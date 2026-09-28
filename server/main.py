import os
import sys
import re
import json
import sqlite3
import shutil
import uuid
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, Query, HTTPException, UploadFile, File, Form, status
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from indexer import DB_PATH, EVERNOTE_DIR, init_db
from ocr_engine import process_card_image

# Directories
BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
STATIC_DIR = BASE_DIR / "static"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# Ensure DB exists
init_db(DB_PATH)

app = FastAPI(title="AI 名片管理系統 (Card Hub)", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


class CardUpdateModel(BaseModel):
    name: Optional[str] = ""
    company: Optional[str] = ""
    title: Optional[str] = ""
    mobile: Optional[str] = ""
    phone: Optional[str] = ""
    fax: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    website: Optional[str] = ""
    tax_id: Optional[str] = ""
    context: Optional[str] = ""
    tags: Optional[List[str]] = []
    notes: Optional[str] = ""


class CardCreateModel(CardUpdateModel):
    image_paths: Optional[List[str]] = []
    raw_text: Optional[str] = ""
    ocr_engine: Optional[str] = "manual"


# --- API Endpoints ---

@app.get("/api/stats")
def get_stats():
    conn = get_db()
    cur = conn.cursor()
    total = cur.execute("SELECT count(*) FROM cards;").fetchone()[0]
    with_img = cur.execute("SELECT count(*) FROM cards WHERE image_paths != '[]';").fetchone()[0]
    with_phone = cur.execute("SELECT count(*) FROM cards WHERE (phone != '' OR mobile != '');").fetchone()[0]
    with_email = cur.execute("SELECT count(*) FROM cards WHERE email != '';").fetchone()[0]
    ocr_done = cur.execute("SELECT count(*) FROM cards WHERE ocr_status = 'done';").fetchone()[0]
    pending_ocr = cur.execute("SELECT count(*) FROM cards WHERE ocr_status = 'pending';").fetchone()[0]

    # Tag frequency
    tag_counts: Dict[str, int] = {}
    for row in cur.execute("SELECT tags FROM cards WHERE tags != '[]';").fetchall():
        try:
            ts = json.loads(row["tags"])
            for t in ts:
                tag_counts[t] = tag_counts.get(t, 0) + 1
        except Exception:
            pass

    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:15]

    conn.close()
    return {
        "total": total,
        "with_image": with_img,
        "with_phone": with_phone,
        "with_email": with_email,
        "ocr_done": ocr_done,
        "pending_ocr": pending_ocr,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags]
    }


@app.get("/api/cards")
def list_cards(
    q: Optional[str] = Query(None, description="Search query"),
    tag: Optional[str] = Query(None, description="Filter by tag"),
    has_image: Optional[bool] = Query(None),
    status: Optional[str] = Query(None, description="all, pending, done, indexed"),
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=200)
):
    conn = get_db()
    cur = conn.cursor()
    offset = (page - 1) * limit

    where_clauses = []
    params = []

    if q and q.strip():
        search_term = q.strip()
        # Clean FTS5 special characters
        clean_q = re.sub(r'["\*\^]', '', search_term)
        tokens = [f'"{tok}"*' for tok in clean_q.split() if tok]
        if tokens:
            match_expr = " AND ".join(tokens)
            where_clauses.append("c.id IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ?)")
            params.append(match_expr)

    if tag and tag.strip():
        where_clauses.append("c.tags LIKE ?")
        params.append(f'%"{tag.strip()}"%')

    if has_image is True:
        where_clauses.append("c.image_paths != '[]'")
    elif has_image is False:
        where_clauses.append("c.image_paths = '[]'")

    if status and status != "all":
        where_clauses.append("c.ocr_status = ?")
        params.append(status)

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    # Count total
    count_sql = f"SELECT count(*) FROM cards c {where_sql}"
    total_count = cur.execute(count_sql, params).fetchone()[0]

    # Query cards
    cards_sql = f"""
    SELECT c.id, c.filename, c.name, c.company, c.title, c.mobile, c.phone, c.fax, c.email,
           c.address, c.website, c.tax_id, c.date_str, c.context, c.tags, c.notes,
           c.image_paths, c.ocr_status, c.ocr_engine, c.created_at, c.updated_at
    FROM cards c
    {where_sql}
    ORDER BY c.id DESC
    LIMIT ? OFFSET ?;
    """
    card_rows = cur.execute(cards_sql, params + [limit, offset]).fetchall()

    results = []
    for r in card_rows:
        d = dict(r)
        try:
            d["tags"] = json.loads(d["tags"])
        except Exception:
            d["tags"] = []
        try:
            d["image_paths"] = json.loads(d["image_paths"])
        except Exception:
            d["image_paths"] = []
        results.append(d)

    conn.close()
    return {
        "total": total_count,
        "page": page,
        "limit": limit,
        "total_pages": (total_count + limit - 1) // limit,
        "cards": results
    }


@app.get("/api/cards/{card_id}")
def get_card(card_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM cards WHERE id = ?;", (card_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Card not found")
    d = dict(row)
    d["tags"] = json.loads(d["tags"]) if d["tags"] else []
    d["image_paths"] = json.loads(d["image_paths"]) if d["image_paths"] else []
    return d


@app.put("/api/cards/{card_id}")
def update_card(card_id: int, card_data: CardUpdateModel):
    conn = get_db()
    cur = conn.cursor()
    row = cur.execute("SELECT id FROM cards WHERE id = ?;", (card_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Card not found")

    tags_json = json.dumps(card_data.tags or [], ensure_ascii=False)
    with conn:
        conn.execute("""
        UPDATE cards SET
            name = ?, company = ?, title = ?, mobile = ?, phone = ?, fax = ?,
            email = ?, address = ?, website = ?, tax_id = ?, context = ?,
            tags = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?;
        """, (
            card_data.name, card_data.company, card_data.title,
            card_data.mobile, card_data.phone, card_data.fax,
            card_data.email, card_data.address, card_data.website,
            card_data.tax_id, card_data.context, tags_json,
            card_data.notes, card_id
        ))

    conn.close()
    return {"success": True, "id": card_id}


@app.post("/api/cards")
def create_card(card_data: CardCreateModel):
    conn = get_db()
    cur = conn.cursor()
    filename = f"manual_{uuid.uuid4().hex[:8]}.md"
    tags_json = json.dumps(card_data.tags or [], ensure_ascii=False)
    images_json = json.dumps(card_data.image_paths or [], ensure_ascii=False)

    with conn:
        cur.execute("""
        INSERT INTO cards (
            filename, name, company, title, mobile, phone, fax, email,
            address, website, tax_id, context, tags, notes, raw_text,
            image_paths, ocr_status, ocr_engine
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?);
        """, (
            filename, card_data.name, card_data.company, card_data.title,
            card_data.mobile, card_data.phone, card_data.fax, card_data.email,
            card_data.address, card_data.website, card_data.tax_id,
            card_data.context, tags_json, card_data.notes, card_data.raw_text,
            images_json, card_data.ocr_engine
        ))
        new_id = cur.lastrowid

    conn.close()
    return {"success": True, "id": new_id}


@app.post("/api/ocr")
async def ocr_upload(file: UploadFile = File(...), engine: str = Form("hybrid")):
    """Upload new business card image and run AI Vision OCR."""
    ext = Path(file.filename or "card.jpg").suffix
    unique_fn = f"card_{uuid.uuid4().hex[:12]}{ext}"
    dest_path = UPLOADS_DIR / unique_fn

    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        extracted = process_card_image(str(dest_path), prefer_engine=engine)
        return {
            "success": True,
            "image_url": f"/uploads/{unique_fn}",
            "data": extracted
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cards/{card_id}/ocr")
def ocr_existing_card(card_id: int, engine: str = Query("hybrid")):
    """Run AI OCR on an existing card from its image, and auto-enrich its fields."""
    conn = get_db()
    row = conn.execute("SELECT * FROM cards WHERE id = ?;", (card_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Card not found")

    image_paths = json.loads(row["image_paths"]) if row["image_paths"] else []
    if not image_paths:
        conn.close()
        raise HTTPException(status_code=400, detail="此名片沒有可辨識的圖片檔案")

    first_img = image_paths[0]
    # Check if in uploads or in evernote resources
    if first_img.startswith("/uploads/"):
        target_path = UPLOADS_DIR / Path(first_img).name
    elif first_img.startswith("uploads/"):
        target_path = DATA_DIR / first_img
    else:
        target_path = EVERNOTE_DIR / first_img

    if not target_path.exists():
        conn.close()
        raise HTTPException(status_code=404, detail=f"實體圖片檔不存在: {target_path}")

    extracted = process_card_image(str(target_path), prefer_engine=engine)

    # Merge extracted fields: prefer extracted if non-empty, otherwise keep existing
    name = extracted.get("name") or row["name"]
    company = extracted.get("company") or row["company"]
    title = extracted.get("title") or row["title"]
    mobile = extracted.get("mobile") or row["mobile"]
    phone = extracted.get("phone") or row["phone"]
    fax = extracted.get("fax") or row["fax"]
    email = extracted.get("email") or row["email"]
    address = extracted.get("address") or row["address"]
    website = extracted.get("website") or row["website"]
    tax_id = extracted.get("tax_id") or row["tax_id"]

    # Merge tags
    orig_tags = json.loads(row["tags"]) if row["tags"] else []
    new_tags = list(set(orig_tags + (extracted.get("tags") or [])))
    tags_json = json.dumps(new_tags, ensure_ascii=False)

    notes = (row["notes"] + "\n\n" + extracted.get("notes", "")).strip() if extracted.get("notes") else row["notes"]
    raw_text = extracted.get("raw_text") or row["raw_text"]
    ocr_engine = extracted.get("engine", "gemini-2.5-flash")

    with conn:
        conn.execute("""
        UPDATE cards SET
            name = ?, company = ?, title = ?, mobile = ?, phone = ?, fax = ?,
            email = ?, address = ?, website = ?, tax_id = ?, tags = ?,
            notes = ?, raw_text = ?, ocr_status = 'done', ocr_engine = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?;
        """, (
            name, company, title, mobile, phone, fax,
            email, address, website, tax_id, tags_json,
            notes, raw_text, ocr_engine, card_id
        ))

    updated_row = conn.execute("SELECT * FROM cards WHERE id = ?;", (card_id,)).fetchone()
    conn.close()

    d = dict(updated_row)
    d["tags"] = json.loads(d["tags"])
    d["image_paths"] = json.loads(d["image_paths"])
    return {"success": True, "card": d}


# --- Export Endpoints ---

@app.get("/api/export/vcard")
def export_vcard(q: Optional[str] = None, tag: Optional[str] = None):
    """Export cards as vCard 3.0 file."""
    conn = get_db()
    cur = conn.cursor()
    where = []
    params = []
    if q and q.strip():
        clean_q = re.sub(r'["\*\^]', '', q.strip())
        tokens = [f'"{tok}"*' for tok in clean_q.split() if tok]
        if tokens:
            where.append("c.id IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ?)")
            params.append(" AND ".join(tokens))
    if tag:
        where.append("c.tags LIKE ?")
        params.append(f'%"{tag.strip()}"%')

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    rows = cur.execute(f"SELECT * FROM cards c {where_sql} LIMIT 500;", params).fetchall()
    conn.close()

    vcf_lines = []
    for r in rows:
        vcf_lines.append("BEGIN:VCARD")
        vcf_lines.append("VERSION:3.0")
        vcf_lines.append(f"FN:{r['name'] or '未命名'}")
        if r["company"]:
            vcf_lines.append(f"ORG:{r['company']}")
        if r["title"]:
            vcf_lines.append(f"TITLE:{r['title']}")
        if r["mobile"]:
            vcf_lines.append(f"TEL;TYPE=CELL:{r['mobile']}")
        if r["phone"]:
            vcf_lines.append(f"TEL;TYPE=WORK:{r['phone']}")
        if r["email"]:
            vcf_lines.append(f"EMAIL;TYPE=INTERNET:{r['email']}")
        if r["address"]:
            vcf_lines.append(f"ADR;TYPE=WORK:;;{r['address']};;;;")
        if r["website"]:
            vcf_lines.append(f"URL:{r['website']}")
        if r["notes"]:
            clean_n = r["notes"].replace("\n", "\\n")
            vcf_lines.append(f"NOTE:{clean_n}")
        vcf_lines.append("END:VCARD\n")

    content = "\n".join(vcf_lines)
    return Response(
        content=content,
        media_type="text/vcard",
        headers={"Content-Disposition": "attachment; filename=business_cards.vcf"}
    )


# --- Static Resource Serving ---
app.mount("/resources", StaticFiles(directory=str(EVERNOTE_DIR)), name="resources")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return HTMLResponse("<h1>AI 名片管理系統 (Card Hub) - 靜態頁面加載中</h1>")
