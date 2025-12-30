const path = require('path');
const fs = require('fs');

const IS_TEST = !!process.env.CHAT_WEB_TEST_MODE;

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Electron imports
let app, BrowserWindow, session, Tray, Menu, nativeImage, ipcMain, dialog, shell;
try {
  const electron = require('electron');
  ({ app, BrowserWindow, session, Tray, Menu, nativeImage, ipcMain, dialog, shell } = electron);
  if (process.platform === 'win32' && app.setAppUserModelId) {
    app.setAppUserModelId('com.chat.web.desktop');
  }
} catch (e) {
  if (IS_TEST) {
    // Minimal stubs for unit testing config helpers without Electron runtime
    const noop = () => {};
    app = {
      isPackaged: false,
      setAppUserModelId: noop,
      setPath: noop,
      getPath: () => path.join(process.cwd(), 'user_data_test')
    };
    BrowserWindow = class {};
    session = { defaultSession: { getUserAgent: () => 'test-agent' } };
    Tray = class {};
    Menu = { setApplicationMenu: noop, buildFromTemplate: () => ({}) };
    nativeImage = {
      createFromPath: () => ({ isEmpty: () => true }),
      createFromDataURL: () => ({ isEmpty: () => false, resize: () => ({}) }),
      createEmpty: () => ({})
    };
    ipcMain = { handle: noop, on: noop };
    dialog = {};
    shell = { openExternal: noop };
  } else {
    console.error('Failed to import electron:', e && e.message);
    process.exit(1);
  }
}

// Icons helpers
const getAssetsDir = () => {
  if (app && app.isPackaged) return path.join(process.resourcesPath, 'assets');
  return path.join(__dirname, 'assets');
};

const getIconVariants = () => {
  const ASSETS_DIR = getAssetsDir();
  return {
    idle: {
      png: path.join(ASSETS_DIR, 'chat_idle.png'),
      ico: path.join(ASSETS_DIR, 'chat_idle.ico')
    },
    notify: {
      png: path.join(ASSETS_DIR, 'chat_new.png'),
      ico: path.join(ASSETS_DIR, 'chat_idle.ico') // fallback to idle ico
    }
  };
};

// Defaults / globals
const DEFAULT_TITLE = 'Chat Web Desktop';
const DEFAULT_TRAY_TITLE = 'Chat Web Desktop';
const DEFAULT_PROFILE_NAME = 'Chat Profile';

let isQuitting = false;
let lastActiveProfileId = null;
let configWindow = null;
const windows = new Map();
const profileTrays = new Map();
// Leave empty to allow unread detection without service-specific keywords
const ATTENTION_KEYWORDS = [];
const unreadStates = new Map();
const trayBlinkTimers = new Map();
const trayBlinkStates = new Map();
const TRAY_BLINK_INTERVAL_MS = 900;

// Config helpers
const getConfigPath = () => path.join(app.getPath('userData'), 'config.json');

const trimString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

function normalizeProfile(profile = {}, idx = 0) {
  const id = trimString(profile.id) || `profile-${idx + 1}-${Date.now().toString(36)}`;
  const name = trimString(profile.name) || trimString(profile.title) || `Profile ${idx + 1}`;
  const title = trimString(profile.title) || name || DEFAULT_TITLE;
  const trayTitle = trimString(profile.title) || name || DEFAULT_TRAY_TITLE;
  const url = trimString(profile.url);
  const userAgent = trimString(profile.userAgent);
  const iconPath = trimString(profile.iconPath) || null;
  const iconNotifyPath = trimString(profile.iconNotifyPath) || null;
  const windowBounds = profile.windowBounds || null;
  return { id, name, title, trayTitle, url, userAgent, iconPath, iconNotifyPath, windowBounds };
}

function normalizeConfig(cfg = {}) {
  let profiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];

  // Legacy single-profile support
  const legacyFields = ['url', 'userAgent', 'title', 'trayTitle', 'iconPath'];
  const hasLegacy = legacyFields.some((key) => trimString(cfg[key]));
  if (hasLegacy && profiles.length === 0) {
    profiles.push({
      id: cfg.id || 'profile-1',
      name: trimString(cfg.title) || trimString(cfg.trayTitle) || DEFAULT_PROFILE_NAME,
      url: cfg.url,
      userAgent: cfg.userAgent,
      title: cfg.title,
      iconPath: cfg.iconPath
    });
  }

  profiles = profiles.map((p, idx) => normalizeProfile(p, idx)).filter((p) => p && p.id);
  return { profiles };
}

function loadUserConfig() {
  if (loadUserConfig.cache) return loadUserConfig.cache;
  let cfg = {};
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) || {};
    }
  } catch (e) {
    console.warn('Could not read config.json:', e && e.message);
  }
  loadUserConfig.cache = normalizeConfig(cfg);
  return loadUserConfig.cache;
}

function saveUserConfig(partial = {}) {
  const merged = normalizeConfig({ ...loadUserConfig(), ...partial });
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2));
    loadUserConfig.cache = merged;
  } catch (e) {
    console.error('Failed to write config.json:', e && e.message);
  }
  return merged;
}

function clearUserConfig() {
  try {
    fs.rmSync(getConfigPath(), { force: true });
  } catch (e) {
    console.warn('Failed to clear config.json:', e && e.message);
  }
  loadUserConfig.cache = normalizeConfig({});
  return loadUserConfig.cache;
}

const getProfiles = (cfg = loadUserConfig()) => (Array.isArray(cfg.profiles) ? cfg.profiles : []);
const getProfileById = (id, cfg = loadUserConfig()) => getProfiles(cfg).find((p) => p.id === id);
const getPrimaryProfile = (cfg = loadUserConfig()) => getProfiles(cfg)[0] || null;

const resolveWindowTitle = (profile) => trimString(profile && profile.title) || trimString(profile && profile.name) || DEFAULT_TITLE;
const resolveTrayTitle = (profile) => trimString(profile && profile.title) || trimString(profile && profile.name) || DEFAULT_TRAY_TITLE;

function resolveIconPath(profile) {
  if (profile && typeof profile.iconPath === 'string') {
    const p = profile.iconPath.trim();
    if (p) return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }
  return null;
}

function resolveNotifyIconPath(profile) {
  if (profile && typeof profile.iconNotifyPath === 'string') {
    const p = profile.iconNotifyPath.trim();
    if (p) return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }
  return null;
}

const getDefaultUserAgent = () => {
  try {
    return session.defaultSession.getUserAgent();
  } catch (e) {
    return undefined;
  }
};

function profileMatchesAttentionTargets(profile, currentUrl = '') {
  const haystack = `${trimString(profile && profile.url)} ${trimString(currentUrl)}`.toLowerCase();
  if (!ATTENTION_KEYWORDS.length) return true;
  return ATTENTION_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function getProfileIdFromWebContents(webContents) {
  if (!webContents) return null;
  if (webContents.__profileId) return webContents.__profileId;
  for (const [id, win] of windows.entries()) {
    if (win && win.webContents === webContents) return id;
  }
  return null;
}

function titleIndicatesUnread(title = '', profile = null, currentUrl = '') {
  if (!profileMatchesAttentionTargets(profile, currentUrl)) return false;
  const safeTitle = (title || '').trim();
  if (!safeTitle) return false;
  const lower = safeTitle.toLowerCase();

  const hasBadge = /\(\s*\d+\s*\)/.test(safeTitle);
  if (hasBadge) return true;
  if (/^\s*\d+/.test(safeTitle)) return true;
  if (/inbox\s*\d+/i.test(safeTitle)) return true;
  if (/\b\d+\s+(new|unread)\b/.test(lower)) return true;
  return false;
}

function setUnreadState(profileId, hasUnread) {
  if (!profileId) return;
  const next = !!hasUnread;
  const prev = unreadStates.get(profileId) || false;
  if (prev === next) return;
  unreadStates.set(profileId, next);
  updateTrayAttention();
}

function clearUnreadState(profileId) {
  if (!profileId) return;
  if (unreadStates.delete(profileId)) updateTrayAttention();
}

function updateTrayAttention() {
  const ids = new Set([...profileTrays.keys(), ...unreadStates.keys()]);
  ids.forEach((profileId) => {
    const hasUnread = unreadStates.get(profileId) || false;
    if (hasUnread) startTrayBlinking(profileId);
    else stopTrayBlinking(profileId);
  });
}

function startTrayBlinking(profileId) {
  const tray = getTrayForProfile(profileId);
  if (!tray) return;
  if (trayBlinkTimers.has(profileId)) return;

  const profile = getProfileById(profileId);

  const applyFrame = (notification) => {
    const activeTray = getTrayForProfile(profileId);
    if (!activeTray) {
      stopTrayBlinking(profileId);
      return;
    }
    const trayImage = getAppIconNative({ notification, forTray: true, profile });
    if (trayImage) activeTray.setImage(trayImage);
  };

  trayBlinkStates.set(profileId, true);
  applyFrame(true);
  const timer = setInterval(() => {
    const next = !trayBlinkStates.get(profileId);
    trayBlinkStates.set(profileId, next);
    applyFrame(next);
  }, TRAY_BLINK_INTERVAL_MS);

  trayBlinkTimers.set(profileId, timer);
}

function stopTrayBlinking(profileId) {
  const timer = trayBlinkTimers.get(profileId);
  if (timer) clearInterval(timer);
  trayBlinkTimers.delete(profileId);
  trayBlinkStates.delete(profileId);
  try {
    applyTrayIcon(profileId);
  } catch (e) {}
}

function attachUnreadDetection(win, profile) {
  if (!win || !win.webContents || !profile || !profile.id) return;

  if (win.__unreadCleanup) {
    try {
      win.__unreadCleanup();
    } catch (e) {}
  }

  if (!profileMatchesAttentionTargets(profile)) {
    clearUnreadState(profile.id);
    win.__unreadCleanup = null;
    return;
  }

  const webContents = win.webContents;
  webContents.__profileId = profile.id;
  let cleaned = false;

  const evaluateTitle = (title) => {
    let currentUrl = '';
    try {
      currentUrl = typeof webContents.getURL === 'function' ? webContents.getURL() : '';
    } catch (e) {}
    const hasUnread = titleIndicatesUnread(title, profile, currentUrl);
    if (!hasUnread) clearUnreadState(profile.id);
    else setUnreadState(profile.id, true);
  };

  const handleTitleUpdated = (_event, title) => evaluateTitle(title);
  const handleLoad = () => {
    try {
      evaluateTitle(webContents.getTitle());
    } catch (e) {}
  };
  const handleFocus = () => handleLoad();

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      webContents.removeListener('page-title-updated', handleTitleUpdated);
    } catch (e) {}
    try {
      webContents.removeListener('did-finish-load', handleLoad);
    } catch (e) {}
    try {
      win.removeListener('focus', handleFocus);
    } catch (e) {}
    try {
      win.removeListener('closed', cleanup);
    } catch (e) {}
    clearUnreadState(profile.id);
    win.__unreadCleanup = null;
  };

  webContents.on('page-title-updated', handleTitleUpdated);
  webContents.on('did-finish-load', handleLoad);
  win.on('focus', handleFocus);
  win.on('closed', cleanup);

  win.__unreadCleanup = cleanup;

  handleLoad();
}

// Utility: load first available native image
function loadNativeImageFromList(paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        const empty = typeof img.isEmpty === 'function' ? img.isEmpty() : false;
        if (!empty) return img;
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

function getLogoDataUrl() {
  try {
    const imgPath = getIconVariants().idle.png;
    if (fs.existsSync(imgPath)) {
      const buf = fs.readFileSync(imgPath);
      return `data:image/png;base64,${buf.toString('base64')}`;
    }
  } catch (e) {
    console.warn('Could not load logo image:', e && e.message);
  }
  return (
    'data:image/svg+xml;base64,' +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="64" ry="64" fill="#1d9bf0"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="72" fill="#fff">CW</text></svg>'
    ).toString('base64')
  );
}

function buildSplashPage({ title, subtitle, hint }) {
  const logo = getLogoDataUrl();
  const safeTitle = title || DEFAULT_TITLE;
  const safeSubtitle = subtitle || 'Configure a URL to get started';
  const safeHint = hint || 'Use Configure to set your chat service URL and optional User-Agent.';
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin:0; padding:0; width:100%; height:100%; background:#0c1117; color:#e8ecf1; font-family: "Segoe UI", sans-serif; display:flex; align-items:center; justify-content:center; }
    .card { text-align:center; padding:32px 40px; border:1px solid rgba(255,255,255,0.08); border-radius:16px; background:rgba(255,255,255,0.03); box-shadow:0 20px 70px rgba(0,0,0,0.35); max-width:560px; }
    img { width:120px; height:120px; border-radius:24px; }
    h1 { margin:24px 0 8px; font-size:24px; letter-spacing:0.2px; }
    p { margin:6px 0; color:#aeb7c2; }
    .hint { margin-top:12px; font-size:13px; color:#8591a3; }
    .actions { margin-top:18px; display:flex; gap:10px; justify-content:center; }
    button { padding:10px 14px; border-radius:10px; border:1px solid #1d9bf0; background:#1d9bf0; color:#fff; cursor:pointer; font-weight:600; }
    button.ghost { background:transparent; border-color:#2c3a4f; color:#e8ecf1; }
  </style>
</head>
<body>
  <div class="card">
    <img src="${logo}" alt="logo"/>
    <h1>${safeTitle}</h1>
    <p>${safeSubtitle}</p>
    <p class="hint">${safeHint}</p>
    <div class="actions">
      <button onclick="window.chatWeb && window.chatWeb.openConfig && window.chatWeb.openConfig()">Configure</button>
      <button class="ghost" onclick="window.chatWeb && window.chatWeb.clearConfig && window.chatWeb.clearConfig()">Clear</button>
    </div>
  </div>
</body>
</html>`)
  );
}

function getAppIconNative({ notification = false, forTray = false, profile = null } = {}) {
  try {
    const ICON_VARIANTS = getIconVariants();
    const variant = notification ? ICON_VARIANTS.notify : ICON_VARIANTS.idle;
    const customIcon = notification ? resolveNotifyIconPath(profile) : resolveIconPath(profile);
    const fallbackCustom = notification ? resolveIconPath(profile) : null;
    const candidates = [];

    if (customIcon) candidates.push(customIcon);
    if (!customIcon && fallbackCustom) candidates.push(fallbackCustom);

    // Use png for tray (will be resized), ico for window
    if (forTray) {
      candidates.push(variant.png, variant.ico);
    } else {
      candidates.push(variant.ico, variant.png);
    }

    let img = loadNativeImageFromList(candidates);

    if (img && forTray) {
      try {
        const size = process.platform === 'win32' ? 16 : 24;
        if (typeof img.resize === 'function') img = img.resize({ width: size, height: size });
      } catch (e) {
        // ignore
      }
    }

    if (img) return img;

    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAKtJREFUeNrs1sERgCAQBdGf//6y2gk0m4kCF2k7m3p9m1QYQIAAAAAAAAAAAAAAAAAAAD8O8JZ0wq3m3q+2wz92T4a0d3g2u3BktQbYb5t0gkQ+JqY7j5l9gq8e4g8w5h3Xr0F1u7d6k5w5m9N3nQJ4Y1b5q3m3q+2wz92T4a0d3g2u3BktQbYb5t0gkQ+JqY7j5l9gq8e4g8w5h3Xr0F1u7d6k5w5m9N3nQJ4Y1b5q3m3q+2wz92T4a0d3g2u3BktQbYb5t0gkQAAAAAAAAAAAAAAAAAAAPwB9gABAP2uK3sAAAAASUVORK5CYII=';
    const img2 = nativeImage.createFromDataURL('data:image/png;base64,' + pngBase64);
    try {
      const size = process.platform === 'win32' ? 16 : 24;
      if (typeof img2.resize === 'function') return img2.resize({ width: size, height: size });
    } catch (e) {}
    return img2;
  } catch (e) {
    try {
      return nativeImage.createEmpty();
    } catch (e2) {
      return null;
    }
  }
}

function loadContentForProfile(win, profile) {
  if (!win || !profile) return;
  const targetUrl = trimString(profile.url) || null;
  const targetUa = trimString(profile.userAgent) || null;
  const windowTitle = resolveWindowTitle(profile);

  try {
    win.setTitle(windowTitle);
  } catch (e) {}

  try {
    const winIcon = getAppIconNative({ profile, forTray: false });
    if (winIcon && typeof win.setIcon === 'function') {
      win.setIcon(winIcon);
    }
  } catch (e) {
    console.warn('Could not apply window icon:', e && e.message);
  }

  if (targetUa) {
    try {
      win.webContents.setUserAgent(targetUa);
    } catch (e) {
      console.warn('Could not set webContents userAgent:', e && e.message);
    }
  } else {
    try {
      const fallbackUa = getDefaultUserAgent();
      if (fallbackUa) win.webContents.setUserAgent(fallbackUa);
    } catch (e) {
      console.warn('Could not reset userAgent:', e && e.message);
    }
  }

  if (!targetUrl) {
    const splash = buildSplashPage({
      title: windowTitle,
      subtitle: `${profile.name || 'This profile'} has no service URL configured`,
      hint: 'Use Configure to set your chat service URL, title, icon, and optional User-Agent.'
    });
    return win.loadURL(splash);
  }

  const splash = buildSplashPage({
    title: windowTitle,
    subtitle: `Loading ${profile.name || 'your chat service'}...`,
    hint: targetUrl
  });

  win
    .loadURL(splash)
    .then(() => {
      setTimeout(() => {
        const loadOptions = targetUa ? { userAgent: targetUa } : undefined;
        win.loadURL(targetUrl, loadOptions).catch((error) => {
          console.error('Error loading target URL:', error);
        });
      }, 120);
    })
    .catch((e) => console.error('Error loading splash:', e));
}

function saveWindowBounds(profileId, bounds) {
  const config = loadUserConfig();
  const profiles = config.profiles.map((p) => {
    if (p.id === profileId) {
      return { ...p, windowBounds: bounds };
    }
    return p;
  });
  saveUserConfig({ profiles });
}

function createProfileWindow(profile) {
  const windowTitle = resolveWindowTitle(profile);
  const bounds = profile.windowBounds || {};
  const win = new BrowserWindow({
    width: bounds.width || 1200,
    height: bounds.height || 800,
    x: bounds.x,
    y: bounds.y,
    backgroundColor: '#0c1117',
    show: true,
    title: windowTitle,
    autoHideMenuBar: true,
    icon: getAppIconNative({ notification: false, forTray: false, profile }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.__profileId = profile.id;
  if (win.webContents) win.webContents.__profileId = profile.id;

  // Open external links in default OS browser instead of new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('focus', () => {
    lastActiveProfileId = profile.id;
  });

  win.on('close', (e) => {
    if (!isQuitting && !win.__forceClose) {
      e.preventDefault();
      try {
        win.hide();
      } catch (err) {}
    }
  });

  win.on('minimize', (e) => {
    e.preventDefault();
    try {
      win.hide();
    } catch (err) {}
  });

  let boundsTimeout = null;
  const saveBounds = () => {
    if (boundsTimeout) clearTimeout(boundsTimeout);
    boundsTimeout = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) {
        saveWindowBounds(profile.id, win.getBounds());
      }
    }, 500);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  loadContentForProfile(win, profile);
  attachUnreadDetection(win, profile);

  win.on('closed', () => {
    windows.delete(profile.id);
  });

  windows.set(profile.id, win);
  return win;
}

function getWindowForProfile(profileId) {
  const win = windows.get(profileId);
  if (win && !win.isDestroyed()) return win;
  return null;
}

function showProfileWindow(profileId) {
  const profile = getProfileById(profileId);
  if (!profile) return null;

  let win = getWindowForProfile(profileId);
  if (!win) {
    win = createProfileWindow(profile);
  } else {
    win.show();
    win.focus();
    if (win.webContents) win.webContents.__profileId = profile.id;
    attachUnreadDetection(win, profile);
  }

  createTrayForProfile(profile);
  lastActiveProfileId = profile.id;
  return win;
}

function hideProfileWindow(profileId) {
  const win = getWindowForProfile(profileId);
  if (win) {
    try {
      win.hide();
    } catch (e) {}
  }
}

function reloadProfileWindow(profileId) {
  const profile = getProfileById(profileId);
  const win = getWindowForProfile(profileId);
  if (!profile) return;
  if (!win) {
    showProfileWindow(profileId);
    return;
  }
  loadContentForProfile(win, profile);
  attachUnreadDetection(win, profile);
}

function destroyProfileWindow(profileId) {
  const win = windows.get(profileId);
  if (!win) return;
  try {
    win.__forceClose = true;
    win.close();
  } catch (e) {
    try {
      win.destroy();
    } catch (err) {}
  }
  windows.delete(profileId);
  clearUnreadState(profileId);
}

function syncProfileWindows({ createMissing = true } = {}) {
  const profiles = getProfiles();
  const profileIds = new Set(profiles.map((p) => p.id));

  for (const [id] of windows.entries()) {
    if (!profileIds.has(id)) destroyProfileWindow(id);
  }

  if (!createMissing) return;

  profiles.forEach((profile) => {
    const existing = getWindowForProfile(profile.id);
    if (!existing) createProfileWindow(profile);
    else {
      loadContentForProfile(existing, profile);
      attachUnreadDetection(existing, profile);
    }
  });
}

function getTrayTooltip(profile = null) {
  const title = resolveTrayTitle(profile || getPrimaryProfile()) || DEFAULT_TRAY_TITLE;
  return title;
}

function getTrayForProfile(profileId) {
  const instance = profileTrays.get(profileId);
  if (instance && typeof instance.isDestroyed === 'function' && instance.isDestroyed()) return null;
  return instance || null;
}

function buildTrayMenu(profile) {
  const tray = getTrayForProfile(profile && profile.id);
  if (!tray || !profile) return;

  const profiles = getProfiles();
  const others = profiles.filter((p) => p.id !== profile.id);

  const template = [
    { label: `Show ${profile.name || resolveWindowTitle(profile)}`, click: () => showProfileWindow(profile.id) },
    { label: `Hide ${profile.name || resolveWindowTitle(profile)}`, click: () => hideProfileWindow(profile.id) },
    { label: `Reload ${profile.name || resolveWindowTitle(profile)}`, click: () => reloadProfileWindow(profile.id) },
    { type: 'separator' },
    ...(others.length
      ? [
          {
            label: 'Other Profiles',
            submenu: others.map((p) => ({
              label: p.name || resolveWindowTitle(p),
              icon: getAppIconNative({ forTray: true, profile: p }),
              click: () => {
                createTrayForProfile(p);
                showProfileWindow(p.id);
              }
            }))
          },
          { type: 'separator' }
        ]
      : []),
    { label: 'Show All', click: () => profiles.forEach((p) => showProfileWindow(p.id)) },
    { label: 'Hide All', click: () => profiles.forEach((p) => hideProfileWindow(p.id)) },
    { type: 'separator' },
    { label: 'Configure Profiles…', click: openConfigWindow },
    { type: 'separator' },
    {
      label: 'Quit All',
      click: () => {
        isQuitting = true;
        for (const [id] of windows.entries()) destroyProfileWindow(id);
        destroyAllTrays();
        app.quit();
      }
    },
    {
      label: 'Quit This Profile',
      click: () => {
        destroyProfileWindow(profile.id);
        destroyProfileTray(profile.id);
        if (lastActiveProfileId === profile.id) lastActiveProfileId = null;
        if (!profileTrays.size && !windows.size) {
          isQuitting = true;
          app.quit();
        }
      }
    }
  ];

  try {
    tray.setContextMenu(Menu.buildFromTemplate(template));
  } catch (e) {
    console.error('Failed to set tray menu:', e && e.message);
  }
}

function applyTrayConfig(profileId = null) {
  const profiles = getProfiles();
  const applyOne = (profile) => {
    const tray = getTrayForProfile(profile && profile.id);
    if (!tray || !profile) return;
    try {
      tray.setToolTip(getTrayTooltip(profile));
      buildTrayMenu(profile);
    } catch (e) {
      console.warn('Could not apply tray config:', e && e.message);
    }
  };

  if (profileId) {
    const profile = getProfileById(profileId);
    if (profile) applyOne(profile);
    return;
  }

  profiles.forEach(applyOne);
}

function applyTrayIcon(profileId = null) {
  const applyOne = (profile) => {
    const tray = getTrayForProfile(profile && profile.id);
    if (!tray || !profile) return;
    try {
      const trayImage = getAppIconNative({ forTray: true, profile });
      if (trayImage) tray.setImage(trayImage);
    } catch (e) {
      console.warn('Could not apply tray icon:', e && e.message);
    }
  };

  if (profileId) {
    const profile = getProfileById(profileId);
    if (profile) applyOne(profile);
    return;
  }

  getProfiles().forEach(applyOne);
}

function createTrayForProfile(profile) {
  if (!profile || !profile.id) return null;
  const existing = getTrayForProfile(profile.id);
  if (existing) return existing;

  const trayImage = getAppIconNative({ forTray: true, profile });
  if (!trayImage) {
    console.error('createTrayForProfile: no tray image available - tray will not be created for', profile.id);
    return null;
  }

  let trayInstance;
  try {
    trayInstance = new Tray(trayImage);
    console.log('createTrayForProfile: Tray created for profile', profile.id);
  } catch (e) {
    console.error('Failed to create Tray for profile', profile && profile.id, e && e.message);
    return null;
  }

  trayInstance.setToolTip(getTrayTooltip(profile));
  trayInstance.on('click', () => showProfileWindow(profile.id));

  profileTrays.set(profile.id, trayInstance);
  buildTrayMenu(profile);
  return trayInstance;
}

function destroyProfileTray(profileId) {
  stopTrayBlinking(profileId);
  const tray = getTrayForProfile(profileId);
  if (tray && typeof tray.destroy === 'function') {
    try {
      tray.destroy();
    } catch (e) {}
  }
  profileTrays.delete(profileId);
  unreadStates.delete(profileId);
  trayBlinkStates.delete(profileId);
  trayBlinkTimers.delete(profileId);
}

function destroyAllTrays() {
  for (const [id] of profileTrays.entries()) destroyProfileTray(id);
}

function syncTrays() {
  const profiles = getProfiles();
  const profileIds = new Set(profiles.map((p) => p.id));

  for (const [id] of profileTrays.entries()) {
    if (!profileIds.has(id)) destroyProfileTray(id);
  }

  profiles.forEach((profile) => {
    const existing = getTrayForProfile(profile.id);
    if (!existing) createTrayForProfile(profile);
    else {
      applyTrayIcon(profile.id);
      applyTrayConfig(profile.id);
    }
  });
}

function openConfigWindow() {
  if (!BrowserWindow) return;
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.focus();
    return;
  }

  const html = `<!doctype html>
  <html><head>
    <meta charset="UTF-8" />
    <title>Configure Chat Web Desktop</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin:0; padding:0; width:100%; height:100%; }
      body { font-family: "Segoe UI", sans-serif; background:#0b111a; color:#e8ecf1; display:flex; justify-content:center; overflow:hidden; }
      .wrap { width:100%; max-width:1100px; height:100%; padding:22px 24px 26px; overflow-y:auto; }
      h1 { margin:0; font-size:20px; letter-spacing:0.2px; }
      .subtitle { color:#93a3b8; margin:6px 0 16px; font-size:13px; line-height:1.5; }
      form { display:flex; flex-direction:column; gap:12px; }
      #profiles { display:flex; flex-direction:column; gap:12px; }
      .profile-card { border:1px solid #1b2536; border-radius:12px; padding:14px 16px 12px; background:linear-gradient(145deg, #0f1828, #0c111a); box-shadow:0 14px 40px rgba(0,0,0,0.28); display:flex; flex-direction:column; gap:12px; }
      .profile-head { display:flex; align-items:flex-start; gap:10px; flex-wrap:wrap; }
      .head-titles { display:flex; flex-direction:column; gap:4px; min-width:0; }
      .profile-head h2 { margin:0; font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .profile-actions { margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .pill { padding:6px 10px; border-radius:9px; border:1px solid #223049; font-size:12px; cursor:default; color:#8fa0b8; background:rgba(255,255,255,0.03); }
      .pill.primary { border-color:#2f8ff0; color:#d9e8ff; background:rgba(47,143,240,0.12); }
      .fields { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px 12px; }
      .field { display:flex; flex-direction:column; gap:6px; }
      label { font-weight:700; font-size:12px; color:#cad7eb; letter-spacing:0.1px; }
      input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid #1f2b3d; background:#111a29; color:#e8ecf1; outline:none; transition:border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; }
      input:focus { border-color:#2f8ff0; box-shadow:0 0 0 2px rgba(47,143,240,0.15); background:#111e30; }
      small { color:#8fa0b8; font-size:12px; line-height:1.4; }
      .row { display:flex; gap:8px; align-items:center; }
      .row input { flex:1; }
      .row button { flex:0 0 auto; min-width:92px; }
      .actions { display:flex; gap:10px; position:sticky; bottom:0; padding-top:8px; background:linear-gradient(180deg, transparent 0%, #0b111a 36%); }
      .actions button { flex:1; }
      button { padding:11px 13px; border-radius:10px; border:none; cursor:pointer; font-weight:700; letter-spacing:0.2px; }
      .primary { background:#2f8ff0; color:#fff; }
      .ghost { background:transparent; border:1px solid #1f2b3d; color:#e8ecf1; }
      .add { width:100%; margin-top:4px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Configure Chat Web Desktop</h1>
      <p class="subtitle">Set up your primary service, then add more only if needed. Windows stay available from the tray.</p>
      <form id="form">
        <div id="profiles"></div>
        <button type="button" class="ghost add" id="addProfile">+ Add profile</button>
        <div class="actions">
          <button type="button" class="ghost" id="clear">Clear All</button>
          <button type="submit" class="primary">Save & Reload</button>
        </div>
      </form>
    </div>
    <script>
      const { ipcRenderer } = require('electron');
      const container = document.getElementById('profiles');
      const addProfileBtn = document.getElementById('addProfile');

      const generateId = () => 'profile-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      const esc = (value) => (value || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      const updatePrimaryBadges = () => {
        const cards = Array.from(container.querySelectorAll('.profile-card'));
        cards.forEach((card, idx) => {
          const pill = card.querySelector('.pill');
          if (!pill) return;
          if (idx === 0) {
            pill.classList.add('primary');
            pill.textContent = 'Primary · ID: ' + (card.dataset.id || '');
          } else {
            pill.classList.remove('primary');
            pill.textContent = 'ID: ' + (card.dataset.id || '');
          }
        });
      };

      const ensureAtLeastOneCard = () => {
        if (!container.children.length) addProfileCard({ name: 'Service One', url: 'https://example.com' });
      };

      function addProfileCard(profile = {}) {
        const id = profile.id || generateId();
        const card = document.createElement('div');
        card.className = 'profile-card';
        card.dataset.id = id;
        card.dataset.originalName = profile.name || '';
        card.dataset.originalTitle = profile.title || '';
        const isPrimary = container.children.length === 0;
        card.innerHTML = \`
          <div class="profile-head">
            <div class="head-titles">
              <h2>\${esc(profile.name || profile.title || 'Profile')}</h2>
              <span class="pill \${isPrimary ? 'primary' : ''}">\${isPrimary ? 'Primary · ' : ''}ID: \${id}</span>
            </div>
            <div class="profile-actions">
              <button type="button" class="ghost" data-action="remove">Remove</button>
            </div>
          </div>
          <div class="fields">
            <div class="field">
              <label>Name</label>
              <input data-field="name" type="text" placeholder="Chat, Mail, Support..." autocomplete="off" value="\${esc(profile.name || '')}" />
            </div>

            <div class="field">
              <label>Service URL</label>
              <input data-field="url" type="url" placeholder="https://web.whatever.com" autocomplete="off" value="\${esc(profile.url || '')}" />
              <small>Leave blank to disable loading until set.</small>
            </div>

            <div class="field">
              <label>User-Agent (optional)</label>
              <input data-field="ua" type="text" placeholder="Custom User-Agent or leave blank" autocomplete="off" value="\${esc(profile.userAgent || '')}" />
            </div>

            <div class="field">
              <label>Window Title (optional)</label>
              <input data-field="title" type="text" placeholder="Defaults to the Name above" autocomplete="off" value="\${esc(profile.title || '')}" />
            </div>

            <div class="field">
              <label>Icon (optional)</label>
              <div class="row">
                <input data-field="iconPath" type="text" placeholder="Path to .png/.ico/.icns" autocomplete="off" value="\${esc(profile.iconPath || '')}" />
                <button type="button" class="ghost" data-action="browse">Browse</button>
              </div>
              <small>Per-profile icon is used for its window. Leave blank to use the default chat icon.</small>
            </div>

            <div class="field">
              <label>Notification Icon (optional)</label>
              <div class="row">
                <input data-field="iconNotifyPath" type="text" placeholder="Path to .png/.ico/.icns for new message" autocomplete="off" value="\${esc(profile.iconNotifyPath || '')}" />
                <button type="button" class="ghost" data-action="browse-notify">Browse</button>
              </div>
              <small>Used while the tray blinks for new messages for this profile.</small>
            </div>
          </div>
        \`;

        card.querySelector('[data-action="remove"]').addEventListener('click', () => {
          card.remove();
          ensureAtLeastOneCard();
          updatePrimaryBadges();
        });

        card.querySelector('[data-action="browse"]').addEventListener('click', async () => {
          const selected = await ipcRenderer.invoke('chatweb-config:chooseIcon');
          if (selected && selected.path) {
            card.querySelector('[data-field="iconPath"]').value = selected.path;
          }
        });

        card.querySelector('[data-action="browse-notify"]').addEventListener('click', async () => {
          const selected = await ipcRenderer.invoke('chatweb-config:chooseIcon');
          if (selected && selected.path) {
            card.querySelector('[data-field="iconNotifyPath"]').value = selected.path;
          }
        });

        container.appendChild(card);
        updatePrimaryBadges();
      }

      (async () => {
        const cfg = await ipcRenderer.invoke('chatweb-config:get');
        container.innerHTML = '';
        if (cfg && Array.isArray(cfg.profiles) && cfg.profiles.length) {
          cfg.profiles.forEach((p) => addProfileCard(p));
        } else {
          addProfileCard({ name: 'Service One', url: 'https://example.com' });
        }
      })();

      addProfileBtn.addEventListener('click', () => addProfileCard({}));

      document.getElementById('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const profiles = Array.from(container.querySelectorAll('.profile-card')).map((card, idx) => {
          const get = (selector) => card.querySelector(selector)?.value || '';
          const name = get('[data-field="name"]').trim();
          const rawTitle = get('[data-field="title"]');
          const originalName = card.dataset.originalName || '';
          const originalTitle = card.dataset.originalTitle || '';
          const trimmedTitle = rawTitle ? rawTitle.trim() : '';
          const titleMatchesOriginal = trimmedTitle && originalTitle && trimmedTitle === originalTitle;
          let title = trimmedTitle;
          if (!title) title = name;
          else if (titleMatchesOriginal && name && name !== title) title = name;
          return {
            id: card.dataset.id || generateId(),
            name,
            url: get('[data-field="url"]'),
            userAgent: get('[data-field="ua"]'),
            title,
            iconPath: get('[data-field="iconPath"]'),
            iconNotifyPath: get('[data-field="iconNotifyPath"]')
          };
        }).filter((p) => p.name || p.url);

        await ipcRenderer.invoke('chatweb-config:set', { profiles });
        window.close();
      });

      document.getElementById('clear').addEventListener('click', async () => {
        await ipcRenderer.invoke('chatweb-config:clear');
        window.close();
      });
    </script>
  </body></html>`;

  configWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 640,
    minHeight: 600,
    resizable: true,
    minimizable: true,
    maximizable: true,
    autoHideMenuBar: true,
    modal: false,
    parent: Array.from(windows.values()).find((w) => w && !w.isDestroyed()) || null,
    backgroundColor: '#0c1117',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Open external links in default OS browser instead of new Electron window (config window)
  if (configWindow && configWindow.webContents && typeof configWindow.webContents.setWindowOpenHandler === 'function') {
    configWindow.webContents.setWindowOpenHandler(({ url }) => {
      try { shell.openExternal(url); } catch (_) {}
      return { action: 'deny' };
    });
  }

  configWindow.on('closed', () => {
    configWindow = null;
  });

  configWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function registerIpcHandlers() {
  if (!ipcMain) return;
  ipcMain.handle('chatweb-config:get', async () => loadUserConfig());
  ipcMain.handle('chatweb-config:set', async (_event, payload) => {
    const merged = saveUserConfig(payload || {});
    syncProfileWindows();
    syncTrays();
    applyTrayConfig();
    applyTrayIcon();
    updateTrayAttention();
    return merged;
  });
  ipcMain.handle('chatweb-config:clear', async () => {
    clearUserConfig();
    syncProfileWindows({ createMissing: false });
    syncTrays();
    applyTrayConfig();
    applyTrayIcon();
    updateTrayAttention();
    return loadUserConfig();
  });
  ipcMain.handle('chatweb-config:open', async () => {
    openConfigWindow();
    return true;
  });
  ipcMain.handle('chatweb-config:chooseIcon', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select icon',
        properties: ['openFile'],
        filters: [
          { name: 'Images', extensions: ['png', 'ico', 'icns'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      if (result.canceled || !result.filePaths || !result.filePaths.length) {
        return {};
      }
      return { path: result.filePaths[0] };
    } catch (e) {
      console.warn('Icon chooser failed:', e && e.message);
      return {};
    }
  });
  ipcMain.on('chatweb:notification', (event) => {
    try {
      const profileId = getProfileIdFromWebContents(event && event.sender);
      if (!profileId) return;
      const profile = getProfileById(profileId);
      let currentUrl = '';
      try {
        currentUrl = event && event.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '';
      } catch (e) {}
      if (!profileMatchesAttentionTargets(profile, currentUrl)) return;
      setUnreadState(profileId, true);
    } catch (e) {
      console.warn('chatweb:notification handler failed:', e && e.message);
    }
  });
}

// Ensure the app uses a local writable userData directory next to the executable for portability and multi-user support
if (!IS_TEST) {
  try {
    const exeDir = path.dirname(process.execPath);
    const overridePath = process.env.CHAT_WEB_USER_DATA;
    const dataPath = overridePath ? path.resolve(overridePath) : path.join(exeDir, 'user_data');
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
    app.setPath('userData', dataPath);
    console.log('User data path set to:', dataPath);
  } catch (e) {
    console.warn('Could not set userData path, continuing with defaults:', e && e.message);
  }
}

const shouldAutoStart = !process.env.CHAT_WEB_TEST_MODE;

if (shouldAutoStart) {
  app.whenReady().then(() => {
    registerIpcHandlers();
    Menu.setApplicationMenu(null);
    syncProfileWindows();
    syncTrays();
    applyTrayConfig();
    updateTrayAttention();
    if (!getProfiles().length) openConfigWindow();
  });

  app.on('window-all-closed', () => {
    // keep running for tray
  });

  app.on('before-quit', () => {
    isQuitting = true;
    destroyAllTrays();
    for (const win of windows.values()) {
      if (win && !win.isDestroyed()) win.__forceClose = true;
    }
  });

  app.on('activate', () => {
    const profile = getProfileById(lastActiveProfileId) || getPrimaryProfile();
    if (profile) showProfileWindow(profile.id);
    else openConfigWindow();
  });
}

module.exports = {
  trimString,
  normalizeProfile,
  normalizeConfig,
  getProfiles,
  getProfileById,
  getPrimaryProfile
};
