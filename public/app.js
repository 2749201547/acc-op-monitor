const els = {
  accountList: document.getElementById('accountList'),
  accountFilter: document.getElementById('accountFilter'),
  conversationList: document.getElementById('conversationList'),
  messageList: document.getElementById('messageList'),
  chatTitle: document.getElementById('chatTitle'),
  chatSub: document.getElementById('chatSub'),
  chatAvatar: document.getElementById('chatAvatar'),
  replyForm: document.getElementById('replyForm'),
  replyInput: document.getElementById('replyInput'),
  btnAddAccount: document.getElementById('btnAddAccount'),
  btnSyncAll: document.getElementById('btnSyncAll'),
  syncHint: document.getElementById('syncHint'),
  loginDialog: document.getElementById('loginDialog'),
  qrImage: document.getElementById('qrImage'),
  qrPlaceholder: document.getElementById('qrPlaceholder'),
  loginStatusText: document.getElementById('loginStatusText'),
  btnCancelLogin: document.getElementById('btnCancelLogin'),
};

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

function statusLabel(status) {
  const map = {
    pending: '待登录',
    logging_in: '扫码中',
    active: '已登录',
    expired: '已过期',
  };
  return map[status] || status;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
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
  renderAccounts();
  renderAccountFilter();
}

function renderAccounts() {
  if (!accounts.length) {
    els.accountList.innerHTML = '<li class="empty">还没有账号，点击添加</li>';
    return;
  }

  els.accountList.innerHTML = accounts
    .map((a) => {
      const name = a.displayName || a.username || a.label || '未命名';
      const sub = a.username ? `@${a.username}` : statusLabel(a.status);
      return `
    <li class="account-item" data-id="${a.id}">
      ${avatarHtml(a.avatarUrl, name, '', a.updatedAt || a.id)}
      <div class="account-body">
        <strong>${escapeHtml(name)}</strong>
        <div class="meta">${escapeHtml(sub)}</div>
        <span class="badge ${a.status}">${statusLabel(a.status)}</span>
      </div>
      <div class="account-actions">
        ${
          a.status === 'active'
            ? `<button class="btn btn-tiny" data-action="sync" type="button">同步</button>`
            : `<button class="btn btn-tiny btn-primary" data-action="login" type="button">扫码</button>`
        }
        <button class="btn btn-tiny" data-action="delete" type="button">删除</button>
      </div>
    </li>`;
    })
    .join('');
}

function renderAccountFilter() {
  const current = els.accountFilter.value;
  els.accountFilter.innerHTML =
    '<option value="">全部账号</option>' +
    accounts
      .map((a) => {
        const name = a.displayName || a.username || a.label || '未命名';
        return `<option value="${a.id}">${escapeHtml(name)}</option>`;
      })
      .join('');
  els.accountFilter.value = current;
}

async function refreshConversations() {
  const q = els.accountFilter.value
    ? `?accountId=${encodeURIComponent(els.accountFilter.value)}`
    : '';
  conversations = await api(`/api/conversations${q}`);
  renderConversations();
}

function renderConversations() {
  if (!conversations.length) {
    els.conversationList.innerHTML =
      '<li class="empty">暂无会话。先登录账号，再点「同步全部消息」</li>';
    return;
  }

  els.conversationList.innerHTML = conversations
    .map((c) => {
      const name = c.peerNickname || c.peerUsername || c.peerId;
      return `
    <li>
      <button class="conversation-item ${
        c.id === currentConversationId ? 'active' : ''
      }" data-id="${c.id}" type="button">
        ${avatarHtml(c.peerAvatar, name)}
        <div class="conversation-body">
          <div class="top">
            <strong>${escapeHtml(name)}</strong>
            <span class="acct">${escapeHtml(
              c.accountDisplayName || c.accountUsername || c.accountLabel || ''
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
        <time>${formatTime(m.sentAt || m.createdAt)}</time>
      </div>`
        )
        .join('')
    : '<div class="empty">暂无消息详情，可先同步或直接回复</div>';
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

let loginSucceeded = false;

async function startLogin(accountId) {
  loginAccountId = accountId;
  loginSucceeded = false;
  els.loginStatusText.textContent = '正在启动…';
  els.qrImage.removeAttribute('src');
  els.qrImage.hidden = true;
  if (els.qrPlaceholder) els.qrPlaceholder.hidden = false;
  els.loginDialog.showModal();

  // 接口立刻返回，不再干等浏览器启动
  const result = await api(`/api/accounts/${accountId}/login`, { method: 'POST' });
  els.loginStatusText.textContent = result.message || '正在启动浏览器…';
  setQrPreview(result.screenshot);

  clearInterval(loginPollTimer);
  const poll = async () => {
    try {
      const st = await api(`/api/accounts/${accountId}/login/status`);
      if (st.message) els.loginStatusText.textContent = st.message;
      setQrPreview(st.screenshot);

      if (st.status === 'logged_in') {
        clearInterval(loginPollTimer);
        loginSucceeded = true;
        els.loginStatusText.textContent = `登录成功：@${st.profile?.username || ''}`;
        setTimeout(() => {
          els.loginDialog.close();
          refreshAccounts();
        }, 600);
      } else if (st.status === 'expired' || st.status === 'error') {
        clearInterval(loginPollTimer);
        els.loginStatusText.textContent =
          st.message || (st.status === 'expired' ? '二维码已过期，请重新扫码' : '登录失败');
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

els.btnAddAccount.addEventListener('click', async () => {
  const label = prompt('给这个账号起个名字（如：主号 / 店铺号）', '账号');
  if (label == null) return;
  const account = await api('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ label: label.trim() || '账号' }),
  });
  await refreshAccounts();
  await startLogin(account.id);
});

els.accountList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const item = btn.closest('[data-id]');
  const id = item?.dataset.id;
  if (!id) return;
  const action = btn.dataset.action;

  if (action === 'login') {
    await startLogin(id);
  } else if (action === 'sync') {
    const started = Date.now();
    els.syncHint.textContent = '正在同步（通常约 5–15 秒）…';
    btn.disabled = true;
    try {
      const r = await api(`/api/accounts/${id}/sync`, { method: 'POST' });
      const sec = ((Date.now() - started) / 1000).toFixed(1);
      els.syncHint.textContent = r.ok
        ? `同步完成（${r.conversations || 0} 会话，${sec}s）`
        : `失败：${r.reason || ''}`;
      await refreshAccounts();
      await refreshConversations();
    } catch (err) {
      els.syncHint.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  } else if (action === 'delete') {
    if (!confirm('确定删除该账号及其本地会话？')) return;
    await api(`/api/accounts/${id}`, { method: 'DELETE' });
    if (currentConversationId) {
      currentConversationId = null;
      els.replyForm.hidden = true;
      els.messageList.innerHTML = '';
      els.chatTitle.textContent = '选择会话';
      els.chatSub.textContent = '';
    }
    await refreshAccounts();
    await refreshConversations();
  }
});

els.accountFilter.addEventListener('change', refreshConversations);

els.conversationList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-id]');
  if (btn) openConversation(btn.dataset.id);
});

els.btnSyncAll.addEventListener('click', async () => {
  els.btnSyncAll.disabled = true;
  const started = Date.now();
  els.syncHint.textContent = '正在同步全部账号（每个约 5–15 秒）…';
  try {
    const { results } = await api('/api/sync', { method: 'POST' });
    const ok = results.filter((r) => r.ok).length;
    const sec = ((Date.now() - started) / 1000).toFixed(1);
    els.syncHint.textContent = `完成：${ok}/${results.length} 个账号（${sec}s）`;
    await refreshAccounts();
    await refreshConversations();
  } catch (e) {
    els.syncHint.textContent = e.message;
  } finally {
    els.btnSyncAll.disabled = false;
  }
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

refreshAccounts().then(refreshConversations);
