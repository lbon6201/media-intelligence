const DEFAULT_SERVER = 'https://media-intelligence-production-0383.up.railway.app';
let articleData = null;

function getServerUrl(stored) {
  return (stored.serverUrl || DEFAULT_SERVER).replace(/\/+$/, '');
}

async function init() {
  const stored = await chrome.storage.local.get(['serverUrl', 'authToken', 'selectedWorkstream']);
  const serverUrl = getServerUrl(stored);
  document.getElementById('serverUrl').value = serverUrl;

  document.getElementById('serverUrl').addEventListener('change', (e) => {
    chrome.storage.local.set({ serverUrl: e.target.value });
  });

  // Check if logged in
  if (!stored.authToken) {
    showLoginForm();
    return;
  }

  // Verify token
  try {
    const res = await fetch(`${serverUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${stored.authToken}` } });
    if (!res.ok) throw new Error('Token expired');
    const user = await res.json();
    document.getElementById('userName').textContent = `${user.name} (${user.role})`;
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('clipSection').style.display = 'block';
  } catch {
    showLoginForm();
    return;
  }

  await loadWorkstreams(serverUrl, stored.authToken, stored.selectedWorkstream);
  await extractFromTab();
}

function showLoginForm() {
  document.getElementById('loginSection').style.display = 'block';
  document.getElementById('clipSection').style.display = 'none';
}

async function handleLogin() {
  const stored = await chrome.storage.local.get(['serverUrl']);
  const serverUrl = getServerUrl(stored);
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  document.getElementById('loginError').textContent = '';

  try {
    const res = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    await chrome.storage.local.set({ authToken: data.token });
    document.getElementById('userName').textContent = `${data.user.name} (${data.user.role})`;
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('clipSection').style.display = 'block';

    await loadWorkstreams(serverUrl, data.token);
    await extractFromTab();
  } catch (e) {
    document.getElementById('loginError').textContent = e.message;
  }
}

async function handleLogout() {
  await chrome.storage.local.remove(['authToken']);
  showLoginForm();
}

async function loadWorkstreams(serverUrl, token, savedWs) {
  try {
    const res = await fetch(`${serverUrl}/api/workstreams`, { headers: { Authorization: `Bearer ${token}` } });
    const workstreams = await res.json();
    const select = document.getElementById('workstream');
    select.innerHTML = '';
    workstreams.forEach(ws => {
      const opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = ws.name;
      if (savedWs === ws.id) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      chrome.storage.local.set({ selectedWorkstream: select.value });
    });
  } catch (e) {
    showStatus('error', 'Failed to load workstreams');
  }
}

async function extractFromTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    if (response.success) {
      articleData = response.data;
      document.getElementById('headline').textContent = articleData.headline;
      document.getElementById('meta').textContent = [articleData.outlet, articleData.author, articleData.publish_date, `${articleData.word_count} words`].filter(Boolean).join(' · ');
      document.getElementById('clip').disabled = false;
    } else {
      document.getElementById('headline').textContent = 'Could not extract article';
      document.getElementById('meta').textContent = response.error || 'Try refreshing the page';
    }
  } catch {
    document.getElementById('headline').textContent = 'Could not access page';
    document.getElementById('meta').textContent = 'Try refreshing the page first';
  }
}

async function clipArticle() {
  if (!articleData) return;
  const btn = document.getElementById('clip');
  btn.disabled = true;
  showStatus('loading', 'Clipping...');

  const stored = await chrome.storage.local.get(['serverUrl', 'authToken']);
  const serverUrl = getServerUrl(stored);
  const workstreamId = document.getElementById('workstream').value;

  const raw = `${articleData.headline.toLowerCase().trim()}|${(articleData.outlet || '').toLowerCase().trim()}|${(articleData.publish_date || '').trim()}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;

  try {
    const res = await fetch(`${serverUrl}/api/articles/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stored.authToken}` },
      body: JSON.stringify({ articles: [{ ...articleData, workstream_id: workstreamId, fingerprint: hash.toString(16) }] }),
    });

    if (res.status === 401) { showLoginForm(); return; }

    const result = await res.json();
    if (result.ingested > 0) showStatus('success', 'Article clipped!');
    else if (result.duplicates > 0) showStatus('error', 'Duplicate — already ingested');
    else showStatus('error', 'Failed to clip');
  } catch (e) {
    showStatus('error', `Error: ${e.message}`);
  }
  btn.disabled = false;
}

function showStatus(type, msg) {
  const el = document.getElementById('status');
  el.style.display = 'block';
  el.className = `status ${type}`;
  el.textContent = msg;
}

document.getElementById('loginBtn').addEventListener('click', handleLogin);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);
document.getElementById('clip').addEventListener('click', clipArticle);

init();
