import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, Tray, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Helper } from './helper';
import type { Preferences, RuntimeStatus } from '../shared/types';
const root = path.resolve(__dirname, '../..');
const dev = !app.isPackaged;
const rendererURL = process.env.SARGOSH_RENDERER_URL;
if (dev) app.setPath('userData', path.join(root, '.local', 'electron'));
app.setName('Sargosh');
let mainWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
const helper = new Helper();
const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();
const rendererFile = path.join(root, 'dist', 'renderer', 'index.html');
function trustedURL(raw: string): boolean {
  try { const url = new URL(raw); return rendererURL ? url.origin === new URL(rendererURL).origin : raw.split('#')[0] === pathToFileURL(rendererFile).href; } catch { return false; }
}
function checkSender(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !trustedURL(event.senderFrame.url)) throw new Error('Untrusted application request.');
}
function handle(channel: string, callback: (value: any) => unknown): void {
  ipcMain.handle(channel, (event, value) => { checkSender(event); return callback(value); });
}
function createWindow(overlay = false): BrowserWindow {
  const window = new BrowserWindow({
    width: overlay ? 360 : 1220, height: overlay ? 120 : 820,
    minWidth: overlay ? 200 : 860, minHeight: overlay ? 50 : 620,
    title: 'Sargosh', show: false, autoHideMenuBar: true, backgroundColor: overlay ? '#00000000' : '#f7f6f2',
    ...(overlay ? { frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false } : {}),
    icon: path.join(root, 'assets', 'app-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!trustedURL(url)) event.preventDefault(); });
  if (rendererURL) void window.loadURL(rendererURL + (overlay ? '/#overlay' : '/')); else void window.loadFile(rendererFile, { hash: overlay ? 'overlay' : '' });
  window.once('ready-to-show', () => overlay ? window.showInactive() : window.show());
  if (overlay) {
    const area = screen.getPrimaryDisplay().workArea;
    window.setPosition(Math.round(area.x + (area.width - 360) / 2), area.y + area.height - 135);
  } else {
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  }
  return window;
}
function showMain(): void { mainWindow?.show(); mainWindow?.focus(); }
if (ownsLock) {
  app.on('second-instance', showMain);
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes || [];
      callback(trustedURL(contents.getURL()) && permission === 'media' && mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio'));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => permission === 'media' && Boolean(contents) && trustedURL(contents!.getURL()) && trustedURL(origin));
    try { await helper.start(root, path.join(root, '.local', 'development')); } catch { console.error('Python helper did not start. Check your Python installation.'); }
    handle('sargosh:snapshot', () => helper.call('snapshot'));
    handle('sargosh:preferences', (update: Partial<Preferences>) => helper.call('preferences', update));
    handle('sargosh:delete', (id: unknown) => {
      if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid history entry.');
      return helper.call('delete', { id });
    });
    handle('sargosh:open-main', () => showMain());
    handle('sargosh:move-overlay', ({ dx, dy }: { dx: number; dy: number }) => {
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 500 || Math.abs(dy) > 500 || !overlayWindow) return;
      const [x, y] = overlayWindow.getPosition();
      const area = screen.getDisplayNearestPoint({ x, y }).workArea;
      overlayWindow.setPosition(Math.round(Math.max(area.x, Math.min(x + dx, area.x + area.width - 360))), Math.round(Math.max(area.y, Math.min(y + dy, area.y + area.height - 120))));
    });
    handle('sargosh:status', async (): Promise<RuntimeStatus> => {
      try {
        const response = await fetch('http://127.0.0.1:4318/v1/readiness', { signal: AbortSignal.timeout(1500) });
        const data = await response.json() as { auth: boolean; stt: boolean; cleanup: boolean };
        return { desktop: true, helper: helper.ready, api: response.ok, auth: data.auth === true, stt: data.stt === true, cleanup: data.cleanup === true };
      } catch { return { desktop: true, helper: helper.ready, api: false, auth: false, stt: false, cleanup: false }; }
    });
    mainWindow = createWindow(); overlayWindow = createWindow(true);
    tray = new Tray(nativeImage.createFromPath(path.join(root, 'assets', 'app-icon.png')).resize({ width: 20, height: 20 }));
    tray.setToolTip('Sargosh');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Sargosh', click: showMain }, { type: 'separator' }, { label: 'Quit Sargosh', click: () => app.quit() }]));
    tray.on('click', showMain);
  }).catch(error => { console.error(error); app.quit(); });
}
app.on('window-all-closed', () => { /* The tray owns the application lifetime. */ });
app.on('before-quit', () => { quitting = true; helper.stop(); tray?.destroy(); });
