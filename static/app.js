// AI Card Hub - Frontend Application Logic

const state = {
  query: '',
  filterStatus: 'all',
  activeTag: '',
  page: 1,
  limit: 30,
  total: 0,
  totalPages: 1,
  viewMode: 'grid', // 'grid' or 'table'
  cards: [],
  stats: null,
  currentCard: null,
  uploadedCardData: null
};

// DOM Elements
const searchInput = document.getElementById('searchInput');
const cardsGrid = document.getElementById('cardsGrid');
const cardsTableContainer = document.getElementById('cardsTableContainer');
const cardsTableBody = document.getElementById('cardsTableBody');
const pagination = document.getElementById('pagination');
const loadingIndicator = document.getElementById('loadingIndicator');
const emptyState = document.getElementById('emptyState');
const resRange = document.getElementById('resRange');
const resTotal = document.getElementById('resTotal');

// Modals
const addCardModal = document.getElementById('addCardModal');
const detailModal = document.getElementById('detailModal');
const btnOpenAddModal = document.getElementById('btnOpenAddModal');
const btnCloseAddModal = document.getElementById('btnCloseAddModal');
const btnCancelAdd = document.getElementById('btnCancelAdd');
const btnCloseDetailModal = document.getElementById('btnCloseDetailModal');
const btnDetailClose = document.getElementById('btnDetailClose');

// Upload & OCR
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const selectOcrEngine = document.getElementById('selectOcrEngine');
const ocrStatusMsg = document.getElementById('ocrStatusMsg');
const ocrPreviewContainer = document.getElementById('ocrPreviewContainer');
const previewImage = document.getElementById('previewImage');
const btnSaveCard = document.getElementById('btnSaveCard');

// Stats Elements
const statTotal = document.getElementById('statTotal');
const statWithImg = document.getElementById('statWithImg');
const statWithPhone = document.getElementById('statWithPhone');
const statPendingOcr = document.getElementById('statPendingOcr');
const chipTotalCount = document.getElementById('chipTotalCount');
const filterTagChips = document.getElementById('filterTagChips');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  loadStats();
  loadCards();
});

function initTheme() {
  const saved = localStorage.getItem('cardhub-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cardhub-theme', next);
}

function setupEventListeners() {
  // Theme Toggle
  document.getElementById('btnThemeToggle').addEventListener('click', toggleTheme);

  // Search with debounce
  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.query = e.target.value.trim();
      state.page = 1;
      loadCards();
    }, 280);
  });

  // Keyboard shortcut '/'
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  // View switch
  document.getElementById('btnViewGrid').addEventListener('click', () => setViewMode('grid'));
  document.getElementById('btnViewTable').addEventListener('click', () => setViewMode('table'));

  // Filter Status Chips
  document.getElementById('filterStatusChips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    document.querySelectorAll('#filterStatusChips .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    state.filterStatus = btn.dataset.filterStatus;
    state.page = 1;
    loadCards();
  });

  // Export vCard
  document.getElementById('btnExportVCard').addEventListener('click', () => {
    const url = `/api/export/vcard?q=${encodeURIComponent(state.query)}&tag=${encodeURIComponent(state.activeTag)}`;
    window.open(url, '_blank');
  });

  // Add Modal
  btnOpenAddModal.addEventListener('click', openAddModal);
  btnCloseAddModal.addEventListener('click', closeAddModal);
  btnCancelAdd.addEventListener('click', closeAddModal);
  btnCloseDetailModal.addEventListener('click', closeDetailModal);
  btnDetailClose.addEventListener('click', closeDetailModal);

  // Drag and drop for OCR upload
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelected);

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  // Save new card
  btnSaveCard.addEventListener('click', saveNewCard);
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.getElementById('btnViewGrid').classList.toggle('active', mode === 'grid');
  document.getElementById('btnViewTable').classList.toggle('active', mode === 'table');
  if (mode === 'grid') {
    cardsGrid.style.display = 'grid';
    cardsTableContainer.style.display = 'none';
  } else {
    cardsGrid.style.display = 'none';
    cardsTableContainer.style.display = 'block';
  }
}

let allStaticCards = null;

async function loadStaticCards() {
  if (!allStaticCards) {
    try {
      const res = await fetch('/static/cards.json');
      allStaticCards = await res.json();
    } catch {
      try {
        const res2 = await fetch('/cards.json');
        allStaticCards = await res2.json();
      } catch (e) {
        console.error('Failed to load static cards.json:', e);
        allStaticCards = [];
      }
    }
  }
  return allStaticCards || [];
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error('API not available');
    const data = await res.json();
    applyStatsData(data);
  } catch (err) {
    // Client-side stats calculation from static JSON
    const all = await loadStaticCards();
    const tagCounts = {};
    let withImg = 0, withPhone = 0, withEmail = 0, ocrDone = 0, pendingOcr = 0;
    all.forEach(c => {
      if (c.image_paths && c.image_paths.length > 0) withImg++;
      if (c.phone || c.mobile) withPhone++;
      if (c.email) withEmail++;
      if (c.ocr_status === 'done') ocrDone++;
      if (c.ocr_status === 'pending') pendingOcr++;
      (c.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    });
    const topTags = Object.entries(tagCounts).sort((a,b) => b[1] - a[1]).slice(0, 10).map(([t, c]) => ({ tag: t, count: c }));
    applyStatsData({
      total: all.length,
      with_image: withImg,
      with_phone: withPhone,
      with_email: withEmail,
      ocr_done: ocrDone,
      pending_ocr: pendingOcr,
      top_tags: topTags
    });
  }
}

function applyStatsData(data) {
  state.stats = data;
  statTotal.textContent = data.total.toLocaleString();
  statWithImg.textContent = data.with_image.toLocaleString();
  statWithPhone.textContent = data.with_phone.toLocaleString();
  statPendingOcr.textContent = data.pending_ocr.toLocaleString();
  chipTotalCount.textContent = data.total.toLocaleString();

  filterTagChips.innerHTML = '';
  data.top_tags.slice(0, 6).forEach(({ tag, count }) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(tag)} <span class="chip-count">${count}</span>`;
    chip.addEventListener('click', () => {
      if (state.activeTag === tag) {
        state.activeTag = '';
        chip.classList.remove('active');
      } else {
        document.querySelectorAll('#filterTagChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeTag = tag;
      }
      state.page = 1;
      loadCards();
    });
    filterTagChips.appendChild(chip);
  });
}

async function loadCards() {
  loadingIndicator.style.display = 'flex';

  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit
  });

  if (state.query) params.append('q', state.query);
  if (state.activeTag) params.append('tag', state.activeTag);

  if (state.filterStatus === 'has_image') {
    params.append('has_image', 'true');
  } else if (state.filterStatus === 'has_phone') {
    params.append('has_phone', 'true');
  } else if (state.filterStatus === 'has_email') {
    params.append('has_email', 'true');
  } else if (state.filterStatus === 'pending') {
    params.append('status', 'pending');
  } else if (state.filterStatus === 'done') {
    params.append('status', 'done');
  }

  try {
    const res = await fetch(`/api/cards?${params.toString()}`);
    if (!res.ok) throw new Error('API server unavailable');
    const data = await res.json();

    state.cards = data.cards;
    state.total = data.total;
    state.totalPages = data.total_pages;

    renderCards();
    renderPagination();

    const startIdx = state.total === 0 ? 0 : (state.page - 1) * state.limit + 1;
    const endIdx = Math.min(state.page * state.limit, state.total);
    resRange.textContent = `${startIdx}-${endIdx}`;
    resTotal.textContent = state.total.toLocaleString();

    emptyState.style.display = state.cards.length === 0 ? 'block' : 'none';
  } catch (err) {
    // Seamless fallback to client-side search across static JSON
    await filterCardsClientSide();
  } finally {
    loadingIndicator.style.display = 'none';
  }
}

async function filterCardsClientSide() {
  const all = await loadStaticCards();
  let filtered = all;

  if (state.query) {
    const qLower = state.query.toLowerCase();
    filtered = filtered.filter(c => 
      (c.name && c.name.toLowerCase().includes(qLower)) ||
      (c.company && c.company.toLowerCase().includes(qLower)) ||
      (c.title && c.title.toLowerCase().includes(qLower)) ||
      (c.mobile && c.mobile.includes(qLower)) ||
      (c.phone && c.phone.includes(qLower)) ||
      (c.email && c.email.toLowerCase().includes(qLower)) ||
      (c.address && c.address.toLowerCase().includes(qLower)) ||
      (c.notes && c.notes.toLowerCase().includes(qLower)) ||
      (c.tags && c.tags.some(t => t.toLowerCase().includes(qLower)))
    );
  }

  if (state.activeTag) {
    filtered = filtered.filter(c => c.tags && c.tags.includes(state.activeTag));
  }

  if (state.filterStatus === 'has_image') {
    filtered = filtered.filter(c => c.image_paths && c.image_paths.length > 0);
  } else if (state.filterStatus === 'has_phone') {
    filtered = filtered.filter(c => Boolean(c.phone || c.mobile));
  } else if (state.filterStatus === 'has_email') {
    filtered = filtered.filter(c => Boolean(c.email));
  } else if (state.filterStatus === 'pending') {
    filtered = filtered.filter(c => c.ocr_status === 'pending');
  } else if (state.filterStatus === 'done') {
    filtered = filtered.filter(c => c.ocr_status === 'done');
  }

  state.total = filtered.length;
  state.totalPages = Math.max(1, Math.ceil(filtered.length / state.limit));
  const start = (state.page - 1) * state.limit;
  state.cards = filtered.slice(start, start + state.limit);

  renderCards();
  renderPagination();

  const startIdx = state.total === 0 ? 0 : (state.page - 1) * state.limit + 1;
  const endIdx = Math.min(state.page * state.limit, state.total);
  resRange.textContent = `${startIdx}-${endIdx}`;
  resTotal.textContent = state.total.toLocaleString();
  emptyState.style.display = state.cards.length === 0 ? 'block' : 'none';
}

// --- Render Cards ---
function renderCards() {
  // 1. Grid View
  cardsGrid.innerHTML = '';
  state.cards.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = 'business-card';
    cardEl.dataset.id = card.id;

    // Image logic
    const hasImage = card.image_paths && card.image_paths.length > 0;
    const firstImg = hasImage ? card.image_paths[0] : null;
    const imgSrc = firstImg 
      ? (firstImg.startsWith('/uploads/') ? firstImg : `/resources/${firstImg}`)
      : null;

    const ocrStatusBadge = card.ocr_status === 'done'
      ? `<span class="badge badge-ocr-done">AI 已辨識</span>`
      : (card.ocr_status === 'pending' ? `<span class="badge badge-ocr-pending">待 AI 補全</span>` : '');

    const imagesBadge = hasImage && card.image_paths.length > 1
      ? `<span class="badge badge-images-count">📷 ${card.image_paths.length}張</span>`
      : '';

    const phoneDisplay = card.mobile || card.phone || '';
    const emailDisplay = card.email || '';

    // Tags
    const tagsHtml = (card.tags || []).slice(0, 3)
      .map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('');

    cardEl.innerHTML = `
      <div class="card-media" onclick="openDetailModal(${card.id})">
        ${imgSrc 
          ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(card.name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'card-media-placeholder\\'><span>📷 圖片載入失敗</span></div>'">` 
          : `<div class="card-media-placeholder"><span>🪪 無名片照片</span><small>${escapeHtml(card.company || '名片紀錄')}</small></div>`}
        <div class="media-badges">
          ${imagesBadge}
          ${ocrStatusBadge}
        </div>
      </div>

      <div class="card-body">
        <div class="card-header-info">
          <div class="card-name" onclick="openDetailModal(${card.id})" style="cursor: pointer;">
            ${escapeHtml(card.name || '未命名')}
          </div>
          ${card.company ? `<div class="card-company">🏢 ${escapeHtml(card.company)}</div>` : ''}
          ${card.title ? `<div class="card-title-text">💼 ${escapeHtml(card.title)}</div>` : ''}
        </div>

        <div class="card-details">
          ${phoneDisplay ? `
            <div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              <a href="tel:${escapeHtml(phoneDisplay)}">${escapeHtml(phoneDisplay)}</a>
              <button onclick="copyToClipboard('${escapeHtml(phoneDisplay)}', '電話號碼')" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:0.75rem;" title="複製">📋</button>
            </div>` : ''}
          
          ${emailDisplay ? `
            <div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
              <a href="mailto:${escapeHtml(emailDisplay)}">${escapeHtml(emailDisplay)}</a>
              <button onclick="copyToClipboard('${escapeHtml(emailDisplay)}', 'Email')" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:0.75rem;" title="複製">📋</button>
            </div>` : ''}
          
          ${card.address ? `
            <div class="detail-row" title="${escapeHtml(card.address)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span>${escapeHtml(card.address)}</span>
            </div>` : ''}
        </div>

        <div class="card-tags">
          ${tagsHtml}
        </div>
      </div>

      <div class="card-footer">
        <div class="action-btn-group">
          ${hasImage ? `
            <button class="card-action-btn btn-ocr" onclick="triggerCardOcr(${card.id}, this)">
              ⚡ AI 辨識
            </button>` : ''}
        </div>
        <button class="card-action-btn" onclick="openDetailModal(${card.id})">
          查看詳情 →
        </button>
      </div>
    `;

    cardsGrid.appendChild(cardEl);
  });

  // 2. Table View
  cardsTableBody.innerHTML = '';
  state.cards.forEach(card => {
    const tr = document.createElement('tr');
    const firstImg = card.image_paths && card.image_paths.length > 0 ? card.image_paths[0] : null;
    const imgSrc = firstImg ? (firstImg.startsWith('/uploads/') ? firstImg : `/resources/${firstImg}`) : '';
    const phoneDisplay = card.mobile || card.phone || '-';

    tr.innerHTML = `
      <td>
        ${imgSrc 
          ? `<img src="${escapeHtml(imgSrc)}" class="table-thumb" onclick="openDetailModal(${card.id})" alt="名片">` 
          : `<span style="font-size:1.2rem;">🪪</span>`}
      </td>
      <td><strong>${escapeHtml(card.name || '未命名')}</strong></td>
      <td>${escapeHtml(card.company || '-')}</td>
      <td>${escapeHtml(card.title || '-')}</td>
      <td>${escapeHtml(phoneDisplay)}</td>
      <td>${escapeHtml(card.email || '-')}</td>
      <td><small style="color:var(--text-dim);">${escapeHtml((card.tags || []).join(', ') || card.notes?.substring(0, 30) || '-')}</small></td>
      <td style="text-align: right;">
        <button class="card-action-btn" onclick="openDetailModal(${card.id})">詳情</button>
      </td>
    `;
    cardsTableBody.appendChild(tr);
  });
}

function renderPagination() {
  pagination.innerHTML = '';
  if (state.totalPages <= 1) return;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.innerHTML = '&larr; 上一頁';
  prevBtn.disabled = state.page === 1;
  prevBtn.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      loadCards();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  pagination.appendChild(prevBtn);

  // Page Numbers
  const maxButtons = 7;
  let startPage = Math.max(1, state.page - 3);
  let endPage = Math.min(state.totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement('button');
    btn.className = `page-btn ${i === state.page ? 'active' : ''}`;
    btn.textContent = i;
    btn.addEventListener('click', () => {
      state.page = i;
      loadCards();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    pagination.appendChild(btn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.innerHTML = '下一頁 &rarr;';
  nextBtn.disabled = state.page === state.totalPages;
  nextBtn.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page++;
      loadCards();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  pagination.appendChild(nextBtn);
}

// --- Detail Modal ---
async function openDetailModal(cardId) {
  try {
    const res = await fetch(`/api/cards/${cardId}`);
    const card = await res.json();
    state.currentCard = card;

    const detailModalBody = document.getElementById('detailModalBody');
    const imagesHtml = (card.image_paths || []).map(p => {
      const src = p.startsWith('/uploads/') ? p : `/resources/${p}`;
      return `
        <div style="margin-bottom: 1rem; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border-subtle); background: var(--bg-tertiary); text-align: center;">
          <a href="${src}" target="_blank" title="點擊檢視原圖">
            <img src="${src}" style="max-width: 100%; max-height: 420px; object-fit: contain;" alt="${escapeHtml(card.name)}">
          </a>
        </div>
      `;
    }).join('');

    detailModalBody.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 1.5rem;">
        <div>
          ${imagesHtml || `<div class="card-media-placeholder" style="height: 250px; background: var(--bg-tertiary); border-radius: var(--radius-md);"><span>無名片照片</span></div>`}
        </div>

        <div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">姓名</label>
              <input type="text" id="detailName" class="form-input" value="${escapeHtml(card.name || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">職稱</label>
              <input type="text" id="detailTitle" class="form-input" value="${escapeHtml(card.title || '')}">
            </div>
            <div class="form-group full-width">
              <label class="form-label">公司全銜</label>
              <input type="text" id="detailCompany" class="form-input" value="${escapeHtml(card.company || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">行動電話</label>
              <input type="text" id="detailMobile" class="form-input" value="${escapeHtml(card.mobile || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">市內電話</label>
              <input type="text" id="detailPhone" class="form-input" value="${escapeHtml(card.phone || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">傳真號碼</label>
              <input type="text" id="detailFax" class="form-input" value="${escapeHtml(card.fax || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="text" id="detailEmail" class="form-input" value="${escapeHtml(card.email || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">統一編號</label>
              <input type="text" id="detailTaxId" class="form-input" value="${escapeHtml(card.tax_id || '')}">
            </div>
            <div class="form-group full-width">
              <label class="form-label">通訊地址</label>
              <input type="text" id="detailAddress" class="form-input" value="${escapeHtml(card.address || '')}">
            </div>
            <div class="form-group full-width">
              <label class="form-label">標籤 (逗號分隔)</label>
              <input type="text" id="detailTags" class="form-input" value="${escapeHtml((card.tags || []).join(', '))}">
            </div>
            <div class="form-group full-width">
              <label class="form-label">備忘筆記 / OCR 原始內容</label>
              <textarea id="detailNotes" class="form-textarea" rows="4">${escapeHtml(card.notes || '')}</textarea>
            </div>
          </div>
        </div>
      </div>
    `;

    // Hook buttons
    document.getElementById('btnDetailTriggerOcr').onclick = () => triggerCardOcr(card.id);
    document.getElementById('btnDetailExportVcf').onclick = () => {
      window.open(`/api/export/vcard?q=${encodeURIComponent(card.name)}`, '_blank');
    };
    document.getElementById('btnDetailSave').onclick = () => saveCardDetail(card.id);

    detailModal.classList.add('active');
  } catch (err) {
    console.error('Failed to open detail:', err);
    showToast('載入名片詳情失敗', 'error');
  }
}

async function saveCardDetail(cardId) {
  const payload = {
    name: document.getElementById('detailName').value.trim(),
    title: document.getElementById('detailTitle').value.trim(),
    company: document.getElementById('detailCompany').value.trim(),
    mobile: document.getElementById('detailMobile').value.trim(),
    phone: document.getElementById('detailPhone').value.trim(),
    fax: document.getElementById('detailFax').value.trim(),
    email: document.getElementById('detailEmail').value.trim(),
    tax_id: document.getElementById('detailTaxId').value.trim(),
    address: document.getElementById('detailAddress').value.trim(),
    tags: document.getElementById('detailTags').value.split(',').map(s => s.trim()).filter(Boolean),
    notes: document.getElementById('detailNotes').value.trim()
  };

  try {
    const res = await fetch(`/api/cards/${cardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('名片資料已成功更新！', 'success');
      closeDetailModal();
      loadCards();
      loadStats();
    } else {
      showToast('儲存失敗', 'error');
    }
  } catch (err) {
    showToast('更新失敗: ' + err.message, 'error');
  }
}

function closeDetailModal() {
  detailModal.classList.remove('active');
  state.currentCard = null;
}

// --- Single Card OCR Trigger ---
async function triggerCardOcr(cardId, buttonElement) {
  const origText = buttonElement ? buttonElement.innerHTML : '';
  if (buttonElement) {
    buttonElement.disabled = true;
    buttonElement.innerHTML = `<span class="spinner"></span> 辨識中...`;
  }
  showToast('AI 正在對名片進行高精準視覺分析...', 'info');

  try {
    const res = await fetch(`/api/cards/${cardId}/ocr`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✨ 已成功辨識【${data.card.name || '名片'}】並自動填入欄位！`, 'success');
      loadCards();
      loadStats();
      if (state.currentCard && state.currentCard.id === cardId) {
        openDetailModal(cardId);
      }
    } else {
      showToast('辨識失敗: ' + (data.detail || '未知錯誤'), 'error');
    }
  } catch (err) {
    showToast('辨識異常: ' + err.message, 'error');
  } finally {
    if (buttonElement) {
      buttonElement.disabled = false;
      buttonElement.innerHTML = origText;
    }
  }
}

// --- Add Card / OCR Upload Flow ---
function openAddModal() {
  // Reset Form
  dropzone.style.display = 'block';
  ocrPreviewContainer.style.display = 'none';
  ocrStatusMsg.style.display = 'none';
  btnSaveCard.disabled = true;
  state.uploadedCardData = null;
  fileInput.value = '';

  addCardModal.classList.add('active');
}

function closeAddModal() {
  addCardModal.classList.remove('active');
}

function closeAllModals() {
  closeAddModal();
  closeDetailModal();
}

function handleFileSelected(e) {
  if (e.target.files && e.target.files[0]) {
    handleFileUpload(e.target.files[0]);
  }
}

async function handleFileUpload(file) {
  if (!file.type.startsWith('image/')) {
    showToast('請上傳圖檔格式 (JPG, PNG, HEIC 等)', 'error');
    return;
  }

  // Preview local image immediately
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImage.src = e.target.result;
    ocrPreviewContainer.style.display = 'grid';
  };
  reader.readAsDataURL(file);

  // Show status
  ocrStatusMsg.style.display = 'block';
  btnSaveCard.disabled = true;

  const engine = selectOcrEngine.value;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('engine', engine);

  try {
    const res = await fetch('/api/ocr', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();

    if (res.ok && result.success) {
      state.uploadedCardData = {
        image_url: result.image_url,
        data: result.data
      };

      // Populate form
      const d = result.data;
      document.getElementById('formName').value = d.name || '';
      document.getElementById('formCompany').value = d.company || '';
      document.getElementById('formTitle').value = d.title || '';
      document.getElementById('formMobile').value = d.mobile || '';
      document.getElementById('formPhone').value = d.phone || '';
      document.getElementById('formEmail').value = d.email || '';
      document.getElementById('formTaxId').value = d.tax_id || '';
      document.getElementById('formAddress').value = d.address || '';
      document.getElementById('formWebsite').value = d.website || '';
      document.getElementById('formTags').value = (d.tags || []).join(', ');
      document.getElementById('formNotes').value = d.notes || d.raw_text || '';

      btnSaveCard.disabled = false;
      showToast(`🎉 AI 辨識完成 (${d.engine || 'Gemini'})！請核對並儲存`, 'success');
    } else {
      showToast('圖片辨識出錯: ' + (result.detail || '請手動填寫欄位'), 'error');
      btnSaveCard.disabled = false;
    }
  } catch (err) {
    showToast('上傳或辨識異常: ' + err.message, 'error');
    btnSaveCard.disabled = false;
  } finally {
    ocrStatusMsg.style.display = 'none';
  }
}

async function saveNewCard() {
  const name = document.getElementById('formName').value.trim();
  if (!name) {
    showToast('請至少填寫名片姓名', 'error');
    document.getElementById('formName').focus();
    return;
  }

  const payload = {
    name: name,
    company: document.getElementById('formCompany').value.trim(),
    title: document.getElementById('formTitle').value.trim(),
    mobile: document.getElementById('formMobile').value.trim(),
    phone: document.getElementById('formPhone').value.trim(),
    email: document.getElementById('formEmail').value.trim(),
    tax_id: document.getElementById('formTaxId').value.trim(),
    address: document.getElementById('formAddress').value.trim(),
    website: document.getElementById('formWebsite').value.trim(),
    tags: document.getElementById('formTags').value.split(',').map(s => s.trim()).filter(Boolean),
    notes: document.getElementById('formNotes').value.trim(),
    image_paths: state.uploadedCardData?.image_url ? [state.uploadedCardData.image_url] : [],
    raw_text: state.uploadedCardData?.data?.raw_text || '',
    ocr_engine: state.uploadedCardData?.data?.engine || 'manual'
  };

  btnSaveCard.disabled = true;
  btnSaveCard.innerHTML = `<span class="spinner"></span> 儲存中...`;

  try {
    const res = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast(`✅ 新名片【${payload.name}】已成功存入名片庫！`, 'success');
      closeAddModal();
      loadCards();
      loadStats();
    } else {
      showToast('儲存失敗', 'error');
    }
  } catch (err) {
    showToast('儲存異常: ' + err.message, 'error');
  } finally {
    btnSaveCard.disabled = false;
    btnSaveCard.innerHTML = `💾 儲存至名片庫`;
  }
}

// --- Utilities ---
function copyToClipboard(text, label) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`已複製 ${label}: ${text}`, 'info');
  }).catch(() => {
    showToast('複製失敗', 'error');
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
