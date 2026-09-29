const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Tray, Menu, nativeImage, Notification, clipboard } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

process.on('uncaughtException', (err) => {
  console.error('[Huistrap] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Huistrap] Unhandled rejection:', reason);
});


const CDN_BASE = 'https://setup.rbxcdn.com';
const APP_VERSION = require('./package.json').version;
const UPDATE_REPO = 'Krozix1012/Huistrap';
const UPDATE_MANIFEST_URL = `https://raw.githubusercontent.com/${UPDATE_REPO}/main/version.json`;
const GITHUB_RELEASE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/tags/`;

const rootDir = path.join(os.homedir(), 'AppData', 'Local', 'Huistrap');
const configFile = path.join(rootDir, 'config.json');
const updateStatePath = path.join(rootDir, 'update-state.json');
const accountsFile = path.join(rootDir, 'accounts.json');
const savedGamesFile = path.join(rootDir, 'saved-games.json');

const DISCORD_INVITE_CODE = 'jwbu7M9yuH';
const DISCORD_INVITE_URL = `https://discord.gg/${DISCORD_INVITE_CODE}`;
const DISCORD_APP_URI = `discord://-/invite/${DISCORD_INVITE_CODE}`;

const DEFAULT_SETTINGS = {
  channel: 'LIVE',
  versionsDir: path.join(rootDir, 'Versions'),
  studioVersionsDir: path.join(rootDir, 'StudioVersions'),
  installedVersion: null,
  installedStudioVersion: null,
  downloadConcurrency: 8,
  fpsCap: null,
  fastFlags: {},
  customFontName: null,
  selectedExploit: null,
  cursorType: 'default',
  enableActivityTray: true
};

const modificationsDir = path.join(rootDir, 'Modifications');
const modFontsDir = path.join(modificationsDir, 'content', 'fonts');
const modFontsFamiliesDir = path.join(modFontsDir, 'families');
const CUSTOM_FONT_FILENAME = 'CustomFont.ttf';
const CURSOR_PRESETS = {
  From2006: path.join(__dirname, 'assets', 'cursors', 'From2006'),
  From2013: path.join(__dirname, 'assets', 'cursors', 'From2013')
};
const CURSOR_FILES = ['ArrowCursor.png', 'ArrowFarCursor.png'];

let mainWindow;
let settings = null;
let pendingProtocolUri = null;
let pendingAppUpdate = null;

const PROTOCOL_SCHEME = 'roblox-player';

if (process.platform === 'win32') {
  try {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [path.resolve(process.argv[1] || '.')]);
    }
  } catch (err) {
    console.error('[Huistrap] Could not register protocol handler:', err);
  }
}

function findProtocolArg(argv) {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}:`)) || null;
}

const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', (event, argv) => {
  const protocolArg = findProtocolArg(argv);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    if (!protocolArg) mainWindow.webContents.send('huistrap:show-home');
  } else {
    createWindow();
  }
  if (protocolArg) handleProtocolLaunch(protocolArg);
});

function ensureDirs() {
  if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });
  if (!fs.existsSync(settings.versionsDir)) fs.mkdirSync(settings.versionsDir, { recursive: true });
  if (!fs.existsSync(settings.studioVersionsDir)) fs.mkdirSync(settings.studioVersionsDir, { recursive: true });
}

function loadSettings() {
  if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });
  if (!fs.existsSync(configFile)) {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    return;
  }
  try {
    const loaded = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    settings = { ...DEFAULT_SETTINGS, ...loaded };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  ensureDirs();
}

function saveSettings() {
  fs.writeFileSync(configFile, JSON.stringify(settings, null, 2));
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Huistrap/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const trimmed = data.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
          reject(new Error('Response is not JSON.'));
          return;
        }
        try {
          resolve(JSON.parse(trimmed));
        } catch (e) {
          reject(e);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Timeout.')));
  });
}

function weaoGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'WEAO-3PService', Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const trimmed = data.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
          reject(new Error('Response is not JSON.'));
          return;
        }
        try {
          resolve(JSON.parse(trimmed));
        } catch (e) {
          reject(e);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Timeout.')));
  });
}

let exploitsCache = null;
let exploitsCacheTime = 0;
const EXPLOITS_CACHE_TTL = 60 * 1000; // 1 minute

async function fetchExploitsList() {
  const now = Date.now();
  if (exploitsCache && (now - exploitsCacheTime) < EXPLOITS_CACHE_TTL) {
    return exploitsCache;
  }
  const data = await weaoGetJson('https://weao.xyz/api/status/exploits');
  if (!Array.isArray(data)) throw new Error('Invalid exploits response');
  exploitsCache = data
    .filter((e) => (e.platform || '').toLowerCase() === 'windows')
    .map((e) => {
      const extype = (e.extype || '').toLowerCase();
      const isExternal = extype.includes('external');
      return {
        title: e.title || 'Unknown',
        updateStatus: !!e.updateStatus,
        version: e.version || null,
        platform: e.platform || null,
        free: !!e.free,
        detected: !!e.detected,
        rbxversion: e.rbxversion || null,
        updatedDate: e.updatedDate || null,
        logo: (e.slug && e.slug.logo) ? e.slug.logo : null,
        cost: e.cost || null,
        extype: e.extype || null,
        isExternal
      };
    });
  exploitsCacheTime = now;
  return exploitsCache;
}

function httpDownload(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Huistrap/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const declared = parseInt(res.headers['content-length'], 10);
      const total = Number.isFinite(declared) && declared > 0 ? declared : undefined;
      let received = 0;
      const file = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress(received, total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
    request.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
    request.setTimeout(30000, () => request.destroy(new Error('Timeout.')));
  });
}

function httpDownloadBinary(url, destPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects.'));
      return;
    }
    const request = https.get(url, { headers: { 'User-Agent': 'Huistrap/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpDownloadBinary(res.headers.location, destPath, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
    request.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
    request.setTimeout(30000, () => request.destroy(new Error('Timeout while downloading the update.')));
  });
}

async function fetchChangelogForVersion(version) {
  const local = readLocalChangelog(version);
  for (const tag of [`v${version}`, version]) {
    try {
      const release = await httpGetJson(`${GITHUB_RELEASE_API}${encodeURIComponent(tag)}`);
      if (release && typeof release.body === 'string' && release.body.trim()) {
        return release.body.trim();
      }
    } catch {
      // Tag format not found, trying the next format.
    }
  }
  return local;
}

function readLocalChangelog(version) {
  try {
    const file = path.join(__dirname, 'CHANGELOG.md');
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!text) return null;
    if (!version) return text;
    const needle = String(version).replace(/^v/i, '');
    if (text.includes(needle)) return text;
    return text;
  } catch {
    return null;
  }
}

function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(updateStatePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeUpdateState(state) {
  if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(updateStatePath, JSON.stringify(state));
}

async function checkForAppUpdate() {
  const state = readUpdateState();

  if (state.phase === 'pending-verify') {
    if (state.targetVersion === APP_VERSION.trim()) {
      console.log(`[Huistrap] Update to ${APP_VERSION} verified successfully.`);
      writeUpdateState({ phase: 'applied', lastAppliedVersion: APP_VERSION.trim(), timestamp: Date.now(), changelogPending: true });
    } else {
      const ageMs = Date.now() - (state.timestamp || 0);
      console.log(`[Huistrap] Update to ${state.targetVersion} was NOT applied (current version still ${APP_VERSION}). robocopy likely failed.`);
      if (ageMs < 2 * 60 * 1000) {
        console.log('[Huistrap] Cooldown active, skipping immediate retry.');
        return null;
      }
      writeUpdateState({});
    }
  }

  let manifest;
  try {
    manifest = await httpGetJson(UPDATE_MANIFEST_URL);
  } catch (err) {
    console.log('[Huistrap] No update / error during check:', err.message);
    return null;
  }

  if (!manifest || typeof manifest !== 'object') return null;
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) return null;
  if (typeof manifest.downloadUrl !== 'string' || !manifest.downloadUrl.startsWith('https://')) return null;

  const targetVersion = manifest.version.trim();

  if (targetVersion === APP_VERSION.trim()) return null;

  const freshState = readUpdateState();
  if (freshState.lastAppliedVersion === targetVersion) {
    console.log(`[Huistrap] Update ${targetVersion} was already verified and applied, skipping.`);
    return null;
  }

  console.log(`[Huistrap] Update detected: ${APP_VERSION} -> ${targetVersion}`);
  return manifest;
}

async function performSelfUpdate(manifest) {
  const targetVersion = manifest.version.trim();
  const appDir = __dirname;

  try {
    const testFile = path.join(appDir, `.huistrap-write-test-${Date.now()}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch {
    throw new Error(`No write permission in the app folder (${appDir}). Huistrap was likely installed in a protected folder (e.g. Program Files). Please reinstall into a folder in your user profile, or run Huistrap as administrator.`);
  }

  const updateDir = path.join(os.tmpdir(), `huistrap-update-${Date.now()}`);
  fs.mkdirSync(updateDir, { recursive: true });
  const zipPath = path.join(updateDir, 'app.zip');

  await httpDownloadBinary(manifest.downloadUrl, zipPath);

  const extractDir = path.join(updateDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  await extractZip(zipPath, extractDir);

  if (!fs.existsSync(path.join(extractDir, 'main.js')) || !fs.existsSync(path.join(extractDir, 'package.json'))) {
    throw new Error('Update package is incomplete (main.js or package.json missing after extraction).');
  }

  const extractedPkg = JSON.parse(fs.readFileSync(path.join(extractDir, 'package.json'), 'utf8'));
  if (!extractedPkg.version || extractedPkg.version.trim() !== targetVersion) {
    throw new Error(`Downloaded package has version ${extractedPkg.version}, expected ${targetVersion}.`);
  }

  writeUpdateState({ phase: 'pending-verify', targetVersion, timestamp: Date.now() });

  const batchPath = path.join(updateDir, 'update.bat');
  const vbsPath = path.join(updateDir, 'run-hidden.vbs');
  const logPath = path.join(updateDir, 'update.log');
  const exePath = process.execPath;
  const isPackaged = app.isPackaged;
  const startCmd = isPackaged
    ? `start "" "${exePath}"`
    : `start "" "${exePath}" "${appDir}"`;
  const batchScript = [
    '@echo off',
    `echo Huistrap update > "${logPath}"`,
    `powershell -NoProfile -Command "try { Wait-Process -Id ${process.pid} -Timeout 30 -ErrorAction SilentlyContinue } catch {}" >> "${logPath}" 2>&1`,
    `robocopy "${extractDir}" "${appDir}" /E /IS /IT /R:5 /W:1 >> "${logPath}" 2>&1`,
    startCmd,
    `rmdir /s /q "${updateDir}" 2>nul`
  ].join('\r\n');
  fs.writeFileSync(batchPath, batchScript);

  // Launched via a VBScript wrapper (WScript.Shell.Run with windowStyle 0)
  // instead of spawning cmd.exe directly - this is a more reliable way to
  // guarantee no console window ever becomes visible, since Node's
  // windowsHide flag doesn't always suppress console inheritance through
  // nested batch/child processes (tasklist, powershell, robocopy, etc.)
  // on Windows.
  const vbsScript = [
    'Set objShell = CreateObject("WScript.Shell")',
    `objShell.Run "cmd.exe /c ""${batchPath}""", 0, False`
  ].join('\r\n');
  fs.writeFileSync(vbsPath, vbsScript);

  const child = spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  app.quit();
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile('tar.exe', ['-xf', zipPath, '-C', destDir], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getVersionUrl(binaryType) {
  return `https://clientsettings.roblox.com/v2/client-version/${binaryType}/channel/${settings.channel}`;
}

async function getLatestVersionInfo(binaryType) {
  const data = await httpGetJson(getVersionUrl(binaryType));
  return { version: data.clientVersionUpload, guid: data.clientVersionUpload };
}

async function getPackageManifest(guid) {
  const url = `${CDN_BASE}/${guid}-rbxPkgManifest.txt`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Huistrap/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for manifest`));
        return;
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Timeout.')));
  });
}

const PACKAGE_DEST_MAP = {
  'Libraries.zip': '',
  'shaders.zip': 'shaders',
  'ssl.zip': 'ssl',
  'WebView2.zip': '',
  'WebView2RuntimeInstaller.zip': 'WebView2RuntimeInstaller',
  'content-avatar.zip': 'content\\avatar',
  'content-configs.zip': 'content\\configs',
  'content-fonts.zip': 'content\\fonts',
  'content-sky.zip': 'content\\sky',
  'content-sounds.zip': 'content\\sounds',
  'content-textures2.zip': 'content\\textures',
  'content-models.zip': 'content\\models',
  'content-textures3.zip': 'PlatformContent\\pc\\textures',
  'content-terrain.zip': 'PlatformContent\\pc\\terrain',
  'content-platform-fonts.zip': 'PlatformContent\\pc\\fonts',
  'extracontent-luapackages.zip': 'ExtraContent\\LuaPackages',
  'extracontent-translations.zip': 'ExtraContent\\translations',
  'extracontent-models.zip': 'ExtraContent\\models',
  'extracontent-textures.zip': 'ExtraContent\\textures',
  'extracontent-places.zip': 'ExtraContent\\places',
  'RobloxApp.zip': ''
};

const STUDIO_PACKAGE_DEST_MAP = {
  'Libraries.zip': '',
  'shaders.zip': 'shaders',
  'ssl.zip': 'ssl',
  'WebView2.zip': '',
  'WebView2RuntimeInstaller.zip': 'WebView2RuntimeInstaller',
  'content-avatar.zip': 'content\\avatar',
  'content-configs.zip': 'content\\configs',
  'content-fonts.zip': 'content\\fonts',
  'content-sky.zip': 'content\\sky',
  'content-sounds.zip': 'content\\sounds',
  'content-textures2.zip': 'content\\textures',
  'content-models.zip': 'content\\models',
  'content-textures3.zip': 'PlatformContent\\pc\\textures',
  'content-terrain.zip': 'PlatformContent\\pc\\terrain',
  'content-platform-fonts.zip': 'PlatformContent\\pc\\fonts',
  'extracontent-luapackages.zip': 'ExtraContent\\LuaPackages',
  'extracontent-translations.zip': 'ExtraContent\\translations',
  'extracontent-models.zip': 'ExtraContent\\models',
  'extracontent-textures.zip': 'ExtraContent\\textures',
  'extracontent-places.zip': 'ExtraContent\\places',
  'RobloxStudio.zip': '',
  'ApplicationConfig.zip': 'ApplicationConfig',
  'content-studio_svg_textures.zip': 'content\\studio_svg_textures',
  'content-qt_translations.zip': 'content\\qt_translations',
  'content-api-docs.zip': 'content\\api_docs',
  'extracontent-scripts.zip': 'ExtraContent\\scripts',
  'BuiltInPlugins.zip': 'BuiltInPlugins',
  'BuiltInStandalonePlugins.zip': 'BuiltInStandalonePlugins',
  'LibrariesQt5.zip': '',
  'Plugins.zip': 'Plugins',
  'Qml.zip': 'Qml',
  'StudioFonts.zip': 'StudioFonts',
  'redist.zip': ''
};

function parsePackageManifest(manifestText) {
  const lines = manifestText.split(/\r?\n/).map((l) => l.trim());
  const packages = [];
  let i = 0;
  if (lines[0] && /^v\d+/i.test(lines[0])) i = 1;
  while (i < lines.length) {
    const name = lines[i];
    if (name && /\.zip$/i.test(name)) {
      // rbxPkgManifest: name, md5, packedSize, unpackedSize
      const packed = parseInt(lines[i + 2], 10);
      const unpacked = parseInt(lines[i + 3], 10);
      const size = (Number.isFinite(packed) && packed > 0)
        ? packed
        : (Number.isFinite(unpacked) && unpacked > 0 ? unpacked : 0);
      packages.push({ name, size });
      i += 4;
    } else {
      i += 1;
    }
  }
  return packages;
}

async function downloadRobloxBinary(guid, targetVersionsDir, destMap, progressCallback) {
  const manifestText = await getPackageManifest(guid);
  const packages = parsePackageManifest(manifestText);
  if (!packages.length) {
    throw new Error('Roblox package manifest was empty or could not be parsed.');
  }

  const targetDir = path.join(targetVersionsDir, guid);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const tmpDir = path.join(os.tmpdir(), `huistrap-${guid}`);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const concurrency = Math.max(1, settings.downloadConcurrency || 8);
  let totalSize = packages.reduce((sum, p) => sum + (p.size > 0 ? p.size : 0), 0);
  const perPackageReceived = new Array(packages.length).fill(0);
  const completed = new Array(packages.length).fill(false);
  const activeFiles = new Set();

  function reportOverall(extra) {
    if (!progressCallback) return;
    const receivedBytes = perPackageReceived.reduce((a, b) => a + b, 0);
    const filesDone = completed.filter(Boolean).length;
    const active = [...activeFiles];
    const extracting = extra && extra.extracting;
    const phase = extra && extra.phase ? extra.phase : (extracting ? 'extracting' : 'downloading');
    progressCallback({
      receivedBytes,
      totalBytes: Math.max(totalSize, receivedBytes, 1),
      currentFile: extracting || active[0] || null,
      currentFiles: extracting ? [extracting] : active,
      filesDone,
      filesTotal: packages.length,
      phase
    });
  }

  reportOverall({ phase: 'starting' });

  async function processPackage(pkg, idx) {
    const zipUrl = `${CDN_BASE}/${guid}-${pkg.name}`;
    const zipDest = path.join(tmpDir, pkg.name);
    activeFiles.add(pkg.name);
    reportOverall();
    await httpDownload(zipUrl, zipDest, (received, contentLength) => {
      if (contentLength && (!pkg.size || pkg.size <= 0)) {
        pkg.size = contentLength;
        totalSize = packages.reduce((sum, p) => sum + (p.size > 0 ? p.size : 0), 0);
      }
      const cap = pkg.size > 0 ? pkg.size : received;
      perPackageReceived[idx] = Math.min(received, cap);
      reportOverall();
    });
    activeFiles.delete(pkg.name);
    if (pkg.size > 0) perPackageReceived[idx] = pkg.size;
    reportOverall({ extracting: pkg.name });
    const relDest = destMap[pkg.name] !== undefined ? destMap[pkg.name] : pkg.name.replace(/\.zip$/i, '');
    const extractDest = path.join(targetDir, relDest);
    if (!fs.existsSync(extractDest)) fs.mkdirSync(extractDest, { recursive: true });
    await extractZip(zipDest, extractDest);
    completed[idx] = true;
    if (pkg.size > 0) perPackageReceived[idx] = pkg.size;
    reportOverall();
  }

  let cursor = 0;
  const sortedPackages = [...packages].sort((a, b) => b.size - a.size);
  async function worker() {
    while (cursor < sortedPackages.length) {
      const pkg = sortedPackages[cursor];
      cursor += 1;
      const originalIdx = packages.indexOf(pkg);
      await processPackage(pkg, originalIdx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, packages.length) }, worker);
  await Promise.all(workers);

  if (progressCallback) {
    progressCallback({
      receivedBytes: Math.max(totalSize, perPackageReceived.reduce((a, b) => a + b, 0)),
      totalBytes: Math.max(totalSize, 1),
      currentFile: null,
      currentFiles: [],
      filesDone: packages.length,
      filesTotal: packages.length,
      phase: 'finishing'
    });
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  const appSettings = `<?xml version="1.0" encoding="UTF-8"?>\n<Settings>\n\t<ContentFolder>content</ContentFolder>\n\t<BaseUrl>http://www.roblox.com</BaseUrl>\n</Settings>`;
  fs.writeFileSync(path.join(targetDir, 'AppSettings.xml'), appSettings);

  return targetDir;
}

function killProcessByName(exeName) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/F', '/IM', exeName, '/T'], () => resolve());
  });
}

async function downloadRobloxVersion(guid, progressCallback) {
  const dir = await downloadRobloxBinary(guid, settings.versionsDir, PACKAGE_DEST_MAP, progressCallback);
  await killProcessByName('RobloxPlayerBeta.exe');
  cleanupOldVersions(settings.versionsDir, guid);
  return dir;
}

async function downloadStudioVersion(guid, progressCallback) {
  const dir = await downloadRobloxBinary(guid, settings.studioVersionsDir, STUDIO_PACKAGE_DEST_MAP, progressCallback);
  await killProcessByName('RobloxStudioBeta.exe');
  cleanupOldVersions(settings.studioVersionsDir, guid);
  return dir;
}

function cleanupOldVersions(dir, keepGuid) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== keepGuid) {
      const targetPath = path.join(dir, entry.name);
      removeDirWithRetry(targetPath);
    }
  }
}

function removeDirWithRetry(targetPath, attemptsLeft = 3) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (err) {
    if (attemptsLeft > 1) {
      setTimeout(() => removeDirWithRetry(targetPath, attemptsLeft - 1), 1500);
    } else {
      console.log(`[Huistrap] Could not delete old folder (ignored, will retry on next start): ${targetPath} — ${err.message}`);
    }
  }
}

function listInstalledVersions(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function writeClientAppSettings(versionDir) {
  const flags = {};
  for (const [key, value] of Object.entries(settings.fastFlags)) {
    flags[key] = String(value);
  }
  const fpsCapNum = parseInt(settings.fpsCap, 10);
  if (Number.isFinite(fpsCapNum) && fpsCapNum > 0) {
    flags.DFIntTaskSchedulerTargetFps = String(fpsCapNum);
    flags.FFlagTaskSchedulerLimitTargetFpsTo2402 = 'False';
  }
  const clientSettingsDir = path.join(versionDir, 'ClientSettings');
  if (!fs.existsSync(clientSettingsDir)) fs.mkdirSync(clientSettingsDir, { recursive: true });
  fs.writeFileSync(path.join(clientSettingsDir, 'ClientAppSettings.json'), JSON.stringify(flags, null, 2));
}

function applyCursorMod(versionDir) {
  const cursorType = settings.cursorType || 'default';
  const targetDir = path.join(versionDir, 'content', 'textures', 'Cursors', 'KeyboardMouse');
  if (!fs.existsSync(targetDir)) return;

  if (!cursorType || cursorType === 'default') {
    // Leave Roblox defaults alone
    return;
  }

  const srcDir = CURSOR_PRESETS[cursorType];
  if (!srcDir || !fs.existsSync(srcDir)) {
    console.log(`[Huistrap] Cursor preset not found: ${cursorType}`);
    return;
  }

  for (const fileName of CURSOR_FILES) {
    const src = path.join(srcDir, fileName);
    const dest = path.join(targetDir, fileName);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, dest);
    } catch (err) {
      console.log(`[Huistrap] Could not apply cursor ${fileName}:`, err.message);
    }
  }
}

function applyModifications(versionDir) {
  applyCursorMod(versionDir);

  const customFontSrc = path.join(modFontsDir, CUSTOM_FONT_FILENAME);
  if (!fs.existsSync(customFontSrc)) return;

  const targetFontsDir = path.join(versionDir, 'content', 'fonts');
  const targetFamiliesDir = path.join(targetFontsDir, 'families');
  if (!fs.existsSync(targetFontsDir) || !fs.existsSync(targetFamiliesDir)) return;

  try {
    fs.copyFileSync(customFontSrc, path.join(targetFontsDir, CUSTOM_FONT_FILENAME));
  } catch (err) {
    console.log('[Huistrap] Could not copy CustomFont.ttf:', err.message);
    return;
  }

  const familyFiles = fs.readdirSync(targetFamiliesDir).filter((f) => f.toLowerCase().endsWith('.json'));
  for (const fileName of familyFiles) {
    const familyPath = path.join(targetFamiliesDir, fileName);
    const backupPath = familyPath + '.huistrap-original';
    try {
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(familyPath, backupPath);
      }
      const original = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      if (Array.isArray(original.faces)) {
        for (const face of original.faces) {
          face.assetId = `rbxasset://fonts/${CUSTOM_FONT_FILENAME}`;
        }
      }
      fs.writeFileSync(familyPath, JSON.stringify(original));
    } catch (err) {
      console.log(`[Huistrap] Could not overwrite font family (${fileName}):`, err.message);
    }
  }
}

function restoreOriginalFonts(versionDir) {
  const targetFamiliesDir = path.join(versionDir, 'content', 'fonts', 'families');
  if (!fs.existsSync(targetFamiliesDir)) return;

  const backupFiles = fs.readdirSync(targetFamiliesDir).filter((f) => f.endsWith('.huistrap-original'));
  for (const backupName of backupFiles) {
    const backupPath = path.join(targetFamiliesDir, backupName);
    const originalPath = backupPath.replace(/\.huistrap-original$/, '');
    try {
      fs.copyFileSync(backupPath, originalPath);
      fs.unlinkSync(backupPath);
    } catch (err) {
      console.log(`[Huistrap] Could not restore font family (${backupName}):`, err.message);
    }
  }
}

function launchRoblox(versionDir, launchArgs, accountMeta) {
  const exePath = path.join(versionDir, 'RobloxPlayerBeta.exe');
  if (!fs.existsSync(exePath)) {
    throw new Error(`RobloxPlayerBeta.exe not found in ${versionDir}`);
  }
  writeClientAppSettings(versionDir);
  applyModifications(versionDir);
  const args = launchArgs ? [launchArgs] : [];
  const preLaunchLogs = listRecentPlayerLogs(2 * 60 * 60 * 1000).map((l) => l.full);
  const child = spawn(exePath, args, { detached: true, stdio: 'ignore', cwd: versionDir });
  child.unref();
  registerLaunchedInstance({
    pid: child.pid || null,
    userId: accountMeta && accountMeta.userId,
    username: accountMeta && accountMeta.username,
    displayName: accountMeta && accountMeta.displayName,
    preLaunchLogs
  });
  startActivityTray();
  return child;
}

function launchRobloxStudio(versionDir) {
  const exePath = path.join(versionDir, 'RobloxStudioBeta.exe');
  if (!fs.existsSync(exePath)) {
    throw new Error(`RobloxStudioBeta.exe not found in ${versionDir}`);
  }
  writeClientAppSettings(versionDir);
  applyModifications(versionDir);
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore', cwd: versionDir });
    let settled = false;
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      if (code !== null && code !== 0) {
        reject(new Error(`Roblox Studio exited immediately with code ${code}. Installation may be corrupted.`));
      } else {
        child.unref();
        resolve();
      }
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    }, 3000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 260,
    resizable: false,
    frame: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('index.html');
}

function resizeWindow(width, height) {
  if (!mainWindow) return;
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(width, height);
  mainWindow.setMaximumSize(width, height);
  mainWindow.setSize(width, height);
  mainWindow.setResizable(false);
  mainWindow.center();
}

function findAnyInstalledVersion(dir, exeName) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const entry of entries) {
    if (fs.existsSync(path.join(dir, entry.name, exeName))) {
      return entry.name;
    }
  }
  return null;
}

async function resolveProtocolLaunch(protocolUri, forceDownload) {
  // Roblox expects the entire "roblox-player:1+launchmode:play+..." URI,
  // prefix included, passed through unmodified as the single argument to
  // RobloxPlayerBeta.exe - it uses the "roblox-player:" prefix itself to
  // recognize the argument as a valid launch URI.
  ensureDirs();
  const latest = await getLatestVersionInfo('WindowsPlayer');

  let installedVersion = settings.installedVersion;
  let installedDir = installedVersion ? path.join(settings.versionsDir, installedVersion) : null;
  let installedExists = installedDir && fs.existsSync(path.join(installedDir, 'RobloxPlayerBeta.exe'));

  if (!installedExists) {
    const foundVersion = findAnyInstalledVersion(settings.versionsDir, 'RobloxPlayerBeta.exe');
    if (foundVersion) {
      installedVersion = foundVersion;
      installedDir = path.join(settings.versionsDir, foundVersion);
      installedExists = true;
      settings.installedVersion = foundVersion;
      saveSettings();
    }
  }

  const upToDate = installedExists && installedVersion === latest.version;

  if (!forceDownload && upToDate) {
    launchRoblox(installedDir, protocolUri);
    return { status: 'launched', version: installedVersion };
  }

  if (!forceDownload && installedExists && !upToDate) {
    return {
      status: 'update-available',
      installedVersion,
      latestVersion: latest.version,
      hasAnyInstalled: true
    };
  }

  // forceDownload or nothing installed → download latest
  if (mainWindow) mainWindow.webContents.send('huistrap:protocol-launch-downloading');
  const dir = await downloadRobloxVersion(latest.guid, (data) => {
    if (mainWindow) mainWindow.webContents.send('huistrap:progress', data);
  });
  settings.installedVersion = latest.version;
  saveSettings();
  launchRoblox(dir, protocolUri);
  return { status: 'launched', version: latest.version };
}

async function handleProtocolLaunch(protocolUri) {
  const isNewWindow = !mainWindow || mainWindow.isDestroyed();
  if (isNewWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();

  const runLaunch = async () => {
    pendingProtocolUri = protocolUri;
    mainWindow.webContents.send('huistrap:protocol-launch-started');
    try {
      const result = await resolveProtocolLaunch(protocolUri, false);
      if (result.status === 'update-available') {
        mainWindow.webContents.send('huistrap:protocol-update-available', {
          installedVersion: result.installedVersion,
          latestVersion: result.latestVersion,
          hasAnyInstalled: result.hasAnyInstalled
        });
        return;
      }
      pendingProtocolUri = null;
      mainWindow.webContents.send('huistrap:protocol-launch-done');
    } catch (err) {
      pendingProtocolUri = null;
      mainWindow.webContents.send('huistrap:protocol-launch-failed', err.message || String(err));
    }
  };

  if (isNewWindow) {
    mainWindow.webContents.once('did-finish-load', runLaunch);
  } else {
    await runLaunch();
  }
}

function readAccounts() {
  try {
    const raw = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
}

function readSavedGames() {
  try {
    const raw = JSON.parse(fs.readFileSync(savedGamesFile, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeSavedGames(games) {
  if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(savedGamesFile, JSON.stringify(games, null, 2));
}

function parsePlaceId(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  const fromUrl = s.match(/roblox\.com\/(?:games|experiences)\/(\d+)/i);
  if (fromUrl) return fromUrl[1];
  const fromQuery = s.match(/[?&]placeId=(\d+)/i);
  if (fromQuery) return fromQuery[1];
  if (/^\d+$/.test(s)) return s;
  return null;
}

function parseJobId(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  const uuid = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  return s;
}

function buildPlayerLaunchUri(ticket, opts) {
  const options = opts || {};
  const trackerId = String(Date.now());
  const parts = [
    'roblox-player:1',
    'launchmode:play',
    `gameinfo:${ticket}`,
    `launchtime:${Date.now()}`
  ];

  let launcherUrl = null;
  if (options.followUserId) {
    launcherUrl = `https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestFollowUser&browserTrackerId=${trackerId}&userId=${options.followUserId}`;
  } else if (options.placeId && options.jobId) {
    launcherUrl = `https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGameJob&browserTrackerId=${trackerId}&placeId=${options.placeId}&gameId=${options.jobId}&isPlayTogetherGame=false`;
  } else if (options.placeId) {
    launcherUrl = `https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGame&browserTrackerId=${trackerId}&placeId=${options.placeId}&isPlayTogetherGame=false`;
  }

  if (launcherUrl) {
    parts.push(`placelauncherurl:${encodeURIComponent(launcherUrl)}`);
  }

  parts.push(`browsertrackerid:${trackerId}`);
  parts.push('robloxLocale:en_us');
  parts.push('gameLocale:en_us');
  parts.push('channel:');
  parts.push('LaunchExp:InApp');
  return parts.join('+');
}

async function fetchAccountsPresence(accounts) {
  const result = {};
  if (!accounts.length) return result;
  const cookie = getAnySavedRobloxCookie();
  if (!cookie) return result;
  try {
    const res = await robloxRequest(
      'POST',
      'https://presence.roblox.com/v1/presence/users',
      cookie,
      { Referer: 'https://www.roblox.com/', Origin: 'https://www.roblox.com' },
      JSON.stringify({ userIds: accounts.map((a) => Number(a.userId)).filter((id) => Number.isFinite(id)) })
    );
    if (res.statusCode !== 200) return result;
    let data;
    try { data = JSON.parse(res.body); } catch { return result; }
    const rows = Array.isArray(data && data.userPresences) ? data.userPresences : [];
    for (const row of rows) {
      const type = Number(row.userPresenceType);
      let status = 'offline';
      if (type === 2) status = 'ingame';
      else if (type === 3) status = 'studio';
      else if (type === 1) status = 'online';
      result[String(row.userId)] = {
        status,
        lastLocation: row.lastLocation || null,
        placeId: row.placeId ? String(row.placeId) : null,
        rootPlaceId: row.rootPlaceId ? String(row.rootPlaceId) : null,
        jobId: row.gameId ? String(row.gameId) : null,
        universeId: row.universeId || null
      };
    }
  } catch (err) {
    console.log('[Huistrap] Presence lookup failed:', err.message);
  }
  return result;
}

function encryptCookie(cookie) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is not available on this system.');
  }
  return safeStorage.encryptString(cookie).toString('base64');
}

function decryptCookie(encoded) {
  return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
}

function robloxRequest(method, url, cookie, extraHeaders, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    // Roblox's auth endpoints reject POSTs that don't declare a media type,
    // even when there's no meaningful payload - so always send *something*
    // with a matching Content-Type/Content-Length on POST requests.
    const payload = body !== undefined ? body : (method === 'POST' ? '{}' : undefined);
    const headers = {
      'User-Agent': 'Huistrap/1.0',
      Cookie: `.ROBLOSECURITY=${cookie}`,
      ...(payload !== undefined ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}),
      ...(extraHeaders || {})
    };
    const request = https.request(target, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Timeout.')));
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

async function fetchAccountForCookie(cookie) {
  const res = await robloxRequest('GET', 'https://users.roblox.com/v1/users/authenticated', cookie, { Referer: 'https://www.roblox.com/' });
  if (res.statusCode !== 200) return null;
  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    return null;
  }
  if (!data || !data.id || !data.name) return null;
  return { userId: data.id, username: data.name, displayName: data.displayName || data.name, cookie };
}

async function fetchAvatarThumbnails(userIds) {
  if (!userIds.length) return {};
  const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userIds.join(',')}&size=150x150&format=Png&isCircular=true`;
  try {
    const data = await httpGetJson(url);
    const map = {};
    for (const entry of data.data || []) {
      if (entry.state === 'Completed' && entry.imageUrl) map[entry.targetId] = entry.imageUrl;
    }
    return map;
  } catch {
    return {};
  }
}

function describeTicketFailure(res) {
  // Roblox responds with a machine-readable reason whenever it refuses to
  // hand out a ticket. Surface that instead of a single generic message so
  // "expired session" (fixable by re-adding the account) doesn't get
  // confused with things re-adding the account can't fix.
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(res.body);
  } catch {
    // Non-JSON body - fall through and use the raw status/body instead.
  }
  const apiMessage = parsedBody && Array.isArray(parsedBody.errors) && parsedBody.errors[0]
    ? parsedBody.errors[0].message
    : null;

  const challengeId = res.headers['rbx-challenge-id'] || res.headers['rbx-challenge-metadata'];
  if (challengeId || /challenge|two-?step|verification/i.test(apiMessage || '')) {
    return 'Roblox is asking this account to complete an additional security check (such as two-step verification) '
      + 'before it will issue a launch ticket. Huistrap can\'t complete that check for you - sign in to this account '
      + 'once at roblox.com in a normal browser, clear any verification prompt, then try launching from Huistrap again.';
  }

  if (res.statusCode === 429) {
    return 'Roblox is rate-limiting authentication-ticket requests right now. Wait a minute and try again.';
  }

  if (res.statusCode === 401 || res.statusCode === 403) {
    return `The saved session was rejected by Roblox (${apiMessage || `HTTP ${res.statusCode}`}). `
      + 'The saved session has likely expired - remove and re-add this account.';
  }

  return `Could not create an authentication ticket (HTTP ${res.statusCode}${apiMessage ? `: ${apiMessage}` : ''}).`;
}

async function getAuthenticationTicket(cookie) {
  const ticketReferer = 'https://www.roblox.com/games';
  const primer = await robloxRequest('POST', 'https://auth.roblox.com/v1/authentication-ticket', cookie, { Referer: ticketReferer });
  const csrfToken = primer.headers['x-csrf-token'];
  if (!csrfToken) {
    const reason = describeTicketFailure(primer);
    console.error('[Huistrap] Auth ticket priming request failed:', primer.statusCode, primer.body?.slice(0, 500));
    throw new Error(primer.statusCode === 401
      ? 'The saved session has expired - remove and re-add this account.'
      : `Could not obtain a CSRF token. ${reason}`);
  }
  const res = await robloxRequest('POST', 'https://auth.roblox.com/v1/authentication-ticket', cookie, {
    Referer: ticketReferer,
    'X-CSRF-TOKEN': csrfToken
  });
  const ticket = res.headers['rbx-authentication-ticket'];
  if (res.statusCode !== 200 || !ticket) {
    console.error('[Huistrap] Auth ticket request failed:', res.statusCode, res.body?.slice(0, 500));
    throw new Error(describeTicketFailure(res));
  }
  return ticket;
}

function addAccountViaLogin() {
  return new Promise((resolve, reject) => {
    const loginWin = new BrowserWindow({
      width: 480,
      height: 680,
      parent: mainWindow || undefined,
      modal: !!mainWindow,
      resizable: false,
      show: false,
      autoHideMenuBar: true,
      title: 'Sign in to Roblox',
      icon: path.join(__dirname, 'icon.png'),
      webPreferences: {
        partition: `login-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    let settled = false;
    let pollTimer = null;

    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (!loginWin.isDestroyed()) loginWin.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    pollTimer = setInterval(async () => {
      if (settled || loginWin.isDestroyed()) return;
      try {
        const cookies = await loginWin.webContents.session.cookies.get({ name: '.ROBLOSECURITY', domain: '.roblox.com' });
        if (!cookies[0]) return;
        const account = await fetchAccountForCookie(cookies[0].value);
        if (account) finish(account);
      } catch {
        // Session cookie not valid yet - keep polling until the window closes.
      }
    }, 1000);

    loginWin.on('closed', () => finish(null, new Error('Sign-in was cancelled.')));
    loginWin.once('ready-to-show', () => loginWin.show());
    loginWin.loadURL('https://www.roblox.com/login').catch((err) => finish(null, err));
  });
}

function isDiscordProtocolRegistered() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(false);
      return;
    }
    execFile('reg', ['query', 'HKCR\\discord'], (err) => resolve(!err));
  });
}

ipcMain.handle('huistrap:check', async () => {
  ensureDirs();
  const latest = await getLatestVersionInfo('WindowsPlayer');

  let installedVersion = settings.installedVersion;
  let installedDir = installedVersion ? path.join(settings.versionsDir, installedVersion) : null;
  let installedExists = installedDir && fs.existsSync(path.join(installedDir, 'RobloxPlayerBeta.exe'));

  if (!installedExists) {
    const foundVersion = findAnyInstalledVersion(settings.versionsDir, 'RobloxPlayerBeta.exe');
    if (foundVersion) {
      installedVersion = foundVersion;
      settings.installedVersion = foundVersion;
      saveSettings();
      installedExists = true;
    }
  }

  return {
    latestVersion: latest.version,
    installedVersion,
    updateAvailable: !installedExists || installedVersion !== latest.version,
    hasAnyInstalled: installedExists
  };
});

ipcMain.handle('huistrap:launch-installed', async () => {
  if (!settings.installedVersion) throw new Error('No installed version available.');
  const dir = path.join(settings.versionsDir, settings.installedVersion);
  launchRoblox(dir);
  return { ok: true };
});

ipcMain.handle('huistrap:download-and-launch', async () => {
  const latest = await getLatestVersionInfo('WindowsPlayer');
  const dir = await downloadRobloxVersion(latest.guid, (data) => {
    mainWindow.webContents.send('huistrap:progress', data);
  });
  settings.installedVersion = latest.version;
  saveSettings();
  launchRoblox(dir);
  return { ok: true };
});

ipcMain.handle('huistrap:launch-studio', async () => {
  ensureDirs();
  const latest = await getLatestVersionInfo('WindowsStudio64');

  let installedStudioVersion = settings.installedStudioVersion;
  let installedDir = installedStudioVersion ? path.join(settings.studioVersionsDir, installedStudioVersion) : null;
  let installedExists = installedDir && fs.existsSync(path.join(installedDir, 'RobloxStudioBeta.exe'));

  if (!installedExists) {
    const foundVersion = findAnyInstalledVersion(settings.studioVersionsDir, 'RobloxStudioBeta.exe');
    if (foundVersion) {
      installedStudioVersion = foundVersion;
      settings.installedStudioVersion = foundVersion;
      saveSettings();
      installedDir = path.join(settings.studioVersionsDir, foundVersion);
      installedExists = true;
    }
  }

  if (installedExists && installedStudioVersion === latest.version) {
    await launchRobloxStudio(installedDir);
    return { ok: true, downloaded: false };
  }

  const dir = await downloadStudioVersion(latest.guid, (data) => {
    mainWindow.webContents.send('huistrap:progress', data);
  });
  settings.installedStudioVersion = latest.version;
  saveSettings();
  await launchRobloxStudio(dir);
  return { ok: true, downloaded: true };
});

ipcMain.handle('huistrap:accounts-list', async () => {
  const accounts = readAccounts();
  const [thumbnails, presence] = await Promise.all([
    fetchAvatarThumbnails(accounts.map((a) => a.userId)),
    fetchAccountsPresence(accounts)
  ]);
  const instances = summarizeInstances();
  return accounts.map((a) => ({
    userId: a.userId,
    username: a.username,
    displayName: a.displayName,
    avatarUrl: thumbnails[a.userId] || null,
    presence: presence[String(a.userId)] || { status: 'unknown' },
    instance: instances.find((i) => i.alive && String(i.userId) === String(a.userId)) || null
  }));
});

ipcMain.handle('huistrap:accounts-add', async () => {
  const account = await addAccountViaLogin();
  const accounts = readAccounts().filter((a) => a.userId !== account.userId);
  accounts.push({
    userId: account.userId,
    username: account.username,
    displayName: account.displayName,
    cookieEnc: encryptCookie(account.cookie)
  });
  writeAccounts(accounts);
  return { userId: account.userId, username: account.username, displayName: account.displayName };
});

ipcMain.handle('huistrap:accounts-remove', (event, userId) => {
  const accounts = readAccounts().filter((a) => a.userId !== userId);
  writeAccounts(accounts);
  return { ok: true };
});

ipcMain.handle('huistrap:accounts-reorder', (event, orderedUserIds) => {
  const accounts = readAccounts();
  const byId = new Map(accounts.map((a) => [a.userId, a]));
  const reordered = [];
  for (const id of orderedUserIds || []) {
    if (byId.has(id)) {
      reordered.push(byId.get(id));
      byId.delete(id);
    }
  }
  for (const remaining of byId.values()) reordered.push(remaining);
  writeAccounts(reordered);
  return { ok: true };
});

ipcMain.handle('huistrap:accounts-launch', async (event, userId, options) => {
  const opts = options || {};
  const accounts = readAccounts();
  const account = accounts.find((a) => a.userId === userId);
  if (!account) throw new Error('Account not found. It may have been removed.');

  ensureDirs();
  const latest = await getLatestVersionInfo('WindowsPlayer');
  let installedVersion = settings.installedVersion;
  let installedDir = installedVersion ? path.join(settings.versionsDir, installedVersion) : null;
  let installedExists = installedDir && fs.existsSync(path.join(installedDir, 'RobloxPlayerBeta.exe'));

  // Only auto-downloads a newer version when the caller didn't ask to stick
  // with what's already installed (useInstalled - set after the person
  // explicitly confirms the update prompt in the renderer).
  let dir;
  if (installedExists && (opts.useInstalled || installedVersion === latest.version)) {
    dir = installedDir;
  } else {
    mainWindow.webContents.send('huistrap:account-launch-downloading');
    dir = await downloadRobloxVersion(latest.guid, (data) => {
      mainWindow.webContents.send('huistrap:progress', data);
    });
    settings.installedVersion = latest.version;
    saveSettings();
  }

  // Ticket is requested last, right before launch, since it's single-use
  // and short-lived - fetching it before a potentially long download would
  // risk it expiring before Roblox ever gets to use it.
  const cookie = decryptCookie(account.cookieEnc);
  const ticket = await getAuthenticationTicket(cookie);

  const placeId = parsePlaceId(opts.placeId);
  const jobId = parseJobId(opts.jobId);
  const followUserId = opts.followUserId ? String(opts.followUserId) : null;
  const launchUri = buildPlayerLaunchUri(ticket, { placeId, jobId, followUserId });
  launchRoblox(dir, launchUri, {
    userId: account.userId,
    username: account.username,
    displayName: account.displayName
  });
  return { ok: true, username: account.username, displayName: account.displayName };
});

ipcMain.handle('huistrap:accounts-open-browser', async (event, userId) => {
  const accounts = readAccounts();
  const account = accounts.find((a) => a.userId === userId);
  if (!account) throw new Error('Account not found. It may have been removed.');
  const cookie = decryptCookie(account.cookieEnc);

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: `${account.displayName || account.username} — Roblox`,
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      partition: `persist:roblox-account-${account.userId}`,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const ses = win.webContents.session;
  const cookieBase = {
    name: '.ROBLOSECURITY',
    value: cookie,
    domain: '.roblox.com',
    path: '/',
    httpOnly: true,
    secure: true
  };
  await ses.cookies.set({ ...cookieBase, url: 'https://www.roblox.com' });
  await ses.cookies.set({ ...cookieBase, url: 'https://roblox.com' });
  win.loadURL('https://www.roblox.com/home');
  return { ok: true };
});

ipcMain.handle('huistrap:accounts-presence', async () => {
  const accounts = readAccounts();
  return fetchAccountsPresence(accounts);
});

ipcMain.handle('huistrap:accounts-kill', async (event, userId) => {
  return killInstancesForUser(userId);
});

ipcMain.handle('huistrap:instances-list', () => {
  return summarizeInstances();
});

ipcMain.handle('huistrap:saved-games-list', () => {
  return readSavedGames();
});

ipcMain.handle('huistrap:saved-games-save', (event, placeId, name) => {
  const id = parsePlaceId(placeId);
  if (!id) throw new Error('Enter a valid Game ID (or a roblox.com/games URL).');
  const label = String(name || '').trim() || `Place ${id}`;
  const games = readSavedGames();
  const existing = games.find((g) => String(g.placeId) === id);
  if (existing) {
    existing.name = label;
  } else {
    games.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      placeId: id,
      name: label
    });
  }
  writeSavedGames(games);
  return games;
});

ipcMain.handle('huistrap:saved-games-rename', (event, gameId, name) => {
  const label = String(name || '').trim();
  if (!label) throw new Error('Name cannot be empty.');
  const games = readSavedGames();
  const row = games.find((g) => g.id === gameId || String(g.placeId) === String(gameId));
  if (!row) throw new Error('Saved game not found.');
  row.name = label;
  writeSavedGames(games);
  return games;
});

ipcMain.handle('huistrap:saved-games-remove', (event, gameId) => {
  const games = readSavedGames().filter((g) => g.id !== gameId && String(g.placeId) !== String(gameId));
  writeSavedGames(games);
  return games;
});

ipcMain.handle('huistrap:get-settings', () => {
  const updateState = readUpdateState();
  return {
    ...settings,
    installedVersions: listInstalledVersions(settings.versionsDir),
    installedStudioVersions: listInstalledVersions(settings.studioVersionsDir),
    appVersion: APP_VERSION,
    lastAppliedVersion: updateState.lastAppliedVersion || null,
    lastAppliedAt: updateState.phase === 'applied' ? updateState.timestamp : null
  };
});

ipcMain.handle('huistrap:check-app-update-now', async () => {
  const manifest = await checkForAppUpdate();
  if (!manifest) {
    pendingAppUpdate = null;
    let reason = 'No update available. You have the current version.';
    try {
      const remote = await httpGetJson(UPDATE_MANIFEST_URL);
      if (remote && remote.version && remote.version.trim() !== APP_VERSION.trim()) {
        reason = `Update ${remote.version} was found but skipped (already applied or incomplete manifest).`;
      }
    } catch {
      reason = 'No update available (repo unreachable or empty).';
    }
    return { updateAvailable: false, message: reason };
  }
  pendingAppUpdate = manifest;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('huistrap:app-update-available', manifest.version);
  }
  return { updateAvailable: true, version: manifest.version };
});

ipcMain.handle('huistrap:get-pending-app-update', () => {
  if (!pendingAppUpdate) return null;
  return { version: pendingAppUpdate.version };
});

ipcMain.handle('huistrap:install-app-update', async () => {
  if (!pendingAppUpdate) {
    const manifest = await checkForAppUpdate();
    if (!manifest) throw new Error('No update is available.');
    pendingAppUpdate = manifest;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('huistrap:app-update-found', pendingAppUpdate.version);
  }
  try {
    await performSelfUpdate(pendingAppUpdate);
    return { ok: true };
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('huistrap:app-update-failed', err.message || String(err));
    }
    throw err;
  }
});

ipcMain.handle('huistrap:set-channel', (event, channel) => {
  settings.channel = channel;
  saveSettings();
  return { ok: true };
});

ipcMain.handle('huistrap:set-concurrency', (event, value) => {
  const n = parseInt(value, 10);
  settings.downloadConcurrency = Number.isFinite(n) && n > 0 ? n : 8;
  saveSettings();
  return { ok: true };
});

ipcMain.handle('huistrap:set-fps-cap', (event, value) => {
  const n = parseInt(value, 10);
  settings.fpsCap = Number.isFinite(n) && n > 0 ? n : null;
  saveSettings();
  return { ok: true };
});

ipcMain.handle('huistrap:set-fflags', (event, flags) => {
  if (typeof flags !== 'object' || flags === null || Array.isArray(flags)) {
    throw new Error('FastFlags must be an object of flag name/value pairs.');
  }
  const clean = {};
  for (const [key, value] of Object.entries(flags)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`Invalid value for flag "${trimmedKey}".`);
    }
    clean[trimmedKey] = value;
  }
  settings.fastFlags = clean;
  saveSettings();
  return { ok: true, fastFlags: settings.fastFlags };
});

ipcMain.handle('huistrap:get-exploits', async () => {
  try {
    const list = await fetchExploitsList();
    return { ok: true, exploits: list, selected: settings.selectedExploit || null };
  } catch (err) {
    return { ok: false, error: err.message || String(err), exploits: [], selected: settings.selectedExploit || null };
  }
});

ipcMain.handle('huistrap:set-selected-exploit', (event, title) => {
  settings.selectedExploit = title ? String(title) : null;
  saveSettings();
  return { ok: true, selected: settings.selectedExploit };
});

ipcMain.handle('huistrap:get-exploit-status', async () => {
  const selected = settings.selectedExploit;
  if (!selected) {
    return { ok: true, selected: null, updateStatus: null, version: null };
  }
  try {
    const list = await fetchExploitsList();
    const match = list.find((e) => e.title === selected);
    if (!match) {
      return { ok: true, selected, updateStatus: null, version: null, notFound: true };
    }
    return {
      ok: true,
      selected,
      updateStatus: match.updateStatus,
      version: match.version,
      platform: match.platform,
      detected: match.detected,
      updatedDate: match.updatedDate,
      rbxversion: match.rbxversion
    };
  } catch (err) {
    return { ok: false, selected, error: err.message || String(err), updateStatus: null };
  }
});

ipcMain.handle('huistrap:get-pending-changelog', async () => {
  const state = readUpdateState();
  if (!state.changelogPending || !state.lastAppliedVersion) return null;
  const changelog = await fetchChangelogForVersion(state.lastAppliedVersion);
  return { version: state.lastAppliedVersion, changelog };
});

ipcMain.handle('huistrap:mark-changelog-shown', () => {
  const state = readUpdateState();
  if (state.changelogPending) {
    writeUpdateState({ ...state, changelogPending: false });
  }
  return { ok: true };
});

ipcMain.handle('huistrap:preview-changelog', async () => {
  const changelog = await fetchChangelogForVersion(APP_VERSION.trim());
  return { version: APP_VERSION.trim(), changelog };
});

ipcMain.handle('huistrap:open-discord', async () => {
  try {
    const hasDiscordApp = await isDiscordProtocolRegistered();
    if (hasDiscordApp) {
      await shell.openExternal(DISCORD_APP_URI);
      return { ok: true, target: 'app' };
    }
  } catch {
    // Falls through to the browser fallback below.
  }
  await shell.openExternal(DISCORD_INVITE_URL);
  return { ok: true, target: 'browser' };
});

function migrateDir(oldDir, newDir) {
  if (fs.existsSync(oldDir)) {
    fs.mkdirSync(newDir, { recursive: true });
    const entries = fs.readdirSync(oldDir, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(oldDir, entry.name);
      const dest = path.join(newDir, entry.name);
      fs.cpSync(src, dest, { recursive: true });
    }
    fs.rmSync(oldDir, { recursive: true, force: true });
  } else {
    fs.mkdirSync(newDir, { recursive: true });
  }
}

ipcMain.handle('huistrap:change-versions-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose storage location for Roblox versions'
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };

  const newDir = result.filePaths[0];
  const oldDir = settings.versionsDir;
  if (path.resolve(newDir) === path.resolve(oldDir)) return { ok: false };

  mainWindow.webContents.send('huistrap:migration-progress', { status: 'started' });
  migrateDir(oldDir, newDir);
  settings.versionsDir = newDir;
  saveSettings();
  mainWindow.webContents.send('huistrap:migration-progress', { status: 'done' });
  return { ok: true, newDir };
});

ipcMain.handle('huistrap:open-versions-dir', () => {
  shell.openPath(settings.versionsDir);
});

ipcMain.handle('huistrap:change-studio-versions-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose storage location for Roblox Studio versions'
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };

  const newDir = result.filePaths[0];
  const oldDir = settings.studioVersionsDir;
  if (path.resolve(newDir) === path.resolve(oldDir)) return { ok: false };

  mainWindow.webContents.send('huistrap:migration-progress', { status: 'started' });
  migrateDir(oldDir, newDir);
  settings.studioVersionsDir = newDir;
  saveSettings();
  mainWindow.webContents.send('huistrap:migration-progress', { status: 'done' });
  return { ok: true, newDir };
});

ipcMain.handle('huistrap:open-studio-versions-dir', () => {
  shell.openPath(settings.studioVersionsDir);
});

ipcMain.handle('huistrap:choose-custom-font', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose font',
    filters: [{ name: 'TrueType Font', extensions: ['ttf'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };

  const sourcePath = result.filePaths[0];
  const fileName = path.basename(sourcePath);

  if (!fs.existsSync(modFontsDir)) fs.mkdirSync(modFontsDir, { recursive: true });

  try {
    fs.copyFileSync(sourcePath, path.join(modFontsDir, CUSTOM_FONT_FILENAME));
  } catch (err) {
    throw new Error(`Could not copy font: ${err.message}`);
  }

  settings.customFontName = fileName;
  saveSettings();
  return { ok: true, fontName: fileName };
});

ipcMain.handle('huistrap:clear-custom-font', () => {
  const customFontPath = path.join(modFontsDir, CUSTOM_FONT_FILENAME);
  if (fs.existsSync(customFontPath)) fs.unlinkSync(customFontPath);

  if (settings.installedVersion) {
    const versionDir = path.join(settings.versionsDir, settings.installedVersion);
    restoreOriginalFonts(versionDir);
  }
  if (settings.installedStudioVersion) {
    const studioDir = path.join(settings.studioVersionsDir, settings.installedStudioVersion);
    restoreOriginalFonts(studioDir);
  }

  settings.customFontName = null;
  saveSettings();
  return { ok: true };
});

ipcMain.handle('huistrap:resize-home', () => {
  resizeWindow(600, 260);
});

ipcMain.handle('huistrap:resize-flow', () => {
  resizeWindow(520, 320);
});

ipcMain.handle('huistrap:resize-modal', () => {
  resizeWindow(600, 540);
});

ipcMain.handle('huistrap:resize-credits', () => {
  resizeWindow(600, 440);
});

ipcMain.handle('huistrap:resize-accounts', () => {
  resizeWindow(980, 640);
});

ipcMain.handle('huistrap:resize-settings', () => {
  resizeWindow(960, 580);
});

ipcMain.handle('huistrap:set-cursor', (event, cursorType) => {
  const allowed = ['default', 'From2006', 'From2013'];
  settings.cursorType = allowed.includes(cursorType) ? cursorType : 'default';
  saveSettings();
  return { ok: true, cursorType: settings.cursorType };
});

ipcMain.handle('huistrap:protocol-download-and-launch', async () => {
  if (!pendingProtocolUri) throw new Error('No pending protocol launch.');
  const uri = pendingProtocolUri;
  try {
    await resolveProtocolLaunch(uri, true);
    pendingProtocolUri = null;
    return { ok: true };
  } catch (err) {
    pendingProtocolUri = null;
    throw err;
  }
});

ipcMain.handle('huistrap:protocol-launch-current', async () => {
  if (!pendingProtocolUri) throw new Error('No pending protocol launch.');
  const uri = pendingProtocolUri;
  ensureDirs();
  let installedVersion = settings.installedVersion;
  let installedDir = installedVersion ? path.join(settings.versionsDir, installedVersion) : null;
  if (!installedDir || !fs.existsSync(path.join(installedDir, 'RobloxPlayerBeta.exe'))) {
    const found = findAnyInstalledVersion(settings.versionsDir, 'RobloxPlayerBeta.exe');
    if (!found) throw new Error('No installed Roblox version found.');
    installedVersion = found;
    installedDir = path.join(settings.versionsDir, found);
    settings.installedVersion = found;
    saveSettings();
  }
  launchRoblox(installedDir, uri);
  pendingProtocolUri = null;
  return { ok: true };
});

ipcMain.handle('huistrap:protocol-cancel', () => {
  pendingProtocolUri = null;
  return { ok: true };
});

ipcMain.handle('huistrap:close', () => {
  // Hide to tray if activity tracking is on; otherwise quit
  if (settings && settings.enableActivityTray && trayIcon) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    return { ok: true, hidden: true };
  }
  app.quit();
  return { ok: true };
});

ipcMain.handle('huistrap:set-activity-tray', (event, enabled) => {
  settings.enableActivityTray = !!enabled;
  saveSettings();
  if (!settings.enableActivityTray) stopActivityTray();
  return { ok: true, enableActivityTray: settings.enableActivityTray };
});

// ---------------------------------------------------------------------------
// System tray activity (game name, thumbnail, playtime, RoValra region)
// ---------------------------------------------------------------------------
let trayIcon = null;
let activityWindow = null;
let activityWatcher = null;
let lastActivityPayload = null;
let trackedInstances = [];
let selectedInstanceId = null;

function httpGetBuffer(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Huistrap/1.2' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpGetBuffer(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
  });
}

function httpGetJsonAny(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Huistrap/1.2', Accept: 'application/json' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpGetJsonAny(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
  });
}

function formatPlaytime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function isPublicIp(ip) {
  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const p = ip.split('.').map(Number);
  if (p[0] === 10) return false;
  if (p[0] === 127) return false;
  if (p[0] === 0) return false;
  if (p[0] === 192 && p[1] === 168) return false;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
  if (p[0] === 169 && p[1] === 254) return false;
  return true;
}

function isRobloxPlayerRunning() {
  if (process.platform !== 'win32') return true;
  return listRobloxPlayerPids().length > 0;
}

let robloxPidCache = { at: 0, pids: [] };

function listRobloxPlayerPids() {
  if (Date.now() - robloxPidCache.at < 350) return robloxPidCache.pids.slice();
  if (process.platform !== 'win32') {
    robloxPidCache = { at: Date.now(), pids: [] };
    return [];
  }
  try {
    const out = require('child_process').execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq RobloxPlayerBeta.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 }
    );
    const pids = [];
    for (const line of String(out).split(/\r?\n/)) {
      const m = line.match(/"RobloxPlayerBeta\.exe","(\d+)"/i);
      if (m) pids.push(Number(m[1]));
    }
    robloxPidCache = { at: Date.now(), pids };
    return pids.slice();
  } catch {
    return robloxPidCache.pids.slice();
  }
}

function invalidateRobloxPidCache() {
  robloxPidCache = { at: 0, pids: [] };
}

function listRecentPlayerLogs(maxAgeMs) {
  const logDir = path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'logs');
  if (!fs.existsSync(logDir)) return [];
  const cutoff = Date.now() - (maxAgeMs || 6 * 60 * 60 * 1000);
  try {
    return fs.readdirSync(logDir)
      .filter((f) => f.endsWith('.log') && /Player/i.test(f))
      .map((f) => {
        const full = path.join(logDir, f);
        try {
          const st = fs.statSync(full);
          return { full, name: f, mtime: st.mtimeMs, size: st.size };
        } catch { return null; }
      })
      .filter((row) => row && row.mtime >= cutoff)
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

function findLatestRobloxPlayerLog() {
  const logDir = path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'logs');
  if (!fs.existsSync(logDir)) return null;
  // Prefer very recent logs (created in the last few minutes) so we don't
  // attach to an old session file.
  const now = Date.now();
  const files = fs.readdirSync(logDir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => {
      const full = path.join(logDir, f);
      try {
        const st = fs.statSync(full);
        return { full, name: f, mtime: st.mtimeMs };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return null;
  const player = files.find((f) => /Player/i.test(f.name));
  return (player || files[0]).full;
}

async function fetchPlaceMeta(placeId) {
  let name = null;
  let universeId = null;

  // 1) placeId → universeId (public, no auth)
  try {
    const uni = await httpGetJsonAny(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    if (uni && uni.universeId) universeId = uni.universeId;
  } catch (err) {
    console.log('[Huistrap] universe lookup failed:', err.message);
  }

  // 2) universeId → game name
  if (universeId) {
    try {
      const games = await httpGetJsonAny(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
      const row = games && Array.isArray(games.data) ? games.data[0] : null;
      if (row && row.name) name = row.name;
    } catch (err) {
      console.log('[Huistrap] games lookup failed:', err.message);
    }
  }

  // 3) fallback: asset details (still public for many places)
  if (!name) {
    try {
      const asset = await httpGetJsonAny(`https://economy.roblox.com/v2/assets/${placeId}/details`);
      if (asset && asset.Name) name = asset.Name;
    } catch (err) {
      console.log('[Huistrap] asset details failed:', err.message);
    }
  }

  return { name, universeId };
}

async function fetchGameThumbnail(universeId, placeId) {
  const tryUrl = async (url) => {
    if (!url) return null;
    const buf = await httpGetBuffer(url);
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const icon = img.resize({ width: 32, height: 32, quality: 'best' });
    const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
    return { icon, dataUrl };
  };

  try {
    if (universeId) {
      const data = await httpGetJsonAny(
        `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`
      );
      const url = data && data.data && data.data[0] && data.data[0].imageUrl;
      const got = await tryUrl(url);
      if (got) return got;
    }
  } catch (err) {
    console.log('[Huistrap] game icon failed:', err.message);
  }

  // Fallback: place asset thumbnail
  try {
    if (placeId) {
      const data = await httpGetJsonAny(
        `https://thumbnails.roblox.com/v1/assets?assetIds=${placeId}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`
      );
      const url = data && data.data && data.data[0] && data.data[0].imageUrl;
      const got = await tryUrl(url);
      if (got) return got;
    }
  } catch (err) {
    console.log('[Huistrap] asset icon failed:', err.message);
  }
  return null;
}

/** Server region via RoValra, with ip-api fallback */
function formatShortRegion(regionName, countryName, countryCode) {
  // Prefer "Texas, USA" style — skip city, shorten country when possible
  const country = (countryCode || countryName || '').toString().trim();
  const shortCountry = ({
    'United States': 'USA',
    'United States of America': 'USA',
    'United Kingdom': 'UK',
    'US': 'USA',
    'GB': 'UK'
  })[country] || country;
  const region = (regionName || '').toString().trim();
  if (region && shortCountry) return `${region}, ${shortCountry}`;
  if (shortCountry) return shortCountry;
  if (region) return region;
  return null;
}

async function fetchServerRegion(ip) {
  if (!isPublicIp(ip)) return null;
  try {
    const data = await httpGetJsonAny(`https://apis.rovalra.com/v1/geolocation?ip=${encodeURIComponent(ip)}`);
    if (data && data.status === 'success' && data.location) {
      const loc = data.location;
      const short = formatShortRegion(loc.region, loc.country_name, loc.country_code);
      if (short) return short;
    }
  } catch (err) {
    console.log('[Huistrap] RoValra geolocation failed:', err.message);
  }
  try {
    const data = await httpGetJsonAny(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city`);
    if (data && data.status === 'success') {
      const short = formatShortRegion(data.regionName, data.country, data.countryCode);
      if (short) return short;
    }
  } catch {}
  return null;
}


/** Server first_seen / uptime via RoValra */

function getAnySavedRobloxCookie() {
  try {
    const accounts = readAccounts();
    for (const a of accounts) {
      if (!a.cookieEnc) continue;
      try {
        const cookie = decryptCookie(a.cookieEnc);
        if (cookie) return cookie;
      } catch {}
    }
  } catch {}
  return null;
}

/**
 * Universal server uptime via Roblox gamejoin (ServerClaimedTime).
 * Works for any server when a saved account cookie is available.
 */
async function fetchGameJoinServerUptime(placeId, jobId) {
  if (!placeId || !jobId) return null;
  const cookie = getAnySavedRobloxCookie();
  if (!cookie) return null;

  try {
    const url = 'https://gamejoin.roblox.com/v1/join-game-instance';
    // CSRF primer
    const primer = await robloxRequest(
      'POST',
      url,
      cookie,
      { Referer: 'https://www.roblox.com/', Origin: 'https://www.roblox.com' },
      JSON.stringify({
        placeId: parseInt(placeId, 10),
        isTeleport: false,
        gameId: String(jobId),
        gameJoinAttemptId: '00000000-0000-4000-8000-000000000000'
      })
    );
    const csrf = primer.headers['x-csrf-token'];
    if (!csrf) {
      console.log('[Huistrap] gamejoin uptime: no CSRF', primer.statusCode);
      return null;
    }

    const attemptId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });

    const res = await robloxRequest(
      'POST',
      url,
      cookie,
      {
        Referer: 'https://www.roblox.com/',
        Origin: 'https://www.roblox.com',
        'X-CSRF-TOKEN': csrf
      },
      JSON.stringify({
        placeId: parseInt(placeId, 10),
        isTeleport: false,
        gameId: String(jobId),
        gameJoinAttemptId: attemptId
      })
    );

    if (res.statusCode !== 200) {
      console.log('[Huistrap] gamejoin uptime HTTP', res.statusCode, (res.body || '').slice(0, 200));
      return null;
    }

    let data;
    try { data = JSON.parse(res.body); } catch { return null; }

    let joinScript = data && data.joinScript;
    if (typeof joinScript === 'string') {
      try { joinScript = JSON.parse(joinScript); } catch { joinScript = null; }
    }
    if (!joinScript || typeof joinScript !== 'object') {
      // Sometimes nested under joinScript.Data / SessionId structures
      console.log('[Huistrap] gamejoin uptime: no joinScript, status=', data && data.status);
      return null;
    }

    const claimed =
      joinScript.ServerClaimedTime ||
      joinScript.serverClaimedTime ||
      (joinScript.Data && joinScript.Data.ServerClaimedTime) ||
      null;

    if (claimed == null) return null;
    let ts = Number(claimed);
    if (!Number.isFinite(ts)) return null;
    // Roblox has used seconds and ms at different times
    if (ts < 1e12) ts = ts * 1000;
    // Sanity: not in the future, not older than 30 days
    const now = Date.now();
    if (ts > now + 60000) return null;
    if (now - ts > 30 * 86400 * 1000) return null;

    return { firstSeenAt: ts, isEstimate: false };
  } catch (err) {
    console.log('[Huistrap] gamejoin uptime failed:', err.message);
    return null;
  }
}

/** Prefer gamejoin (any server); fall back to RoValra crowdsourced data. */
async function fetchServerUptimeAny(placeId, jobId, extraPlaceIds) {
  const viaJoin = await fetchGameJoinServerUptime(placeId, jobId);
  if (viaJoin) return viaJoin;
  return fetchRoValraServerUptime(placeId, jobId, extraPlaceIds);
}

async function fetchRoValraServerUptime(placeId, jobId, extraPlaceIds) {
  if (!jobId) return null;
  const placeIds = [];
  const add = (id) => {
    if (id == null || id === '') return;
    const s = String(id);
    if (!placeIds.includes(s)) placeIds.push(s);
  };
  add(placeId);
  if (Array.isArray(extraPlaceIds)) extraPlaceIds.forEach(add);

  // Blox Fruits (and similar) often teleport across places; RoValra indexes
  // many listings under the root place id.
  if (String(placeId) === '2753915549' || placeIds.includes('2753915549')) {
    add('2753915549');
    add('4442272183'); // common secondary BF place
  }

  const postSighting = (pid) => {
    try {
      const postBody = JSON.stringify({
        place_id: Number(pid) || pid,
        server_ids: [String(jobId)]
      });
      const req = https.request(
        {
          hostname: 'apis.rovalra.com',
          path: '/process_servers',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Huistrap/1.2',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(postBody)
          },
          timeout: 8000
        },
        (res) => { res.resume(); }
      );
      req.on('error', () => {});
      req.write(postBody);
      req.end();
    } catch {}
  };

  const parseFirstSeen = (row) => {
    if (!row || typeof row !== 'object') return null;
    const raw =
      row.first_seen ||
      row.firstSeen ||
      row.FirstSeen ||
      row.first_seen_at ||
      row.created_at ||
      row.createdAt ||
      null;
    if (!raw) return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      const ts = raw < 1e12 ? raw * 1000 : raw;
      return Number.isFinite(ts) ? ts : null;
    }
    const str = String(raw);
    const iso = str.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(str) ? str : str + 'Z';
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? ts : null;
  };

  const queryDetails = async (pid) => {
    const urls = [
      `https://apis.rovalra.com/v1/servers/details?place_id=${encodeURIComponent(pid)}&server_ids=${encodeURIComponent(jobId)}`,
      `https://apis.rovalra.com/v1/server_details?place_id=${encodeURIComponent(pid)}&server_ids=${encodeURIComponent(jobId)}`
    ];
    for (const url of urls) {
      try {
        const data = await httpGetJsonAny(url, 10000);
        if (!data || !Array.isArray(data.servers) || !data.servers.length) continue;
        const row =
          data.servers.find((s) => String(s.server_id || s.serverId || s.id) === String(jobId)) ||
          data.servers[0];
        const ts = parseFirstSeen(row);
        if (ts) return { firstSeenAt: ts, isEstimate: true };
      } catch (err) {
        console.log('[Huistrap] RoValra details failed:', err.message);
      }
    }
    return null;
  };

  try {
    for (const pid of placeIds) postSighting(pid);
    await new Promise((r) => setTimeout(r, 1000));
    for (const pid of placeIds) {
      const result = await queryDetails(pid);
      if (result) return result;
    }
    for (const pid of placeIds) postSighting(pid);
    await new Promise((r) => setTimeout(r, 2000));
    for (const pid of placeIds) {
      const result = await queryDetails(pid);
      if (result) return result;
    }
    return null;
  } catch (err) {
    console.log('[Huistrap] RoValra uptime failed:', err.message);
    return null;
  }
}

function formatServerUptime(firstSeenAt) {
  if (!firstSeenAt) return null;
  const sec = Math.max(0, Math.floor((Date.now() - firstSeenAt) / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function openHuistrapMainWindow() {
  hideActivityPanel();
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('huistrap:show-home');
    });
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('huistrap:show-home');
  }
}

function nextInstanceId() {
  return `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function instanceLabel(inst) {
  if (!inst) return 'Instance';
  if (inst.displayName) return inst.displayName;
  if (inst.username) return inst.username;
  if (inst.session && inst.session.placeName) return inst.session.placeName;
  return 'Instance';
}

function instanceHasLiveProcess(inst) {
  if (!inst || !inst.pid) return false;
  return listRobloxPlayerPids().includes(Number(inst.pid));
}

function getSelectedInstance() {
  if (!trackedInstances.length) return null;
  let inst = trackedInstances.find((i) => i.id === selectedInstanceId);
  if (!inst) {
    inst = trackedInstances.find((i) => i.session && i.session.inGame) || trackedInstances[0];
    selectedInstanceId = inst.id;
  }
  return inst;
}

function selectTrackedInstance(id) {
  if (!id) return getSelectedInstance();
  const inst = trackedInstances.find((i) => i.id === id);
  if (inst) selectedInstanceId = inst.id;
  pushActivityUpdate();
  return inst || getSelectedInstance();
}

function createTrackedInstance(partial) {
  const inst = {
    id: nextInstanceId(),
    pid: null,
    preLaunchLogs: [],
    userId: null,
    username: null,
    displayName: null,
    launchedAt: Date.now(),
    logPath: null,
    offset: 0,
    pendingJoin: null,
    pendingSince: 0,
    leaveTimer: null,
    session: { inGame: false },
    seenRoblox: false,
    ...partial
  };
  trackedInstances.push(inst);
  if (!selectedInstanceId) selectedInstanceId = inst.id;
  return inst;
}

function registerLaunchedInstance(meta) {
  const userId = meta && meta.userId != null ? String(meta.userId) : null;
  if (userId) {
    const existingLive = trackedInstances.find(
      (i) => String(i.userId) === userId && (instanceHasLiveProcess(i) || (i.session && i.session.inGame))
    );
    if (existingLive) {
      // Roblox redirects a same-account relaunch to the already-running window
      // and the new process exits itself after a couple seconds — don't track
      // it as its own (unkillable, name-less) instance.
      selectedInstanceId = existingLive.id;
      broadcastInstances();
      pushActivityUpdate();
      return existingLive;
    }
  }
  const inst = createTrackedInstance({
    pid: meta && meta.pid ? Number(meta.pid) : null,
    userId,
    username: (meta && meta.username) || null,
    displayName: (meta && meta.displayName) || null,
    preLaunchLogs: (meta && meta.preLaunchLogs) || []
  });
  selectedInstanceId = inst.id;
  broadcastInstances();
  pushActivityUpdate();
  return inst;
}

function removeTrackedInstance(id) {
  const inst = trackedInstances.find((i) => i.id === id);
  if (inst && inst.leaveTimer) {
    clearTimeout(inst.leaveTimer);
    inst.leaveTimer = null;
  }
  trackedInstances = trackedInstances.filter((i) => i.id !== id);
  if (selectedInstanceId === id) {
    const next = trackedInstances.find((i) => i.session && i.session.inGame) || trackedInstances[0];
    selectedInstanceId = next ? next.id : null;
  }
}

function summarizeInstances() {
  return trackedInstances.map((inst) => ({
    id: inst.id,
    userId: inst.userId ? String(inst.userId) : null,
    username: inst.username || null,
    displayName: inst.displayName || null,
    label: instanceLabel(inst),
    alive: instanceHasLiveProcess(inst) || !!(inst.session && inst.session.inGame),
    inGame: !!(inst.session && inst.session.inGame),
    placeName: (inst.session && inst.session.placeName) || null,
    pid: inst.pid || null
  }));
}

function broadcastInstances() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('huistrap:instances-update', summarizeInstances());
    } catch {}
  }
}

function applyUserIdToInstance(inst, userId) {
  if (!inst || !userId) return;
  const id = String(userId);
  inst.userId = inst.userId || id;
  try {
    const accounts = readAccounts();
    const acc = accounts.find((a) => String(a.userId) === id);
    if (acc) {
      inst.username = inst.username || acc.username;
      inst.displayName = inst.displayName || acc.displayName;
    }
  } catch {}
  broadcastInstances();
}

function killPidTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    execFile('taskkill', ['/F', '/PID', String(pid), '/T'], { windowsHide: true }, () => resolve());
  });
}

async function killTrackedInstance(id) {
  const inst = trackedInstances.find((i) => i.id === id);
  if (!inst) throw new Error('Instance not found.');
  invalidateRobloxPidCache();
  let pid = inst.pid ? Number(inst.pid) : null;
  if (!pid || !listRobloxPlayerPids().includes(pid)) {
    const live = listRobloxPlayerPids();
    const claimed = new Set(
      trackedInstances.filter((i) => i.id !== inst.id && i.pid).map((i) => Number(i.pid))
    );
    const unclaimed = live.filter((p) => !claimed.has(p));
    if (unclaimed.length === 1) pid = unclaimed[0];
  }
  if (!pid) throw new Error('Could not find a process for this instance.');
  await killPidTree(pid);
  invalidateRobloxPidCache();
  removeTrackedInstance(id);
  broadcastInstances();
  rebuildTrayMenu();
  if (!trackedInstances.length && !isRobloxPlayerRunning()) {
    // Keep the tray for a moment if the main window is open; otherwise idle.
    if (activityWatcher) activityWatcher.seenRoblox = isRobloxPlayerRunning();
  }
  return { ok: true };
}

async function killInstancesForUser(userId) {
  if (userId == null) throw new Error('No account selected.');
  const matches = trackedInstances.filter((i) => String(i.userId) === String(userId));
  if (!matches.length) throw new Error('No running instance for this account.');
  for (const inst of matches) {
    await killTrackedInstance(inst.id);
  }
  return { ok: true };
}

function initialLogOffset(log) {
  const size = log.size || 0;
  if (Date.now() - log.mtime < 30000 && size > 0) return Math.max(0, size - 16384);
  return size;
}

function consumeLogText(inst, text) {
  if (!activityWatcher || !inst) return;
  const joinRe = /! Joining game ['"]([0-9a-f\-]{36})['"] place ([0-9]+) at ([0-9\.]+)/i;
  const joinReLoose = /Joining game ['"]([0-9a-f\-]{36})['"] place ([0-9]+)/i;
  const udmuxRe = /UDMUX Address\s*=\s*([0-9\.]+)/i;
  const rccRe = /RCC Server Address\s*=\s*([0-9\.]+)/i;
  const joinedRe = /serverId:\s*([0-9\.]+)\|([0-9]+)/i;
  const replicatorRe = /Replicator created:/i;
  const leaveRe = /Time to disconnect replication data:/i;
  const leaveRe2 = /leaveUGCGameInternal/i;
  const userIdRe = /\b(?:userId|UserId|userid)\s*[:=]\s*"?(\d{3,})/;
  const reportUserIdRe = /ReportUserId\s+(\d{3,})/i;

  const confirmPending = (reason) => {
    if (!inst.pendingJoin) return;
    const info = inst.pendingJoin;
    inst.pendingJoin = null;
    inst.pendingSince = 0;
    console.log('[Huistrap] Game join confirmed via', reason, info.placeId, inst.id);
    onInstanceJoined(inst, info).catch((e) => console.log('[Huistrap] join handler:', e.message));
  };

  for (const line of text.split(/\r?\n/)) {
    const uid = line.match(userIdRe) || line.match(reportUserIdRe);
    if (uid) applyUserIdToInstance(inst, uid[1]);

    let jm = line.match(joinRe);
    if (!jm) {
      const loose = line.match(joinReLoose);
      if (loose) jm = [loose[0], loose[1], loose[2], '0.0.0.0'];
    }
    if (jm) {
      inst.pendingJoin = {
        jobId: jm[1],
        placeId: jm[2],
        machineAddress: jm[3] || '0.0.0.0',
        udmuxAddress: null
      };
      inst.pendingSince = Date.now();
      console.log('[Huistrap] Pending join place', jm[2], inst.id);
    }

    const um = line.match(udmuxRe);
    if (um && inst.pendingJoin) inst.pendingJoin.udmuxAddress = um[1];
    const rcc = line.match(rccRe);
    if (rcc && inst.pendingJoin && !inst.pendingJoin.udmuxAddress) inst.pendingJoin.udmuxAddress = rcc[1];

    if (inst.pendingJoin && (joinedRe.test(line) || replicatorRe.test(line))) {
      confirmPending(joinedRe.test(line) ? 'serverId' : 'replicator');
    }

    if (leaveRe.test(line) || leaveRe2.test(line)) {
      inst.pendingJoin = null;
      inst.pendingSince = 0;
      onInstanceLeft(inst);
    }
  }

  if (inst.pendingJoin && inst.pendingSince && Date.now() - inst.pendingSince > 8000) {
    confirmPending('timeout');
  }
}

function tickInstanceLogs() {
  if (!activityWatcher || !activityWatcher.running) return;
  try {
    const logs = listRecentPlayerLogs(2 * 60 * 60 * 1000);
    const claimed = new Set(trackedInstances.map((i) => i.logPath).filter(Boolean));

    // Assign each still-unmatched, live instance the newest log file that
    // didn't exist yet at its own launch time and isn't already claimed by
    // another instance. Deterministic per-PID matching — no time-window
    // guessing, no fallback "closest open instance" stealing.
    for (const inst of trackedInstances) {
      if (inst.logPath || !instanceHasLiveProcess(inst)) continue;
      const candidate = logs.find(
        (log) =>
          !claimed.has(log.full) &&
          !inst.preLaunchLogs.includes(log.full) &&
          log.mtime >= inst.launchedAt - 2000
      );
      if (candidate) {
        inst.logPath = candidate.full;
        inst.offset = initialLogOffset(candidate);
        claimed.add(candidate.full);
      }
    }

    for (const log of logs) {
      const inst = trackedInstances.find((i) => i.logPath === log.full);
      if (!inst) continue;
      if (!fs.existsSync(inst.logPath)) continue;
      const st = fs.statSync(inst.logPath);
      if (st.size < inst.offset) inst.offset = 0;
      if (st.size === inst.offset) {
        if (inst.pendingJoin && inst.pendingSince && Date.now() - inst.pendingSince > 8000) {
          const info = inst.pendingJoin;
          inst.pendingJoin = null;
          inst.pendingSince = 0;
          onInstanceJoined(inst, info).catch((e) => console.log('[Huistrap] join handler:', e.message));
        }
        continue;
      }
      const fd = fs.openSync(inst.logPath, 'r');
      const len = st.size - inst.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, inst.offset);
      fs.closeSync(fd);
      inst.offset = st.size;
      consumeLogText(inst, buf.toString('utf8'));
    }
  } catch {
    // ignore rotation races
  }
}

function activityPanelSize(payload) {
  const n = ((payload && payload.instances) || []).length;
  const inGame = !!(payload && payload.inGame);
  let h = 210;
  if (n >= 2) h += 46;
  if (inGame) h += 48;
  else if (payload && payload.canKill) h += 40;
  return { w: 480, h: Math.min(h, 360) };
}

function layoutActivityPanel(payload) {
  if (!activityWindow || activityWindow.isDestroyed() || !activityWindow.isVisible()) return;
  const { screen } = require('electron');
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const { width, height, x, y } = display.workArea;
  const size = activityPanelSize(payload);
  activityWindow.setSize(size.w, size.h);
  activityWindow.setPosition(
    Math.round(x + (width - size.w) / 2),
    Math.round(y + (height - size.h) / 2)
  );
}

function buildTrayTooltip(session) {
  const n = trackedInstances.length;
  if (n >= 2) {
    const inGame = trackedInstances.filter((i) => i.session && i.session.inGame).length;
    const lines = [`Huistrap — ${n} instances`];
    if (inGame) lines.push(`${inGame} in game`);
    const selected = getSelectedInstance();
    if (selected && selected.session && selected.session.inGame) {
      lines.push(instanceLabel(selected) + ': ' + (selected.session.placeName || 'In game'));
    }
    return lines.join('\n');
  }
  if (!session || !session.inGame) return 'Huistrap — waiting for a game…';
  const lines = [session.placeName || 'In game'];
  lines.push(session.region || 'Region N/A');
  if (session.joinedAt) lines.push(formatPlaytime(Date.now() - session.joinedAt));
  else lines.push('Playtime N/A');
  return lines.join('\n');
}

function sessionFields(session) {
  if (!session || !session.inGame) return { inGame: false };
  return {
    inGame: true,
    placeId: session.placeId || null,
    jobId: session.jobId || null,
    machineAddress: session.machineAddress || null,
    placeName: session.placeName || null,
    universeId: session.universeId || null,
    region: session.region || null,
    joinedAt: session.joinedAt || null,
    thumbnailDataUrl: session.thumbnailDataUrl || null,
    serverFirstSeenAt: session.serverFirstSeenAt || null,
    serverUptime: session.serverFirstSeenAt ? formatServerUptime(session.serverFirstSeenAt) : null,
    serverUptimeEstimate: !!session.serverUptimeEstimate
  };
}

function buildActivityPayload() {
  const selected = getSelectedInstance();
  const session = selected && selected.session;
  const fields = sessionFields(session);
  const instances = trackedInstances
    .filter((inst) => instanceHasLiveProcess(inst) || (inst.session && inst.session.inGame))
    .map((inst) => ({
      id: inst.id,
      userId: inst.userId ? String(inst.userId) : null,
      username: inst.username || null,
      displayName: inst.displayName || null,
      label: instanceLabel(inst),
      inGame: !!(inst.session && inst.session.inGame),
      placeName: (inst.session && inst.session.placeName) || null,
      thumbnailDataUrl: (inst.session && inst.session.thumbnailDataUrl) || null,
      canKill: instanceHasLiveProcess(inst)
    }));
  return {
    ...fields,
    accountLabel: selected ? instanceLabel(selected) : null,
    selectedInstanceId: selected ? selected.id : null,
    instances,
    canKill: selected ? instanceHasLiveProcess(selected) : false
  };
}

function pushActivityUpdate() {
  const selected = getSelectedInstance();
  const session = selected && selected.session;
  lastActivityPayload = buildActivityPayload();
  if (activityWindow && !activityWindow.isDestroyed()) {
    activityWindow.webContents.send('activity:update', lastActivityPayload);
    if (activityWindow.isVisible()) {
      const size = activityPanelSize(lastActivityPayload);
      const current = activityWindow.getSize();
      if (current[0] !== size.w || current[1] !== size.h) {
        activityWindow.setSize(size.w, size.h);
      }
    }
  }
  if (trayIcon) {
    trayIcon.setToolTip(buildTrayTooltip(session));
  }
}

function hideActivityPanel() {
  if (activityWindow && !activityWindow.isDestroyed()) {
    activityWindow.hide();
  }
}

function showActivityPanel() {
  ensureActivityWindow();
  if (!activityWindow || activityWindow.isDestroyed()) return;

  const payload = lastActivityPayload || buildActivityPayload();
  const send = () => activityWindow.webContents.send('activity:update', payload);

  if (activityWindow.webContents.isLoading()) {
    activityWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }

  const { screen } = require('electron');
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const { width, height, x, y } = display.workArea;
  const size = activityPanelSize(payload);
  activityWindow.setSize(size.w, size.h);
  activityWindow.setPosition(
    Math.round(x + (width - size.w) / 2),
    Math.round(y + (height - size.h) / 2)
  );
  activityWindow.setAlwaysOnTop(true, 'floating');
  activityWindow.show();
  activityWindow.focus();
}

function ensureActivityWindow() {
  if (activityWindow && !activityWindow.isDestroyed()) return;
  activityWindow = new BrowserWindow({
    width: 480,
    height: 268,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'activity-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  activityWindow.on('blur', () => {
    hideActivityPanel();
  });
  activityWindow.on('closed', () => {
    activityWindow = null;
  });
  activityWindow.loadFile(path.join(__dirname, 'activity.html'));
}

function rebuildTrayMenu() {
  if (!trayIcon) return;
  const items = [
    { label: 'Show activity', click: () => showActivityPanel() },
    { label: 'Open Huistrap', click: () => openHuistrapMainWindow() }
  ];
  const live = trackedInstances.filter((i) => instanceHasLiveProcess(i) || (i.session && i.session.inGame));
  if (live.length) {
    items.push({ type: 'separator' });
    live.forEach((inst) => {
      const name = instanceLabel(inst);
      const game = inst.session && inst.session.inGame ? (inst.session.placeName || 'In game') : 'Running';
      items.push({
        label: `Kill ${name} — ${game}`,
        click: () => {
          killTrackedInstance(inst.id).catch((err) => console.log('[Huistrap] kill:', err.message));
        }
      });
    });
  }
  items.push({ type: 'separator' });
  items.push({
    label: 'Quit',
    click: () => {
      stopActivityTray();
      app.quit();
    }
  });
  trayIcon.setContextMenu(Menu.buildFromTemplate(items));
  pushActivityUpdate();
}

function ensureTrayIcon() {
  if (trayIcon) return;
  try {
    const fallback = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    const img = fallback.isEmpty() ? nativeImage.createEmpty() : fallback.resize({ width: 16, height: 16 });
    trayIcon = new Tray(img);
    trayIcon.setToolTip('Huistrap');
    trayIcon.on('click', () => showActivityPanel());
    trayIcon.on('double-click', () => openHuistrapMainWindow());
    rebuildTrayMenu();
  } catch (err) {
    console.log('[Huistrap] Tray create failed:', err.message);
  }
}

async function onInstanceJoined(inst, info) {
  if (!inst) return;

  const sameJob =
    inst.session &&
    inst.session.inGame &&
    inst.session.jobId === info.jobId;

  if (sameJob) return;

  const wasInGame = !!(inst.session && inst.session.inGame);

  if (inst.leaveTimer) {
    clearTimeout(inst.leaveTimer);
    inst.leaveTimer = null;
  }

  inst.seenRoblox = true;
  if (activityWatcher) activityWatcher.seenRoblox = true;
  selectedInstanceId = inst.id;

  const place = await fetchPlaceMeta(info.placeId);
  const placeName = place.name || `Place ${info.placeId}`;
  const ip = isPublicIp(info.udmuxAddress)
    ? info.udmuxAddress
    : (isPublicIp(info.machineAddress) ? info.machineAddress : (info.udmuxAddress || info.machineAddress || null));
  const region = ip ? (await fetchServerRegion(ip)) : null;
  const thumbInfo = await fetchGameThumbnail(place.universeId, info.placeId);

  const seedHistory = [];
  const addHist = (id) => {
    if (id == null || id === '') return;
    const s = String(id);
    if (!seedHistory.includes(s)) seedHistory.push(s);
  };
  addHist(info.placeId);
  if (place.universeId === 994732206 || /blox fruits/i.test(placeName)) {
    addHist('2753915549');
    addHist('4442272183');
  }

  inst.session = {
    inGame: true,
    placeId: info.placeId,
    jobId: info.jobId,
    machineAddress: ip,
    placeName,
    universeId: place.universeId || null,
    region: region || null,
    joinedAt: Date.now(),
    thumbnailDataUrl: (thumbInfo && thumbInfo.dataUrl) || null,
    serverFirstSeenAt: null,
    serverUptimeEstimate: false,
    placeIdHistory: seedHistory
  };

  ensureTrayIcon();
  rebuildTrayMenu();
  broadcastInstances();

  if (!wasInGame && place.name && Notification.isSupported()) {
    try {
      new Notification({
        title: place.name,
        body: (inst.displayName || inst.username)
          ? `${inst.displayName || inst.username} · ${region ? `Server: ${region}` : 'Joined experience'}`
          : (region ? `Server: ${region}` : 'Joined experience')
      }).show();
    } catch {}
  }

  try {
    const uptimeInfo = await fetchServerUptimeAny(info.placeId, info.jobId, seedHistory);
    if (uptimeInfo && uptimeInfo.firstSeenAt && inst.session && inst.session.jobId === info.jobId) {
      inst.session.serverFirstSeenAt = uptimeInfo.firstSeenAt;
      inst.session.serverUptimeEstimate = uptimeInfo.isEstimate !== false;
      rebuildTrayMenu();
    } else if (inst.session && inst.session.jobId === info.jobId) {
      inst.session.serverFirstSeenAt = null;
      rebuildTrayMenu();
    }
  } catch (e) {
    console.log('[Huistrap] uptime resolve:', e.message);
  }

  const jobAtSchedule = info.jobId;
  const instId = inst.id;
  [3000, 8000, 15000].forEach((delay) => {
    setTimeout(async () => {
      try {
        const current = trackedInstances.find((i) => i.id === instId);
        if (!current || !current.session || !current.session.inGame) return;
        if (current.session.jobId !== jobAtSchedule) return;
        if (current.session.serverFirstSeenAt && delay > 3000) return;
        const again = await fetchServerUptimeAny(
          current.session.placeId,
          current.session.jobId,
          current.session.placeIdHistory
        );
        if (again && again.firstSeenAt && current.session && current.session.jobId === jobAtSchedule) {
          current.session.serverFirstSeenAt = again.firstSeenAt;
          current.session.serverUptimeEstimate = again.isEstimate !== false;
          rebuildTrayMenu();
        }
      } catch {}
    }, delay);
  });
}

function onInstanceLeft(inst) {
  if (!inst) return;
  if (inst.leaveTimer) return;
  inst.leaveTimer = setTimeout(() => {
    inst.leaveTimer = null;
    inst.session = { inGame: false };
    rebuildTrayMenu();
    broadcastInstances();
  }, 3500);
}

function finishActivityAndMaybeQuit() {
  stopActivityTray();
  const winOpen = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  if (!winOpen) app.quit();
}

function startActivityTray() {
  if (!settings || settings.enableActivityTray === false) return;
  if (activityWatcher && activityWatcher.running) return;

  activityWatcher = {
    running: true,
    tickTimer: null,
    menuTimer: null,
    processTimer: null,
    uptimeRetryTimer: null,
    seenRoblox: trackedInstances.length > 0,
    startedAt: Date.now()
  };

  ensureTrayIcon();
  rebuildTrayMenu();

  activityWatcher.tickTimer = setInterval(tickInstanceLogs, 750);
  activityWatcher.menuTimer = setInterval(() => {
    if (trackedInstances.some((i) => i.session && i.session.inGame)) {
      rebuildTrayMenu();
    }
  }, 5000);

  activityWatcher.uptimeRetryTimer = setInterval(async () => {
    try {
      if (!activityWatcher || !activityWatcher.running) return;
      for (const inst of trackedInstances) {
        const s = inst.session;
        if (!s || !s.inGame || s.serverFirstSeenAt || !s.placeId || !s.jobId) continue;
        const uptimeInfo = await fetchServerUptimeAny(s.placeId, s.jobId, s.placeIdHistory);
        if (uptimeInfo && uptimeInfo.firstSeenAt && inst.session) {
          inst.session.serverFirstSeenAt = uptimeInfo.firstSeenAt;
          inst.session.serverUptimeEstimate = uptimeInfo.isEstimate !== false;
          rebuildTrayMenu();
        }
      }
    } catch {}
  }, 20000);

  activityWatcher.processTimer = setInterval(() => {
    if (!activityWatcher || !activityWatcher.running) return;
    invalidateRobloxPidCache();
    const running = isRobloxPlayerRunning();
    if (running) activityWatcher.seenRoblox = true;

    let changed = false;
    for (const inst of trackedInstances.slice()) {
      if (Date.now() - inst.launchedAt < 15000) continue;
      if (!instanceHasLiveProcess(inst) && inst.session && inst.session.inGame) {
        onInstanceLeft(inst);
      } else if (!instanceHasLiveProcess(inst) && !(inst.session && inst.session.inGame) && Date.now() - inst.launchedAt > 20000) {
        removeTrackedInstance(inst.id);
        broadcastInstances();
        changed = true;
      }
    }
    if (changed || running) rebuildTrayMenu();

    if (running) return;
    if (Date.now() - activityWatcher.startedAt < 20000) return;
    if (!activityWatcher.seenRoblox && !trackedInstances.length) return;
    if (trackedInstances.some((i) => Date.now() - i.launchedAt < 20000)) return;
    finishActivityAndMaybeQuit();
  }, 2000);

  tickInstanceLogs();
}

function stopActivityTray() {
  if (activityWatcher) {
    if (activityWatcher.tickTimer) clearInterval(activityWatcher.tickTimer);
    if (activityWatcher.menuTimer) clearInterval(activityWatcher.menuTimer);
    if (activityWatcher.processTimer) clearInterval(activityWatcher.processTimer);
    if (activityWatcher.uptimeRetryTimer) clearInterval(activityWatcher.uptimeRetryTimer);
  }
  for (const inst of trackedInstances) {
    if (inst.leaveTimer) clearTimeout(inst.leaveTimer);
  }
  trackedInstances = [];
  selectedInstanceId = null;
  activityWatcher = null;
  lastActivityPayload = null;
  if (activityWindow && !activityWindow.isDestroyed()) {
    try { activityWindow.close(); } catch {}
    activityWindow = null;
  }
  if (trayIcon) {
    try { trayIcon.destroy(); } catch {}
    trayIcon = null;
  }
}

ipcMain.handle('activity:open-main', () => {
  openHuistrapMainWindow();
  return { ok: true };
});
ipcMain.handle('activity:close-panel', () => {
  hideActivityPanel();
  return { ok: true };
});
ipcMain.handle('activity:quit', () => {
  stopActivityTray();
  app.quit();
  return { ok: true };
});
ipcMain.handle('activity:copy', (_e, text) => {
  try { clipboard.writeText(String(text || '')); } catch {}
  return { ok: true };
});
ipcMain.handle('activity:select-instance', (_e, id) => {
  selectTrackedInstance(id);
  return { ok: true, selectedInstanceId };
});
ipcMain.handle('activity:kill-instance', async (_e, id) => {
  const target = id || selectedInstanceId;
  return killTrackedInstance(target);
});

app.whenReady().then(async () => {
  try {
    loadSettings();

    const protocolArg = findProtocolArg(process.argv);
    if (protocolArg) {
      handleProtocolLaunch(protocolArg);
    } else {
      createWindow();
    }

    try {
      const updateManifest = await checkForAppUpdate();
      if (updateManifest) {
        pendingAppUpdate = updateManifest;
        const send = () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('huistrap:app-update-available', updateManifest.version);
          }
        };
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.webContents.isLoading()) {
            mainWindow.webContents.once('did-finish-load', send);
          } else {
            send();
          }
        }
      }
    } catch (err) {
      console.log('[Huistrap] Update check failed:', err.message);
    }
  } catch (err) {
    console.error('[Huistrap] Startup failed:', err);
    if (!mainWindow || mainWindow.isDestroyed()) {
      try {
        createWindow();
      } catch (fallbackErr) {
        console.error('[Huistrap] Fallback window creation also failed:', fallbackErr);
      }
    }
  }
});

app.on('window-all-closed', () => {
  // Stay alive only while the tray is active (tracking a Roblox session)
  if (activityWatcher && activityWatcher.running && trayIcon) return;
  app.quit();
});

app.on('before-quit', () => {
  stopActivityTray();
});