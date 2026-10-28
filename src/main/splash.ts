import { BrowserWindow } from 'electron';
import path from 'node:path';
import { splashMarkup } from './startup';
export function createSplash(theme: 'light' | 'dark') {
  const window = new BrowserWindow({ width: 400, height: 330, title: 'Sargosh', show: false, frame: false,
    resizable: false, maximizable: false, minimizable: false, center: true,
    icon: path.resolve(__dirname, '../../assets/app-icon.png'),
    backgroundColor: theme === 'dark' ? '#111813' : '#eeeee6',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.showInactive(); });
  void window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashMarkup(theme))).catch(() => { if (!window.isDestroyed()) window.destroy(); });
  return window;
}
