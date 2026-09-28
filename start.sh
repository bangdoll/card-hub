#!/usr/bin/env bash
# AI Card Hub Launcher
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

VENV_PYTHON="/Users/aios/Projects/00.AI-Notes_Local/.venv/bin/python"

echo "================================================"
echo "🪪  AI Card Hub (名片大腦 ‧ 商務人脈管理系統)"
echo "================================================"
echo "檢查資料庫與服務中..."

# Run server
exec "$VENV_PYTHON" -m uvicorn server.main:app --host 127.0.0.1 --port 8765 --reload
