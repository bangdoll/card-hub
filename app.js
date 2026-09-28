// --- Security Configuration (One-way SHA-256 Hash Guard) ---
const DEFAULT_KEY_HASH = '59492ade085893d9876ef399d55dfcc9e78d38226549533b08732103660e8f41';

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
  uploadedCardData: null,
  isAuthenticated: false
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

// Stats Elements (Desktop & Mobile)
const statTotal = document.getElementById('statTotal');
const statWithImg = document.getElementById('statWithImg');
const statWithPhone = document.getElementById('statWithPhone');
const statPendingOcr = document.getElementById('statPendingOcr');
const mStatTotal = document.getElementById('mStatTotal');
const mStatWithImg = document.getElementById('mStatWithImg');
const mStatWithPhone = document.getElementById('mStatWithPhone');
const mStatPendingOcr = document.getElementById('mStatPendingOcr');
const chipTotalCount = document.getElementById('chipTotalCount');
const filterTagChips = document.getElementById('filterTagChips');

// Security Vault Elements
const vaultGateOverlay = document.getElementById('vaultGateOverlay');
const vaultAuthForm = document.getElementById('vaultAuthForm');
const vaultPassInput = document.getElementById('vaultPassInput');
const btnVaultUnlock = document.getElementById('btnVaultUnlock');
const btnVaultTogglePwd = document.getElementById('btnVaultTogglePwd');
const vaultErrorMsg = document.getElementById('vaultErrorMsg');
const vaultRememberMe = document.getElementById('vaultRememberMe');
const btnGoogleLogin = document.getElementById('btnGoogleLogin');
const userProfileBadge = document.getElementById('userProfileBadge');
const userEmailText = document.getElementById('userEmailText');
const btnUserLogout = document.getElementById('btnUserLogout');
const btnLockVault = document.getElementById('btnLockVault');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  setupSecurityVault();
  checkAuthAndLoad();
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

// --- Security Vault Logic ---
function setupSecurityVault() {
  if (btnVaultTogglePwd) {
    btnVaultTogglePwd.addEventListener('click', () => {
      const isPwd = vaultPassInput.type === 'password';
      vaultPassInput.type = isPwd ? 'text' : 'password';
      btnVaultTogglePwd.textContent = isPwd ? '🙈' : '👁️';
    });
  }

  if (vaultAuthForm) {
    vaultAuthForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handlePasscodeUnlock();
    });
  }

  if (btnVaultUnlock) {
    btnVaultUnlock.addEventListener('click', handlePasscodeUnlock);
  }

  if (btnUserLogout) {
    btnUserLogout.addEventListener('click', handleLogout);
  }

  if (btnLockVault) {
    btnLockVault.addEventListener('click', handleLogout);
  }
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function checkAuthAndLoad() {
  const token = localStorage.getItem('cardhub_vault_session') || sessionStorage.getItem('cardhub_vault_session');
  if (token) {
    try {
      const sess = JSON.parse(token);
      if (sess && sess.valid) {
        if (!sess.exp || Date.now() < sess.exp) {
          grantAccess();
          return;
        }
      }
    } catch (e) {
      // invalid token
    }
  }

  // Not authorized: show vault overlay and lock data
  lockAccess();
}

function grantAccess() {
  state.isAuthenticated = true;
  vaultGateOverlay.classList.add('unlocked');
  if (userProfileBadge) {
    userProfileBadge.style.display = 'inline-flex';
    userEmailText.textContent = '已授權';
  }
  showToast('歡迎回來！人脈智能庫已安全解鎖 🪪', 'success');
  loadStats();
  loadCards();
}

function lockAccess() {
  state.isAuthenticated = false;
  state.cards = [];
  vaultGateOverlay.classList.remove('unlocked');
  if (userProfileBadge) {
    userProfileBadge.style.display = 'none';
  }
  // Clear any rendered cards from memory
  cardsGrid.innerHTML = '';
  cardsTableBody.innerHTML = '';
  emptyState.style.display = 'none';
}

function handleLogout() {
  localStorage.removeItem('cardhub_vault_session');
  sessionStorage.removeItem('cardhub_vault_session');
  lockAccess();
  showToast('人脈保險庫已安全鎖定 🔒', 'info');
}

async function handlePasscodeUnlock() {
  const val = vaultPassInput.value.trim();
  if (!val) {
    showVaultError('請輸入存取金鑰');
    return;
  }

  const hash = await sha256(val);
  const customHash = localStorage.getItem('cardhub_custom_key_hash') || DEFAULT_KEY_HASH;

  if (hash === customHash || hash === DEFAULT_KEY_HASH) {
    const sess = {
      valid: true,
      exp: vaultRememberMe.checked ? Date.now() + 30 * 24 * 3600 * 1000 : null
    };
    if (vaultRememberMe.checked) {
      localStorage.setItem('cardhub_vault_session', JSON.stringify(sess));
    } else {
      sessionStorage.setItem('cardhub_vault_session', JSON.stringify(sess));
    }
    vaultErrorMsg.style.display = 'none';
    vaultPassInput.value = '';
    grantAccess();
  } else {
    showVaultError('存取金鑰錯誤，拒絕存取');
    const cardEl = vaultGateOverlay.querySelector('.vault-card');
    cardEl.classList.add('vault-shake');
    setTimeout(() => cardEl.classList.remove('vault-shake'), 400);
  }
}

function showVaultError(msg) {
  vaultErrorMsg.textContent = msg;
  vaultErrorMsg.style.display = 'block';
}

// --- Event Listeners Setup ---
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

  // Big Notes Form Controls in Add Modal
  const formNotes = document.getElementById('formNotes');
  const formNotesCount = document.getElementById('formNotesCount');
  const btnFormNotesInsertDate = document.getElementById('btnFormNotesInsertDate');
  const btnFormNotesToggleExpand = document.getElementById('btnFormNotesToggleExpand');

  if (formNotes && formNotesCount) {
    formNotes.addEventListener('input', () => {
      formNotesCount.textContent = `${formNotes.value.length} 字`;
    });
  }
  if (btnFormNotesInsertDate && formNotes) {
    btnFormNotesInsertDate.addEventListener('click', () => {
      const today = new Date().toISOString().split('T')[0];
      const stamp = `\n[${today}] `;
      formNotes.value += stamp;
      formNotes.focus();
      if (formNotesCount) formNotesCount.textContent = `${formNotes.value.length} 字`;
    });
  }
  if (btnFormNotesToggleExpand && formNotes) {
    btnFormNotesToggleExpand.addEventListener('click', () => {
      formNotes.classList.toggle('expanded');
      btnFormNotesToggleExpand.textContent = formNotes.classList.contains('expanded') ? '⛶ 收合高度' : '⛶ 擴展高度';
    });
  }

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

// --- Data Loading & Fallback ---
let allStaticCards = null;

async function loadStaticCards() {
  if (!allStaticCards) {
    try {
      const res = await fetch('/static/cards.json');
      if (res.ok) {
        allStaticCards = await res.json();
      } else {
        throw new Error('static/cards.json 404');
      }
    } catch {
      try {
        const res2 = await fetch('/cards.json');
        if (res2.ok) {
          allStaticCards = await res2.json();
        } else {
          allStaticCards = [];
        }
      } catch (e) {
        console.error('Failed to load static cards.json:', e);
        allStaticCards = [];
      }
    }
  }

  // Apply any client-side localStorage overrides
  const overrides = JSON.parse(localStorage.getItem('cardhub_overrides') || '{}');
  if (allStaticCards && Object.keys(overrides).length > 0) {
    allStaticCards.forEach(c => {
      if (overrides[c.id]) {
        Object.assign(c, overrides[c.id]);
      }
    });
  }

  return allStaticCards || [];
}

async function loadStats() {
  if (!state.isAuthenticated) return;

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
      (c.tags || []).forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag, count]) => ({ tag, count }));

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
  const totalFmt = data.total.toLocaleString();
  const withImgFmt = data.with_image.toLocaleString();
  const withPhoneFmt = data.with_phone.toLocaleString();
  const pendingFmt = data.pending_ocr.toLocaleString();

  // Desktop Stats
  if (statTotal) statTotal.textContent = totalFmt;
  if (statWithImg) statWithImg.textContent = withImgFmt;
  if (statWithPhone) statWithPhone.textContent = withPhoneFmt;
  if (statPendingOcr) statPendingOcr.textContent = pendingFmt;
  if (chipTotalCount) chipTotalCount.textContent = totalFmt;

  // Mobile Mini Stats Bar
  if (mStatTotal) mStatTotal.textContent = totalFmt;
  if (mStatWithImg) mStatWithImg.textContent = withImgFmt;
  if (mStatWithPhone) mStatWithPhone.textContent = withPhoneFmt;
  if (mStatPendingOcr) mStatPendingOcr.textContent = pendingFmt;

  // Tag Chips
  filterTagChips.innerHTML = '';
  (data.top_tags || []).forEach(({ tag, count }) => {
    const chip = document.createElement('button');
    chip.className = `chip ${state.activeTag === tag ? 'active' : ''}`;
    chip.innerHTML = `${escapeHtml(tag)} <span class="chip-count">${count}</span>`;
    chip.addEventListener('click', () => {
      if (state.activeTag === tag) {
        state.activeTag = '';
        chip.classList.remove('active');
      } else {
        document.querySelectorAll('#filterTagChips .chip').forEach(c => c.classList.remove('active'));
        state.activeTag = tag;
        chip.classList.add('active');
      }
      state.page = 1;
      loadCards();
    });
    filterTagChips.appendChild(chip);
  });
}

async function loadCards() {
  if (!state.isAuthenticated) return;
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
      (c.phone && c.phone.includes(qLower)) ||
      (c.mobile && c.mobile.includes(qLower)) ||
      (c.email && c.email.toLowerCase().includes(qLower)) ||
      (c.address && c.address.toLowerCase().includes(qLower)) ||
      (c.notes && c.notes.toLowerCase().includes(qLower)) ||
      (c.tags && c.tags.some(t => t.toLowerCase().includes(qLower)))
    );
  }

  if (state.activeTag) {
    filtered = filtered.filter(c => (c.tags || []).includes(state.activeTag));
  }

  if (state.filterStatus === 'has_image') {
    filtered = filtered.filter(c => Boolean(c.image_paths && c.image_paths.length > 0));
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

// --- Digital Neural Card Art Generator ---
function getCardDigitalMediaHtml(card) {
  const gradients = [
    'linear-gradient(135deg, #1e1e38 0%, #2a2b5c 50%, #3d2f66 100%)', // 曜石紫
    'linear-gradient(135deg, #0f2b38 0%, #164e63 50%, #0e7490 100%)', // 極光青
    'linear-gradient(135deg, #1e293b 0%, #334155 50%, #1e293b 100%)', // 太空灰
    'linear-gradient(135deg, #1c1917 0%, #44403c 50%, #292524 100%)', // 琥珀深褐
    'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)', // 皇家靛藍
    'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)'  // 翡翠綠
  ];
  const str = card.name || card.company || 'Card';
  const charCode = str.charCodeAt(0) || 0;
  const grad = gradients[charCode % gradients.length];
  const initial = (card.name || card.company || '名').trim().slice(0, 1);
  const companyShort = (card.company || '商務合作夥伴').slice(0, 14);

  return `
    <div class="card-digital-art" style="background: ${grad};">
      <div class="card-chip-icon">🪪</div>
      <div class="card-art-body">
        <div class="card-art-avatar">${escapeHtml(initial)}</div>
        <div class="card-art-info">
          <div class="card-art-name">${escapeHtml(card.name || '商務夥伴')}</div>
          <div class="card-art-company">${escapeHtml(companyShort)}</div>
        </div>
      </div>
      <div class="card-art-circuit"></div>
    </div>
  `;
}

// Image Path Resolver (優先載入已壓縮 WebP 縮圖，兼顧真實照片與極速秒開)
function getCardImageSrc(card) {
  if (!card.image_paths || card.image_paths.length === 0) return null;
  const first = card.image_paths[0];
  if (first.startsWith('/uploads/')) return first;
  return `/static/thumbs/card_${card.id}.webp`;
}

// Global Image Error Fallback (優雅回退，無任何跳錯或轉義字串)
window.handleImageError = function(imgEl, cardId) {
  const card = (state.cards || []).find(c => c.id === cardId) || { name: '商務名片' };
  const parent = imgEl.parentElement;
  if (parent) {
    imgEl.remove();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = getCardDigitalMediaHtml(card);
    if (wrapper.firstElementChild) {
      parent.prepend(wrapper.firstElementChild);
    }
  }
};

window.handleDetailImageError = function(imgEl, cardId) {
  const card = state.currentCard || (state.cards || []).find(c => c.id === cardId) || { name: '商務名片' };
  const container = imgEl.closest('.detail-media-container') || imgEl.parentElement;
  if (container) {
    container.innerHTML = `<div style="padding: 1.5rem; width: 100%; height: 260px;">${getCardDigitalMediaHtml(card)}</div>`;
  }
};

window.handleTableThumbError = function(imgEl) {
  const span = document.createElement('span');
  span.style.fontSize = '1.2rem';
  span.textContent = '🪪';
  imgEl.replaceWith(span);
};

// --- Render Cards ---
function renderCards() {
  if (!state.isAuthenticated) return;

  // 1. Grid View
  cardsGrid.innerHTML = '';
  state.cards.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = 'business-card';
    cardEl.dataset.id = card.id;

    // Image logic: 載入真實實體名片圖檔
    const hasImage = card.image_paths && card.image_paths.length > 0;
    const imgSrc = getCardImageSrc(card);

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

    // Notes Preview (便籤摘要)
    let notesPreviewHtml = '';
    if (card.notes && card.notes.trim()) {
      const cleanNotes = card.notes.replace(/---/g, '').replace(/[\n\r]+/g, ' ').trim();
      if (cleanNotes) {
        notesPreviewHtml = `
          <div class="card-notes-preview" onclick="openDetailModal(${card.id})" title="點擊檢視備忘全文">
            <span class="notes-icon">📝 備忘:</span> ${escapeHtml(cleanNotes.substring(0, 75))}...
          </div>
        `;
      }
    }

    cardEl.innerHTML = `
      <div class="card-media" onclick="openDetailModal(${card.id})">
        ${imgSrc 
          ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(card.name)}" loading="lazy" onerror="window.handleImageError(this, ${card.id})">` 
          : getCardDigitalMediaHtml(card)}
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

        ${notesPreviewHtml}

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
    const imgSrc = getCardImageSrc(card);
    const phoneDisplay = card.mobile || card.phone || '-';

    tr.innerHTML = `
      <td>
        ${imgSrc 
          ? `<img src="${escapeHtml(imgSrc)}" class="table-thumb" onclick="openDetailModal(${card.id})" alt="名片" onerror="window.handleTableThumbError(this)">` 
          : `<span style="font-size:1.2rem;">🪪</span>`}
      </td>
      <td><strong style="cursor:pointer;" onclick="openDetailModal(${card.id})">${escapeHtml(card.name || '未命名')}</strong></td>
      <td>${escapeHtml(card.company || '-')}</td>
      <td>${escapeHtml(card.title || '-')}</td>
      <td>
        ${phoneDisplay !== '-' 
          ? `<a href="tel:${escapeHtml(phoneDisplay)}" style="color:var(--text-main);">${escapeHtml(phoneDisplay)}</a>`
          : '-'}
      </td>
      <td>
        ${card.email 
          ? `<a href="mailto:${escapeHtml(card.email)}" style="color:var(--primary);">${escapeHtml(card.email)}</a>`
          : '-'}
      </td>
      <td><small style="color:var(--text-dim);">${escapeHtml((card.tags || []).join(', ') || card.notes?.substring(0, 30) || '-')}</small></td>
      <td>
        <button class="card-action-btn" onclick="openDetailModal(${card.id})">詳情</button>
      </td>
    `;
    cardsTableBody.appendChild(tr);
  });
}

// --- Pagination ---
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

  let startPage = Math.max(1, state.page - 2);
  let endPage = Math.min(state.totalPages, startPage + 4);
  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  for (let p = startPage; p <= endPage; p++) {
    const btn = document.createElement('button');
    btn.className = `page-btn ${p === state.page ? 'active' : ''}`;
    btn.textContent = p;
    btn.addEventListener('click', () => {
      state.page = p;
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
    let card = null;

    // 1. Try local FastAPI server
    try {
      const res = await fetch(`/api/cards/${cardId}`);
      if (res.ok) {
        card = await res.json();
      }
    } catch (e) {
      // offline / Vercel static
    }

    // 2. Seamless Client-side fallback from static cards cache
    if (!card) {
      const all = await loadStaticCards();
      card = all.find(c => c.id === cardId || String(c.id) === String(cardId));
    }

    if (!card) throw new Error('查無名片資料');
    state.currentCard = card;

    const detailModalBody = document.getElementById('detailModalBody');
    const thumbSrc = getCardImageSrc(card);
    const imagesHtml = (card.image_paths || []).map((p, idx) => {
      const originalSrc = p.startsWith('/uploads/') ? p : `/resources/${p}`;
      const displaySrc = thumbSrc || originalSrc;
      return `
        <div class="detail-media-container" style="margin-bottom: 1rem; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border-subtle); background: var(--bg-tertiary); text-align: center;">
          <a href="${originalSrc}" target="_blank" title="點擊檢視高解析大圖">
            <img src="${escapeHtml(displaySrc)}" style="max-width: 100%; max-height: 420px; object-fit: contain; cursor: zoom-in;" alt="${escapeHtml(card.name)}" onerror="window.handleDetailImageError(this, ${card.id})">
          </a>
        </div>
      `;
    }).join('');

    detailModalBody.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1.25fr; gap: 1.5rem;">
        <div>
          ${imagesHtml || `<div style="height: 260px; border-radius: var(--radius-md); overflow: hidden;">${getCardDigitalMediaHtml(card)}</div>`}
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
            
            <!-- 大尺寸備忘錄與寫作工具列 -->
            <div class="form-group full-width notes-form-group">
              <div class="notes-header-bar">
                <label class="form-label">📝 備忘筆記 / 業務交流與談話紀錄</label>
                <div class="notes-tools">
                  <span class="notes-counter" id="detailNotesCount">${(card.notes || '').length} 字</span>
                  <button type="button" class="btn-notes-tool" id="btnDetailInsertDate">📅 今日日期</button>
                  <button type="button" class="btn-notes-tool" id="btnDetailToggleExpand">⛶ 擴展高度</button>
                </div>
              </div>
              <textarea id="detailNotes" class="form-textarea form-textarea-large" rows="10" placeholder="相遇場合、對話紀錄、合作項目、家庭狀況、待辦事項...（右下角可往下拖曳拉大）">${escapeHtml(card.notes || '')}</textarea>
            </div>
          </div>
        </div>
      </div>
    `;

    // Hook detail modal note tools
    const detailNotes = document.getElementById('detailNotes');
    const detailNotesCount = document.getElementById('detailNotesCount');
    const btnDetailInsertDate = document.getElementById('btnDetailInsertDate');
    const btnDetailToggleExpand = document.getElementById('btnDetailToggleExpand');

    if (detailNotes && detailNotesCount) {
      detailNotes.addEventListener('input', () => {
        detailNotesCount.textContent = `${detailNotes.value.length} 字`;
      });
    }
    if (btnDetailInsertDate && detailNotes) {
      btnDetailInsertDate.addEventListener('click', () => {
        const today = new Date().toISOString().split('T')[0];
        const stamp = `\n[${today}] `;
        detailNotes.value += stamp;
        detailNotes.focus();
        if (detailNotesCount) detailNotesCount.textContent = `${detailNotes.value.length} 字`;
      });
    }
    if (btnDetailToggleExpand && detailNotes) {
      btnDetailToggleExpand.addEventListener('click', () => {
        detailNotes.classList.toggle('expanded');
        btnDetailToggleExpand.textContent = detailNotes.classList.contains('expanded') ? '⛶ 收合高度' : '⛶ 擴展高度';
      });
    }

    // Hook buttons
    document.getElementById('btnDetailTriggerOcr').onclick = () => triggerCardOcr(card.id);
    document.getElementById('btnDetailExportVcf').onclick = () => {
      window.open(`/api/export/vcard?q=${encodeURIComponent(card.name)}`, '_blank');
    };
    document.getElementById('btnDetailSave').onclick = () => saveCardDetail(card.id);

    detailModal.classList.add('active');
  } catch (err) {
    console.error('Failed to open detail:', err);
    showToast('載入名片詳情失敗: ' + err.message, 'error');
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
    let savedRemote = false;
    try {
      const res = await fetch(`/api/cards/${cardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) savedRemote = true;
    } catch (e) {
      // Vercel / Static mode
    }

    // Update in-memory cards
    if (state.currentCard) {
      Object.assign(state.currentCard, payload);
    }
    if (allStaticCards) {
      const idx = allStaticCards.findIndex(c => c.id === cardId || String(c.id) === String(cardId));
      if (idx !== -1) {
        Object.assign(allStaticCards[idx], payload);
      }
    }
    const cardInState = state.cards.find(c => c.id === cardId || String(c.id) === String(cardId));
    if (cardInState) {
      Object.assign(cardInState, payload);
    }

    // Save override to localStorage
    const overrides = JSON.parse(localStorage.getItem('cardhub_overrides') || '{}');
    overrides[cardId] = payload;
    localStorage.setItem('cardhub_overrides', JSON.stringify(overrides));

    showToast('✨ 名片備忘與資料已成功更新儲存！', 'success');
    closeDetailModal();
    renderCards();
    loadStats();
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
    showToast('辨識請求失敗: ' + err.message, 'error');
  } finally {
    if (buttonElement) {
      buttonElement.disabled = false;
      buttonElement.innerHTML = origText;
    }
  }
}

// --- Add Card Modal & Upload ---
function openAddModal() {
  resetAddForm();
  addCardModal.classList.add('active');
}

function closeAddModal() {
  addCardModal.classList.remove('active');
  resetAddForm();
}

function closeAllModals() {
  closeAddModal();
  closeDetailModal();
}

function resetAddForm() {
  dropzone.style.display = 'block';
  ocrPreviewContainer.style.display = 'none';
  btnSaveCard.disabled = true;
  ocrStatusMsg.style.display = 'none';
  fileInput.value = '';
  previewImage.src = '';
  state.uploadedCardData = null;

  document.getElementById('formName').value = '';
  document.getElementById('formTitle').value = '';
  document.getElementById('formCompany').value = '';
  document.getElementById('formMobile').value = '';
  document.getElementById('formPhone').value = '';
  document.getElementById('formEmail').value = '';
  document.getElementById('formTaxId').value = '';
  document.getElementById('formAddress').value = '';
  document.getElementById('formWebsite').value = '';
  document.getElementById('formTags').value = '';
  document.getElementById('formNotes').value = '';
}

function handleFileSelected(e) {
  if (e.target.files && e.target.files.length > 0) {
    handleFileUpload(e.target.files[0]);
  }
}

async function handleFileUpload(file) {
  if (!file.type.startsWith('image/')) {
    showToast('請上傳 JPG、PNG 或 WebP 圖片格式', 'error');
    return;
  }

  // Preview local image
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImage.src = e.target.result;
    dropzone.style.display = 'none';
    ocrPreviewContainer.style.display = 'grid';
  };
  reader.readAsDataURL(file);

  // Send to OCR API
  const formData = new FormData();
  formData.append('file', file);
  const engine = selectOcrEngine.value;
  formData.append('engine', engine);

  ocrStatusMsg.style.display = 'inline-block';
  showToast('AI 正在極速掃描名片並對齊標準欄位...', 'info');

  try {
    const res = await fetch('/api/ocr', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (res.ok && data.success) {
      const d = data.data;
      state.uploadedCardData = {
        ...d,
        temp_image_path: data.image_path
      };

      // Fill in form fields
      document.getElementById('formName').value = d.name || '';
      document.getElementById('formTitle').value = d.title || '';
      document.getElementById('formCompany').value = d.company || '';
      document.getElementById('formMobile').value = d.mobile || '';
      document.getElementById('formPhone').value = d.phone || '';
      document.getElementById('formEmail').value = d.email || '';
      document.getElementById('formTaxId').value = d.tax_id || '';
      document.getElementById('formAddress').value = d.address || '';
      document.getElementById('formWebsite').value = d.website || '';
      document.getElementById('formTags').value = (d.tags || []).join(', ');
      document.getElementById('formNotes').value = d.notes || d.raw_text || '';

      btnSaveCard.disabled = false;
      showToast('✨ AI 視覺辨識完成！欄位已自動對應，請核對後儲存。', 'success');
    } else {
      showToast('OCR 辨識未完成: ' + (data.detail || '請手動填寫欄位'), 'error');
      btnSaveCard.disabled = false;
    }
  } catch (err) {
    showToast('網路連線失敗，請手動輸入名片資料', 'error');
    btnSaveCard.disabled = false;
  } finally {
    ocrStatusMsg.style.display = 'none';
  }
}

async function saveNewCard() {
  const payload = {
    name: document.getElementById('formName').value.trim(),
    title: document.getElementById('formTitle').value.trim(),
    company: document.getElementById('formCompany').value.trim(),
    mobile: document.getElementById('formMobile').value.trim(),
    phone: document.getElementById('formPhone').value.trim(),
    email: document.getElementById('formEmail').value.trim(),
    tax_id: document.getElementById('formTaxId').value.trim(),
    address: document.getElementById('formAddress').value.trim(),
    website: document.getElementById('formWebsite').value.trim(),
    tags: document.getElementById('formTags').value.split(',').map(s => s.trim()).filter(Boolean),
    notes: document.getElementById('formNotes').value.trim(),
    image_paths: state.uploadedCardData?.temp_image_path ? [state.uploadedCardData.temp_image_path] : [],
    ocr_status: 'done'
  };

  if (!payload.name && !payload.company) {
    showToast('請至少填寫「姓名」或「公司全名」', 'error');
    return;
  }

  btnSaveCard.disabled = true;
  btnSaveCard.textContent = '儲存中...';

  try {
    const res = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('🎉 新名片已成功建檔並存入名片庫！', 'success');
      closeAddModal();
      loadCards();
      loadStats();
    } else {
      const err = await res.json();
      showToast('建檔失敗: ' + (err.detail || '未知錯誤'), 'error');
    }
  } catch (err) {
    showToast('網路請求錯誤: ' + err.message, 'error');
  } finally {
    btnSaveCard.disabled = false;
    btnSaveCard.textContent = '💾 儲存至名片庫';
  }
}

// --- Utilities ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function copyToClipboard(text, label) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast(`已複製${label}: ${text}`, 'success');
  }).catch(() => {
    showToast('複製失敗', 'error');
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
