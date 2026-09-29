const views = {
  home: document.getElementById('homeView'),
  connecting: document.getElementById('connectingView'),
  update: document.getElementById('updateView'),
  progress: document.getElementById('progressView')
};

const versionInfo = document.getElementById('versionInfo');
const progressIcon = document.getElementById('progressIcon');
const progressPercent = document.getElementById('progressPercent');
const progressTitle = document.getElementById('progressTitle');
const progressFileText = document.getElementById('progressFileText');
const progressBarOuter = document.getElementById('progressBarOuter');
const progressFill = document.getElementById('progressFill');
const progressBytesText = document.getElementById('progressBytesText');
const progressSpeed = document.getElementById('progressSpeed');
const errorText = document.getElementById('errorText');
const versionLabel = document.getElementById('versionLabel');
const connectingChannel = document.getElementById('connectingChannel');
const connectingVersion = document.getElementById('connectingVersion');
const connectingProgressFill = document.getElementById('connectingProgressFill');
const connectingText = document.getElementById('connectingText');
const connectingStageLabel = document.getElementById('connectingStageLabel');
const connectingLogoRing = document.getElementById('connectingLogoRing');

// Named launch stages for the connecting screen's progress bar. Each one
// carries both a target percentage and a label, so the bar always reads as
// real, ordered progress instead of jumping straight from empty to full.
const CONNECTING_STAGES = {
  auth: { pct: 18, label: 'Authenticating' },
  prepare: { pct: 50, label: 'Preparing launch' },
  starting: { pct: 88, label: 'Starting Roblox' },
  done: { pct: 100, label: 'Launched' }
};

let lastProgressSample = null;
let pendingAccountLaunch = null;

// Generic fade helper for modal-style overlays (settings, accounts,
// changelog, credits) - mirrors the view crossfade below so every screen
// transition in the app shares the same smooth, slightly-slow feel.
const OVERLAY_FADE_MS = 240;
function fadeInOverlay(el) {
  el.classList.remove('hidden');
  el.classList.add('overlay-fade');
  void el.offsetWidth;
  el.classList.remove('overlay-fade');
}
function fadeOutOverlay(el, after) {
  el.classList.add('overlay-fade');
  setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('overlay-fade');
    if (after) after();
  }, OVERLAY_FADE_MS);
}

const FLOW_VIEWS = new Set(['connecting', 'update', 'progress']);
const VIEW_FADE_MS = 280;

function currentVisibleView() {
  return Object.values(views).find((v) => !v.classList.contains('hidden')) || null;
}

// Crossfades between views (fade the old one out, then fade the new one in)
// instead of an instant cut, and resizes the window to fit whichever view
// is coming in - the compact 600x260 home size for 'home', a taller size
// for the connecting/update/progress flow screens.
function showView(name) {
  const next = views[name];
  document.getElementById('errorView').classList.add('hidden');
  if (name === 'home') window.huistrap.resizeHome();
  else if (FLOW_VIEWS.has(name)) window.huistrap.resizeFlow();

  const current = currentVisibleView();
  if (!current || current === next) {
    Object.values(views).forEach((v) => { if (v !== next) v.classList.add('hidden'); });
    next.classList.remove('hidden', 'view-fade');
    return;
  }

  current.classList.add('view-fade');
  setTimeout(() => {
    Object.values(views).forEach((v) => { if (v !== next) { v.classList.add('hidden'); v.classList.remove('view-fade'); } });
    next.classList.remove('hidden');
    next.classList.add('view-fade');
    void next.offsetWidth;
    next.classList.remove('view-fade');
  }, VIEW_FADE_MS);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Starts a fresh connecting flow: resets the bar to 0% and steps to the
// "Authenticating" stage on the next frame so the fill is always visible
// transitioning in, never snapping straight to its target.
function showConnectingScreen(headline, channel) {
  connectingChannel.textContent = `Channel: ${channel || 'production'}`;
  connectingVersion.textContent = 'Version: –';
  connectingText.textContent = headline || 'Connecting to Roblox...';
  connectingLogoRing.classList.remove('done');
  connectingProgressFill.style.width = '0%';
  showView('connecting');
  requestAnimationFrame(() => setConnectingStage('auth'));
}

function setConnectingStage(stageKey, version) {
  const stage = CONNECTING_STAGES[stageKey];
  if (!stage) return;
  if (version) connectingVersion.textContent = `Version: ${version}`;
  connectingStageLabel.textContent = stage.label;
  connectingProgressFill.style.width = stage.pct + '%';
}

function setConnectingHeadline(text) {
  connectingText.textContent = text;
}

// Brings the connecting view back to the front (e.g. after a Roblox
// download finished and the download screen was showing instead) without
// resetting the progress bar back to 0 first.
function returnToConnectingView(headline) {
  connectingText.textContent = headline;
  connectingLogoRing.classList.remove('done');
  showView('connecting');
}

function finishConnectingScreen(callback) {
  setConnectingStage('done');
  connectingLogoRing.classList.add('done');
  setTimeout(callback, 650);
}

function showError(message) {
  window.huistrap.resizeFlow();
  const current = currentVisibleView();
  errorText.textContent = message;
  const errorView = document.getElementById('errorView');
  if (!current) {
    Object.values(views).forEach((v) => v.classList.add('hidden'));
    errorView.classList.remove('hidden', 'view-fade');
    return;
  }
  current.classList.add('view-fade');
  setTimeout(() => {
    Object.values(views).forEach((v) => { v.classList.add('hidden'); v.classList.remove('view-fade'); });
    errorView.classList.remove('hidden');
    errorView.classList.add('view-fade');
    void errorView.offsetWidth;
    errorView.classList.remove('view-fade');
  }, VIEW_FADE_MS);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function beginRobloxDownloadProgressUI(title) {
  progressIcon.classList.add('hidden');
  progressPercent.classList.remove('hidden');
  progressPercent.textContent = '0%';
  progressBarOuter.classList.remove('indeterminate');
  progressTitle.textContent = title;
  progressFileText.textContent = '';
  progressFill.style.width = '0%';
  progressBytesText.textContent = '';
  progressSpeed.textContent = '';
  lastProgressSample = null;
  showView('progress');
}

window.huistrap.onProgress((data) => {
  const receivedBytes = (data && data.receivedBytes) || 0;
  const totalBytes = (data && data.totalBytes) || 0;
  const filesDone = (data && data.filesDone) || 0;
  const filesTotal = (data && data.filesTotal) || 0;
  const finishing = data && data.phase === 'finishing';

  let pct = 0;
  if (finishing) {
    pct = 100;
  } else if (totalBytes > 1) {
    pct = Math.round((receivedBytes / totalBytes) * 100);
    if (pct >= 100) pct = 99;
    if (pct < 0) pct = 0;
  } else if (filesTotal > 0) {
    pct = Math.round((filesDone / filesTotal) * 100);
    if (pct >= 100) pct = 99;
  }

  progressFill.style.width = pct + '%';
  if (!progressPercent.classList.contains('hidden')) {
    progressPercent.textContent = pct + '%';
  }
  progressBytesText.textContent = totalBytes > 1
    ? `${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}`
    : '';

  if (finishing) {
    progressFileText.textContent = filesTotal
      ? `Finishing up…  ·  ${filesTotal} files`
      : 'Finishing up...';
    progressSpeed.textContent = '';
    return;
  }

  if (data && data.phase === 'extracting' && data.currentFile) {
    progressFileText.textContent = `Extracting ${data.currentFile}`
      + (filesTotal ? `  ·  ${filesDone}/${filesTotal} files` : '');
  } else if (data && data.currentFile) {
    const extra = Array.isArray(data.currentFiles) && data.currentFiles.length > 1
      ? ` + ${data.currentFiles.length - 1} more`
      : '';
    const count = filesTotal ? `  ·  ${filesDone}/${filesTotal} files` : '';
    progressFileText.textContent = `${data.currentFile}${extra}${count}`;
  } else if (filesTotal) {
    progressFileText.textContent = filesDone
      ? `${filesDone}/${filesTotal} files`
      : `Preparing ${filesTotal} files…`;
  } else {
    progressFileText.textContent = '';
  }

  const now = Date.now();
  if (lastProgressSample) {
    const deltaBytes = receivedBytes - lastProgressSample.bytes;
    const deltaMs = now - lastProgressSample.time;
    if (deltaMs > 400) {
      const bytesPerSec = deltaBytes / (deltaMs / 1000);
      progressSpeed.textContent = bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '';
      lastProgressSample = { bytes: receivedBytes, time: now };
    }
  } else {
    lastProgressSample = { bytes: receivedBytes, time: now };
  }
});

window.huistrap.onMigrationProgress((data) => {
  if (data.status === 'started') {
    progressIcon.classList.add('hidden');
    progressPercent.classList.add('hidden');
    progressBarOuter.classList.remove('indeterminate');
    progressTitle.textContent = 'Moving versions...';
    progressFileText.textContent = '';
    progressFill.style.width = '0%';
    progressBytesText.textContent = '';
    progressSpeed.textContent = '';
    showView('progress');
  } else if (data.status === 'done') {
    openSettings();
  }
});

window.huistrap.onAppUpdateFound((version) => {
  progressIcon.classList.remove('hidden');
  progressPercent.classList.add('hidden');
  progressBarOuter.classList.add('indeterminate');
  progressTitle.textContent = `Updating Huistrap to v${version}...`;
  progressFileText.textContent = '';
  progressFill.style.width = '0%';
  progressBytesText.textContent = '';
  progressSpeed.textContent = "Please don't close this window — Huistrap will restart automatically.";
  showView('progress');
});

window.huistrap.onAppUpdateFailed((message) => {
  showError(`Update failed: ${message}`);
});

let pendingProtocolLaunch = false;

window.huistrap.onProtocolLaunchStarted(() => {
  pendingProtocolLaunch = true;
  showConnectingScreen('Connecting to Roblox...');
});

window.huistrap.onProtocolLaunchDownloading(() => {
  beginRobloxDownloadProgressUI('Downloading Roblox...');
});

window.huistrap.onProtocolLaunchDone(() => {
  pendingProtocolLaunch = false;
  returnToConnectingView('Starting Roblox');
  setConnectingStage('starting');
  finishConnectingScreen(() => window.huistrap.closeApp());
});

window.huistrap.onProtocolLaunchFailed((message) => {
  pendingProtocolLaunch = false;
  showError(message);
});

window.huistrap.onProtocolUpdateAvailable((data) => {
  pendingProtocolLaunch = true;
  const btnSkip = document.getElementById('btnSkip');
  if (!data.hasAnyInstalled) {
    versionInfo.textContent = `No installation found. New version: ${data.latestVersion}`;
    btnSkip.disabled = true;
  } else {
    versionInfo.textContent = `Installed: ${data.installedVersion} → New: ${data.latestVersion}`;
    btnSkip.disabled = false;
  }
  showView('update');
});

window.huistrap.onAccountLaunchDownloading(() => {
  beginRobloxDownloadProgressUI('Downloading Roblox...');
});

async function refreshHomeVersion() {
  try {
    const s = await window.huistrap.getSettings();
    versionLabel.textContent = s.installedVersion || '–';
    const badge = document.getElementById('appVersionBadge');
    if (badge) badge.textContent = `v${s.appVersion}`;
  } catch {
    versionLabel.textContent = '–';
  }
  refreshExecutorHomeStatus();
}

function setExecutorDot(el, status) {
  if (!el) return;
  el.classList.remove('green', 'red', 'neutral');
  if (status === true) el.classList.add('green');
  else if (status === false) el.classList.add('red');
  else el.classList.add('neutral');
}

async function refreshExecutorHomeStatus() {
  const dot = document.getElementById('executorHomeDot');
  const label = document.getElementById('executorHomeLabel');
  if (!dot || !label) return;
  try {
    const res = await window.huistrap.getExploitStatus();
    if (!res.selected) {
      setExecutorDot(dot, null);
      label.textContent = 'No executor selected';
      return;
    }
    if (res.updateStatus === true) {
      setExecutorDot(dot, true);
      label.textContent = `${res.selected} · Updated`;
    } else if (res.updateStatus === false) {
      setExecutorDot(dot, false);
      label.textContent = `${res.selected} · Not updated`;
    } else {
      setExecutorDot(dot, null);
      label.textContent = res.notFound ? `${res.selected} · Not found` : `${res.selected} · Checking…`;
    }
  } catch {
    setExecutorDot(dot, null);
    label.textContent = 'Status unavailable';
  }
}

let executorPollTimer = null;
function startExecutorPolling() {
  if (executorPollTimer) return;
  refreshExecutorHomeStatus();
  executorPollTimer = setInterval(refreshExecutorHomeStatus, 60000);
}

window.huistrap.onShowHome(() => {
  showView('home');
  refreshHomeVersion();
});

async function startPlayFlow() {
  showConnectingScreen('Connecting to Roblox...');
  try {
    const result = await window.huistrap.check();

    if (!result.updateAvailable) {
      await wait(150);
      setConnectingStage('prepare', result.installedVersion || '–');
      await wait(200);
      setConnectingHeadline('Starting Roblox');
      setConnectingStage('starting', result.installedVersion || '–');
      await window.huistrap.launchInstalled();
      finishConnectingScreen(() => window.huistrap.closeApp());
      return;
    }

    const btnSkip = document.getElementById('btnSkip');
    if (!result.hasAnyInstalled) {
      versionInfo.textContent = `No installation found. New version: ${result.latestVersion}`;
      btnSkip.disabled = true;
    } else {
      versionInfo.textContent = `Installed: ${result.installedVersion} → New: ${result.latestVersion}`;
      btnSkip.disabled = false;
    }

    showView('update');
  } catch (err) {
    showError(err.message || String(err));
  }
}

async function startStudioFlow() {
  showConnectingScreen('Connecting to Roblox Studio...');
  try {
    await wait(150);
    setConnectingStage('prepare');
    await wait(200);
    setConnectingHeadline('Starting Roblox Studio');
    setConnectingStage('starting');
    await window.huistrap.launchStudio();
    finishConnectingScreen(() => window.huistrap.closeApp());
  } catch (err) {
    showError(err.message || String(err));
  }
}

async function finishAccountLaunch(userId, label, useInstalled, launchOpts) {
  showConnectingScreen(`Signing in as ${label}...`);
  try {
    const result = await window.huistrap.accountsLaunch(userId, { useInstalled, ...(launchOpts || {}) });
    returnToConnectingView(`Starting Roblox as ${result.displayName || result.username}`);
    setConnectingStage('starting');
    finishConnectingScreen(() => window.huistrap.closeApp());
  } catch (err) {
    showError(err.message || String(err));
  }
}

// Checks for a Roblox update before launching an account, same as the
// regular Play button flow, instead of silently auto-downloading whatever
// is newest.
async function startAccountLaunchFlow(userId, label, launchOpts) {
  fadeOutOverlay(accountsOverlay);
  showConnectingScreen(`Signing in as ${label}...`);
  try {
    const result = await window.huistrap.check();
    if (!result.updateAvailable) {
      await finishAccountLaunch(userId, label, false, launchOpts);
      return;
    }

    pendingAccountLaunch = { userId, label, launchOpts: launchOpts || {} };
    const btnSkip = document.getElementById('btnSkip');
    if (!result.hasAnyInstalled) {
      versionInfo.textContent = `No installation found. New version: ${result.latestVersion}`;
      btnSkip.disabled = true;
    } else {
      versionInfo.textContent = `Installed: ${result.installedVersion} → New: ${result.latestVersion}`;
      btnSkip.disabled = false;
    }
    showView('update');
  } catch (err) {
    showError(err.message || String(err));
  }
}

document.getElementById('btnPlay').addEventListener('click', startPlayFlow);
document.getElementById('btnStudio').addEventListener('click', startStudioFlow);

document.getElementById('btnDownload').addEventListener('click', async () => {
  if (pendingAccountLaunch) {
    const { userId, label, launchOpts } = pendingAccountLaunch;
    pendingAccountLaunch = null;
    await finishAccountLaunch(userId, label, false, launchOpts);
    return;
  }
  if (pendingProtocolLaunch) {
    beginRobloxDownloadProgressUI('Downloading Roblox...');
    try {
      await window.huistrap.protocolDownloadAndLaunch();
      pendingProtocolLaunch = false;
      connectingProgressFill.style.width = '0%';
      returnToConnectingView('Starting Roblox');
      setConnectingStage('starting');
      finishConnectingScreen(() => window.huistrap.closeApp());
    } catch (err) {
      pendingProtocolLaunch = false;
      showError(err.message || String(err));
    }
    return;
  }
  beginRobloxDownloadProgressUI('Downloading Roblox...');
  try {
    await window.huistrap.downloadAndLaunch();
    connectingProgressFill.style.width = '0%';
    returnToConnectingView('Starting Roblox');
    setConnectingStage('starting');
    finishConnectingScreen(() => window.huistrap.closeApp());
  } catch (err) {
    showError(err.message || String(err));
  }
});

document.getElementById('btnSkip').addEventListener('click', async () => {
  if (pendingAccountLaunch) {
    const { userId, label, launchOpts } = pendingAccountLaunch;
    pendingAccountLaunch = null;
    await finishAccountLaunch(userId, label, true, launchOpts);
    return;
  }
  if (pendingProtocolLaunch) {
    showConnectingScreen('Starting Roblox');
    try {
      setConnectingStage('starting');
      await window.huistrap.protocolLaunchCurrent();
      pendingProtocolLaunch = false;
      finishConnectingScreen(() => window.huistrap.closeApp());
    } catch (err) {
      pendingProtocolLaunch = false;
      showError(err.message || String(err));
    }
    return;
  }
  showConnectingScreen('Starting Roblox');
  try {
    setConnectingStage('starting');
    await window.huistrap.launchInstalled();
    finishConnectingScreen(() => window.huistrap.closeApp());
  } catch (err) {
    showError(err.message || String(err));
  }
});

document.getElementById('btnConnectingCancel').addEventListener('click', () => {
  if (pendingProtocolLaunch) {
    pendingProtocolLaunch = false;
    window.huistrap.protocolCancel();
  }
  window.huistrap.closeApp();
});

document.getElementById('btnCancel').addEventListener('click', () => {
  if (pendingProtocolLaunch) {
    pendingProtocolLaunch = false;
    window.huistrap.protocolCancel();
    showView('home');
    return;
  }
  if (pendingAccountLaunch) {
    pendingAccountLaunch = null;
    openAccounts();
    return;
  }
  showView('home');
});

document.getElementById('btnErrorClose').addEventListener('click', () => {
  showView('home');
});

document.getElementById('btnTitlebarClose').addEventListener('click', () => {
  window.huistrap.closeApp();
});

const settingsOverlay = document.getElementById('settingsOverlay');
const sidebarItems = document.querySelectorAll('.sidebar-item');
const settingsPanels = document.querySelectorAll('.settings-panel');

function switchPanel(panelName) {
  sidebarItems.forEach((el) => el.classList.toggle('active', el.dataset.panel === panelName));
  settingsPanels.forEach((el) => el.classList.toggle('hidden', el.id !== `panel-${panelName}`));
  if (panelName === 'executor') {
    loadExecutorPanel();
  }
}

sidebarItems.forEach((item) => {
  item.addEventListener('click', () => switchPanel(item.dataset.panel));
});

let currentFflags = {};
let fflagsView = 'list';
let fflagsSearchTerm = '';

function setFflagsView(view) {
  fflagsView = view;
  document.querySelectorAll('.fflags-toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.fview === view);
  });
  document.getElementById('fflagsListView').classList.toggle('hidden', view !== 'list');
  document.getElementById('fflagsJsonView').classList.toggle('hidden', view !== 'json');
  document.getElementById('fflagsSearch').closest('.fflags-search').classList.toggle('hidden', view !== 'list');
  if (view === 'json') {
    document.getElementById('fflagJsonEditor').value = JSON.stringify(currentFflags, null, 2);
    document.getElementById('fflagJsonError').textContent = '';
  } else {
    renderFflagsList();
  }
}

function updateFflagsCount() {
  const n = Object.keys(currentFflags).length;
  document.getElementById('fflagsCount').textContent = n === 1 ? '1 flag' : `${n} flags`;
}

function renderFflagsList() {
  const list = document.getElementById('fflagsList');
  updateFflagsCount();
  const term = fflagsSearchTerm.trim().toLowerCase();
  const entries = Object.entries(currentFflags).filter(([name]) => !term || name.toLowerCase().includes(term));
  list.innerHTML = '';
  if (Object.keys(currentFflags).length === 0) {
    list.innerHTML = '<p class="fflags-empty">No custom FastFlags set. Click "+ Add Flag".</p>';
    return;
  }
  if (entries.length === 0) {
    list.innerHTML = '<p class="fflags-empty">No flags match your filter.</p>';
    return;
  }
  entries.forEach(([name, value]) => list.appendChild(createFflagRow(name, String(value))));
}

function createFflagRow(name, value) {
  const row = document.createElement('div');
  row.className = 'fflag-row';
  let committedName = name;

  const nameInput = document.createElement('input');
  nameInput.className = 'fflag-name-input';
  nameInput.value = name;
  nameInput.placeholder = 'Flag name, e.g. FFlagDebugGraphicsPreferD3D11';
  nameInput.spellcheck = false;

  const valueInput = document.createElement('input');
  valueInput.className = 'fflag-value-input';
  valueInput.value = value;
  valueInput.placeholder = 'Value, e.g. true';
  valueInput.spellcheck = false;

  const markDuplicate = () => {
    const newName = nameInput.value.trim();
    const isDuplicate = !!newName && newName !== committedName && Object.prototype.hasOwnProperty.call(currentFflags, newName);
    nameInput.classList.toggle('fflag-name-duplicate', isDuplicate);
    nameInput.title = isDuplicate ? 'A flag with this name already exists - saving will overwrite it.' : '';
  };
  nameInput.addEventListener('input', markDuplicate);

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      valueInput.focus();
      valueInput.select();
    }
  });
  valueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      valueInput.blur();
    }
  });

  nameInput.addEventListener('blur', () => {
    const newName = nameInput.value.trim();
    if (newName === committedName) return;
    if (committedName) delete currentFflags[committedName];
    if (newName) {
      currentFflags[newName] = valueInput.value.trim();
      committedName = newName;
      persistFflags();
    } else if (committedName) {
      committedName = '';
      persistFflags();
    }
    updateFflagsCount();
  });

  valueInput.addEventListener('blur', () => {
    if (!committedName) return;
    currentFflags[committedName] = valueInput.value.trim();
    persistFflags();
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'fflag-remove';
  removeBtn.title = 'Remove flag';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    const hadName = !!committedName;
    if (hadName) delete currentFflags[committedName];
    row.remove();
    if (hadName) persistFflags();
    updateFflagsCount();
    if (!document.querySelector('#fflagsList .fflag-row')) renderFflagsList();
  });

  row.appendChild(nameInput);
  row.appendChild(valueInput);
  row.appendChild(removeBtn);
  return row;
}

async function persistFflags() {
  try {
    const result = await window.huistrap.setFflags(currentFflags);
    currentFflags = result.fastFlags;
    updateFflagsCount();
  } catch (err) {
    showError(err.message || String(err));
  }
}

document.getElementById('btnFflagAddRow').addEventListener('click', () => {
  fflagsSearchTerm = '';
  document.getElementById('fflagsSearch').value = '';
  const list = document.getElementById('fflagsList');
  const emptyMsg = list.querySelector('.fflags-empty');
  if (emptyMsg) emptyMsg.remove();
  const row = createFflagRow('', '');
  list.appendChild(row);
  row.querySelector('.fflag-name-input').focus();
});

document.getElementById('btnFflagClearAll').addEventListener('click', async () => {
  if (!Object.keys(currentFflags).length) return;
  if (!confirm('Remove all custom FastFlags?')) return;
  currentFflags = {};
  await persistFflags();
  renderFflagsList();
});

document.getElementById('fflagsSearch').addEventListener('input', (e) => {
  fflagsSearchTerm = e.target.value;
  renderFflagsList();
});

document.querySelectorAll('.fflags-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => setFflagsView(btn.dataset.fview));
});

document.getElementById('btnFflagJsonApply').addEventListener('click', async () => {
  const editor = document.getElementById('fflagJsonEditor');
  const errorEl = document.getElementById('fflagJsonError');
  let parsed;
  try {
    parsed = JSON.parse(editor.value);
  } catch (err) {
    errorEl.textContent = 'Invalid JSON: ' + err.message;
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errorEl.textContent = 'JSON must be an object of flag name/value pairs.';
    return;
  }
  try {
    const result = await window.huistrap.setFflags(parsed);
    currentFflags = result.fastFlags;
    errorEl.textContent = '';
    editor.value = JSON.stringify(currentFflags, null, 2);
    updateFflagsCount();
  } catch (err) {
    errorEl.textContent = err.message || String(err);
  }
});

async function openSettings() {
  window.huistrap.resizeSettings();
  fadeInOverlay(settingsOverlay);
  switchPanel('bootstrapper');
  try {
    const s = await window.huistrap.getSettings();
    document.getElementById('channelSelect').value = s.channel;
    document.getElementById('versionsDirLabel').textContent = s.versionsDir;
    document.getElementById('studioVersionsDirLabel').textContent = s.studioVersionsDir;
    document.getElementById('deploymentPlayerVersion').textContent = s.installedVersion || 'Not installed';
    document.getElementById('deploymentStudioVersion').textContent = s.installedStudioVersion || 'Not installed';
    document.getElementById('concurrencySelect').value = String(s.downloadConcurrency || 8);
    document.getElementById('fpsCapInput').value = s.fpsCap || '';
    document.getElementById('cursorSelect').value = s.cursorType || 'default';
    document.getElementById('activityTrayToggle').checked = s.enableActivityTray !== false;
    currentFflags = s.fastFlags || {};
    fflagsSearchTerm = '';
    document.getElementById('fflagsSearch').value = '';
    setFflagsView('list');
    document.getElementById('customFontLabel').textContent = s.customFontName
      ? `Active: ${s.customFontName}`
      : 'No custom font selected.';

    document.getElementById('aboutVersionText').textContent = `v${s.appVersion}`;
    const lastUpdateEl = document.getElementById('aboutLastUpdateText');
    if (s.lastAppliedVersion && s.lastAppliedAt) {
      const d = new Date(s.lastAppliedAt);
      lastUpdateEl.textContent = `Updated to v${s.lastAppliedVersion} on ${d.toLocaleDateString('en-US')} at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      lastUpdateEl.textContent = 'No update installed yet.';
    }
    refreshUpdateNowUi();

    await loadExecutorPanel();
  } catch (err) {
    showError(err.message || String(err));
  }
}

let executorListCache = [];
let executorSelectedTitle = null;
let executorSearchTerm = '';

async function loadExecutorPanel() {
  const listEl = document.getElementById('executorList');
  if (!listEl) return;

  listEl.innerHTML = '<p class="executor-loading">Loading executors…</p>';

  try {
    const res = await window.huistrap.getExploits();
    executorListCache = res.exploits || [];
    executorSelectedTitle = res.selected || null;
    renderExecutorList();
  } catch (err) {
    listEl.innerHTML = `<p class="executor-empty">Failed to load: ${err.message || String(err)}</p>`;
  }
}

function sortExploits(list) {
  return list.slice().sort((a, b) => {
    if (a.updateStatus !== b.updateStatus) return a.updateStatus ? -1 : 1;
    return (a.title || '').localeCompare(b.title || '');
  });
}

function renderExecutorList() {
  const listEl = document.getElementById('executorList');
  if (!listEl) return;

  const term = executorSearchTerm.trim().toLowerCase();
  const filtered = term
    ? executorListCache.filter((e) => (e.title || '').toLowerCase().includes(term))
    : executorListCache;

  listEl.innerHTML = '';

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="executor-empty">No Windows executors found.</p>';
    return;
  }

  const executors = sortExploits(filtered.filter((e) => !e.isExternal));
  const externals = sortExploits(filtered.filter((e) => e.isExternal));

  // Executors (internals) on top, then Externals
  if (executors.length > 0) {
    listEl.appendChild(makeSectionHeader('Executors', executors.length));
    for (const e of executors) listEl.appendChild(createExecutorCard(e));
  }
  if (externals.length > 0) {
    listEl.appendChild(makeSectionHeader('Externals', externals.length));
    for (const e of externals) listEl.appendChild(createExecutorCard(e));
  }
}

function makeSectionHeader(label, count) {
  const el = document.createElement('div');
  el.className = 'executor-section-header';
  el.innerHTML = `<span>${label}</span><span class="executor-section-count">${count}</span>`;
  return el;
}

function createExecutorCard(e) {
  const card = document.createElement('div');
  card.className = 'executor-card' + (e.title === executorSelectedTitle ? ' selected' : '');
  card.dataset.title = e.title;

  // Icon
  if (e.logo) {
    const img = document.createElement('img');
    img.className = 'executor-card-icon';
    img.src = e.logo;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => {
      img.replaceWith(makeFallbackIcon(e.title));
    };
    card.appendChild(img);
  } else {
    card.appendChild(makeFallbackIcon(e.title));
  }

  // Info
  const info = document.createElement('div');
  info.className = 'executor-card-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'executor-card-title';
  titleEl.textContent = e.title;
  info.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'executor-card-meta';
  const metaParts = [];
  if (e.version) metaParts.push(`v${e.version}`);
  if (e.cost) metaParts.push(e.cost);
  else if (e.free) metaParts.push('Free');
  if (e.updatedDate) metaParts.push(e.updatedDate);
  meta.textContent = metaParts.join(' · ') || 'Windows';
  info.appendChild(meta);
  card.appendChild(info);

  // Right side
  const right = document.createElement('div');
  right.className = 'executor-card-right';

  const badge = document.createElement('span');
  badge.className = 'executor-card-badge ' + (e.updateStatus ? 'updated' : 'outdated');
  badge.textContent = e.updateStatus ? 'Updated' : 'Outdated';
  right.appendChild(badge);

  if (e.free) {
    const freeTag = document.createElement('span');
    freeTag.className = 'executor-card-free';
    freeTag.textContent = 'Free';
    right.appendChild(freeTag);
  }
  card.appendChild(right);

  card.addEventListener('click', async () => {
    const wasSelected = executorSelectedTitle === e.title;
    const newTitle = wasSelected ? null : e.title;
    executorSelectedTitle = newTitle;
    await window.huistrap.setSelectedExploit(newTitle);
    renderExecutorList();
    refreshExecutorHomeStatus();
  });

  return card;
}

function makeFallbackIcon(title) {
  const el = document.createElement('div');
  el.className = 'executor-card-icon-fallback';
  el.textContent = (title || '?').charAt(0);
  return el;
}

document.getElementById('executorSearch').addEventListener('input', (e) => {
  executorSearchTerm = e.target.value;
  renderExecutorList();
});

document.getElementById('btnExecutorClear').addEventListener('click', async () => {
  executorSelectedTitle = null;
  await window.huistrap.setSelectedExploit(null);
  renderExecutorList();
  refreshExecutorHomeStatus();
});

function closeSettings() {
  fadeOutOverlay(settingsOverlay);
  window.huistrap.resizeHome();
  refreshHomeVersion();
}

document.getElementById('btnSettings').addEventListener('click', openSettings);
document.getElementById('btnSettingsClose').addEventListener('click', closeSettings);
document.getElementById('btnSettingsClose2').addEventListener('click', closeSettings);
document.getElementById('btnSettingsSave').addEventListener('click', closeSettings);
document.getElementById('btnSettingsSaveLaunch').addEventListener('click', () => {
  closeSettings();
  startPlayFlow();
});

document.getElementById('channelSelect').addEventListener('change', (e) => {
  window.huistrap.setChannel(e.target.value);
});

document.getElementById('concurrencySelect').addEventListener('change', (e) => {
  window.huistrap.setConcurrency(e.target.value);
});

document.getElementById('fpsCapInput').addEventListener('change', (e) => {
  window.huistrap.setFpsCap(e.target.value.trim());
});

document.getElementById('cursorSelect').addEventListener('change', (e) => {
  window.huistrap.setCursor(e.target.value);
});

document.getElementById('activityTrayToggle').addEventListener('change', (e) => {
  window.huistrap.setActivityTray(e.target.checked);
});

document.getElementById('btnChooseFont').addEventListener('click', async () => {
  try {
    const result = await window.huistrap.chooseCustomFont();
    if (result.ok) {
      document.getElementById('customFontLabel').textContent = `Active: ${result.fontName}`;
    }
  } catch (err) {
    showError(err.message || String(err));
  }
});

document.getElementById('btnClearFont').addEventListener('click', async () => {
  await window.huistrap.clearCustomFont();
  document.getElementById('customFontLabel').textContent = 'No custom font selected.';
});

document.getElementById('btnChangeDir').addEventListener('click', async () => {
  const result = await window.huistrap.changeVersionsDir();
  if (result.ok) {
    document.getElementById('versionsDirLabel').textContent = result.newDir;
  }
});

document.getElementById('btnOpenDir').addEventListener('click', () => {
  window.huistrap.openVersionsDir();
});

document.getElementById('btnChangeStudioDir').addEventListener('click', async () => {
  const result = await window.huistrap.changeStudioVersionsDir();
  if (result.ok) {
    document.getElementById('studioVersionsDirLabel').textContent = result.newDir;
  }
});

document.getElementById('btnOpenStudioDir').addEventListener('click', () => {
  window.huistrap.openStudioVersionsDir();
});

document.getElementById('linkDiscord').addEventListener('click', (e) => {
  e.preventDefault();
  window.huistrap.openDiscord();
});

document.getElementById('linkAbout').addEventListener('click', (e) => {
  e.preventDefault();
  openSettings().then(() => switchPanel('about'));
});

document.getElementById('btnCheckUpdateNow').addEventListener('click', async () => {
  const btn = document.getElementById('btnCheckUpdateNow');
  const statusEl = document.getElementById('aboutLastUpdateText');
  btn.disabled = true;
  statusEl.textContent = 'Checking...';
  try {
    const result = await window.huistrap.checkAppUpdateNow();
    if (result.updateAvailable) {
      pendingAppUpdateVersion = result.version;
      refreshUpdateNowUi();
      statusEl.textContent = `Update ${result.version} is available. Click Update Now to install — Huistrap will not update by itself.`;
    } else {
      pendingAppUpdateVersion = null;
      refreshUpdateNowUi();
      statusEl.textContent = result.message;
    }
  } catch (err) {
    statusEl.textContent = 'Error while checking: ' + (err.message || String(err));
  } finally {
    btn.disabled = false;
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function inlineMarkdown(str) {
  return str
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function renderChangelogMarkdown(text) {
  const lines = escapeHtml(text).split('\n');
  let html = '';
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      return;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (headingMatch) {
      closeList();
      html += `<h4 class="changelog-heading">${inlineMarkdown(headingMatch[2])}</h4>`;
    } else if (bulletMatch) {
      if (!inList) {
        html += '<ul class="changelog-list">';
        inList = true;
      }
      html += `<li>${inlineMarkdown(bulletMatch[1])}</li>`;
    } else {
      closeList();
      html += `<p>${inlineMarkdown(line)}</p>`;
    }
  });
  closeList();
  return html;
}

let changelogPendingFlag = false;
let changelogFromSettings = false;
let creditsFromSettings = false;

async function displayChangelog(version, changelog) {
  document.getElementById('changelogVersion').textContent = `v${version}`;
  document.getElementById('changelogBody').innerHTML = changelog
    ? renderChangelogMarkdown(changelog)
    : '<p>This version includes general improvements and bug fixes.</p>';
  window.huistrap.resizeModal();
  fadeInOverlay(document.getElementById('changelogOverlay'));
}

async function checkPendingChangelog() {
  try {
    const pending = await window.huistrap.getPendingChangelog();
    if (!pending) return;
    changelogPendingFlag = true;
    changelogFromSettings = false;
    await displayChangelog(pending.version, pending.changelog);
  } catch {
    // Changelog could not be loaded - will retry on next launch.
  }
}

document.getElementById('btnShowChangelog').addEventListener('click', async () => {
  const btn = document.getElementById('btnShowChangelog');
  btn.disabled = true;
  try {
    const result = await window.huistrap.previewChangelog();
    changelogPendingFlag = false;
    changelogFromSettings = true;
    fadeOutOverlay(settingsOverlay);
    await displayChangelog(result.version, result.changelog);
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btnChangelogClose').addEventListener('click', async () => {
  fadeOutOverlay(document.getElementById('changelogOverlay'), () => {
    if (changelogFromSettings) {
      window.huistrap.resizeSettings();
      fadeInOverlay(settingsOverlay);
    } else {
      window.huistrap.resizeHome();
    }
  });
  if (changelogPendingFlag) {
    changelogPendingFlag = false;
    await window.huistrap.markChangelogShown();
  }
});

document.getElementById('linkCredits').addEventListener('click', (e) => {
  e.preventDefault();
  creditsFromSettings = false;
  window.huistrap.resizeCredits();
  fadeInOverlay(document.getElementById('creditsOverlay'));
});

document.getElementById('btnShowCredits').addEventListener('click', () => {
  creditsFromSettings = true;
  fadeOutOverlay(settingsOverlay, () => {
    window.huistrap.resizeCredits();
    fadeInOverlay(document.getElementById('creditsOverlay'));
  });
});

document.getElementById('btnCreditsClose').addEventListener('click', () => {
  fadeOutOverlay(document.getElementById('creditsOverlay'), () => {
    if (creditsFromSettings) {
      window.huistrap.resizeSettings();
      fadeInOverlay(settingsOverlay);
    } else {
      window.huistrap.resizeHome();
    }
  });
});

const accountsOverlay = document.getElementById('accountsOverlay');
const accountsListEl = document.getElementById('accountsList');
const accountsErrorEl = document.getElementById('accountsError');
const accountsCountEl = document.getElementById('accountsCount');
const btnAccountAdd = document.getElementById('btnAccountAdd');
const btnAccountAddLabel = document.getElementById('btnAccountAddLabel');

const ACCOUNTS_EMPTY_STATE = `
  <div class="accounts-empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="accounts-empty-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
    <p class="accounts-empty-title">No accounts yet</p>
    <p class="accounts-empty-sub">Add an account to switch between Roblox logins without signing in and out.</p>
  </div>
`;

function avatarFallbackInitials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function setAccountsCount(n) {
  accountsCountEl.textContent = n === 1 ? '1 account' : `${n} accounts`;
}

function presenceLabel(presence) {
  const status = presence && presence.status;
  if (status === 'ingame') return presence.lastLocation ? `In game · ${presence.lastLocation}` : 'In game';
  if (status === 'studio') return 'In Studio';
  if (status === 'online') return 'Online';
  if (status === 'unknown') return 'Unknown';
  return 'Offline';
}

function makeAvatarNode(account) {
  const wrap = document.createElement('div');
  wrap.className = 'account-avatar-wrap';
  if (account.avatarUrl) {
    const img = document.createElement('img');
    img.className = 'account-avatar';
    img.src = account.avatarUrl;
    img.alt = account.displayName || account.username;
    wrap.appendChild(img);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'account-avatar-fallback';
    fallback.textContent = avatarFallbackInitials(account.displayName || account.username);
    wrap.appendChild(fallback);
  }
  return wrap;
}

let accountsCache = [];
let savedGamesCache = [];
let selectedAccountId = null;
let dragSrcUserId = null;
let presenceTimer = null;
let renamingGameId = null;
let pendingAppUpdateVersion = null;

function selectedAccount() {
  return accountsCache.find((a) => String(a.userId) === String(selectedAccountId)) || null;
}

function renderAccounts(accounts) {
  accountsCache = accounts;
  accountsListEl.innerHTML = '';
  setAccountsCount(accounts.length);
  if (!accounts.length) {
    accountsListEl.innerHTML = ACCOUNTS_EMPTY_STATE;
    selectedAccountId = null;
    renderAccountDetail();
    return;
  }
  if (!selectedAccountId || !accounts.some((a) => String(a.userId) === String(selectedAccountId))) {
    selectedAccountId = accounts[0].userId;
  }
  accounts.forEach((account) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'account-row' + (String(account.userId) === String(selectedAccountId) ? ' account-row-selected' : '');
    row.draggable = true;
    row.dataset.userId = account.userId;

    const handle = document.createElement('span');
    handle.className = 'account-drag-handle';
    handle.title = 'Drag to reorder';
    handle.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"></circle><circle cx="15" cy="6" r="1.6"></circle><circle cx="9" cy="12" r="1.6"></circle><circle cx="15" cy="12" r="1.6"></circle><circle cx="9" cy="18" r="1.6"></circle><circle cx="15" cy="18" r="1.6"></circle></svg>';
    row.appendChild(handle);
    row.appendChild(makeAvatarNode(account));

    const info = document.createElement('div');
    info.className = 'account-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'account-display-name';
    nameEl.textContent = account.displayName || account.username;
    const userEl = document.createElement('span');
    userEl.className = 'account-username';
    userEl.textContent = `@${account.username}`;
    const metaEl = document.createElement('span');
    metaEl.className = 'account-row-meta';
    metaEl.textContent = presenceLabel(account.presence);
    info.appendChild(nameEl);
    info.appendChild(userEl);
    info.appendChild(metaEl);
    row.appendChild(info);

    const dot = document.createElement('span');
    dot.className = 'presence-dot ' + ((account.presence && account.presence.status) || 'offline');
    row.appendChild(dot);

    if (account.instance && account.instance.alive) {
      const kill = document.createElement('span');
      kill.className = 'account-row-kill';
      kill.title = 'Kill instance';
      kill.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"></rect></svg>';
      kill.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await killAccountInstance(account.userId);
      });
      row.appendChild(kill);
    }

    row.addEventListener('click', () => {
      selectedAccountId = account.userId;
      renderAccounts(accountsCache);
    });

    row.addEventListener('dragstart', (e) => {
      dragSrcUserId = account.userId;
      row.classList.add('account-row-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(account.userId));
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('account-row-dragging');
      accountsListEl.querySelectorAll('.account-row').forEach((r) => r.classList.remove('account-row-dragover'));
    });
    row.addEventListener('dragover', (e) => {
      if (!dragSrcUserId || dragSrcUserId === account.userId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('account-row-dragover');
    });
    row.addEventListener('dragleave', () => row.classList.remove('account-row-dragover'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('account-row-dragover');
      const targetUserId = account.userId;
      if (!dragSrcUserId || dragSrcUserId === targetUserId) return;
      const fromIndex = accountsCache.findIndex((a) => a.userId === dragSrcUserId);
      const toIndex = accountsCache.findIndex((a) => a.userId === targetUserId);
      if (fromIndex === -1 || toIndex === -1) return;
      const reordered = accountsCache.slice();
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      renderAccounts(reordered);
      try {
        await window.huistrap.accountsReorder(reordered.map((a) => a.userId));
      } catch (err) {
        accountsErrorEl.textContent = err.message || String(err);
        accountsErrorEl.classList.remove('hidden');
      }
    });

    accountsListEl.appendChild(row);
  });
  renderAccountDetail();
}

function fillAvatarWrap(wrap, account) {
  wrap.className = 'account-avatar-wrap account-avatar-wrap-lg';
  wrap.innerHTML = '';
  const node = makeAvatarNode(account);
  while (node.firstChild) wrap.appendChild(node.firstChild);
}

function renderAccountDetail() {
  const emptyEl = document.getElementById('accountsDetailEmpty');
  const bodyEl = document.getElementById('accountsDetailBody');
  const account = selectedAccount();
  if (!account) {
    emptyEl.classList.remove('hidden');
    bodyEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  bodyEl.classList.remove('hidden');

  fillAvatarWrap(document.getElementById('detailAvatarWrap'), account);
  document.getElementById('detailDisplayName').textContent = account.displayName || account.username;
  document.getElementById('detailUsername').textContent = `@${account.username}`;
  const pill = document.getElementById('detailPresence');
  const status = (account.presence && account.presence.status) || 'offline';
  pill.className = 'presence-pill ' + status;
  pill.textContent = presenceLabel(account.presence);

  const killBtn = document.getElementById('btnDetailKill');
  if (account.instance && account.instance.alive) {
    killBtn.classList.remove('hidden');
    const game = account.instance.placeName;
    killBtn.title = game ? `Kill instance — ${game}` : 'Kill this account’s running Roblox instance';
  } else {
    killBtn.classList.add('hidden');
  }

  renderSavedGamesUi();
  renderFollowSelect();
}

function renderFollowSelect() {
  const select = document.getElementById('followAccountSelect');
  const current = selectedAccount();
  const others = accountsCache.filter((a) => {
    if (!current || String(a.userId) === String(current.userId)) return false;
    return a.presence && (a.presence.status === 'ingame' || a.presence.placeId);
  });
  const prev = select.value;
  select.innerHTML = '';
  if (!others.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No one in-game right now';
    select.appendChild(opt);
  } else {
    others.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = String(a.userId);
      const loc = a.presence && a.presence.lastLocation ? a.presence.lastLocation : 'In game';
      opt.textContent = `${a.displayName || a.username} — ${loc}`;
      select.appendChild(opt);
    });
    if (prev && others.some((a) => String(a.userId) === prev)) select.value = prev;
  }
}

function renderSavedGamesUi() {
  const select = document.getElementById('savedGameSelect');
  const list = document.getElementById('savedGamesList');
  const currentVal = select.value;
  select.innerHTML = '';
  const custom = document.createElement('option');
  custom.value = '';
  custom.textContent = 'Custom Game ID';
  select.appendChild(custom);
  savedGamesCache.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.placeId;
    opt.textContent = g.name;
    select.appendChild(opt);
  });
  if (currentVal && savedGamesCache.some((g) => String(g.placeId) === currentVal)) {
    select.value = currentVal;
  }

  list.innerHTML = '';
  if (!savedGamesCache.length) {
    list.innerHTML = '<p class="saved-game-empty">No saved games yet. Enter a Game ID and click Save.</p>';
    return;
  }
  savedGamesCache.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'saved-game-row';
    if (renamingGameId === g.id) {
      const input = document.createElement('input');
      input.value = g.name;
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          await commitRenameGame(g.id, input.value);
        } else if (e.key === 'Escape') {
          renamingGameId = null;
          renderSavedGamesUi();
        }
      });
      row.appendChild(input);
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-primary btn-small';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => commitRenameGame(g.id, input.value));
      row.appendChild(saveBtn);
    } else {
      const info = document.createElement('div');
      info.className = 'saved-game-info';
      const name = document.createElement('span');
      name.className = 'saved-game-name';
      name.textContent = g.name;
      const id = document.createElement('span');
      id.className = 'saved-game-id';
      id.textContent = g.placeId;
      info.appendChild(name);
      info.appendChild(id);
      row.appendChild(info);

      const useBtn = document.createElement('button');
      useBtn.className = 'btn btn-secondary btn-small';
      useBtn.textContent = 'Use';
      useBtn.addEventListener('click', () => {
        document.getElementById('savedGameSelect').value = g.placeId;
        document.getElementById('joinPlaceInput').value = g.placeId;
      });
      row.appendChild(useBtn);

      const renameBtn = document.createElement('button');
      renameBtn.className = 'icon-btn';
      renameBtn.title = 'Rename';
      renameBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
      renameBtn.addEventListener('click', () => {
        renamingGameId = g.id;
        renderSavedGamesUi();
      });
      row.appendChild(renameBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn danger';
      delBtn.title = 'Delete';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>';
      delBtn.addEventListener('click', async () => {
        savedGamesCache = await window.huistrap.savedGamesRemove(g.id);
        renderSavedGamesUi();
      });
      row.appendChild(delBtn);
    }
    list.appendChild(row);
  });
}

async function commitRenameGame(id, name) {
  try {
    savedGamesCache = await window.huistrap.savedGamesRename(id, name);
    renamingGameId = null;
    renderSavedGamesUi();
  } catch (err) {
    accountsErrorEl.textContent = err.message || String(err);
    accountsErrorEl.classList.remove('hidden');
  }
}

function parsePlaceIdClient(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const fromUrl = s.match(/roblox\.com\/(?:games|experiences)\/(\d+)/i);
  if (fromUrl) return fromUrl[1];
  const fromQuery = s.match(/[?&]placeId=(\d+)/i);
  if (fromQuery) return fromQuery[1];
  if (/^\d+$/.test(s)) return s;
  return null;
}

function currentJoinOptions() {
  const placeId = parsePlaceIdClient(document.getElementById('joinPlaceInput').value);
  const jobRaw = document.getElementById('joinJobInput').value.trim();
  const opts = {};
  if (placeId) opts.placeId = placeId;
  if (jobRaw) opts.jobId = jobRaw;
  return opts;
}

function launchSelected(extraOpts) {
  const account = selectedAccount();
  if (!account) return;
  startAccountLaunchFlow(account.userId, account.displayName || account.username, extraOpts || {});
}

document.getElementById('btnDetailLaunch').addEventListener('click', () => launchSelected({}));

document.getElementById('btnDetailBrowser').addEventListener('click', async () => {
  const account = selectedAccount();
  if (!account) return;
  accountsErrorEl.classList.add('hidden');
  try {
    await window.huistrap.accountsOpenBrowser(account.userId);
  } catch (err) {
    accountsErrorEl.textContent = err.message || String(err);
    accountsErrorEl.classList.remove('hidden');
  }
});

document.getElementById('btnDetailRemove').addEventListener('click', async () => {
  const account = selectedAccount();
  if (!account) return;
  try {
    await window.huistrap.accountsRemove(account.userId);
    selectedAccountId = null;
    await loadAccounts();
  } catch (err) {
    accountsErrorEl.textContent = err.message || String(err);
    accountsErrorEl.classList.remove('hidden');
  }
});

async function killAccountInstance(userId) {
  accountsErrorEl.classList.add('hidden');
  try {
    await window.huistrap.accountsKill(userId);
    await loadAccounts();
  } catch (err) {
    accountsErrorEl.textContent = err.message || String(err);
    accountsErrorEl.classList.remove('hidden');
  }
}

document.getElementById('btnDetailKill').addEventListener('click', () => {
  const account = selectedAccount();
  if (!account) return;
  killAccountInstance(account.userId);
});

document.getElementById('btnJoinGame').addEventListener('click', () => {
  const opts = currentJoinOptions();
  if (!opts.placeId) {
    accountsErrorEl.textContent = 'Enter a Game ID (or pick a saved game) first.';
    accountsErrorEl.classList.remove('hidden');
    return;
  }
  accountsErrorEl.classList.add('hidden');
  launchSelected(opts);
});

const saveGameOverlay = document.getElementById('saveGameOverlay');
const saveGameNameInput = document.getElementById('saveGameNameInput');
const saveGamePlaceIdLabel = document.getElementById('saveGamePlaceIdLabel');
const btnSaveGameCancel = document.getElementById('btnSaveGameCancel');
const btnSaveGameConfirm = document.getElementById('btnSaveGameConfirm');
let pendingSaveGamePlaceId = null;

function openSaveGameModal(placeId, defaultName) {
  pendingSaveGamePlaceId = placeId;
  saveGamePlaceIdLabel.textContent = 'Place ' + placeId;
  saveGameNameInput.value = defaultName || '';
  fadeInOverlay(saveGameOverlay);
  setTimeout(() => {
    saveGameNameInput.focus();
    saveGameNameInput.select();
  }, 0);
}

function closeSaveGameModal() {
  pendingSaveGamePlaceId = null;
  fadeOutOverlay(saveGameOverlay);
}

async function confirmSaveGameModal() {
  const placeId = pendingSaveGamePlaceId;
  if (!placeId) return;
  const name = saveGameNameInput.value.trim() || ('Place ' + placeId);
  try {
    savedGamesCache = await window.huistrap.savedGamesSave(placeId, name);
    document.getElementById('savedGameSelect').value = placeId;
    renderSavedGamesUi();
    accountsErrorEl.classList.add('hidden');
    closeSaveGameModal();
  } catch (err) {
    accountsErrorEl.textContent = err.message || String(err);
    accountsErrorEl.classList.remove('hidden');
    closeSaveGameModal();
  }
}

btnSaveGameCancel.addEventListener('click', closeSaveGameModal);
btnSaveGameConfirm.addEventListener('click', confirmSaveGameModal);
saveGameNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmSaveGameModal();
  } else if (e.key === 'Escape') {
    closeSaveGameModal();
  }
});

document.getElementById('btnSaveGame').addEventListener('click', () => {
  const placeId = parsePlaceIdClient(document.getElementById('joinPlaceInput').value);
  if (!placeId) {
    accountsErrorEl.textContent = 'Enter a valid Game ID to save.';
    accountsErrorEl.classList.remove('hidden');
    return;
  }
  const existing = savedGamesCache.find((g) => String(g.placeId) === placeId);
  openSaveGameModal(placeId, existing ? existing.name : '');
});

document.getElementById('savedGameSelect').addEventListener('change', (e) => {
  if (e.target.value) document.getElementById('joinPlaceInput').value = e.target.value;
});

document.getElementById('btnJoinAccount').addEventListener('click', () => {
  const targetId = document.getElementById('followAccountSelect').value;
  if (!targetId) {
    accountsErrorEl.textContent = 'Nobody else is in a game right now.';
    accountsErrorEl.classList.remove('hidden');
    return;
  }
  const target = accountsCache.find((a) => String(a.userId) === String(targetId));
  if (!target) return;
  const opts = { followUserId: target.userId };
  if (target.presence && target.presence.placeId) opts.placeId = target.presence.placeId;
  if (target.presence && target.presence.jobId) opts.jobId = target.presence.jobId;
  accountsErrorEl.classList.add('hidden');
  launchSelected(opts);
});

async function loadAccounts() {
  accountsListEl.innerHTML = '<p class="accounts-loading">Loading accounts...</p>';
  try {
    const [accounts, games] = await Promise.all([
      window.huistrap.accountsList(),
      window.huistrap.savedGamesList()
    ]);
    savedGamesCache = games || [];
    renderAccounts(accounts);
  } catch (err) {
    accountsListEl.innerHTML = '';
    setAccountsCount(0);
    accountsErrorEl.textContent = err.message || String(err);
    accountsErrorEl.classList.remove('hidden');
  }
}

async function refreshPresenceQuiet() {
  try {
    const [presence, instances] = await Promise.all([
      window.huistrap.accountsPresence(),
      window.huistrap.instancesList ? window.huistrap.instancesList() : Promise.resolve([])
    ]);
    accountsCache = accountsCache.map((a) => ({
      ...a,
      presence: presence[String(a.userId)] || a.presence || { status: 'unknown' },
      instance: (instances || []).find((i) => i.alive && String(i.userId) === String(a.userId)) || null
    }));
    renderAccounts(accountsCache);
  } catch {
    // Presence is best-effort.
  }
}

async function openAccounts() {
  accountsErrorEl.classList.add('hidden');
  await window.huistrap.resizeAccounts();
  fadeInOverlay(accountsOverlay);
  await loadAccounts();
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(refreshPresenceQuiet, 8000);
}

function closeAccounts() {
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
  fadeOutOverlay(accountsOverlay);
  window.huistrap.resizeHome();
  refreshHomeVersion();
}

document.getElementById('btnAccounts').addEventListener('click', openAccounts);
document.getElementById('btnAccountsClose').addEventListener('click', closeAccounts);

btnAccountAdd.addEventListener('click', async () => {
  accountsErrorEl.classList.add('hidden');
  btnAccountAdd.disabled = true;
  btnAccountAddLabel.textContent = 'Waiting…';
  try {
    const added = await window.huistrap.accountsAdd();
    if (added && added.userId) selectedAccountId = added.userId;
    await loadAccounts();
  } catch (err) {
    accountsErrorEl.textContent = err.message || String(err);
    accountsErrorEl.classList.remove('hidden');
  } finally {
    btnAccountAdd.disabled = false;
    btnAccountAddLabel.textContent = 'Add';
  }
});

function refreshUpdateNowUi() {
  const homeLink = document.getElementById('linkUpdateNow');
  const banner = document.getElementById('aboutUpdateBanner');
  const bannerText = document.getElementById('aboutUpdateBannerText');
  if (!homeLink || !banner) return;
  if (pendingAppUpdateVersion) {
    homeLink.classList.remove('hidden');
    homeLink.textContent = 'Update Now — v' + pendingAppUpdateVersion;
    banner.classList.remove('hidden');
    if (bannerText) {
      bannerText.textContent = 'Huistrap v' + pendingAppUpdateVersion + ' is ready. It will not install until you click Update Now.';
    }
  } else {
    homeLink.classList.add('hidden');
    banner.classList.add('hidden');
  }
}

async function installPendingAppUpdate() {
  try {
    await window.huistrap.installAppUpdate();
  } catch (err) {
    showError(err.message || String(err));
  }
}

document.getElementById('linkUpdateNow').addEventListener('click', (e) => {
  e.preventDefault();
  installPendingAppUpdate();
});

document.getElementById('btnInstallUpdateAbout').addEventListener('click', installPendingAppUpdate);

if (window.huistrap.onAppUpdateAvailable) {
  window.huistrap.onAppUpdateAvailable((version) => {
    pendingAppUpdateVersion = version;
    refreshUpdateNowUi();
  });
}

showView('home');
refreshHomeVersion();
startExecutorPolling();
checkPendingChangelog();
window.huistrap.getPendingAppUpdate().then((pending) => {
  if (pending && pending.version) {
    pendingAppUpdateVersion = pending.version;
    refreshUpdateNowUi();
  }
}).catch(() => {});

if (window.huistrap.onInstancesUpdate) {
  window.huistrap.onInstancesUpdate((instances) => {
    if (!accountsCache.length) return;
    accountsCache = accountsCache.map((a) => ({
      ...a,
      instance: (instances || []).find((i) => i.alive && String(i.userId) === String(a.userId)) || null
    }));
    if (!accountsOverlay.classList.contains('hidden')) renderAccounts(accountsCache);
  });
}
