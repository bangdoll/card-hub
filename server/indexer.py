import os
import sys
import re
import json
import sqlite3
from pathlib import Path
from typing import Dict, Any, List

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DB_PATH = DATA_DIR / "cards.db"
EVERNOTE_DIR = Path("/Users/aios/Projects/00.AI-Notes_Local/Evernote-BK/012 Name 名片")


def init_db(db_path: Path = DB_PATH) -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    
    with conn:
        conn.execute("""
        CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE,
            name TEXT,
            company TEXT,
            title TEXT,
            mobile TEXT,
            phone TEXT,
            fax TEXT,
            email TEXT,
            address TEXT,
            website TEXT,
            tax_id TEXT,
            date_str TEXT,
            context TEXT,
            tags TEXT,
            notes TEXT,
            raw_text TEXT,
            image_paths TEXT,
            ocr_status TEXT DEFAULT 'indexed',
            ocr_engine TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
            name,
            company,
            title,
            phone,
            mobile,
            email,
            address,
            tags,
            context,
            notes,
            raw_text,
            content='cards',
            content_rowid='id'
        );
        """)

        # Triggers to keep FTS5 synchronized
        conn.execute("""
        CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON cards BEGIN
            INSERT INTO cards_fts(rowid, name, company, title, phone, mobile, email, address, tags, context, notes, raw_text)
            VALUES (new.id, new.name, new.company, new.title, new.phone, new.mobile, new.email, new.address, new.tags, new.context, new.notes, new.raw_text);
        END;
        """)

        conn.execute("""
        CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON cards BEGIN
            INSERT INTO cards_fts(cards_fts, rowid, name, company, title, phone, mobile, email, address, tags, context, notes, raw_text)
            VALUES ('delete', old.id, old.name, old.company, old.title, old.phone, old.mobile, old.email, old.address, old.tags, old.context, old.notes, old.raw_text);
        END;
        """)

        conn.execute("""
        CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON cards BEGIN
            INSERT INTO cards_fts(cards_fts, rowid, name, company, title, phone, mobile, email, address, tags, context, notes, raw_text)
            VALUES ('delete', old.id, old.name, old.company, old.title, old.phone, old.mobile, old.email, old.address, old.tags, old.context, old.notes, old.raw_text);
            INSERT INTO cards_fts(rowid, name, company, title, phone, mobile, email, address, tags, context, notes, raw_text)
            VALUES (new.id, new.name, new.company, new.title, new.phone, new.mobile, new.email, new.address, new.tags, new.context, new.notes, new.raw_text);
        END;
        """)

    return conn


def parse_markdown_card(fn: str, full_p: Path) -> Dict[str, Any]:
    with open(full_p, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    tags = []
    fm = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    body = content
    if fm:
        body = content[fm.end():].strip()
        for line in fm.group(1).splitlines():
            line = line.strip()
            if line.startswith("- "):
                t = line[2:].strip()
                if t: tags.append(t)

    # Images
    raw_imgs = re.findall(r"!\[\[(.*?)(?:\|.*?)?\]\]", content) + re.findall(r"!\[.*?\]\((.*?)\)", content)
    images = []
    for img in raw_imgs:
        clean = img.strip()
        if clean.startswith("./"): clean = clean[2:]
        if clean.startswith("/"): clean = clean[1:]
        disk_p = EVERNOTE_DIR / clean
        if disk_p.exists():
            images.append(clean)

    # Title parsing
    title_no_ext = fn[:-3] if fn.endswith(".md") else fn
    name = ""
    company = ""
    role = ""
    context = ""
    date_str = ""

    date_m = re.search(r"(20\d{2}[-./]?\d{1,2}[-./]?\d{1,2}|20\d{6})", title_no_ext)
    if date_m:
        date_str = date_m.group(1)

    if "@" in title_no_ext:
        parts = title_no_ext.split("@", 1)
        title_base = parts[0].strip()
        context = parts[1].strip()
    else:
        title_base = title_no_ext

    if "-" in title_base:
        subparts = [p.strip() for p in title_base.split("-") if p.strip()]
        name = subparts[0]
        if len(subparts) > 1 and subparts[1] not in ["名片", "掃描名片"]:
            company = subparts[1]
        if len(subparts) > 2:
            extra = " - ".join(subparts[2:])
            context = f"{extra} | {context}" if context else extra
    elif " " in title_base:
        subparts = [p.strip() for p in title_base.split() if p.strip()]
        if len(subparts) >= 2 and len(subparts[0]) <= 4:
            name = subparts[0]
            company = " ".join(subparts[1:])
        else:
            name = title_base
    else:
        name = title_base

    name = re.sub(r"\s*-\s*名片|\s*-\s*掃描名片|added to iOS Contacts", "", name).strip()

    # Extract Key-values from body if present
    m_co = re.search(r"NAME0\s*:\s*(.+)", body)
    if m_co and not company:
        company = m_co.group(1).strip()

    m_memo = re.search(r"MEMO\s*:\s*(.+)", body)
    if m_memo and not name:
        name = m_memo.group(1).strip()

    # Phones
    phones = re.findall(r"(?:\+?886[-\s]?)?(?:0?9\d{2}[-\s]?\d{3}[-\s]?\d{3}|0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{3,4})", body)
    mobile = ""
    phone = ""
    for p in phones:
        digits = re.sub(r"\D", "", p)
        if len(digits) in [9, 10] and not digits.startswith("201") and not digits.startswith("202"):
            if digits.startswith("09") or (digits.startswith("8869")):
                if not mobile: mobile = p.strip()
            else:
                if not phone: phone = p.strip()

    # Emails
    emails = list(set(re.findall(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", body)))
    email = emails[0] if emails else ""

    # Fax
    fax_m = re.search(r"(?:FAX|傳真)[\s:：]*([\d\-\s]+)", body, re.I)
    fax = fax_m.group(1).strip() if fax_m else ""

    # Tax ID
    tax_m = re.search(r"(?:統一編號|TAX ID|統編)[\s:：]*(\d{8})", body, re.I)
    tax_id = tax_m.group(1) if tax_m else ""

    # Address
    addr_m = re.search(r"(?:台北|新北|桃園|台中|台南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東)[市縣][\w區鄉鎮市路街巷弄號樓\-]+", body)
    address = addr_m.group(0) if addr_m else ""

    # Notes cleaning (strip images and metadata lines)
    clean_notes = re.sub(r"!\[\[.*?\]\]", "", body)
    clean_notes = re.sub(r"!\[.*?\]\(.*?\)", "", clean_notes).strip()

    # Determine initial ocr_status
    if len(clean_notes) < 30 and not phone and not mobile and not email:
        ocr_status = "pending"
    else:
        ocr_status = "indexed"

    return {
        "filename": fn,
        "name": name,
        "company": company,
        "title": role,
        "mobile": mobile,
        "phone": phone,
        "fax": fax,
        "email": email,
        "address": address,
        "website": "",
        "tax_id": tax_id,
        "date_str": date_str,
        "context": context,
        "tags": json.dumps(tags, ensure_ascii=False),
        "notes": clean_notes,
        "raw_text": body,
        "image_paths": json.dumps(images, ensure_ascii=False),
        "ocr_status": ocr_status,
        "ocr_engine": "evernote-parser"
    }


def index_all_cards(force_reindex: bool = False):
    conn = init_db()
    if force_reindex:
        with conn:
            conn.execute("DELETE FROM cards;")
            conn.execute("DELETE FROM cards_fts;")

    existing = set()
    for row in conn.execute("SELECT filename FROM cards;"):
        existing.add(row[0])

    files = [f for f in os.listdir(EVERNOTE_DIR) if f.endswith(".md")]
    print(f"[Indexer] Found {len(files)} markdown cards in {EVERNOTE_DIR}")

    to_insert = []
    for fn in files:
        if not force_reindex and fn in existing:
            continue
        full_p = EVERNOTE_DIR / fn
        card = parse_markdown_card(fn, full_p)
        to_insert.append((
            card["filename"], card["name"], card["company"], card["title"],
            card["mobile"], card["phone"], card["fax"], card["email"],
            card["address"], card["website"], card["tax_id"], card["date_str"],
            card["context"], card["tags"], card["notes"], card["raw_text"],
            card["image_paths"], card["ocr_status"], card["ocr_engine"]
        ))

    if to_insert:
        with conn:
            conn.executemany("""
            INSERT OR REPLACE INTO cards (
                filename, name, company, title, mobile, phone, fax, email,
                address, website, tax_id, date_str, context, tags, notes,
                raw_text, image_paths, ocr_status, ocr_engine
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, to_insert)
        print(f"[Indexer] Successfully indexed {len(to_insert)} cards into database.")
    else:
        print("[Indexer] All cards are already up to date in database.")

    # Print summary counts
    cur = conn.cursor()
    total = cur.execute("SELECT count(*) FROM cards;").fetchone()[0]
    with_img = cur.execute("SELECT count(*) FROM cards WHERE image_paths != '[]';").fetchone()[0]
    pending = cur.execute("SELECT count(*) FROM cards WHERE ocr_status = 'pending';").fetchone()[0]
    indexed = cur.execute("SELECT count(*) FROM cards WHERE ocr_status != 'pending';").fetchone()[0]
    print(f"[Indexer] Total Cards in DB: {total} | With Image: {with_img} | Rich/Indexed: {indexed} | Pending OCR: {pending}")
    conn.close()


if __name__ == "__main__":
    force = "--force" in sys.argv
    index_all_cards(force_reindex=force)
