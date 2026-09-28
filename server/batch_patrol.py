import os
import sys
import re
import json
import sqlite3
import subprocess
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "cards.db"
EVERNOTE_DIR = Path("/Users/aios/Projects/00.AI-Notes_Local/Evernote-BK/012 Name 名片")
APPLE_OCR_BIN = BASE_DIR / "server" / "bin" / "apple_ocr"


def clean_phone_str(raw: str) -> str:
    return raw.replace("（", "(").replace("）", ")").replace("：", ":").replace("•", " ").replace("、", " ")


def extract_fields_from_ocr(raw_text: str, existing_name: str = "", existing_company: str = ""):
    text = clean_phone_str(raw_text)
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    mobile = ""
    phone = ""
    fax = ""
    email = ""
    address = ""
    tax_id = ""
    title = ""
    company = existing_company
    name = existing_name

    title_keywords = [
        "總經理", "執行長", "董事長", "總監", "經理", "副總", "顧問", "律師", "會計師",
        "地政士", "建築師", "設計師", "創辦人", "工程師", "理事長", "理事", "代表", "店長",
        "講師", "醫師", "主任", "負責人", "社長", "主席", "常務理事", "理財顧問", "秘書",
        "General Manager", "Director", "CEO", "Founder", "President", "Partner", "Manager"
    ]
    company_keywords = [
        "有限公司", "股份有限公司", "企業社", "事務所", "工作室", "診所", "協會", "商行",
        "學會", "中心", "公會", "集團", "旅行社", "商務中心", "攝影", "科技", "音響",
        "Company", "Co.,", "Inc.", "Ltd.", "Corp."
    ]

    for line in lines:
        # Email
        if not email:
            em = re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", line)
            if em:
                email = em.group(0)

        # Tax ID
        if not tax_id:
            tax = re.search(r"(?:統編|統一編號|TAX ID)?[\s:：]*(\d{8})", line, re.I)
            if tax and any(k in line for k in ["統", "TAX"]):
                tax_id = tax.group(1)

        # Fax
        if not fax and any(k in line.lower() for k in ["fax", "傳真"]):
            fx = re.search(r"(?:\(?0\d{1,2}\)?[\s\-]?)?\d{3,4}[\s\-]?\d{4}", line)
            if fx:
                fax = fx.group(0)

        # Mobile
        if not mobile:
            mob = re.search(r"(?:09\d{2}[-\s]?\d{3}[-\s]?\d{3}|\+?886[-\s]?9\d{2}[-\s]?\d{3}[-\s]?\d{3})", line)
            if mob:
                mobile = mob.group(0)

        # Phone
        if not phone:
            tel_m = re.search(r"(?:(?:TEL|電話|話)[\s:]*)?\(?0\d{1,2}\)?[\s\-]?[2-8]\d{2,3}[\s\-]?\d{4}", line, re.I)
            if tel_m and line != mobile and (not fax or line != fax):
                p_cand = tel_m.group(0)
                p_cand = re.sub(r"^(?:TEL|電話|話)[\s:]*", "", p_cand, flags=re.I).strip()
                phone = p_cand

        # Address
        if not address:
            addr = re.search(r"(?:台北|新北|桃園|台中|台南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東)[市縣][\w區鄉鎮市路街巷弄號樓\-]+", line)
            if addr:
                address = addr.group(0)

        # Company
        if not company and any(k in line for k in company_keywords):
            company = line

        # Title
        if not title:
            for tk in title_keywords:
                if tk in line and len(line) <= 25 and not any(ck in line for ck in company_keywords):
                    title = line
                    break

    return {
        "name": name, "company": company, "title": title,
        "mobile": mobile, "phone": phone, "fax": fax,
        "email": email, "tax_id": tax_id, "address": address,
        "raw_text": raw_text
    }


def run_batch_patrol(limit: int = None, verbose: bool = True):
    if not APPLE_OCR_BIN.exists() or not os.access(APPLE_OCR_BIN, os.X_OK):
        print(f"Error: Apple Vision binary not found at {APPLE_OCR_BIN}", file=sys.stderr)
        return

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Cards that have images and need OCR enrichment
    query = """
    SELECT id, filename, name, company, title, mobile, phone, fax, email, address, tax_id, tags, notes, image_paths
    FROM cards
    WHERE image_paths != '[]'
      AND (
          (phone = '' AND mobile = '')
          OR email = ''
          OR address = ''
          OR ocr_status = 'pending'
      )
    ORDER BY id ASC;
    """
    targets = cur.execute(query).fetchall()
    total_targets = len(targets)
    if limit:
        targets = targets[:limit]

    print("==================================================")
    print(f"🪪  AI 名片庫全量巡檢補全引擎 (Apple Vision)")
    print(f"🎯 待巡檢名片總數: {total_targets} 筆 (本次執行: {len(targets)} 筆)")
    print("==================================================")

    start_time = time.time()
    enriched_count = 0
    new_phones = 0
    new_emails = 0
    new_addresses = 0
    new_titles = 0
    new_companies = 0

    to_update = []

    for i, row in enumerate(targets, 1):
        cid = row["id"]
        cname = row["name"]
        imgs = json.loads(row["image_paths"])
        if not imgs:
            continue

        first_img = imgs[0]
        img_p = EVERNOTE_DIR / first_img
        if not img_p.exists():
            continue

        # Run native Apple Vision OCR
        try:
            proc = subprocess.run([str(APPLE_OCR_BIN), str(img_p)], capture_output=True, text=True, timeout=5)
            ocr_text = proc.stdout.strip()
        except Exception:
            continue

        if not ocr_text:
            continue

        extracted = extract_fields_from_ocr(ocr_text, existing_name=cname, existing_company=row["company"])

        # Compare and enrich
        updated_name = extracted["name"] or cname
        updated_company = extracted["company"] or row["company"]
        updated_title = extracted["title"] or row["title"]
        updated_mobile = extracted["mobile"] or row["mobile"]
        updated_phone = extracted["phone"] or row["phone"]
        updated_fax = extracted["fax"] or row["fax"]
        updated_email = extracted["email"] or row["email"]
        updated_address = extracted["address"] or row["address"]
        updated_tax_id = extracted["tax_id"] or row["tax_id"]

        changes = []
        if updated_mobile and not row["mobile"]:
            new_phones += 1
            changes.append(f"手機: {updated_mobile}")
        if updated_phone and not row["phone"]:
            new_phones += 1
            changes.append(f"電話: {updated_phone}")
        if updated_email and not row["email"]:
            new_emails += 1
            changes.append(f"Email: {updated_email}")
        if updated_address and not row["address"]:
            new_addresses += 1
            changes.append(f"地址: {updated_address[:15]}...")
        if updated_title and not row["title"]:
            new_titles += 1
            changes.append(f"職稱: {updated_title}")
        if updated_company and not row["company"]:
            new_companies += 1
            changes.append(f"公司: {updated_company}")

        raw_text = (row["notes"] + "\n\n" + ocr_text).strip()

        to_update.append((
            updated_name, updated_company, updated_title,
            updated_mobile, updated_phone, updated_fax,
            updated_email, updated_address, updated_tax_id,
            raw_text, cid
        ))
        enriched_count += 1

        if verbose and changes:
            print(f"[{i}/{len(targets)}] ID {cid} {cname} -> +{', '.join(changes)}")
        elif verbose and i % 50 == 0:
            print(f"[{i}/{len(targets)}] 巡檢進度 {(i/len(targets)*100):.1f}%...")

        # Batch commit every 50 records
        if len(to_update) >= 50:
            with conn:
                conn.executemany("""
                UPDATE cards SET
                    name = ?, company = ?, title = ?,
                    mobile = ?, phone = ?, fax = ?,
                    email = ?, address = ?, tax_id = ?,
                    raw_text = ?, ocr_status = 'done', ocr_engine = 'apple-vision',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?;
                """, to_update)
            to_update = []

    # Commit remaining
    if to_update:
        with conn:
            conn.executemany("""
            UPDATE cards SET
                name = ?, company = ?, title = ?,
                mobile = ?, phone = ?, fax = ?,
                email = ?, address = ?, tax_id = ?,
                raw_text = ?, ocr_status = 'done', ocr_engine = 'apple-vision',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?;
            """, to_update)

    elapsed = time.time() - start_time
    print("\n==================================================")
    print(f"🎉 巡檢完成！耗時: {elapsed:.1f} 秒")
    print(f"📊 巡檢名片: {len(targets)} 筆 | 成功辨識更新: {enriched_count} 筆")
    print(f"📈 補齊新資訊:")
    print(f"   - 新增電話/手機: +{new_phones} 筆")
    print(f"   - 新增 Email:    +{new_emails} 筆")
    print(f"   - 新增通訊地址: +{new_addresses} 筆")
    print(f"   - 新增職稱:      +{new_titles} 筆")
    print(f"   - 新增公司:      +{new_companies} 筆")
    print("==================================================")
    conn.close()


if __name__ == "__main__":
    lim = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else None
    run_batch_patrol(limit=lim)
