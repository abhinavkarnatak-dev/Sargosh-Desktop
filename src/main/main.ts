import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, session, Tray, webContents, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { RecordingCommands } from './recording-commands';
import { enableOverlayInput } from './overlay-input';
import { pathToFileURL } from 'node:url';
import { MAX_CLEANUP_CHARS, type CleanupRequest } from '../shared/cleanup';
import { DesktopTranscriber } from './transcription';
import { audioType, isRequestId, isSpeechLanguage, type TranscriptionRequest, type TranscriptionStatus } from '../shared/transcription';
import { Helper } from './helper';
import { INITIAL_RECORDING_STATE, MAX_AUDIO_BYTES, recordingBusy, type RecordingState } from '../shared/recording';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../shared/windows';
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
const transcriber = new DesktopTranscriber();
const recordingCommands = new RecordingCommands();
let transcriptionStatus: TranscriptionStatus = { phase: 'idle', message: '' };
let recordingState: RecordingState = { ...INITIAL_RECORDING_STATE };
let windowsState: WindowsState = { ...INITIAL_WINDOWS_STATE };
function recordingUpdate(state: RecordingState) {
  recordingState = { ...state, revision: recordingState.revision + 1 };
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('sargosh:recording-state', recordingState);
  }
}
function stopOwner(message: string) {
  recordingCommands.cancelAll();
  transcriber.cancelAll();
  transcriptionStatus = { phase: 'cancelled', message: 'Transcription cancelled.' };
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('sargosh:transcription-state', transcriptionStatus);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sargosh:recording-command', 'cancel');
  void helper.call('windows.disarm').catch(() => {});
  recordingUpdate({ ...INITIAL_RECORDING_STATE, phase: 'failed', message });
}
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false }
  });
  if (overlay) enableOverlayInput(window);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!trustedURL(url)) event.preventDefault(); });
  if (rendererURL) void window.loadURL(rendererURL + (overlay ? '/#overlay' : '/')); else void window.loadFile(rendererFile, { hash: overlay ? 'overlay' : '' });
  window.once('ready-to-show', () => overlay ? window.showInactive() : window.show());
  if (overlay) {
    const area = screen.getPrimaryDisplay().workArea;
    window.setPosition(Math.round(area.x + (area.width - 360) / 2), area.y + area.height - 135);
  } else {
    window.webContents.on('render-process-gone', () => stopOwner('The recording window stopped. Reopen Sargosh before recording again.'));
    window.webContents.on('did-start-loading', () => {
      if (recordingBusy(recordingState) || windowsState.purpose === 'recording') stopOwner('The app reloaded. Any active recording was discarded.');
    });
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
    helper.onEvent((event, data) => {
      if (event === 'helper.unavailable') { stopOwner('Windows input access stopped. Recording cancelled. Restart Sargosh.'); return; }
      if (event !== 'windows.state') return;
      windowsState = data as WindowsState;
      for (const window of [mainWindow, overlayWindow]) {
        if (window && !window.isDestroyed()) window.webContents.send('sargosh:windows-state', data);
      }
    });
    handle('sargosh:windows-status', () => helper.call('windows.status'));
    handle('sargosh:recording-status', () => recordingState);
    ipcMain.handle('sargosh:transcribe', (event, request: TranscriptionRequest) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !request || !isRequestId(request.requestId) || !isSpeechLanguage(request.language) ||
          !(request.audio instanceof ArrayBuffer) || !request.audio.byteLength || request.audio.byteLength > MAX_AUDIO_BYTES ||
          typeof request.mimeType !== 'string' || !audioType(request.mimeType)) throw new Error('Invalid audio transcription request.');
      return transcriber.transcribe(request);
    });
    ipcMain.handle('sargosh:cleanup', (event, request: CleanupRequest) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !request || !isRequestId(request.requestId) || !isSpeechLanguage(request.language) ||
          typeof request.text !== 'string' || !request.text.trim() || request.text.length > MAX_CLEANUP_CHARS) throw new Error('Invalid cleanup request.');
      return transcriber.cleanup(request);
    });
    ipcMain.handle('sargosh:transcription-cancel', (event, requestId: unknown) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !isRequestId(requestId)) throw new Error('Invalid transcription cancellation.');
      transcriber.cancel(requestId);
    });
    ipcMain.handle('sargosh:transcription-report', (event, value: TranscriptionStatus) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !value || !['idle', 'working', 'completed', 'failed', 'cancelled'].includes(value.phase) || typeof value.message !== 'string' || value.message.length > 400) throw new Error('Invalid transcription status.');
      transcriptionStatus = { phase: value.phase, message: value.message };
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('sargosh:transcription-state', transcriptionStatus);
    });
    handle('sargosh:transcription-status', () => transcriptionStatus);

    ipcMain.handle('sargosh:recording-report', (event, value: RecordingState) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents) throw new Error('Only the recording owner can publish audio state.');
      if (!value || !['idle', 'opening', 'recording', 'finishing', 'ready', 'cancelled', 'failed'].includes(value.phase) ||
          !Number.isFinite(value.level) || value.level < 0 || value.level > 100 ||
          !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 400000 ||
          typeof value.message !== 'string' || value.message.length > 400 ||
          (value.sessionId !== null && (typeof value.sessionId !== 'string' || value.sessionId.length > 100)) ||
          ![null, 'hold', 'hands-free', 'manual'].includes(value.mode) || typeof value.quiet !== 'boolean' ||
          (value.clip !== null && (!Number.isFinite(value.clip.bytes) || value.clip.bytes < 0 || value.clip.bytes > MAX_AUDIO_BYTES || typeof value.clip.mimeType !== 'string' || value.clip.mimeType.length > 100))) {
        throw new Error('Invalid recording state.');
      }
      recordingUpdate({ revision: 0, phase: value.phase, sessionId: value.sessionId, mode: value.mode,
        durationMs: value.durationMs, level: value.level, quiet: value.quiet, message: value.message,
        clip: value.clip ? { bytes: value.clip.bytes, mimeType: value.clip.mimeType } : null,
        target: windowsState.sessionId === value.sessionId ? windowsState.target : null });
    });
    handle('sargosh:recording-action', (action: unknown) => {
      if (action !== 'cancel' && action !== 'finish') throw new Error('Invalid recording action.');
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) throw new Error('The recording window is unavailable.');
      const owner = mainWindow.webContents;
      return recordingCommands.run(owner.id, action, command => owner.send('sargosh:recording-command', command));
    });
    ipcMain.handle('sargosh:recording-command-result', (event, result: unknown) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !result || typeof result !== 'object') throw new Error('Invalid recording control response.');
      const value = result as { id?: unknown; ok?: unknown };
      if (typeof value.id !== 'string' || value.id.length > 100 || typeof value.ok !== 'boolean') throw new Error('Invalid recording control response.');
      recordingCommands.settle(event.sender.id, value.id, value.ok);
    });
    handle('sargosh:recording-start', (shortcut: unknown) => {
      if (recordingBusy(recordingState) || transcriptionStatus.phase === 'working' || typeof shortcut !== 'string' || shortcut.length > 80) throw new Error('Finish recording before changing shortcuts.');
      const ignoredProcessIds = [...new Set([process.pid, ...webContents.getAllWebContents().map(contents => contents.getOSProcessId())])].filter(pid => pid > 0);
      return helper.call('windows.arm', { shortcut, ignoredProcessIds, purpose: 'recording' });
    });
    powerMonitor.on('suspend', () => stopOwner('The computer went to sleep. Any active recording was discarded.'));

    handle('sargosh:windows-start', (shortcut: unknown) => {
      if (recordingBusy(recordingState) || transcriptionStatus.phase === 'working' || !dev || typeof shortcut !== 'string' || shortcut.length > 80) throw new Error('Invalid Windows test request.');
      const ignoredProcessIds = [...new Set([process.pid, ...webContents.getAllWebContents().map(contents => contents.getOSProcessId())])].filter(pid => pid > 0);
      return helper.call('windows.arm', { shortcut, ignoredProcessIds });
    });
    handle('sargosh:windows-action', (action: unknown) => {
      if (!dev || !['cancel', 'finish', 'start-hands-free', 'disarm'].includes(String(action))) throw new Error('Invalid Windows test action.');
      return helper.call('windows.' + action);
    });
    handle('sargosh:windows-insert-test', (sessionId: unknown) => {
      if (!dev || typeof sessionId !== 'string' || sessionId.length > 80) throw new Error('Invalid Windows test session.');
      return helper.call('windows.insert-test', { sessionId });
    });
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
app.on('before-quit', () => { recordingCommands.cancelAll(); transcriber.cancelAll(); quitting = true; helper.stop(); tray?.destroy(); });
