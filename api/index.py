from fastapi import FastAPI, APIRouter, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import json
from pathlib import Path

app = FastAPI(title="AI Card Hub Serverless API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent.parent
CARDS_PATHS = [
    BASE_DIR / "static" / "cards.json",
    BASE_DIR / "data" / "cards.json",
    BASE_DIR / "public" / "cards.json",
    Path(__file__).resolve().parent / "cards.json"
]

_cards_cache = None

def get_cards():
    global _cards_cache
    if _cards_cache is None:
        for p in CARDS_PATHS:
            if p.exists():
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        _cards_cache = json.load(f)
                        break
                except Exception:
                    pass
        if _cards_cache is None:
            _cards_cache = []
    return _cards_cache


@router.get("/stats")
def stats():
    cards = get_cards()
    total = len(cards)
    with_img = sum(1 for c in cards if c.get("image_paths"))
    with_phone = sum(1 for c in cards if c.get("phone") or c.get("mobile"))
    with_email = sum(1 for c in cards if c.get("email"))
    ocr_done = sum(1 for c in cards if c.get("ocr_status") == "done")
    pending_ocr = sum(1 for c in cards if c.get("ocr_status") == "pending")

    tag_counts = {}
    for c in cards:
        for t in c.get("tags", []):
            tag_counts[t] = tag_counts.get(t, 0) + 1
    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:15]

    return {
        "total": total,
        "with_image": with_img,
        "with_phone": with_phone,
        "with_email": with_email,
        "ocr_done": ocr_done,
        "pending_ocr": pending_ocr,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags]
    }


@router.get("/cards")
def list_cards(
    q: str = None,
    tag: str = None,
    status: str = None,
    has_image: bool = None,
    has_phone: bool = None,
    has_email: bool = None,
    page: int = 1,
    limit: int = 30
):
    cards = get_cards()
    filtered = cards

    if q and q.strip():
        q_lower = q.strip().lower()
        filtered = [
            c for c in filtered if (
                q_lower in (c.get("name") or "").lower() or
                q_lower in (c.get("company") or "").lower() or
                q_lower in (c.get("title") or "").lower() or
                q_lower in (c.get("mobile") or "").lower() or
                q_lower in (c.get("phone") or "").lower() or
                q_lower in (c.get("email") or "").lower() or
                q_lower in (c.get("address") or "").lower() or
                q_lower in (c.get("notes") or "").lower() or
                any(q_lower in t.lower() for t in c.get("tags", []))
            )
        ]

    if tag and tag.strip():
        filtered = [c for c in filtered if tag.strip() in c.get("tags", [])]

    if has_image is True:
        filtered = [c for c in filtered if c.get("image_paths")]
    elif has_image is False:
        filtered = [c for c in filtered if not c.get("image_paths")]

    if has_phone is True:
        filtered = [c for c in filtered if c.get("phone") or c.get("mobile")]

    if has_email is True:
        filtered = [c for c in filtered if c.get("email")]

    if status and status != "all":
        filtered = [c for c in filtered if c.get("ocr_status") == status]

    total = len(filtered)
    offset = (page - 1) * limit
    page_cards = filtered[offset:offset + limit]

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": (total + limit - 1) // limit if limit else 1,
        "cards": page_cards
    }


@router.get("/cards/{card_id}")
def get_card(card_id: int):
    cards = get_cards()
    for c in cards:
        if c.get("id") == card_id:
            return c
    return JSONResponse(status_code=404, content={"detail": "Card not found"})


@router.get("/")
@router.get("")
def root():
    return {"status": "ok", "app": "AI Card Hub Serverless API", "total_cards": len(get_cards())}

# Support both with and without /api prefix, and handle index.py
app.include_router(router, prefix="/api")
app.include_router(router)
app.include_router(router, prefix="/api/index.py")
