const { ipcRenderer } = require('electron');

// Expose minimal API for splash/config controls
try {
  if (!window.chatWeb) window.chatWeb = {};
  window.chatWeb.openConfig = () => ipcRenderer.invoke('chatweb-config:open');
  window.chatWeb.clearConfig = () => ipcRenderer.invoke('chatweb-config:clear');
} catch (e) {}

// Surface new message signals to the main process by piggybacking on Notifications
try {
  const NativeNotification = window.Notification;
  if (NativeNotification) {
    const WrappedNotification = function(title, options) {
      const instance = new NativeNotification(title, options);
      try {
        ipcRenderer.send('chatweb:notification', {
          title,
          url: window.location && window.location.href ? window.location.href : ''
        });
      } catch (e) {}
      return instance;
    };
    WrappedNotification.prototype = NativeNotification.prototype;
    Object.setPrototypeOf(WrappedNotification, NativeNotification);
    WrappedNotification.requestPermission = NativeNotification.requestPermission
      ? NativeNotification.requestPermission.bind(NativeNotification)
      : undefined;
    window.Notification = WrappedNotification;
  }
} catch (e) {}

// Optional spoofing: disabled by default. Enable by setting CHAT_WEB_PRELOAD_UA.
(function() {
  const explicitUA = process.env.CHAT_WEB_PRELOAD_UA;
  if (!explicitUA) return;

  const spoofedVersion = process.env.CHAT_WEB_PRELOAD_UA_VERSION || '131.0.0.0';
  const newUA = explicitUA;

  try {
    Object.defineProperty(navigator, 'userAgent', { get: () => newUA, configurable: true });
  } catch (e) {}

  try {
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });
  } catch (e) {}

  try {
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true });
  } catch (e) {}

  const uaData = {
    brands: [
      { brand: 'Chromium', version: spoofedVersion },
      { brand: 'Google Chrome', version: spoofedVersion }
    ],
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues: () =>
      Promise.resolve({
        architecture: 'x86',
        model: '',
        platform: 'Windows',
        platformVersion: '10.0.0',
        uaFullVersion: spoofedVersion
      })
  };

  try {
    Object.defineProperty(navigator, 'userAgentData', { get: () => uaData, configurable: true });
  } catch (e) {}

  try {
    if (!window.chrome) window.chrome = { runtime: {} };
    else if (!window.chrome.runtime) window.chrome.runtime = {};
  } catch (e) {}

  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch (e) {}

  try { delete window.electron; } catch (e) {}
  try { delete window.process; } catch (e) {}
  try { delete window.require; } catch (e) {}
  try { delete window.module; } catch (e) {}
})();
