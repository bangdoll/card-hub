import os
import sys
import re
import json
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except ImportError:
    pass

APPLE_OCR_BIN = Path(__file__).resolve().parent / "bin" / "apple_ocr"

def extract_structured_with_gemini(image_path: str) -> Optional[Dict[str, Any]]:
    """Use Gemini 2.5 Flash Vision to extract structured business card fields."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        from google import genai
        from google.genai import types
        from PIL import Image

        client = genai.Client(api_key=api_key)
        img = Image.open(image_path)

        prompt = """請仔細辨識並分析這張名片圖片，將其內容萃取為標準 JSON 格式。
請務必嚴格遵循以下 JSON 欄位（若名片中未提及該資訊，請填寫為空字串 ""，標籤填寫為空陣列 []）：
{
  "name": "姓名（中文姓名或英文全名）",
  "company": "公司或組織完整全銜",
  "title": "職稱或職務（例如：總經理、資深設計師、理財顧問）",
  "mobile": "行動電話（手機號碼，格式例如 0912-345-678）",
  "phone": "市內電話或公司總機（格式例如 02-2345-6789，含分機如 ext 123）",
  "fax": "傳真號碼",
  "email": "電子郵件信箱",
  "address": "地址（完整中文地址或英文地址）",
  "website": "公司官網或社群連結",
  "tax_id": "統一編號（8碼數字）",
  "tags": ["建議分類標籤，例如行業分類、BNI、設計、金融、醫療等"],
  "notes": "名片上的業務介紹、專業項目或Slogan等備註資訊",
  "raw_text": "名片上所有文字的完整換行排版"
}
僅輸出標準合法 JSON 字串，不要包含任何 markdown 標記（如 ```json ），直接輸出 JSON。"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[img, prompt],
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json"
            )
        )

        text = response.text.strip()
        # Clean any remaining markdown wrappers
        text = re.sub(r"^```json\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
        data = json.loads(text)
        data["engine"] = "gemini-2.5-flash"
        return data
    except Exception as e:
        print(f"[OCR] Gemini vision extraction failed: {e}", file=sys.stderr)
        return None


def extract_text_with_apple_vision(image_path: str) -> str:
    """Run local native Apple Vision binary to extract text quickly."""
    if not APPLE_OCR_BIN.exists() or not os.access(APPLE_OCR_BIN, os.X_OK):
        return ""
    try:
        proc = subprocess.run(
            [str(APPLE_OCR_BIN), image_path],
            capture_output=True,
            text=True,
            timeout=10
        )
        if proc.returncode == 0:
            return proc.stdout.strip()
        else:
            print(f"[OCR] Apple Vision error: {proc.stderr}", file=sys.stderr)
            return ""
    except Exception as e:
        print(f"[OCR] Apple Vision execution failed: {e}", file=sys.stderr)
        return ""


def parse_raw_text_heuristically(raw_text: str) -> Dict[str, Any]:
    """Parse raw OCR text into structured fields using regex patterns."""
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    
    name = ""
    company = ""
    title = ""
    mobile = ""
    phone = ""
    fax = ""
    email = ""
    address = ""
    website = ""
    tax_id = ""
    notes = []
    
    # Common title keywords
    title_keywords = ["總經理", "執行長", "董事長", "總監", "經理", "副總", "顧問", "律師", "會計師", "設計師", "創辦人", "工程師", "理事", "代表", "Director", "Manager", "CEO", "Founder", "President"]
    company_keywords = ["有限公司", "股份有限公司", "企業社", "事務所", "工作室", "診所", "協會", "商行", "學會", "中心", "Company", "Co.,", "Inc.", "Ltd.", "Corp."]

    for line in lines:
        # Check Email
        em = re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", line)
        if em and not email:
            email = em.group(0)
            continue
            
        # Check Website
        web = re.search(r"https?://\S+|www\.[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", line)
        if web and not website:
            website = web.group(0)
            continue

        # Check Tax ID
        tax = re.search(r"(?:統編|統一編號|TAX ID)?[\s:：]*(\d{8})", line, re.I)
        if tax and any(k in line for k in ["統", "TAX"]):
            tax_id = tax.group(1)
            continue

        # Check Mobile
        mob = re.search(r"(?:09\d{2}[-\s]?\d{3}[-\s]?\d{3})", line)
        if mob and not mobile:
            mobile = mob.group(0)
            continue

        # Check Phone
        tel = re.search(r"(?:0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{3,4})", line)
        if tel and not phone and line != mobile:
            phone = tel.group(0)
            continue

        # Check Fax
        if any(k in line.lower() for k in ["fax", "傳真"]):
            fx = re.search(r"(?:0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{3,4})", line)
            if fx and not fax:
                fax = fx.group(0)
                continue

        # Check Address
        addr = re.search(r"(?:台北|新北|桃園|台中|台南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東)[市縣][\w區鄉鎮市路街巷弄號樓\-]+", line)
        if addr and not address:
            address = addr.group(0)
            continue

        # Check Company
        if any(k in line for k in company_keywords) and not company:
            company = line
            continue

        # Check Title
        if any(k in line for k in title_keywords) and not title:
            title = line
            continue

        # Fallback Name heuristics: first short line (2-4 chars) with no digits
        if not name and len(line) in [2, 3, 4] and not re.search(r"\d", line) and not any(k in line for k in title_keywords + company_keywords):
            name = line
            continue

        notes.append(line)

    return {
        "name": name,
        "company": company,
        "title": title,
        "mobile": mobile,
        "phone": phone,
        "fax": fax,
        "email": email,
        "address": address,
        "website": website,
        "tax_id": tax_id,
        "tags": ["名片辨識"],
        "notes": "\n".join(notes[:5]),
        "raw_text": raw_text,
        "engine": "apple-vision-heuristic"
    }


def process_card_image(image_path: str, prefer_engine: str = "hybrid") -> Dict[str, Any]:
    """
    Main entry point for processing a business card image.
    prefer_engine can be 'hybrid', 'gemini', or 'apple'.
    """
    p = Path(image_path)
    if not p.exists():
        raise FileNotFoundError(f"Image not found at {image_path}")

    # 1. If hybrid or gemini, try Gemini Vision first
    if prefer_engine in ["hybrid", "gemini"]:
        res = extract_structured_with_gemini(str(p))
        if res:
            return res

    # 2. Local Apple Vision fallback
    raw_text = extract_text_with_apple_vision(str(p))
    if raw_text:
        return parse_raw_text_heuristically(raw_text)

    # 3. If everything failed, return empty skeleton
    return {
        "name": "",
        "company": "",
        "title": "",
        "mobile": "",
        "phone": "",
        "fax": "",
        "email": "",
        "address": "",
        "website": "",
        "tax_id": "",
        "tags": [],
        "notes": "",
        "raw_text": "",
        "engine": "none"
    }


if __name__ == "__main__":
    if len(sys.argv) > 1:
        img_p = sys.argv[1]
        print(f"Testing OCR on: {img_p}")
        out = process_card_image(img_p)
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        print("Usage: python ocr_engine.py <image_path>")
