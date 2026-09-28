# 🪪 AI Card Hub (名片大腦 ‧ 商務人脈管理系統)

專為教練打造的本地優先 (Local-First) 商務名片管理系統，已全量入庫 **2,025 筆商務人脈筆記** 與 **5,365 張實體名片圖檔**，支援毫秒級全文檢索、多維篩選與雙引擎 AI 圖片自動辨識對應欄位。

---

## 🌟 核心功能特色

1. **秒級全文檢索 (SQLite FTS5)**：
   - 支援搜尋姓名、公司、職稱、手機、市內電話、Email、地址、BNI 分會、相遇場合與原始筆記。
   - 支援鍵盤快捷鍵 `/` 快速聚焦搜尋框，`Esc` 關閉彈窗。
2. **名片牆與清單雙模式 (Grid & Table)**：
   - 高清名片圖預覽、雙面/多圖檢視與放大鏡。
   - 一鍵撥打電話、複製電話/Email 至剪貼簿。
3. **新增名片 ‧ 雙引擎 AI 視覺辨識 (AI Vision Pipeline)**：
   - 拖曳或拍照上傳新名片（JPG, PNG, HEIC, WebP）。
   - **Gemini 2.5 Flash Vision**（推薦）：超高辨識率，精確萃取並對應至標準欄位（姓名、公司、職稱、電話、Email、統一編號、地址、標籤、業務備忘）。
   - **Apple Vision Framework**（原生神經引擎）：本機 Mac 離線備援，0 API 成本，300 毫秒極速辨識。
4. **既有名片按需 AI 補全**：
   - 針對當初僅拍照存檔、尚未建立文字的 1,152 張名片，在卡片上點擊「⚡ AI 辨識」即可即時辨識並回寫補全資料庫。
5. **通訊錄無縫匯出 (vCard / CSV)**：
   - 一鍵匯出為標準 `business_cards.vcf`，可直接匯入 iPhone / Mac 通訊錄或 Google Contacts。

---

## 🚀 快速啟動方式

在終端機執行：

```bash
cd /Users/aios/Projects/00.AI-Notes_Local/card-hub
./start.sh
```

服務將在本地啟動：
👉 **瀏覽器開啟：`http://127.0.0.1:8765`**

---

## 📁 系統目錄結構

```
card-hub/
├── data/
│   ├── cards.db               # SQLite 資料庫 (含 FTS5 全文檢索索引)
│   └── uploads/               # 新上傳名片圖片存儲目錄
├── server/
│   ├── bin/
│   │   └── apple_ocr          # 本機編譯之 macOS Apple Vision 原生 CLI
│   ├── indexer.py             # 2,025 筆 Evernote 名片萃取與建庫腳本
│   ├── ocr_engine.py          # 雙引擎 OCR (Gemini Vision + Apple Vision)
│   └── main.py                # FastAPI 後端服務 (REST API + 靜態託管)
├── static/
│   ├── index.html             # 現代化單頁 Web 應用 (含深色/淺色主題)
│   ├── styles.css             # 頂級精緻 UI 樣式 (Glassmorphism 毛玻璃卡片)
│   └── app.js                 # 前端互動邏輯 (即時檢索、拖曳上傳、動態補全)
├── start.sh                   # 一鍵啟動腳本
└── README.md                  # 本系統說明文件
```

---

## 🔄 重新建立或更新索引

若未來在 `Evernote-BK/012 Name 名片` 目錄新增或修改了 Markdown 檔案，可執行：

```bash
/Users/aios/Projects/00.AI-Notes_Local/.venv/bin/python server/indexer.py
```
*(若需全量重建可加上 `--force` 參數)*
