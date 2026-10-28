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
  brandHex: document.querySelector('.brand-hex'),
  syncHint: document.getElementById('syncHint'),
  groupDialog: document.getElementById('groupDialog'),
  groupDialogHint: document.getElementById('groupDialogHint'),
  groupChips: document.getElementById('groupChips'),
  groupInput: document.getElementById('groupInput'),
  groupForm: document.getElementById('groupForm'),
  loginDialog: document.getElementById('loginDialog'),
  loginDialogTitle: document.getElementById('loginDialogTitle'),
  loginEmbedSlot: document.getElementById('loginEmbedSlot'),
  qrImage: document.getElementById('qrImage'),
  qrPlaceholder: document.getElementById('qrPlaceholder'),
  loginStatusText: document.getElementById('loginStatusText'),
  btnCancelLogin: document.getElementById('btnCancelLogin'),
  syncEmbedOverlay: document.getElementById('syncEmbedOverlay'),
  syncEmbedTitle: document.getElementById('syncEmbedTitle'),
  syncEmbedStatus: document.getElementById('syncEmbedStatus'),
  syncEmbedSlot: document.getElementById('syncEmbedSlot'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmDialogTitle: document.getElementById('confirmDialogTitle'),
  confirmDialogMessage: document.getElementById('confirmDialogMessage'),
  btnOkConfirm: document.getElementById('btnOkConfirm'),
  accountContextMenu: document.getElementById('accountContextMenu'),
};

/** Content-relative slot → physical screen rect for Chrome overlay (Electron only). */
async function getEmbedWindowBounds(slotEl) {
  if (!slotEl) return null;
  if (typeof window.aom?.slotToScreen !== 'function') {
    console.warn(
      '[aom] window.aom 不可用：请完全退出并重启 Electron，否则 Chrome 无法贴到对话框。'
    );
    return null;
  }
  // 等 dialog 布局完成再量
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 50));
  const box = slotEl.getBoundingClientRect();
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
    // 弹窗贴在虚线框内侧：四边各内缩 2mm（CSS px：96dpi）
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

/**
 * Cover the right chat panel (no modal / no black backdrop); Chrome docks to the slot.
 * @template T
 * @param {string} statusText
 * @param {(bounds: object|null) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withSyncEmbed(statusText, fn) {
  const overlay = els.syncEmbedOverlay;
  if (!overlay) return fn(null);
  if (els.syncEmbedTitle) els.syncEmbedTitle.textContent = '正在同步';
  if (els.syncEmbedStatus) {
    els.syncEmbedStatus.textContent = statusText || '浏览器贴合下方区域，请稍候…';
  }
  overlay.hidden = false;
  try {
    const bounds = await getEmbedWindowBounds(els.syncEmbedSlot);
    return await fn(bounds);
  } finally {
    overlay.hidden = true;
  }
}

let pendingPlatform = null;
/** 右键「切换分组」时要改的账号 id；与 pendingPlatform 互斥 */
let pendingMoveAccountId = null;
let contextMenuAccountId = null;

function askConfirm(message, { title = '确认' } = {}) {
  return new Promise((resolve) => {
    if (!els.confirmDialog) {
      resolve(window.confirm(message));
      return;
    }
    if (els.confirmDialogTitle) els.confirmDialogTitle.textContent = title;
    if (els.confirmDialogMessage) els.confirmDialogMessage.textContent = message;
    els.confirmDialog.returnValue = '';
    const onClose = () => {
      els.confirmDialog.removeEventListener('close', onClose);
      resolve(els.confirmDialog.returnValue === 'confirm');
    };
    els.confirmDialog.addEventListener('close', onClose);
    els.confirmDialog.showModal();
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
/** null = 当前可见范围内全部账号 */
let selectedAccountId = null;
let loginPollTimer = null;
let loginAccountId = null;

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
    logging_in: platform === 'facebook' ? '登录中' : '扫码中',
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
  const set = new Set();
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

function pruneSelection() {
  const byPlatform = accountsForPlatform();
  if (selectedGroup && !byPlatform.some((a) => normalizeGroupName(a.label) === selectedGroup)) {
    selectedGroup = null;
  }
  const visible = visibleAccounts();
  if (selectedAccountId && !visible.some((a) => a.id === selectedAccountId)) {
    selectedAccountId = null;
  }
}

function renderAccountItem(a) {
  const name = a.displayName || a.username || '未命名';
  const plat = a.platform || 'tiktok';
  const group = normalizeGroupName(a.label);
  const active = a.id === selectedAccountId ? ' active' : '';
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
    // 选平台 → 筛选高亮；选账号 → 同款高亮，其它 logo 不变
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
  if (!accounts.length) {
    els.groupList.innerHTML = '<li class="empty">还没有分组</li>';
    return;
  }

  const items = [
    {
      key: '',
      name: selectedPlatform ? `全部 ${platformLabel(selectedPlatform)}` : '全部分组',
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

  els.groupList.innerHTML = items
    .map(
      (g) => `
    <li>
      <button type="button" class="group-item${g.active ? ' active' : ''}" data-group="${escapeHtml(
        g.key
      )}">
        <span class="group-item-name">${escapeHtml(g.name)}</span>
        <span class="group-item-count">${g.count}</span>
      </button>
    </li>`
    )
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
  const q = selectedAccountId
    ? `?accountId=${encodeURIComponent(selectedAccountId)}`
    : '';
  let list = await api(`/api/conversations${q}`);
  if (!selectedAccountId) {
    const ids = new Set(visibleAccounts().map((a) => a.id));
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
  selectedAccountId = null;
  pruneSelection();
  renderPlatformFilter();
  renderGroups();
  renderAccounts();
  await refreshConversations();
}

async function setGroupFilter(group) {
  selectedGroup = group || null;
  selectedAccountId = null;
  pruneSelection();
  renderGroups();
  renderAccounts();
  renderPlatformFilter();
  await refreshConversations();
}

async function setAccountFilter(accountId) {
  selectedAccountId = selectedAccountId === accountId ? null : accountId;
  renderAccounts();
  renderPlatformFilter();
  await refreshConversations();
}

function renderConversations() {
  if (!conversations.length) {
    els.conversationList.innerHTML =
      '<li class="empty">暂无会话。先登录账号，再点中间 AOM 同步</li>';
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
    ? `来自：${
        conv.accountDisplayName ||
        conv.accountUsername ||
        conv.accountLabel ||
        conv.accountId
      }`
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

function applyLoginDialogCopy(platform) {
  const isFb = platform === 'facebook';
  if (els.loginDialogTitle) {
    els.loginDialogTitle.textContent = isFb ? 'Facebook 登录' : '扫码登录';
  }
  if (els.qrPlaceholder) {
    els.qrPlaceholder.textContent = isFb
      ? '浏览器将贴合此区域，请在窗口内完成登录'
      : '浏览器启动后会弹出扫码窗口';
  }
}

async function startLogin(accountId) {
  loginAccountId = accountId;
  loginSucceeded = false;
  const account = accounts.find((a) => a.id === accountId);
  const platform = account?.platform || 'tiktok';
  applyLoginDialogCopy(platform);
  els.loginStatusText.textContent = '正在启动…';
  els.qrImage.removeAttribute('src');
  els.qrImage.hidden = true;
  if (els.qrPlaceholder) els.qrPlaceholder.hidden = false;
  els.loginDialog.showModal();

  const windowBounds = await getEmbedWindowBounds(els.loginEmbedSlot);

  // 接口立刻返回，不再干等浏览器启动
  const result = await api(`/api/accounts/${accountId}/login`, {
    method: 'POST',
    body: JSON.stringify({ windowBounds }),
  });
  if (result.platform) applyLoginDialogCopy(result.platform);
  els.loginStatusText.textContent = result.message || '正在启动浏览器…';
  setQrPreview(result.screenshot);

  clearInterval(loginPollTimer);
  const poll = async () => {
    try {
      const st = await api(`/api/accounts/${accountId}/login/status`);
      if (st.platform) applyLoginDialogCopy(st.platform);
      if (st.message) els.loginStatusText.textContent = st.message;
      setQrPreview(st.screenshot);

      if (st.status === 'logged_in') {
        clearInterval(loginPollTimer);
        loginSucceeded = true;
        const who = st.profile?.displayName || st.profile?.username || '';
        els.loginStatusText.textContent = who ? `登录成功：${who}` : '登录成功';
        setTimeout(() => {
          els.loginDialog.close();
          refreshAccounts();
        }, 600);
      } else if (st.status === 'expired' || st.status === 'error') {
        clearInterval(loginPollTimer);
        els.loginStatusText.textContent =
          st.message ||
          (st.status === 'expired'
            ? platform === 'facebook'
              ? '登录超时，请重试'
              : '二维码已过期，请重新扫码'
            : '登录失败');
      }
    } catch (e) {
      els.loginStatusText.textContent = e.message;
    }
  };
  await poll();
  loginPollTimer = setInterval(poll, 1200);
}

async function cancelLogin() {
  clearInterval(loginPollTimer);
  const id = loginAccountId;
  loginAccountId = null;
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

function clearGroupDialogAnchor() {
  const dialog = els.groupDialog;
  if (!dialog) return;
  dialog.classList.remove('dialog-anchored');
  dialog.style.left = '';
  dialog.style.top = '';
}

function positionGroupDialog(anchorEl) {
  const dialog = els.groupDialog;
  if (!dialog) return;
  const anchor = anchorEl && !anchorEl.hidden ? anchorEl : null;
  if (!anchor) {
    clearGroupDialogAnchor();
    return;
  }

  dialog.classList.add('dialog-anchored');
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const d = dialog.getBoundingClientRect();
    const gap = 10;
    const pad = 8;
    let left = a.right + gap;
    let top = a.top + a.height / 2 - d.height / 2;
    if (left + d.width > window.innerWidth - pad) {
      left = Math.max(pad, a.left - d.width - gap);
    }
    top = Math.max(pad, Math.min(top, window.innerHeight - d.height - pad));
    left = Math.max(pad, left);
    dialog.style.left = `${Math.round(left)}px`;
    dialog.style.top = `${Math.round(top)}px`;
  };

  requestAnimationFrame(() => requestAnimationFrame(place));
}

function fillGroupDialog({ hint, initialGroup, anchor } = {}) {
  if (els.groupDialogHint && hint) {
    els.groupDialogHint.textContent = hint;
  }
  const groups = existingGroups();
  if (els.groupChips) {
    els.groupChips.innerHTML = groups.length
      ? groups
          .map(
            (g) =>
              `<button type="button" class="group-chip" data-group="${escapeHtml(g)}">${escapeHtml(
                g
              )}</button>`
          )
          .join('')
      : '<span class="group-chip-empty">暂无分组，直接输入新名称</span>';
  }
  if (els.groupInput) {
    const fallback =
      selectedGroup && selectedGroup !== '未分组' ? selectedGroup : groups[0] || '';
    els.groupInput.value = initialGroup ?? fallback;
    syncGroupChipActive(els.groupInput.value);
  }
  els.groupDialog.returnValue = '';
  els.groupDialog.showModal();
  positionGroupDialog(anchor);
  queueMicrotask(() => els.groupInput?.focus());
}

function openGroupDialog(platform) {
  pendingPlatform = platform;
  pendingMoveAccountId = null;
  const platName = platformLabel(platform);
  fillGroupDialog({
    hint: `把这个 ${platName} 账号归到哪个分组？`,
    anchor: els.btnBrandAdd,
  });
}

function openMoveGroupDialog(accountId) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return;
  pendingPlatform = null;
  pendingMoveAccountId = accountId;
  const name = account.displayName || account.username || '未命名';
  const item = els.accountList?.querySelector(`[data-id="${CSS.escape(accountId)}"]`);
  fillGroupDialog({
    hint: `把「${name}」换到哪个分组？`,
    initialGroup: normalizeGroupName(account.label),
    anchor: item || els.btnBrandAdd,
  });
}

function hideAccountContextMenu() {
  contextMenuAccountId = null;
  if (els.accountContextMenu) els.accountContextMenu.hidden = true;
}

function showAccountContextMenu(account, x, y) {
  const menu = els.accountContextMenu;
  if (!menu || !account) return;
  contextMenuAccountId = account.id;
  const loginBtn = menu.querySelector('[data-ctx="login"]');
  if (loginBtn) loginBtn.hidden = account.status === 'active';

  menu.hidden = false;
  const pad = 8;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - pad);
  const top = Math.min(y, window.innerHeight - rect.height - pad);
  menu.style.left = `${Math.max(pad, left)}px`;
  menu.style.top = `${Math.max(pad, top)}px`;
}

async function deleteAccount(id) {
  const ok = await askConfirm('确定删除该账号及其本地会话？', { title: '确认删除' });
  if (!ok) return;
  await api(`/api/accounts/${id}`, { method: 'DELETE' });
  if (selectedAccountId === id) selectedAccountId = null;
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

els.groupChips?.addEventListener('click', (e) => {
  const chip = e.target.closest('.group-chip');
  if (!chip) return;
  if (els.groupInput) els.groupInput.value = chip.dataset.group || '';
  syncGroupChipActive(els.groupInput?.value);
  els.groupInput?.focus();
});

els.groupInput?.addEventListener('input', () => {
  syncGroupChipActive(els.groupInput.value);
});

document.getElementById('btnCancelGroup')?.addEventListener('click', () => {
  els.groupDialog.close('cancel');
});

els.groupDialog.addEventListener('close', async () => {
  clearGroupDialogAnchor();
  const action = els.groupDialog.returnValue;
  const platform = pendingPlatform;
  const moveId = pendingMoveAccountId;
  pendingPlatform = null;
  pendingMoveAccountId = null;
  if (action !== 'confirm') return;

  const group = String(els.groupInput?.value || '').trim() || '未分组';
  try {
    if (moveId) {
      await api(`/api/accounts/${moveId}`, {
        method: 'PATCH',
        body: JSON.stringify({ label: group }),
      });
      await refreshAccounts();
      return;
    }
    if (!platform) return;
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
  const btn = e.target.closest('.group-item[data-group]');
  if (!btn) return;
  setGroupFilter(btn.dataset.group || null);
});

function setBrandSyncing(on) {
  els.brandHex?.classList.toggle('is-syncing', Boolean(on));
}

els.accountList.addEventListener('click', async (e) => {
  hideAccountContextMenu();
  const item = e.target.closest('[data-id]');
  const id = item?.dataset.id;
  if (!id) return;
  await setAccountFilter(id);
});

els.accountList.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('[data-id]');
  if (!item) return;
  e.preventDefault();
  const account = accounts.find((a) => a.id === item.dataset.id);
  if (!account) return;
  showAccountContextMenu(account, e.clientX, e.clientY);
});

els.accountContextMenu?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-ctx]');
  const id = contextMenuAccountId;
  const action = btn?.dataset.ctx;
  hideAccountContextMenu();
  if (!id || !action) return;

  try {
    if (action === 'login') {
      await startLogin(id);
    } else if (action === 'move') {
      openMoveGroupDialog(id);
    } else if (action === 'delete') {
      await deleteAccount(id);
    }
  } catch (err) {
    alert(err.message);
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!els.accountContextMenu || els.accountContextMenu.hidden) return;
  if (els.accountContextMenu.contains(e.target)) return;
  hideAccountContextMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideAccountContextMenu();
});

window.addEventListener('blur', hideAccountContextMenu);
window.addEventListener('resize', hideAccountContextMenu);
window.addEventListener('scroll', hideAccountContextMenu, true);

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
  if (els.syncHint) els.syncHint.textContent = '正在同步全部账号（每个约 5–15 秒）…';
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
      await withSyncEmbed('正在同步全部账号，请稍候…', run);
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

els.loginDialog.addEventListener('close', () => {
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
