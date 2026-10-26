import { BrowserWindow } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { splashMarkup } from './startup';
export function createSplash(brandDirectory: string, theme: 'light' | 'dark') {
  const window = new BrowserWindow({ width: 400, height: 330, title: 'Sargosh', show: false, frame: false,
    resizable: false, maximizable: false, minimizable: false, center: true,
    backgroundColor: theme === 'dark' ? '#191b18' : '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const logo = readFileSync(path.join(brandDirectory, `logo-${theme}.png`)).toString('base64');
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.showInactive(); });
  void window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashMarkup(logo, theme))).catch(() => { if (!window.isDestroyed()) window.destroy(); });
  return window;
}
