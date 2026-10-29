const els = {
  groupList: document.getElementById('groupList'),
  accountList: document.getElementById('accountList'),
  conversationList: document.getElementById('conversationList'),
  messageList: document.getElementById('messageList'),
  chatTitle: document.getElementById('chatTitle'),
  chatSub: document.getElementById('chatSub'),
  chatAvatar: document.getElementById('chatAvatar'),
  replyForm: document.getElementById('replyForm'),
  replyInput: document.getElementById('replyInput'),
  btnBrandSync: document.getElementById('btnBrandSync'),
  btnAccountsSync: document.getElementById('btnAccountsSync'),
  btnBrandAdd: document.getElementById('btnBrandAdd'),
  btnGroupAdd: document.getElementById('btnGroupAdd'),
  brandHex: document.querySelector('.brand-hex'),
  syncHint: document.getElementById('syncHint'),
  groupDialog: document.getElementById('groupDialog'),
  groupDialogTitle: document.getElementById('groupDialogTitle'),
  groupDialogHint: document.getElementById('groupDialogHint'),
  platformPicker: document.getElementById('platformPicker'),
  platformChips: document.getElementById('platformChips'),
  groupPicker: document.getElementById('groupPicker'),
  groupChips: document.getElementById('groupChips'),
  groupInput: document.getElementById('groupInput'),
  groupInputField: document.getElementById('groupInputField'),
  groupInputLabel: document.getElementById('groupInputLabel'),
  groupForm: document.getElementById('groupForm'),
  qrImage: document.getElementById('qrImage'),
  qrPlaceholder: document.getElementById('qrPlaceholder'),
  btnCancelLogin: document.getElementById('btnCancelLogin'),
  syncEmbedOverlay: document.getElementById('syncEmbedOverlay'),
  syncEmbedTitle: document.getElementById('syncEmbedTitle'),
  syncEmbedStatus: document.getElementById('syncEmbedStatus'),
  syncEmbedSlot: document.getElementById('syncEmbedSlot'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmDialogTitle: document.getElementById('confirmDialogTitle'),
  confirmDialogMessage: document.getElementById('confirmDialogMessage'),
  btnOkConfirm: document.getElementById('btnOkConfirm'),
  proxyDialog: document.getElementById('proxyDialog'),
  proxyForm: document.getElementById('proxyForm'),
  proxyProfilePick: document.getElementById('proxyProfilePick'),
  proxyRegion: document.getElementById('proxyRegion'),
  proxyServer: document.getElementById('proxyServer'),
  proxyUsername: document.getElementById('proxyUsername'),
  proxyPassword: document.getElementById('proxyPassword'),
  btnClearProxy: document.getElementById('btnClearProxy'),
  btnSaveProxy: document.getElementById('btnSaveProxy'),
  btnProxyManager: document.getElementById('btnProxyManager'),
  proxyManager: document.getElementById('proxyManager'),
  btnCloseProxyManager: document.getElementById('btnCloseProxyManager'),
  btnAddProxyRegion: document.getElementById('btnAddProxyRegion'),
  btnAddProxyProfile: document.getElementById('btnAddProxyProfile'),
  proxyRegionList: document.getElementById('proxyRegionList'),
  proxyProfileList: document.getElementById('proxyProfileList'),
  proxyProfileRegionTitle: document.getElementById('proxyProfileRegionTitle'),
  proxyRegionDialog: document.getElementById('proxyRegionDialog'),
  proxyRegionForm: document.getElementById('proxyRegionForm'),
  proxyRegionDialogTitle: document.getElementById('proxyRegionDialogTitle'),
  proxyRegionNameInput: document.getElementById('proxyRegionNameInput'),
  proxyProfileDialog: document.getElementById('proxyProfileDialog'),
  proxyProfileForm: document.getElementById('proxyProfileForm'),
  proxyProfileDialogTitle: document.getElementById('proxyProfileDialogTitle'),
  proxyProfileLabelInput: document.getElementById('proxyProfileLabelInput'),
  proxyProfileServerInput: document.getElementById('proxyProfileServerInput'),
  proxyProfileUsernameInput: document.getElementById('proxyProfileUsernameInput'),
  proxyProfilePasswordInput: document.getElementById('proxyProfilePasswordInput'),
  accountContextMenu: document.getElementById('accountContextMenu'),
  groupContextMenu: document.getElementById('groupContextMenu'),
  groupPlatformPicker: document.getElementById('groupPlatformPicker'),
  groupPlatformOrbit: document.getElementById('groupPlatformOrbit'),
};

function rectNearlyEqual(a, b, eps = 1) {
  return (
    Math.abs(a.left - b.left) <= eps &&
    Math.abs(a.top - b.top) <= eps &&
    Math.abs(a.width - b.width) <= eps &&
    Math.abs(a.height - b.height) <= eps
  );
}

/** Wait for dialog layout, then return a stable getBoundingClientRect. */
async function measureSlotBox(slotEl) {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 80));
  let box = slotEl.getBoundingClientRect();
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 40));
    const next = slotEl.getBoundingClientRect();
    if (rectNearlyEqual(box, next)) return next;
    box = next;
  }
  return box;
}

/** Content-relative slot → screen DIP rect for Chrome overlay (Electron only). */
async function getEmbedWindowBounds(slotEl) {
  if (!slotEl) return null;
  if (typeof window.aom?.slotToScreen !== 'function') {
    console.warn(
      '[aom] window.aom 不可用：请完全退出并重启 Electron，否则 Chrome 无法贴到对话框。'
    );
    return null;
  }
  const box = await measureSlotBox(slotEl);
  if (box.width < 40 || box.height < 40) {
    console.warn('[aom] embed slot 尺寸异常', box);
    return null;
  }
  try {
    const screenRect = await window.aom.slotToScreen({
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
    });
    if (!screenRect) {
      console.warn('[aom] slotToScreen 返回空');
      return null;
    }
    // 弹窗贴在虚线框内侧：四边各内缩 2mm（CSS px@96dpi）
    const inset = (2 * 96) / 25.4;
    const adjusted = {
      x: Math.round(screenRect.x + inset),
      y: Math.round(screenRect.y + inset),
      width: Math.max(200, Math.round(screenRect.width - inset * 2)),
      height: Math.max(160, Math.round(screenRect.height - inset * 2)),
    };
    console.log('[aom] embed windowBounds', adjusted);
    return adjusted;
  } catch (e) {
    console.warn('[aom] slotToScreen 失败', e);
    return null;
  }
}

function accountNeedsHeadedBrowser(account) {
  return account?.platform === 'facebook';
}

/** Show the right chat-panel embed (sync / login); Chrome docks to the dashed slot. */
function showChatEmbed({ title, status, showCancel = false }) {
  const overlay = els.syncEmbedOverlay;
  if (!overlay) return;
  if (els.syncEmbedTitle) els.syncEmbedTitle.textContent = title || '';
  if (els.syncEmbedStatus) els.syncEmbedStatus.textContent = status || '';
  if (els.btnCancelLogin) els.btnCancelLogin.hidden = !showCancel;
  if (els.qrImage) {
    els.qrImage.removeAttribute('src');
    els.qrImage.hidden = true;
  }
  if (els.qrPlaceholder) {
    els.qrPlaceholder.hidden = false;
    els.qrPlaceholder.textContent = '浏览器将贴合此区域';
  }
  overlay.hidden = false;
}

function hideChatEmbed() {
  const overlay = els.syncEmbedOverlay;
  if (!overlay) return;
  overlay.hidden = true;
  if (els.btnCancelLogin) els.btnCancelLogin.hidden = true;
  if (els.qrImage) {
    els.qrImage.removeAttribute('src');
    els.qrImage.hidden = true;
  }
  if (els.qrPlaceholder) els.qrPlaceholder.hidden = false;
}

function isChatEmbedOpen() {
  return Boolean(els.syncEmbedOverlay && !els.syncEmbedOverlay.hidden);
}

/**
 * Cover the right chat panel during sync; Chrome docks to the slot.
 * @template T
 * @param {string} statusText
 * @param {(bounds: object|null) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withSyncEmbed(statusText, fn) {
  if (!els.syncEmbedOverlay) return fn(null);
  showChatEmbed({
    title: '正在同步',
    status: statusText || '浏览器贴合下方区域，请稍候',
    showCancel: false,
  });
  try {
    const bounds = await getEmbedWindowBounds(els.syncEmbedSlot);
    return await fn(bounds);
  } finally {
    hideChatEmbed();
  }
}

let pendingPlatform = null;
/** 弹窗内选择的平台（从分组加号进入时用） */
let dialogPlatform = null;
/** 标题栏加号：仅新建项目分组 */
let pendingCreateGroup = false;
/** 右键重命名时的原分组名 */
let pendingRenameGroup = null;
/** 右键「切换分组」时要改的账号 id 列表 */
let pendingMoveAccountIds = [];
let contextMenuAccountIds = [];
let contextMenuGroupName = null;
/** 分组加号环形选平台时的目标分组 */
let pendingAddGroup = null;

const CUSTOM_GROUPS_KEY = 'aom-custom-groups';

function loadCustomGroups() {
  try {
    const raw = localStorage.getItem(CUSTOM_GROUPS_KEY);
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => String(x).trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveCustomGroups() {
  localStorage.setItem(CUSTOM_GROUPS_KEY, JSON.stringify([...customGroups]));
}

function addCustomGroup(name) {
  const g = normalizeGroupName(name);
  if (!g || g === '未分组') return '';
  customGroups.add(g);
  saveCustomGroups();
  return g;
}

function removeCustomGroup(name) {
  const g = normalizeGroupName(name);
  if (!g || g === '未分组') return;
  customGroups.delete(g);
  saveCustomGroups();
}

function isEditableGroup(name) {
  const g = normalizeGroupName(name);
  return Boolean(g) && g !== '未分组';
}

async function setAccountsGroupLabel(fromLabel, toLabel) {
  const from = normalizeGroupName(fromLabel);
  const to = normalizeGroupName(toLabel) || '未分组';
  const targets = accounts.filter((a) => normalizeGroupName(a.label) === from);
  for (const a of targets) {
    await api(`/api/accounts/${a.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ label: to }),
    });
  }
  return targets.length;
}

let customGroups = loadCustomGroups();

const PLATFORM_OPTIONS = [
  'tiktok',
  'facebook',
  'youtube',
  'instagram',
  'pinterest',
  'threads',
];

/** 与顶部 brand-hex 相同的环形顺序 */
const PLATFORM_ORBIT_ORDER = [
  'youtube',
  'tiktok',
  'instagram',
  'threads',
  'pinterest',
  'facebook',
];

function askConfirm(message, { title = '确认', anchor } = {}) {
  return new Promise((resolve) => {
    if (!els.confirmDialog) {
      resolve(window.confirm(message));
      return;
    }
    if (els.confirmDialogTitle) els.confirmDialogTitle.textContent = title;
    if (els.confirmDialogMessage) {
      // 支持 **加粗** 与换行
      els.confirmDialogMessage.innerHTML = escapeHtml(message)
        .replaceAll('\n', '<br>')
        .replaceAll(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }
    els.confirmDialog.returnValue = '';
    const onClose = () => {
      els.confirmDialog.removeEventListener('close', onClose);
      clearAnchoredDialog(els.confirmDialog);
      resolve(els.confirmDialog.returnValue === 'confirm');
    };
    els.confirmDialog.addEventListener('close', onClose);
    els.confirmDialog.showModal();
    positionAnchoredDialog(els.confirmDialog, anchor);
  });
}

function setQrPreview(src) {
  if (src) {
    els.qrImage.src = src;
    els.qrImage.hidden = false;
    if (els.qrPlaceholder) els.qrPlaceholder.hidden = true;
  }
}

let accounts = [];
let conversations = [];
let currentConversationId = null;
let selectedPlatform = null;
/** null = 全部分组 */
let selectedGroup = null;
/** 主选账号（会话列表焦点）；null = 未点选具体账号 */
let selectedAccountId = null;
/** 多选账号（Ctrl / Shift）；批量操作以此为准 */
let selectedAccountIds = new Set();
/** Shift 连选锚点 */
let lastAccountClickId = null;
/** 账号列表画框多选 */
let accountPointerSelect = null;
let suppressAccountClick = false;
const ACCOUNT_MARQUEE_THRESHOLD = 5;
let loginPollTimer = null;
let loginAccountId = null;
/** @type {ReturnType<typeof setTimeout>[]} */
let loginRedockTimers = [];

function clearLoginRedockTimers() {
  for (const t of loginRedockTimers) clearTimeout(t);
  loginRedockTimers = [];
}

function scheduleLoginRedock(accountId) {
  clearLoginRedockTimers();
  for (const delay of [300, 800, 1600]) {
    const t = setTimeout(async () => {
      if (loginAccountId !== accountId || !isChatEmbedOpen()) return;
      const bounds = await getEmbedWindowBounds(els.syncEmbedSlot);
      if (!bounds || loginAccountId !== accountId) return;
      await api(`/api/accounts/${accountId}/login/bounds`, {
        method: 'POST',
        body: JSON.stringify({ windowBounds: bounds }),
      }).catch(() => {});
    }, delay);
    loginRedockTimers.push(t);
  }
}

async function api(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function statusLabel(status, platform) {
  const map = {
    pending: '待登录',
    logging_in: '登录中',
    active: '已登录',
    expired: '已过期',
  };
  return map[status] || status;
}

function platformLabel(platform) {
  const map = {
    tiktok: 'TikTok',
    facebook: 'Facebook',
    youtube: 'YouTube',
    instagram: 'Instagram',
    pinterest: 'Pinterest',
    threads: 'Threads',
  };
  return map[platform] || 'TikTok';
}


function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return '';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d`;
  return d.toLocaleDateString('zh-CN');
}

/** 气泡时间：Facebook 同步多为相对时间反推，显示成「精确到秒」会误导 */
function formatMessageTime(iso, messageId) {
  if (!iso) return '';
  // 列表占位消息 / 近期消息：用相对时间，和左侧会话列表一致
  if (String(messageId || '').startsWith('preview_')) {
    return formatRelativeTime(iso) || formatTime(iso);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff >= 0 && diff < 48 * 3600 * 1000) {
    return formatRelativeTime(iso);
  }
  return formatTime(iso);
}

function initials(name) {
  const s = String(name || '?').trim();
  return (s[0] || '?').toUpperCase();
}

function avatarSrc(url, bust) {
  if (!url) return '';
  const u = String(url);
  if (u.startsWith('/media/')) {
    const t = bust ? `?v=${encodeURIComponent(bust)}` : `?v=${Date.now()}`;
    return u + t;
  }
  return u;
}

function avatarHtml(url, name, extraClass = '', bust = '') {
  const letter = escapeHtml(initials(name));
  if (url) {
    const src = escapeHtml(avatarSrc(url, bust));
    return `<span class="avatar ${extraClass}" data-letter="${letter}"><img src="${src}" alt="" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';this.parentElement.appendChild(document.createTextNode(this.parentElement.dataset.letter||'?'));" /></span>`;
  }
  return `<span class="avatar ${extraClass}">${letter}</span>`;
}

function fillAvatarEl(el, url, name, bust = '') {
  if (!el) return;
  const letter = initials(name);
  if (!url && !name) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.dataset.letter = letter;
  if (url) {
    el.innerHTML = `<img src="${escapeHtml(
      avatarSrc(url, bust)
    )}" alt="" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';this.parentElement.appendChild(document.createTextNode(this.parentElement.dataset.letter||'?'));" />`;
  } else {
    el.textContent = letter;
  }
}

async function refreshAccounts() {
  accounts = await api('/api/accounts');
  pruneSelection();
  renderGroups();
  renderAccounts();
  renderPlatformFilter();
}

function normalizeGroupName(label) {
  const t = String(label || '').trim();
  if (!t || t === '账号' || t === '未命名账号') return '未分组';
  return t;
}

function existingGroups() {
  const set = new Set(customGroups);
  for (const a of accounts) {
    const g = normalizeGroupName(a.label);
    if (g !== '未分组') set.add(g);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
}

function accountsForPlatform() {
  if (!selectedPlatform) return accounts;
  return accounts.filter((a) => (a.platform || 'tiktok') === selectedPlatform);
}

/** 当前平台 + 分组下的账号 */
function visibleAccounts() {
  let list = accountsForPlatform();
  if (selectedGroup) {
    list = list.filter((a) => normalizeGroupName(a.label) === selectedGroup);
  }
  return list;
}

function clearAccountSelection() {
  selectedAccountId = null;
  selectedAccountIds = new Set();
  lastAccountClickId = null;
}

async function clearAccountSelectionAndRefresh() {
  if (!selectedAccountIds.size && !selectedAccountId) return;
  clearAccountSelection();
  renderAccounts();
  renderPlatformFilter();
  await refreshConversations();
}

function getSelectedAccountIds() {
  return [...selectedAccountIds];
}

function pruneSelection() {
  // 空分组（0 账号）仍可选；仅当分组已不在列表中时才清掉
  if (selectedGroup) {
    const { names } = groupStats();
    if (!names.includes(selectedGroup)) {
      selectedGroup = null;
    }
  }
  const visibleIds = new Set(visibleAccounts().map((a) => a.id));
  selectedAccountIds = new Set([...selectedAccountIds].filter((id) => visibleIds.has(id)));
  if (selectedAccountId && !visibleIds.has(selectedAccountId)) {
    selectedAccountId = selectedAccountIds.size ? [...selectedAccountIds].at(-1) : null;
  }
  if (!selectedAccountIds.size) {
    selectedAccountId = null;
  } else if (!selectedAccountIds.has(selectedAccountId)) {
    selectedAccountId = [...selectedAccountIds].at(-1);
  }
}

function renderAccountItem(a) {
  const name = a.displayName || a.username || '未命名';
  const plat = a.platform || 'tiktok';
  const group = normalizeGroupName(a.label);
  const active = selectedAccountIds.has(a.id) ? ' active' : '';
  const hasProxy = Boolean(a.proxyServer);
  const region = String(a.proxyRegion || '').trim();
  const proxyTitle = hasProxy
    ? escapeHtml([region, a.proxyServer].filter(Boolean).join(' · '))
    : '';
  const proxyLabel = region || '代理';
  return `
    <li class="account-item${active}" data-id="${a.id}">
      ${avatarHtml(a.avatarUrl, name, '', a.updatedAt || a.id)}
      <div class="account-body">
        <div class="account-top">
          <strong class="account-name">${escapeHtml(name)}</strong>
          <span class="platform-tag ${escapeHtml(plat)}">${escapeHtml(platformLabel(plat))}</span>
        </div>
        <div class="account-meta">
          <span class="account-group">${escapeHtml(group)}</span>
          ${
            hasProxy
              ? `<span class="proxy-tag" title="${proxyTitle}">${escapeHtml(proxyLabel)}</span>`
              : ''
          }
          <span class="badge ${a.status}">${statusLabel(a.status, plat)}</span>
        </div>
      </div>
    </li>`;
}

const ADDABLE_PLATFORMS = new Set(['tiktok', 'facebook']);

function selectedAccountPlatform() {
  if (!selectedAccountId) return null;
  const a = accounts.find((x) => x.id === selectedAccountId);
  return a?.platform || null;
}

function renderPlatformFilter() {
  const hex = document.querySelector('.brand-hex');
  if (!hex) return;
  const filtered = Boolean(selectedPlatform);
  const accountPlat = selectedAccountPlatform();
  hex.classList.toggle('is-filtered', filtered);
  hex.querySelectorAll('.hex-icon[data-platform]').forEach((btn) => {
    // 选平台 → 筛选高亮；选账号 → 同款高亮，其余 logo 不变
    const on =
      btn.dataset.platform === selectedPlatform ||
      (!filtered && Boolean(accountPlat) && btn.dataset.platform === accountPlat);
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', btn.dataset.platform === selectedPlatform ? 'true' : 'false');
  });
  if (els.btnBrandAdd) {
    els.btnBrandAdd.hidden = !filtered;
    if (filtered) {
      const name = platformLabel(selectedPlatform);
      const canAdd = ADDABLE_PLATFORMS.has(selectedPlatform);
      els.btnBrandAdd.title = canAdd ? `添加 ${name} 账号` : `${name} 即将支持`;
      els.btnBrandAdd.setAttribute('aria-label', els.btnBrandAdd.title);
      els.btnBrandAdd.disabled = !canAdd;
      els.btnBrandAdd.classList.toggle('is-disabled', !canAdd);
    }
  }
}

function clearChatView() {
  currentConversationId = null;
  els.replyForm.hidden = true;
  els.messageList.innerHTML = '';
  els.chatTitle.textContent = '选择会话';
  els.chatSub.textContent = '';
  fillAvatarEl(els.chatAvatar, '', '');
}

function groupStats() {
  const base = accountsForPlatform();
  const map = new Map();
  for (const a of base) {
    const g = normalizeGroupName(a.label);
    map.set(g, (map.get(g) || 0) + 1);
  }
  for (const g of customGroups) {
    if (!map.has(g)) map.set(g, 0);
  }
  const names = [...map.keys()].sort((a, b) => {
    if (a === '未分组') return 1;
    if (b === '未分组') return -1;
    return a.localeCompare(b, 'zh');
  });
  return { total: base.length, names, map };
}

function renderGroups() {
  if (!els.groupList) return;
  const { total, names, map } = groupStats();
  if (!accounts.length && !customGroups.size) {
    els.groupList.innerHTML = '<li class="empty">还没有分组，点标题旁加号创建</li>';
    return;
  }

  const items = [
    {
      key: '',
      name: selectedPlatform ? platformLabel(selectedPlatform) : 'ALL',
      count: total,
      active: !selectedGroup,
    },
    ...names.map((g) => ({
      key: g,
      name: g,
      count: map.get(g) || 0,
      active: selectedGroup === g,
    })),
  ];

  const addSvg = `<svg class="brand-add-svg" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <path fill="url(#aomGroupAddOuter)" fill-rule="evenodd" d="M256 56c110.5 0 200 89.5 200 200s-89.5 200-200 200S56 366.5 56 256 145.5 56 256 56zm0 52c-81.7 0-148 66.3-148 148s66.3 148 148 148 148-66.3 148-148-66.3-148-148-148z"/>
      <path fill="url(#aomGroupAddInner)" d="M351.604 234.755h-63.736c-5.867 0-10.623-4.756-10.623-10.623v-63.736c0-11.714-9.531-21.245-21.245-21.245s-21.245 9.531-21.245 21.245v63.736c0 5.867-4.756 10.623-10.623 10.623h-63.736c-11.714 0-21.245 9.531-21.245 21.245s9.531 21.245 21.245 21.245h63.736c5.867 0 10.623 4.756 10.623 10.623v63.736c0 11.714 9.531 21.245 21.245 21.245s21.245-9.531 21.245-21.245v-63.736c0-5.867 4.756-10.623 10.623-10.623h63.736c11.714 0 21.245-9.531 21.245-21.245s-9.531-21.245-21.245-21.245z"/>
    </svg>`;

  els.groupList.innerHTML = items
    .map((g) => {
      const addBtn = g.key
        ? `<button type="button" class="group-add-btn group-row-add" data-add-group="${escapeHtml(
            g.key
          )}" aria-label="${escapeHtml(`添加账号到「${g.name}」`)}" title="${escapeHtml(
            `添加账号到「${g.name}」`
          )}">
        ${addSvg}
      </button>`
        : `<span class="group-row-add-spacer" aria-hidden="true"></span>`;
      return `
    <li class="group-row">
      <button type="button" class="group-item${g.active ? ' active' : ''}" data-group="${escapeHtml(
        g.key
      )}">
        <span class="group-item-name">${escapeHtml(g.name)}</span>
        <span class="group-item-count">${g.count}</span>
      </button>
      ${addBtn}
    </li>`;
    })
    .join('');
}

function renderAccounts() {
  const list = visibleAccounts();
  if (!accounts.length) {
    els.accountList.innerHTML = '<li class="empty">先选平台，再点中间加号添加账号</li>';
    return;
  }
  if (!list.length) {
    const tip = selectedGroup
      ? `「${selectedGroup}」下暂无账号`
      : selectedPlatform
        ? `暂无 ${platformLabel(selectedPlatform)} 账号`
        : '暂无账号';
    els.accountList.innerHTML = `<li class="empty">${escapeHtml(tip)}</li>`;
    return;
  }
  els.accountList.innerHTML = list.map(renderAccountItem).join('');
}

async function refreshConversations() {
  const selected = getSelectedAccountIds();
  let list;
  if (selected.length === 1) {
    list = await api(`/api/conversations?accountId=${encodeURIComponent(selected[0])}`);
  } else {
    list = await api('/api/conversations');
    const ids = new Set(selected.length ? selected : visibleAccounts().map((a) => a.id));
    list = list.filter((c) => ids.has(c.accountId));
  }
  conversations = list;
  if (currentConversationId && !conversations.some((c) => c.id === currentConversationId)) {
    clearChatView();
  }
  renderConversations();
}

async function setPlatformFilter(platform) {
  selectedPlatform = selectedPlatform === platform ? null : platform;
  clearAccountSelection();
  pruneSelection();
  renderPlatformFilter();
  renderGroups();
  renderAccounts();
  await refreshConversations();
}

async function setGroupFilter(group) {
  selectedGroup = group || null;
  clearAccountSelection();
  pruneSelection();
  renderGroups();
  renderAccounts();
  renderPlatformFilter();
  await refreshConversations();
}

async function setAccountFilter(accountId, { multi = false, range = false } = {}) {
  const visible = visibleAccounts();
  const ids = visible.map((a) => a.id);
  if (!ids.includes(accountId)) return;

  if (range && lastAccountClickId && ids.includes(lastAccountClickId)) {
    const i0 = ids.indexOf(lastAccountClickId);
    const i1 = ids.indexOf(accountId);
    const [lo, hi] = i0 < i1 ? [i0, i1] : [i1, i0];
    if (!multi) selectedAccountIds = new Set();
    for (let i = lo; i <= hi; i++) selectedAccountIds.add(ids[i]);
    selectedAccountId = accountId;
  } else if (multi) {
    if (selectedAccountIds.has(accountId)) {
      selectedAccountIds.delete(accountId);
      if (selectedAccountId === accountId) {
        selectedAccountId = selectedAccountIds.size ? [...selectedAccountIds].at(-1) : null;
      }
    } else {
      selectedAccountIds.add(accountId);
      selectedAccountId = accountId;
    }
    lastAccountClickId = accountId;
  } else if (selectedAccountIds.size === 1 && selectedAccountIds.has(accountId)) {
    clearAccountSelection();
  } else {
    selectedAccountIds = new Set([accountId]);
    selectedAccountId = accountId;
    lastAccountClickId = accountId;
  }

  if (range) lastAccountClickId = accountId;

  renderAccounts();
  renderPlatformFilter();
  await refreshConversations();
}

function renderConversations() {
  if (!conversations.length) {
    els.conversationList.innerHTML =
      '<li class="empty">暂无会话。先登录账号，再点中央 AOM 同步</li>';
    return;
  }

  els.conversationList.innerHTML = conversations
    .map((c) => {
      const name = c.peerNickname || c.peerUsername || c.peerId;
      const timeLabel = formatRelativeTime(c.lastMessageAt || c.updatedAt);
      return `
    <li>
      <button class="conversation-item ${
        c.id === currentConversationId ? 'active' : ''
      }" data-id="${c.id}" type="button">
        ${avatarHtml(c.peerAvatar, name, '', c.lastMessageAt || c.updatedAt || c.id)}
        <div class="conversation-body">
          <div class="top">
            <strong>${escapeHtml(name)}</strong>
            <span class="acct">${escapeHtml(
              timeLabel ||
                c.accountDisplayName ||
                c.accountUsername ||
                c.accountLabel ||
                ''
            )}</span>
          </div>
          <div class="preview">${escapeHtml(c.lastMessage || '')}</div>
        </div>
      </button>
    </li>`;
    })
    .join('');
}

async function openConversation(id) {
  currentConversationId = id;
  const conv = conversations.find((c) => c.id === id);
  const name = conv
    ? conv.peerNickname || conv.peerUsername || conv.peerId
    : '';
  els.chatTitle.textContent = name || '会话';
  els.chatSub.textContent = conv
    ? `来自「${
        conv.accountDisplayName ||
        conv.accountUsername ||
        conv.accountLabel ||
        conv.accountId
      }」`
    : '';
  fillAvatarEl(els.chatAvatar, conv?.peerAvatar, name);
  els.replyForm.hidden = false;
  renderConversations();

  const messages = await api(`/api/conversations/${id}/messages`);
  els.messageList.innerHTML = messages.length
    ? messages
        .map(
          (m) => `
      <div class="bubble ${m.direction === 'out' ? 'out' : 'in'}">
        ${escapeHtml(m.content)}
        <time>${formatMessageTime(m.sentAt || m.createdAt, m.id)}</time>
      </div>`
        )
        .join('')
    : '<div class="empty">暂无消息详情，可先同步或直接回复</div>';
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

let loginSucceeded = false;

function applyLoginEmbedCopy(platform, statusText) {
  const isFb = platform === 'facebook';
  if (els.syncEmbedTitle) {
    els.syncEmbedTitle.textContent = isFb ? 'Facebook 登录' : 'TikTok 登录';
  }
  if (els.syncEmbedStatus) {
    els.syncEmbedStatus.textContent =
      statusText ||
      (isFb
        ? '请在右侧浏览器窗口中完成 Facebook 登录（账密 / 二次验证）'
        : '请在右侧浏览器窗口中用邮箱或用户名完成 TikTok 登录');
  }
  if (els.qrPlaceholder) {
    els.qrPlaceholder.textContent = '浏览器将贴合此区域，请在窗口内完成登录';
  }
}

async function startLogin(accountId) {
  loginAccountId = accountId;
  loginSucceeded = false;
  clearLoginRedockTimers();
  const account = accounts.find((a) => a.id === accountId);
  const platform = account?.platform || 'tiktok';
  showChatEmbed({
    title: platform === 'facebook' ? 'Facebook 登录' : 'TikTok 登录',
    status: '正在启动',
    showCancel: true,
  });
  applyLoginEmbedCopy(platform, '正在启动');

  const windowBounds = await getEmbedWindowBounds(els.syncEmbedSlot);

  // 接口立刻返回，不再干等浏览器启动
  const result = await api(`/api/accounts/${accountId}/login`, {
    method: 'POST',
    body: JSON.stringify({ windowBounds }),
  });
  if (result.platform) applyLoginEmbedCopy(result.platform, result.message);
  else applyLoginEmbedCopy(platform, result.message || '正在启动浏览器');
  setQrPreview(result.screenshot);
  scheduleLoginRedock(accountId);

  clearInterval(loginPollTimer);
  const poll = async () => {
    try {
      const st = await api(`/api/accounts/${accountId}/login/status`);
      const p = st.platform || platform;
      if (st.message) applyLoginEmbedCopy(p, st.message);
      else applyLoginEmbedCopy(p);
      setQrPreview(st.screenshot);

      if (st.status === 'logged_in') {
        clearInterval(loginPollTimer);
        clearLoginRedockTimers();
        loginSucceeded = true;
        const who = st.profile?.displayName || st.profile?.username || '';
        applyLoginEmbedCopy(p, who ? `登录成功：${who}` : '登录成功');
        setTimeout(() => {
          hideChatEmbed();
          loginAccountId = null;
          refreshAccounts();
        }, 600);
      } else if (st.status === 'expired' || st.status === 'error') {
        clearInterval(loginPollTimer);
        clearLoginRedockTimers();
        applyLoginEmbedCopy(
          p,
          st.message || (st.status === 'expired' ? '登录超时，请重试' : '登录失败')
        );
      }
    } catch (e) {
      applyLoginEmbedCopy(platform, e.message);
    }
  };
  await poll();
  loginPollTimer = setInterval(poll, 1200);
}

async function cancelLogin() {
  clearInterval(loginPollTimer);
  clearLoginRedockTimers();
  const id = loginAccountId;
  loginAccountId = null;
  hideChatEmbed();
  if (id && !loginSucceeded) {
    await api(`/api/accounts/${id}/login/cancel`, { method: 'POST' }).catch(() => {});
  }
  await refreshAccounts();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function clearAnchoredDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove('dialog-anchored', 'is-closing');
  dialog.style.left = '';
  dialog.style.top = '';
  dialog.style.removeProperty('--dialog-origin');
  delete dialog.dataset.closing;
}

function clearGroupDialogAnchor() {
  clearAnchoredDialog(els.groupDialog);
}

function closeAnchoredDialogAnimated(dialog, returnValue = 'cancel') {
  if (!dialog?.open) return;
  if (dialog.dataset.closing === '1') return;

  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !dialog.classList.contains('dialog-anchored')) {
    dialog.close(returnValue);
    return;
  }

  dialog.dataset.closing = '1';
  dialog.classList.add('is-closing');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    dialog.classList.remove('is-closing');
    delete dialog.dataset.closing;
    if (dialog.open) dialog.close(returnValue);
  };
  dialog.addEventListener(
    'animationend',
    (e) => {
      if (e.target === dialog) finish();
    },
    { once: true }
  );
  setTimeout(finish, 220);
}

function closeGroupDialogAnimated(returnValue = 'cancel') {
  closeAnchoredDialogAnimated(els.groupDialog, returnValue);
}

function positionAnchoredDialog(dialog, anchorEl) {
  if (!dialog) return;
  const anchor = anchorEl && !anchorEl.hidden ? anchorEl : null;
  if (!anchor) {
    clearAnchoredDialog(dialog);
    return;
  }

  dialog.classList.add('dialog-anchored');
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const d = dialog.getBoundingClientRect();
    const gap = 12;
    const pad = 10;
    let left = a.right + gap;
    let originX = '0%';
    if (left + d.width > window.innerWidth - pad) {
      left = Math.max(pad, a.left - d.width - gap);
      originX = '100%';
    }
    let top = a.top + a.height / 2 - d.height / 2;
    top = Math.max(pad, Math.min(top, window.innerHeight - d.height - pad));
    left = Math.max(pad, left);
    const originY = `${Math.max(
      12,
      Math.min(88, ((a.top + a.height / 2 - top) / Math.max(d.height, 1)) * 100)
    )}%`;
    dialog.style.setProperty('--dialog-origin', `${originX} ${originY}`);
    dialog.style.left = `${Math.round(left)}px`;
    dialog.style.top = `${Math.round(top)}px`;
  };

  requestAnimationFrame(() => requestAnimationFrame(place));
}

function positionGroupDialog(anchorEl) {
  positionAnchoredDialog(els.groupDialog, anchorEl);
}

function renderPlatformChips(activePlatform) {
  if (!els.platformChips) return;
  els.platformChips.innerHTML = PLATFORM_OPTIONS.map((id) => {
    const addable = ADDABLE_PLATFORMS.has(id);
    const active = id === activePlatform ? ' active' : '';
    const disabled = addable ? '' : ' disabled';
    const title = addable ? platformLabel(id) : `${platformLabel(id)} 即将支持`;
    return `<button type="button" class="group-chip${active}" data-platform="${escapeHtml(
      id
    )}" title="${escapeHtml(title)}"${disabled}>
      <img src="/icons/${escapeHtml(id)}.svg" alt="" />
      <span>${escapeHtml(platformLabel(id))}</span>
    </button>`;
  }).join('');
}

function syncPlatformChipActive(platform) {
  els.platformChips?.querySelectorAll('.group-chip[data-platform]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.platform === platform);
  });
}

function fillGroupDialog({
  title,
  hint,
  initialGroup,
  anchor,
  showPlatform = false,
  createGroupOnly = false,
  renameGroupOnly = false,
  platformOnly = false,
} = {}) {
  const nameOnly = createGroupOnly || renameGroupOnly;
  if (els.groupDialogTitle) {
    els.groupDialogTitle.textContent =
      title ||
      (renameGroupOnly
        ? '重命名分组'
        : createGroupOnly
          ? '新建项目分组'
          : showPlatform
            ? '添加账号'
            : '选择分组');
  }
  if (els.groupDialogHint) {
    if (hint) {
      els.groupDialogHint.hidden = false;
      els.groupDialogHint.textContent = hint;
    } else {
      els.groupDialogHint.hidden = true;
      els.groupDialogHint.textContent = '';
    }
  }
  if (els.platformPicker) {
    els.platformPicker.hidden = !showPlatform;
  }
  if (els.groupPicker) {
    els.groupPicker.hidden = nameOnly || platformOnly;
  }
  if (els.groupInputField) {
    els.groupInputField.hidden = platformOnly;
  }
  if (els.groupInputLabel) {
    els.groupInputLabel.textContent = nameOnly ? '分组名称' : '或输入新分组';
  }
  if (showPlatform) {
    dialogPlatform =
      selectedPlatform && ADDABLE_PLATFORMS.has(selectedPlatform) ? selectedPlatform : null;
    renderPlatformChips(dialogPlatform);
  } else {
    dialogPlatform = null;
  }

  const groups = existingGroups();
  const chipGroups = ['未分组', ...groups];
  if (els.groupChips) {
    els.groupChips.innerHTML = chipGroups
      .map(
        (g) =>
          `<button type="button" class="group-chip" data-group="${escapeHtml(g)}">${escapeHtml(
            g
          )}</button>`
      )
      .join('');
  }
  if (els.groupInput) {
    if (renameGroupOnly) {
      els.groupInput.value = initialGroup || '';
      els.groupInput.placeholder = '输入新的分组名称';
      queueMicrotask(() => {
        els.groupInput?.select();
      });
    } else if (createGroupOnly) {
      els.groupInput.value = '';
      els.groupInput.placeholder = '如：人造草 / 客服组 / 店铺A';
    } else if (platformOnly) {
      els.groupInput.value = initialGroup || '未分组';
    } else {
      const fallback = selectedGroup || groups[0] || '未分组';
      els.groupInput.value = initialGroup ?? fallback;
      els.groupInput.placeholder = '如：客服组 / 主号 / 店铺A';
    }
    syncGroupChipActive(els.groupInput.value);
  }
  els.groupDialog.returnValue = '';
  els.groupDialog.showModal();
  positionGroupDialog(anchor);
  queueMicrotask(() => {
    if (showPlatform) {
      els.platformChips?.querySelector('.group-chip.active, .group-chip:not([disabled])')?.focus();
    } else {
      els.groupInput?.focus();
    }
  });
}

function openGroupDialog(platform, { anchor, initialGroup } = {}) {
  pendingPlatform = platform;
  pendingMoveAccountIds = [];
  pendingCreateGroup = false;
  pendingRenameGroup = null;
  fillGroupDialog({
    title: '选择分组',
    hint: '',
    initialGroup,
    anchor: anchor || els.btnBrandAdd,
    showPlatform: false,
    createGroupOnly: false,
  });
}

function openCreateGroupDialog() {
  pendingPlatform = null;
  pendingMoveAccountIds = [];
  dialogPlatform = null;
  pendingCreateGroup = true;
  pendingRenameGroup = null;
  fillGroupDialog({
    title: '新建项目分组',
    hint: '',
    initialGroup: '',
    anchor: els.btnGroupAdd,
    showPlatform: false,
    createGroupOnly: true,
  });
}

function openRenameGroupDialog(groupName, anchor) {
  const oldName = normalizeGroupName(groupName);
  if (!isEditableGroup(oldName)) return;
  pendingPlatform = null;
  pendingMoveAccountIds = [];
  dialogPlatform = null;
  pendingCreateGroup = false;
  pendingRenameGroup = oldName;
  const item = els.groupList?.querySelector(
    `.group-item[data-group="${CSS.escape(oldName)}"]`
  );
  fillGroupDialog({
    title: `重命名 · ${oldName}`,
    hint: '',
    initialGroup: oldName,
    anchor: anchor || item || els.btnGroupAdd,
    showPlatform: false,
    renameGroupOnly: true,
  });
}

function renderGroupPlatformOrbit() {
  if (!els.groupPlatformOrbit) return;
  els.groupPlatformOrbit.innerHTML = PLATFORM_ORBIT_ORDER.map((id, i) => {
    const addable = ADDABLE_PLATFORMS.has(id);
    const title = addable ? platformLabel(id) : `${platformLabel(id)} 即将支持`;
    const disabled = addable ? '' : ' disabled';
    const disabledClass = addable ? '' : ' is-disabled';
    return `<button type="button" class="hex-icon${disabledClass}" style="--i: ${i}" data-platform="${escapeHtml(
      id
    )}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" role="menuitem"${disabled}>
      <img src="/icons/${escapeHtml(id)}.svg" alt="" />
    </button>`;
  }).join('');
}

function showGroupPlatformPicker(groupName, anchor) {
  const group = normalizeGroupName(groupName) || '未分组';
  const picker = els.groupPlatformPicker;
  const orbit = els.groupPlatformOrbit;
  if (!picker || !orbit || !anchor) return;

  const isVisible = !picker.hidden && !picker.classList.contains('is-closing');
  const sameOpen = isVisible && pendingAddGroup === group && anchor.classList.contains('is-picking');
  hideAccountContextMenu();
  hideGroupContextMenu();
  if (sameOpen) {
    hideGroupPlatformPicker();
    return;
  }

  window.clearTimeout(groupPlatformPickerHideTimer);
  groupPlatformPickerHideTimer = 0;
  document.querySelectorAll('.group-add-btn.is-picking').forEach((btn) => {
    btn.classList.remove('is-picking');
  });
  picker.classList.remove('is-closing');

  pendingAddGroup = group;
  renderGroupPlatformOrbit();

  const rect = anchor.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  orbit.style.left = `${cx}px`;
  orbit.style.top = `${cy}px`;

  anchor.classList.add('is-picking');
  picker.hidden = false;
  // 先落到收起态再展开，保证重开也有入场动效
  picker.classList.remove('is-open');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (pendingAddGroup !== group || picker.hidden) return;
      picker.classList.add('is-open');
    });
  });
}

async function addAccountToGroup(groupName, platform) {
  const group = normalizeGroupName(groupName) || '未分组';
  if (!platform || !ADDABLE_PLATFORMS.has(platform)) {
    alert(`${platformLabel(platform)} 即将支持`);
    return;
  }
  hideGroupPlatformPicker();
  try {
    addCustomGroup(group);
    const account = await api('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({ label: group, platform }),
    });
    selectedGroup = group;
    await refreshAccounts();
    await startLogin(account.id);
  } catch (e) {
    alert(e.message);
  }
}

function openMoveGroupDialog(accountIds) {
  const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean);
  if (!ids.length) return;
  const account = accounts.find((a) => a.id === ids[0]);
  if (!account) return;
  pendingPlatform = null;
  dialogPlatform = null;
  pendingCreateGroup = false;
  pendingRenameGroup = null;
  pendingMoveAccountIds = ids;
  const title =
    ids.length > 1
      ? `切换分组 · ${ids.length} 个账号`
      : `切换分组 · ${account.displayName || account.username || '未命名'}`;
  const item = els.accountList?.querySelector(`[data-id="${CSS.escape(ids[0])}"]`);
  fillGroupDialog({
    title,
    hint: '',
    initialGroup: normalizeGroupName(account.label),
    anchor: item || els.btnBrandAdd,
    showPlatform: false,
    createGroupOnly: false,
  });
}

function hideAccountContextMenu() {
  contextMenuAccountIds = [];
  if (els.accountContextMenu) els.accountContextMenu.hidden = true;
}

function hideGroupContextMenu() {
  contextMenuGroupName = null;
  if (els.groupContextMenu) els.groupContextMenu.hidden = true;
}

let groupPlatformPickerHideTimer = 0;

function hideGroupPlatformPicker({ immediate = false } = {}) {
  const picker = els.groupPlatformPicker;
  pendingAddGroup = null;
  document.querySelectorAll('.group-add-btn.is-picking').forEach((btn) => {
    btn.classList.remove('is-picking');
  });
  if (!picker || picker.hidden) {
    if (picker) {
      picker.classList.remove('is-open', 'is-closing');
    }
    return;
  }

  window.clearTimeout(groupPlatformPickerHideTimer);

  const finish = () => {
    groupPlatformPickerHideTimer = 0;
    picker.classList.remove('is-open', 'is-closing');
    picker.hidden = true;
  };

  const reduceMotion =
    immediate ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  if (reduceMotion || !picker.classList.contains('is-open')) {
    finish();
    return;
  }

  picker.classList.add('is-closing');
  picker.classList.remove('is-open');
  // 入场 stagger 约 5*28ms + 0.28s；出场反向约 5*24ms + 0.22s
  groupPlatformPickerHideTimer = window.setTimeout(finish, 360);
}

function hideAllContextMenus() {
  hideAccountContextMenu();
  hideGroupContextMenu();
  hideGroupPlatformPicker();
}

function placeContextMenu(menu, x, y) {
  if (!menu) return;
  menu.hidden = false;
  const pad = 8;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - pad);
  const top = Math.min(y, window.innerHeight - rect.height - pad);
  menu.style.left = `${Math.max(pad, left)}px`;
  menu.style.top = `${Math.max(pad, top)}px`;
}

function showAccountContextMenu(accountIds, x, y) {
  const menu = els.accountContextMenu;
  const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean);
  if (!menu || !ids.length) return;
  hideGroupContextMenu();
  contextMenuAccountIds = ids;
  const multi = ids.length > 1;
  const account = accounts.find((a) => a.id === ids[0]);
  const loginBtn = menu.querySelector('[data-ctx="login"]');
  const proxyBtn = menu.querySelector('[data-ctx="proxy"]');
  const moveBtn = menu.querySelector('[data-ctx="move"]');
  const deleteBtn = menu.querySelector('[data-ctx="delete"]');
  if (loginBtn) {
    loginBtn.hidden = multi || account?.status === 'active';
  }
  if (proxyBtn) proxyBtn.hidden = multi;
  if (moveBtn) moveBtn.textContent = multi ? `批量切换分组（${ids.length}）` : '切换分组';
  if (deleteBtn) deleteBtn.textContent = multi ? `批量删除（${ids.length}）` : '删除';
  placeContextMenu(menu, x, y);
}

let proxyEditAccountId = null;
let proxyRegionsCache = [];
let proxyProfilesCache = [];
let proxyManagerRegion = null;

async function loadProxyCatalog() {
  const [regions, profiles] = await Promise.all([
    api('/api/proxies/regions'),
    api('/api/proxies/profiles'),
  ]);
  proxyRegionsCache = Array.isArray(regions) ? regions : [];
  proxyProfilesCache = Array.isArray(profiles) ? profiles : [];
  return { regions: proxyRegionsCache, profiles: proxyProfilesCache };
}

function fillAccountProxyRegionOptions(selected = '') {
  if (!els.proxyRegion) return;
  const opts = ['<option value="">不标注</option>'].concat(
    proxyRegionsCache.map(
      (r) =>
        `<option value="${escapeHtml(r.name)}"${r.name === selected ? ' selected' : ''}>${escapeHtml(
          r.name
        )}</option>`
    )
  );
  els.proxyRegion.innerHTML = opts.join('');
}

function fillAccountProxyProfileOptions(selectedId = '') {
  if (!els.proxyProfilePick) return;
  const opts = ['<option value="">手动填写 / 不选用</option>'].concat(
    proxyProfilesCache.map((p) => {
      const label = p.label || p.server;
      const text = `${p.region} · ${label}`;
      return `<option value="${escapeHtml(p.id)}"${p.id === selectedId ? ' selected' : ''}>${escapeHtml(
        text
      )}</option>`;
    })
  );
  els.proxyProfilePick.innerHTML = opts.join('');
}

function applyPickedProxyProfile(profileId) {
  const p = proxyProfilesCache.find((x) => x.id === profileId);
  if (!p) return;
  if (els.proxyRegion) els.proxyRegion.value = p.region || '';
  if (els.proxyServer) els.proxyServer.value = p.server || '';
  if (els.proxyUsername) els.proxyUsername.value = p.username || '';
  if (els.proxyPassword) els.proxyPassword.value = p.password || '';
}

async function openProxyDialog(accountId) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account || !els.proxyDialog) return;
  proxyEditAccountId = accountId;
  try {
    await loadProxyCatalog();
  } catch {
    /* offline catalog ok */
  }
  fillAccountProxyRegionOptions(account.proxyRegion || '');
  fillAccountProxyProfileOptions(account.proxyProfileId || '');
  if (els.proxyServer) els.proxyServer.value = account.proxyServer || '';
  if (els.proxyUsername) els.proxyUsername.value = account.proxyUsername || '';
  if (els.proxyPassword) els.proxyPassword.value = account.proxyPassword || '';
  els.proxyDialog.showModal();
  els.proxyServer?.focus();
}

async function saveAccountProxy({ clear = false } = {}) {
  const id = proxyEditAccountId;
  if (!id) return;
  const profileId = els.proxyProfilePick?.value || '';
  let body;
  if (clear) {
    body = { server: '', username: '', password: '', region: '', profileId: '' };
  } else if (profileId) {
    body = { profileId };
  } else {
    body = {
      server: els.proxyServer?.value?.trim() || '',
      username: els.proxyUsername?.value?.trim() || '',
      password: els.proxyPassword?.value ?? '',
      region: els.proxyRegion?.value || '',
      profileId: '',
    };
  }
  await api(`/api/accounts/${id}/proxy`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  proxyEditAccountId = null;
  els.proxyDialog?.close();
  await refreshAccounts();
}

function renderProxyRegionList() {
  if (!els.proxyRegionList) return;
  if (!proxyRegionsCache.length) {
    els.proxyRegionList.innerHTML = '<li class="proxy-empty">还没有国家，点右上角添加</li>';
    return;
  }
  if (!proxyManagerRegion || !proxyRegionsCache.some((r) => r.name === proxyManagerRegion)) {
    proxyManagerRegion = proxyRegionsCache[0]?.name || null;
  }
  els.proxyRegionList.innerHTML = proxyRegionsCache
    .map((r) => {
      const count = proxyProfilesCache.filter((p) => p.region === r.name).length;
      const active = r.name === proxyManagerRegion ? ' active' : '';
      return `<li class="proxy-region-row">
        <button type="button" class="proxy-region-item${active}" data-region="${escapeHtml(r.name)}">
          <span class="proxy-region-item-name">${escapeHtml(r.name)}</span>
          <span class="muted">${count}</span>
        </button>
        <div class="proxy-item-actions">
          <button type="button" class="btn" data-region-act="rename" data-region="${escapeHtml(
            r.name
          )}">改</button>
          <button type="button" class="btn" data-region-act="delete" data-region="${escapeHtml(
            r.name
          )}">删</button>
        </div>
      </li>`;
    })
    .join('');
}

function renderProxyProfileList() {
  if (!els.proxyProfileList) return;
  const region = proxyManagerRegion;
  if (els.proxyProfileRegionTitle) {
    els.proxyProfileRegionTitle.textContent = region ? `${region} · 代理` : '代理列表';
  }
  if (!region) {
    els.proxyProfileList.innerHTML = '<li class="proxy-empty">先选择或添加一个国家</li>';
    return;
  }
  const list = proxyProfilesCache.filter((p) => p.region === region);
  if (!list.length) {
    els.proxyProfileList.innerHTML =
      '<li class="proxy-empty">该国家还没有代理，点右上角 + 代理</li>';
    return;
  }
  els.proxyProfileList.innerHTML = list
    .map(
      (p) => `<li class="proxy-profile-item" data-id="${escapeHtml(p.id)}">
        <div class="proxy-profile-item-main">
          <strong>${escapeHtml(p.label || '未命名线路')}</strong>
          <span title="${escapeHtml(p.server)}">${escapeHtml(p.server)}</span>
        </div>
        <div class="proxy-item-actions">
          <button type="button" class="btn" data-proxy-act="edit">编辑</button>
          <button type="button" class="btn" data-proxy-act="delete">删除</button>
        </div>
      </li>`
    )
    .join('');
}

async function refreshProxyManager() {
  await loadProxyCatalog();
  renderProxyRegionList();
  renderProxyProfileList();
}

async function openProxyManager() {
  if (!els.proxyManager) return;
  els.proxyManager.hidden = false;
  try {
    await refreshProxyManager();
  } catch (e) {
    alert(e.message);
  }
}

function closeProxyManager() {
  if (els.proxyManager) els.proxyManager.hidden = true;
}

let proxyRegionEditName = null;
let proxyProfileEditId = null;

function openProxyRegionDialog({ title = '添加国家', name = '', renameFrom = null } = {}) {
  return new Promise((resolve) => {
    if (!els.proxyRegionDialog) {
      resolve(null);
      return;
    }
    proxyRegionEditName = renameFrom;
    if (els.proxyRegionDialogTitle) els.proxyRegionDialogTitle.textContent = title;
    if (els.proxyRegionNameInput) els.proxyRegionNameInput.value = name || '';
    els.proxyRegionDialog.returnValue = '';
    const onClose = () => {
      els.proxyRegionDialog.removeEventListener('close', onClose);
      const ok = els.proxyRegionDialog.returnValue === 'save';
      const value = String(els.proxyRegionNameInput?.value || '').trim();
      resolve(ok && value ? value : null);
    };
    els.proxyRegionDialog.addEventListener('close', onClose);
    els.proxyRegionDialog.showModal();
    els.proxyRegionNameInput?.focus();
    els.proxyRegionNameInput?.select?.();
  });
}

function openProxyProfileDialog(existing = null) {
  return new Promise((resolve) => {
    if (!els.proxyProfileDialog) {
      resolve(null);
      return;
    }
    proxyProfileEditId = existing?.id || null;
    if (els.proxyProfileDialogTitle) {
      els.proxyProfileDialogTitle.textContent = existing ? '编辑代理' : '添加代理';
    }
    if (els.proxyProfileLabelInput) els.proxyProfileLabelInput.value = existing?.label || '';
    if (els.proxyProfileServerInput) {
      els.proxyProfileServerInput.value = existing?.server || 'socks5://127.0.0.1:';
    }
    if (els.proxyProfileUsernameInput) {
      els.proxyProfileUsernameInput.value = existing?.username || '';
    }
    if (els.proxyProfilePasswordInput) {
      els.proxyProfilePasswordInput.value = existing?.password || '';
    }
    els.proxyProfileDialog.returnValue = '';
    const onClose = () => {
      els.proxyProfileDialog.removeEventListener('close', onClose);
      if (els.proxyProfileDialog.returnValue !== 'save') {
        resolve(null);
        return;
      }
      resolve({
        label: String(els.proxyProfileLabelInput?.value || '').trim(),
        server: String(els.proxyProfileServerInput?.value || '').trim(),
        username: String(els.proxyProfileUsernameInput?.value || '').trim(),
        password: els.proxyProfilePasswordInput?.value ?? '',
      });
    };
    els.proxyProfileDialog.addEventListener('close', onClose);
    els.proxyProfileDialog.showModal();
    els.proxyProfileServerInput?.focus();
  });
}

async function addProxyRegion() {
  const name = await openProxyRegionDialog({ title: '添加国家' });
  if (!name) return;
  await api('/api/proxies/regions', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  proxyManagerRegion = name;
  await refreshProxyManager();
}

async function renameProxyRegion(oldName) {
  const name = await openProxyRegionDialog({
    title: '重命名国家',
    name: oldName,
    renameFrom: oldName,
  });
  if (!name || name === oldName) return;
  await api(`/api/proxies/regions/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  proxyManagerRegion = name;
  await refreshProxyManager();
}

async function deleteProxyRegionByName(name) {
  const ok = await askConfirm(`确定删除国家「${name}」？\n需先清空其下全部代理。`, {
    title: '删除国家',
  });
  if (!ok) return;
  await api(`/api/proxies/regions/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (proxyManagerRegion === name) proxyManagerRegion = null;
  await refreshProxyManager();
}

async function addOrEditProxyProfile(existing = null) {
  if (!proxyManagerRegion) {
    alert('请先选择国家');
    return;
  }
  const data = await openProxyProfileDialog(existing);
  if (!data) return;
  if (!data.server) {
    alert('请填写代理地址');
    return;
  }

  if (existing?.id) {
    await api(`/api/proxies/profiles/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        region: proxyManagerRegion,
        ...data,
      }),
    });
  } else {
    await api('/api/proxies/profiles', {
      method: 'POST',
      body: JSON.stringify({
        region: proxyManagerRegion,
        ...data,
      }),
    });
  }
  await refreshProxyManager();
}

function showGroupContextMenu(groupName, x, y) {
  const menu = els.groupContextMenu;
  const name = normalizeGroupName(groupName);
  if (!menu || !isEditableGroup(name)) return;
  hideAccountContextMenu();
  contextMenuGroupName = name;
  placeContextMenu(menu, x, y);
}

async function renameProjectGroup(oldName, newName) {
  const from = normalizeGroupName(oldName);
  const to = normalizeGroupName(newName);
  if (!isEditableGroup(from)) return;
  if (!to || to === '未分组') {
    alert('请输入有效的分组名称');
    return;
  }
  if (from === to) return;

  removeCustomGroup(from);
  addCustomGroup(to);
  await setAccountsGroupLabel(from, to);
  if (selectedGroup === from) selectedGroup = to;
  await refreshAccounts();
}

async function deleteProjectGroup(groupName, { anchor } = {}) {
  const name = normalizeGroupName(groupName);
  if (!isEditableGroup(name)) return;

  const count = accounts.filter((a) => normalizeGroupName(a.label) === name).length;
  const msg =
    count > 0
      ? `确定删除分组「${name}」？\n其中 **${count}** 个账号将移到「未分组」。`
      : `确定删除分组「${name}」？`;
  const row =
    anchor ||
    els.groupList?.querySelector(`.group-item[data-group="${CSS.escape(name)}"]`);
  const ok = await askConfirm(msg, { title: '删除分组', anchor: row });
  if (!ok) return;

  removeCustomGroup(name);
  if (count > 0) await setAccountsGroupLabel(name, '未分组');
  if (selectedGroup === name) selectedGroup = null;
  await refreshAccounts();
}

async function deleteAccounts(accountIds, { anchor } = {}) {
  const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean);
  if (!ids.length) return;
  const msg =
    ids.length > 1
      ? `确定删除选中的 **${ids.length}** 个账号及其本地会话？`
      : '确定删除该账号及其本地会话？';
  const row =
    anchor ||
    els.accountList?.querySelector(`[data-id="${CSS.escape(ids[0])}"]`);
  const ok = await askConfirm(msg, { title: '确认删除', anchor: row });
  if (!ok) return;
  for (const id of ids) {
    await api(`/api/accounts/${id}`, { method: 'DELETE' });
  }
  for (const id of ids) selectedAccountIds.delete(id);
  if (ids.includes(selectedAccountId)) {
    selectedAccountId = selectedAccountIds.size ? [...selectedAccountIds].at(-1) : null;
  }
  clearChatView();
  await refreshAccounts();
  await refreshConversations();
}

function syncGroupChipActive(value) {
  const v = String(value || '').trim();
  els.groupChips?.querySelectorAll('.group-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.group === v);
  });
}

els.btnBrandAdd?.addEventListener('click', () => {
  if (!selectedPlatform) return;
  if (!ADDABLE_PLATFORMS.has(selectedPlatform)) return;
  openGroupDialog(selectedPlatform);
});

els.btnGroupAdd?.addEventListener('click', () => {
  openCreateGroupDialog();
});

els.platformChips?.addEventListener('click', (e) => {
  const chip = e.target.closest('.group-chip[data-platform]');
  if (!chip || chip.disabled) return;
  dialogPlatform = chip.dataset.platform || null;
  syncPlatformChipActive(dialogPlatform);
});

els.groupChips?.addEventListener('click', (e) => {
  const chip = e.target.closest('.group-chip[data-group]');
  if (!chip) return;
  if (els.groupInput) els.groupInput.value = chip.dataset.group || '';
  syncGroupChipActive(els.groupInput?.value);
  els.groupInput?.focus();
});

els.groupInput?.addEventListener('input', () => {
  syncGroupChipActive(els.groupInput.value);
});

els.groupForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (pendingCreateGroup || pendingRenameGroup) {
    const name = String(els.groupInput?.value || '').trim();
    if (!name || name === '未分组') {
      alert('请输入有效的分组名称');
      return;
    }
    closeGroupDialogAnimated('confirm');
    return;
  }
  const needPlatform = els.platformPicker && !els.platformPicker.hidden;
  if (needPlatform) {
    const platform = dialogPlatform || pendingPlatform;
    if (!platform || !ADDABLE_PLATFORMS.has(platform)) {
      alert('请先选择可添加的平台');
      return;
    }
  }
  closeGroupDialogAnimated('confirm');
});

els.groupDialog?.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeGroupDialogAnimated('cancel');
});

els.groupDialog?.addEventListener('click', (e) => {
  if (e.target === els.groupDialog) {
    closeGroupDialogAnimated('cancel');
  }
});

els.confirmDialog?.querySelector('form')?.addEventListener('submit', (e) => {
  if (!els.confirmDialog?.classList.contains('dialog-anchored')) return;
  e.preventDefault();
  closeAnchoredDialogAnimated(els.confirmDialog, e.submitter?.value || 'cancel');
});

els.confirmDialog?.addEventListener('cancel', (e) => {
  if (!els.confirmDialog?.classList.contains('dialog-anchored')) return;
  e.preventDefault();
  closeAnchoredDialogAnimated(els.confirmDialog, 'cancel');
});

els.confirmDialog?.addEventListener('click', (e) => {
  if (e.target === els.confirmDialog) {
    closeAnchoredDialogAnimated(els.confirmDialog, 'cancel');
  }
});

els.groupDialog.addEventListener('close', async () => {
  clearGroupDialogAnchor();
  const action = els.groupDialog.returnValue;
  const platform = pendingPlatform || dialogPlatform;
  const moveIds = [...pendingMoveAccountIds];
  const creatingGroup = pendingCreateGroup;
  const renamingFrom = pendingRenameGroup;
  pendingPlatform = null;
  dialogPlatform = null;
  pendingMoveAccountIds = [];
  pendingCreateGroup = false;
  pendingRenameGroup = null;
  if (els.platformPicker) els.platformPicker.hidden = true;
  if (els.groupPicker) els.groupPicker.hidden = false;
  if (els.groupInputField) els.groupInputField.hidden = false;
  if (action !== 'confirm') return;

  const group = String(els.groupInput?.value || '').trim() || '未分组';
  try {
    if (renamingFrom) {
      await renameProjectGroup(renamingFrom, group);
      return;
    }
    if (creatingGroup) {
      const name = addCustomGroup(group);
      if (!name) {
        alert('请输入有效的分组名称');
        return;
      }
      selectedGroup = name;
      renderGroups();
      renderAccounts();
      return;
    }
    if (moveIds.length) {
      addCustomGroup(group);
      for (const id of moveIds) {
        await api(`/api/accounts/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ label: group }),
        });
      }
      await refreshAccounts();
      return;
    }
    if (!platform || !ADDABLE_PLATFORMS.has(platform)) return;
    addCustomGroup(group);
    const account = await api('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({ label: group, platform }),
    });
    await refreshAccounts();
    await startLogin(account.id);
  } catch (e) {
    alert(e.message);
  }
});

els.groupList?.addEventListener('click', (e) => {
  const addBtn = e.target.closest('[data-add-group]');
  if (addBtn) {
    e.stopPropagation();
    showGroupPlatformPicker(addBtn.dataset.addGroup || '', addBtn);
    return;
  }
  hideAllContextMenus();
  const btn = e.target.closest('.group-item[data-group]');
  if (!btn) return;
  setGroupFilter(btn.dataset.group || null);
});

els.groupPlatformPicker?.addEventListener('click', (e) => {
  if (e.target.closest('.group-platform-picker-scrim')) {
    hideGroupPlatformPicker();
    return;
  }
  const chip = e.target.closest('.hex-icon[data-platform]');
  if (!chip || chip.disabled) return;
  const platform = chip.dataset.platform;
  const group = pendingAddGroup;
  if (!group || !platform) return;
  addAccountToGroup(group, platform);
});

els.groupList?.addEventListener('contextmenu', (e) => {
  const btn = e.target.closest('.group-item[data-group]');
  if (!btn) return;
  const name = btn.dataset.group || '';
  if (!isEditableGroup(name)) return;
  e.preventDefault();
  showGroupContextMenu(name, e.clientX, e.clientY);
});

els.groupContextMenu?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-ctx]');
  const name = contextMenuGroupName;
  const action = btn?.dataset.ctx;
  hideGroupContextMenu();
  if (!name || !action) return;

  try {
    if (action === 'rename') {
      openRenameGroupDialog(name);
    } else if (action === 'delete') {
      await deleteProjectGroup(name);
    }
  } catch (err) {
    alert(err.message);
  }
});

function setBrandSyncing(on) {
  els.brandHex?.classList.toggle('is-syncing', Boolean(on));
}

function getAccountMarqueeEl() {
  let el = document.getElementById('accountMarquee');
  if (!el) {
    el = document.createElement('div');
    el.id = 'accountMarquee';
    el.className = 'account-marquee';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function hitAccountIdsInRect(box) {
  const ids = [];
  for (const item of els.accountList.querySelectorAll('.account-item[data-id]')) {
    const r = item.getBoundingClientRect();
    if (box.right < r.left || box.left > r.right || box.bottom < r.top || box.top > r.bottom) {
      continue;
    }
    ids.push(item.dataset.id);
  }
  return ids;
}

function paintAccountSelection() {
  for (const item of els.accountList.querySelectorAll('.account-item[data-id]')) {
    item.classList.toggle('active', selectedAccountIds.has(item.dataset.id));
  }
}

function updateAccountMarquee(clientX, clientY) {
  if (!accountPointerSelect?.active) return;
  const { startX, startY, additive, baseIds } = accountPointerSelect;
  const left = Math.min(startX, clientX);
  const top = Math.min(startY, clientY);
  const width = Math.abs(clientX - startX);
  const height = Math.abs(clientY - startY);
  const el = getAccountMarqueeEl();
  el.hidden = false;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;

  const hits = hitAccountIdsInRect({
    left,
    top,
    right: left + width,
    bottom: top + height,
  });
  selectedAccountIds = additive ? new Set([...baseIds, ...hits]) : new Set(hits);
  selectedAccountId = selectedAccountIds.size
    ? hits.at(-1) || [...selectedAccountIds].at(-1)
    : null;
  paintAccountSelection();
}

async function endAccountMarquee() {
  if (!accountPointerSelect) return;
  const wasActive = accountPointerSelect.active;
  const pointerId = accountPointerSelect.pointerId;
  accountPointerSelect = null;
  try {
    if (pointerId != null) els.accountList.releasePointerCapture(pointerId);
  } catch {
    /* already released */
  }
  els.accountList.classList.remove('is-marquee-selecting');
  getAccountMarqueeEl().hidden = true;
  if (!wasActive) return;
  suppressAccountClick = true;
  if (selectedAccountId) lastAccountClickId = selectedAccountId;
  renderPlatformFilter();
  await refreshConversations();
}

els.accountList.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('button, a, input, textarea, select')) return;
  // 阻止从上往下拖时出现系统蓝色文字选区，只走我们的框选
  e.preventDefault();
  window.getSelection()?.removeAllRanges?.();
  accountPointerSelect = {
    startX: e.clientX,
    startY: e.clientY,
    pointerId: e.pointerId,
    additive: e.ctrlKey || e.metaKey,
    baseIds: [...selectedAccountIds],
    active: false,
  };
  try {
    els.accountList.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
});

els.accountList.addEventListener('pointermove', (e) => {
  if (!accountPointerSelect || e.pointerId !== accountPointerSelect.pointerId) return;
  const dx = e.clientX - accountPointerSelect.startX;
  const dy = e.clientY - accountPointerSelect.startY;
  if (!accountPointerSelect.active) {
    if (Math.hypot(dx, dy) < ACCOUNT_MARQUEE_THRESHOLD) return;
    accountPointerSelect.active = true;
    els.accountList.classList.add('is-marquee-selecting');
    window.getSelection()?.removeAllRanges?.();
  }
  updateAccountMarquee(e.clientX, e.clientY);
});

els.accountList.addEventListener('dragstart', (e) => {
  e.preventDefault();
});

els.accountList.addEventListener('pointerup', (e) => {
  if (!accountPointerSelect || e.pointerId !== accountPointerSelect.pointerId) return;
  endAccountMarquee();
});

els.accountList.addEventListener('pointercancel', (e) => {
  if (!accountPointerSelect || e.pointerId !== accountPointerSelect.pointerId) return;
  endAccountMarquee();
});

els.accountList.addEventListener('click', async (e) => {
  hideAllContextMenus();
  if (suppressAccountClick) {
    suppressAccountClick = false;
    return;
  }
  const item = e.target.closest('.account-item[data-id]');
  const id = item?.dataset.id;
  // 点列表空白：取消多选/选中（操作靠右键）
  if (!id) {
    await clearAccountSelectionAndRefresh();
    return;
  }
  const multi = e.ctrlKey || e.metaKey;
  const range = e.shiftKey;
  await setAccountFilter(id, { multi, range });
});

els.accountList.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('[data-id]');
  if (!item) return;
  e.preventDefault();
  const id = item.dataset.id;
  const account = accounts.find((a) => a.id === id);
  if (!account) return;

  let ids;
  if (selectedAccountIds.has(id) && selectedAccountIds.size > 0) {
    ids = getSelectedAccountIds();
  } else {
    selectedAccountIds = new Set([id]);
    selectedAccountId = id;
    lastAccountClickId = id;
    renderAccounts();
    ids = [id];
  }
  showAccountContextMenu(ids, e.clientX, e.clientY);
});

els.accountContextMenu?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-ctx]');
  const ids = [...contextMenuAccountIds];
  const action = btn?.dataset.ctx;
  hideAccountContextMenu();
  if (!ids.length || !action) return;

  try {
    if (action === 'login') {
      await startLogin(ids[0]);
    } else if (action === 'proxy') {
      openProxyDialog(ids[0]);
    } else if (action === 'move') {
      openMoveGroupDialog(ids);
    } else if (action === 'delete') {
      await deleteAccounts(ids);
    }
  } catch (err) {
    alert(err.message);
  }
});

els.proxyForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clear = e.submitter?.value === 'clear';
  try {
    await saveAccountProxy({ clear });
  } catch (err) {
    alert(err.message);
  }
});

els.proxyProfilePick?.addEventListener('change', () => {
  const id = els.proxyProfilePick.value;
  if (id) applyPickedProxyProfile(id);
});

els.btnProxyManager?.addEventListener('click', () => {
  openProxyManager();
});

els.btnCloseProxyManager?.addEventListener('click', () => {
  closeProxyManager();
});

els.proxyManager?.addEventListener('click', (e) => {
  if (e.target === els.proxyManager) closeProxyManager();
});

els.btnAddProxyRegion?.addEventListener('click', async () => {
  try {
    await addProxyRegion();
  } catch (err) {
    alert(err.message);
  }
});

els.btnAddProxyProfile?.addEventListener('click', async () => {
  try {
    await addOrEditProxyProfile();
  } catch (err) {
    alert(err.message);
  }
});

els.proxyRegionList?.addEventListener('click', async (e) => {
  const actBtn = e.target.closest('[data-region-act]');
  if (actBtn) {
    const name = actBtn.dataset.region;
    try {
      if (actBtn.dataset.regionAct === 'rename') await renameProxyRegion(name);
      else if (actBtn.dataset.regionAct === 'delete') await deleteProxyRegionByName(name);
    } catch (err) {
      alert(err.message);
    }
    return;
  }
  const btn = e.target.closest('.proxy-region-item[data-region]');
  if (!btn) return;
  proxyManagerRegion = btn.dataset.region;
  renderProxyRegionList();
  renderProxyProfileList();
});

els.proxyProfileList?.addEventListener('click', async (e) => {
  const actBtn = e.target.closest('[data-proxy-act]');
  const item = e.target.closest('.proxy-profile-item[data-id]');
  if (!actBtn || !item) return;
  const id = item.dataset.id;
  const profile = proxyProfilesCache.find((p) => p.id === id);
  if (!profile) return;
  try {
    if (actBtn.dataset.proxyAct === 'edit') {
      await addOrEditProxyProfile(profile);
    } else if (actBtn.dataset.proxyAct === 'delete') {
      const ok = await askConfirm(`确定删除代理「${profile.label || profile.server}」？`, {
        title: '删除代理',
      });
      if (!ok) return;
      await api(`/api/proxies/profiles/${id}`, { method: 'DELETE' });
      await refreshProxyManager();
    }
  } catch (err) {
    alert(err.message);
  }
});

els.proxyRegionForm?.addEventListener('submit', (e) => {
  const value = e.submitter?.value || 'cancel';
  if (value !== 'save') return;
  const name = String(els.proxyRegionNameInput?.value || '').trim();
  if (!name) {
    e.preventDefault();
    alert('请输入国家/地区名称');
  }
});

els.proxyProfileForm?.addEventListener('submit', (e) => {
  const value = e.submitter?.value || 'cancel';
  if (value !== 'save') return;
  const server = String(els.proxyProfileServerInput?.value || '').trim();
  if (!server) {
    e.preventDefault();
    alert('请填写代理地址');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.proxyManager && !els.proxyManager.hidden) {
    closeProxyManager();
  }
});

document.addEventListener('pointerdown', (e) => {
  const accountOpen = els.accountContextMenu && !els.accountContextMenu.hidden;
  const groupOpen = els.groupContextMenu && !els.groupContextMenu.hidden;
  if (accountOpen || groupOpen) {
    if (accountOpen && els.accountContextMenu.contains(e.target)) return;
    if (groupOpen && els.groupContextMenu.contains(e.target)) return;
    hideAllContextMenus();
  }

  // 左键点账号列表以外：取消选中（批量操作走右键菜单）
  if (e.button !== 0) return;
  if (!selectedAccountIds.size && !selectedAccountId) return;
  if (accountPointerSelect) return;
  if (e.target.closest('.account-item[data-id]')) return;
  if (els.accountList?.contains(e.target)) return; // 列表空白交给 click 处理
  if (
    e.target.closest(
      '#accountContextMenu, #groupContextMenu, dialog, .group-platform-picker, .account-marquee'
    )
  ) {
    return;
  }
  clearAccountSelectionAndRefresh();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideAllContextMenus();
    clearAccountSelectionAndRefresh();
  }
});

window.addEventListener('blur', hideAllContextMenus);
window.addEventListener('resize', hideAllContextMenus);
window.addEventListener('scroll', hideAllContextMenus, true);

document.querySelector('.brand-hex')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.hex-icon[data-platform]');
  if (!btn) return;
  setPlatformFilter(btn.dataset.platform);
});

els.conversationList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-id]');
  if (btn) openConversation(btn.dataset.id);
});

function setSyncButtonsBusy(on) {
  if (els.btnBrandSync) els.btnBrandSync.disabled = on;
  if (els.btnAccountsSync) {
    els.btnAccountsSync.disabled = on;
    els.btnAccountsSync.classList.toggle('is-spinning', on);
  }
}

async function syncAllAccounts() {
  if (els.btnBrandSync?.disabled || els.btnAccountsSync?.disabled) return;
  setSyncButtonsBusy(true);
  setBrandSyncing(true);
  const started = Date.now();
  if (els.syncHint) els.syncHint.textContent = '正在同步全部账号（每个约 5–15 秒）';
  const active = accounts.filter((a) => a.status === 'active');
  const needsEmbed = active.some(accountNeedsHeadedBrowser);
  const run = async (windowBounds) => {
    const { results } = await api('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ windowBounds }),
    });
    const ok = results.filter((r) => r.ok).length;
    const sec = ((Date.now() - started) / 1000).toFixed(1);
    if (els.syncHint) els.syncHint.textContent = `完成：${ok}/${results.length} 个账号（${sec}s）`;
    await refreshAccounts();
    await refreshConversations();
  };
  try {
    if (needsEmbed) {
      await withSyncEmbed('正在同步全部账号，请稍候', run);
    } else {
      await run(null);
    }
  } catch (e) {
    if (els.syncHint) els.syncHint.textContent = e.message;
  } finally {
    setSyncButtonsBusy(false);
    setBrandSyncing(false);
  }
}

els.btnBrandSync?.addEventListener('click', () => {
  if (selectedPlatform) return;
  syncAllAccounts();
});

els.btnAccountsSync?.addEventListener('click', () => {
  syncAllAccounts();
});

els.replyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentConversationId) return;
  const text = els.replyInput.value.trim();
  if (!text) return;
  const btn = els.replyForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const r = await api(`/api/conversations/${currentConversationId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error(r.reason || '发送失败');
    els.replyInput.value = '';
    await refreshConversations();
    await openConversation(currentConversationId);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

els.btnCancelLogin?.addEventListener('click', () => {
  cancelLogin();
});

function enableAutohideScroll(root = document) {
  root.querySelectorAll('.autohide-scroll').forEach((el) => {
    if (el.dataset.autohideBound) return;
    el.dataset.autohideBound = '1';
    let timer = null;
    el.addEventListener(
      'scroll',
      () => {
        el.classList.add('is-scrolling');
        clearTimeout(timer);
        timer = setTimeout(() => el.classList.remove('is-scrolling'), 700);
      },
      { passive: true }
    );
  });
}

enableAutohideScroll();
refreshAccounts().then(refreshConversations);
