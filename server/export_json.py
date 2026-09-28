import json
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "cards.db"
OUTPUT_JSON = DATA_DIR / "cards.json"
STATIC_JSON = BASE_DIR / "static" / "cards.json"


def export_cards_to_json():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    rows = cur.execute("""
    SELECT id, filename, name, company, title, mobile, phone, fax, email,
           address, website, tax_id, date_str, context, tags, notes,
           image_paths, ocr_status, ocr_engine, created_at, updated_at
    FROM cards
    ORDER BY id ASC;
    """).fetchall()

    cards = []
    for r in rows:
        d = dict(r)
        try:
            d["tags"] = json.loads(d["tags"])
        except Exception:
            d["tags"] = []
        try:
            d["image_paths"] = json.loads(d["image_paths"])
        except Exception:
            d["image_paths"] = []
        cards.append(d)

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=2)

    with open(STATIC_JSON, "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False)

    print(f"[Export] Successfully exported {len(cards)} cards to {OUTPUT_JSON} and {STATIC_JSON}")
    conn.close()


if __name__ == "__main__":
    export_cards_to_json()
