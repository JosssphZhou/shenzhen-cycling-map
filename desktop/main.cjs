const { app, BrowserWindow, protocol, session, Menu, shell, ipcMain, screen, nativeTheme } = require('electron');
const { join, resolve } = require('node:path');
const { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } = require('node:fs');
const { createAssetHandler, isInternalUrl, isExternalUrl } = require('./assets.cjs');

const NAME = '深圳骑行地图';
app.setName(NAME);
const userData = join(app.getPath('appData'), 'shenzhen-delivery-desktop');
mkdirSync(userData, { recursive: true });
mkdirSync(join(userData, 'session'), { recursive: true });
app.setPath('userData', userData); app.setPath('sessionData', join(userData, 'session'));
protocol.registerSchemesAsPrivileged([{ scheme: 'shenzhen', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

let window = null, quitting = false;
const windowStatePath = join(userData, 'window-state.json');
function startupUrl() {
  try { if (JSON.parse(readFileSync(windowStatePath, 'utf8')).mode === 'demo') return 'shenzhen://app/prototype/delivery?mode=demo'; } catch {}
  return 'shenzhen://app/prototype/delivery';
}
function reveal() {
  if (!window || window.isDestroyed()) return createWindow();
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    title: NAME, width: Math.min(1440, area.width - 40), height: Math.min(1000, area.height - 40), minWidth: 700, minHeight: 560,
    show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0d0e' : '#e9eaea',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(__dirname, 'preload.cjs') },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => { if (!isInternalUrl(event.url)) event.preventDefault(); });
  window.webContents.on('will-redirect', event => { if (!isInternalUrl(event.url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => { if (!quitting && process.platform === 'darwin') { event.preventDefault(); window.hide(); } });
  window.once('ready-to-show', () => { if (window && !window.isDestroyed()) window.show(); });
  window.on('closed', () => { window = null; });
  void window.loadURL(startupUrl());
  return window;
}
function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: NAME, submenu: [
      { label: `关于${NAME}`, role: 'about' }, { type: 'separator' }, { label: '服务', role: 'services', submenu: [] },
      { type: 'separator' }, { label: `隐藏${NAME}`, role: 'hide' }, { label: '隐藏其他应用', role: 'hideOthers' }, { label: '显示全部', role: 'unhide' },
      { type: 'separator' }, { label: `退出${NAME}`, role: 'quit' },
    ] },
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
      { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '粘贴并匹配样式', role: 'pasteAndMatchStyle' }, { label: '全选', role: 'selectAll' },
    ] },
    { label: '显示', submenu: [
      { label: '重新载入', role: 'reload' }, { type: 'separator' }, { label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' },
      { type: 'separator' }, { label: '切换全屏', role: 'togglefullscreen' },
    ] },
    { label: '窗口', submenu: [
      { label: '最小化', role: 'minimize' }, { label: '缩放', role: 'zoom' }, { label: '隐藏窗口', accelerator: 'CmdOrCtrl+W', click: () => window?.hide() },
      { type: 'separator' }, { label: '显示地图', click: () => reveal() }, { label: '全部置于前面', role: 'front' },
    ] },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (app.isReady()) reveal(); });
  app.on('before-quit', () => {
    quitting = true;
    try {
      if (window && !window.isDestroyed() && isInternalUrl(window.webContents.getURL())) {
        const mode = new URL(window.webContents.getURL()).searchParams.get('mode') === 'demo' ? 'demo' : 'focus';
        writeFileSync(windowStatePath + '.tmp', JSON.stringify({ mode }) + '\n'); renameSync(windowStatePath + '.tmp', windowStatePath);
      }
    } catch (error) { console.error('窗口状态未能保存', error.message); }
    if (app.isReady()) session.defaultSession.flushStorageData();
  });
  app.on('activate', () => { if (app.isReady()) reveal(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.whenReady().then(() => {
    const site = app.isPackaged ? join(__dirname, 'site') : resolve(__dirname, '../out');
    const manifestPath = join(__dirname, 'resources.json');
    const manifest = existsSync(manifestPath) ? require(manifestPath) : undefined;
    protocol.handle('shenzhen', createAssetHandler(site, { manifest }));
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'clipboard-sanitized-write' && isInternalUrl(contents.getURL())));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => permission === 'clipboard-sanitized-write' && !!contents && isInternalUrl(contents.getURL()));
    ipcMain.on('open-source-link', (event, url) => {
      if (!window || event.sender !== window.webContents || !event.senderFrame || !isInternalUrl(event.senderFrame.url) || !isExternalUrl(url)) return;
      void shell.openExternal(url).catch(error => console.error('资料链接未能打开', error.message));
    });
    app.setAboutPanelOptions({ applicationName: NAME, applicationVersion: app.getVersion(), copyright: '本地离线体验版，包含来源与致谢。' });
    installMenu(); createWindow();
  }).catch(error => { console.error('应用未能启动', error); app.quit(); });
}
