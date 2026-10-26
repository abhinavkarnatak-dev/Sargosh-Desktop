import { createSplash } from './splash';
import { StartupGate } from './startup';
import { validAccountUsage } from '../shared/usage';
import { apiEndpoint } from '../shared/api-endpoint';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { DesktopAuth } from './auth';
import { AccountDeletion } from './account-deletion';
import { AuthStorage } from './auth-storage';
import { publicAuthConfig, hasProfileName } from '../shared/auth';
import { retrySavedTranscript } from './history-retry';
import { LocalHistory } from './history';
import { isHistoryId, type HistoryCapture, type HistoryResult } from '../shared/history';
import { titleBarAppearance } from './titlebar';
import { recoveryTextForCopy, validOverlayNotice } from '../shared/overlay-notice';
import { resizeOverlayBounds } from './overlay-bounds';
import { deliveryTimeout, validDeliveryRequest, type DeliveryResult } from '../shared/delivery';
import { app, clipboard, dialog, safeStorage, shell, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, screen, session, Tray, webContents, type IpcMainInvokeEvent } from 'electron';
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
let splashWindow: BrowserWindow | undefined;
function closeSplash() { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy(); splashWindow = undefined; }
const startup = new StartupGate(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); closeSplash(); });
function startupFailed() {
  if (startup.complete || quitting) return;
  startup.cancel(); closeSplash();
  dialog.showErrorBox('Sargosh could not open', 'The app could not finish starting. Please restart Sargosh.');
  app.quit();
}
let overlayWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let activeDelivery: string | null = null;
let history: LocalHistory | undefined;
let auth: DesktopAuth | undefined;
let authStorage: AuthStorage | undefined;
let accountChanging = false;
let historyRetry: string | null = null;
const finishedRecordings = new Map<string, { createdAt: string; durationMs: number; bytes: number; mimeType: string }>();
const helper = new Helper();
let desktopEnvironment:Record<string,string|undefined>={...process.env};
try{desktopEnvironment={...parseEnv(readFileSync(path.join(root,'.env'),'utf8')),...process.env};}catch{}
if(!dev){try{desktopEnvironment={...JSON.parse(readFileSync(path.join(root,'dist','desktop-config.json'),'utf8')),...process.env};}catch{}}
if(!dev&&!desktopEnvironment.SARGOSH_API_URL)throw new Error('The installed app is missing its hosted API configuration.');
const apiBase=apiEndpoint(desktopEnvironment.SARGOSH_API_URL??'http://127.0.0.1:4318');
const transcriber = new DesktopTranscriber(async () => { if (!auth) throw new Error('Sign in to use cloud dictation.'); return auth.accessToken(); },apiBase);
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
  if (activeDelivery) void helper.call('windows.cancel-delivery', { sessionId: activeDelivery }).catch(() => {});
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
    width: overlay ? 420 : 1220, height: overlay ? 120 : 820,
    minWidth: overlay ? 200 : 860, minHeight: overlay ? 50 : 620,
    title: 'Sargosh', show: false, autoHideMenuBar: true, backgroundColor: overlay ? '#00000000' : '#f7f6f2',
    ...(overlay ? { frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false } : process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: titleBarAppearance(nativeTheme.shouldUseDarkColors ? 'dark' : 'light') } : {}),
    icon: path.join(root, 'assets', 'app-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false }
  });
  if (overlay) enableOverlayInput(window);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!trustedURL(url)) event.preventDefault(); });
  if (rendererURL) void window.loadURL(rendererURL + (overlay ? '/#overlay' : '/')); else void window.loadFile(rendererFile, { hash: overlay ? 'overlay' : '' });
  window.once('ready-to-show', () => overlay ? window.showInactive() : startup.painted());
  if (!overlay) window.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3) startupFailed(); });
  if (overlay) {
    const area = screen.getPrimaryDisplay().workArea;
    window.setPosition(Math.round(area.x + (area.width - 420) / 2), area.y + area.height - 135);
  } else {
    window.webContents.on('render-process-gone', () => { if (!startup.complete) startupFailed(); else stopOwner('The recording window stopped. Reopen Sargosh before recording again.'); });
    window.webContents.on('did-start-loading', () => {
      if (recordingBusy(recordingState) || windowsState.enabled && windowsState.purpose === 'recording') stopOwner('The app reloaded. Any active recording was discarded.');
    });
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  }
  return window;
}
function showMain(): void { if (!startup.complete) { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show(); return; } mainWindow?.show(); mainWindow?.focus(); }
if (ownsLock) {
  app.on('second-instance', showMain);
  app.whenReady().then(async () => {
    splashWindow = createSplash(path.join(root, dev ? 'src/renderer/public/brand' : 'dist/renderer/brand'), nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes || [];
      callback(trustedURL(contents.getURL()) && permission === 'media' && mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio'));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => permission === 'media' && Boolean(contents) && trustedURL(contents!.getURL()) && trustedURL(origin));
    const dataDirectory = dev ? path.join(root, '.local', 'development') : app.getPath('userData');
    try { await helper.start(root, dataDirectory); } catch { console.error('Python helper did not start. Check your Python installation.'); }
    history = new LocalHistory(path.join(dataDirectory, 'recordings'), helper, () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sargosh:history-changed');
    });
    await history.initialize().catch(() => console.error('Local recording history could not be opened.'));
    ipcMain.on('sargosh:ui-ready', event => {
      try { checkSender(event); } catch { return; }
      if (event.sender === mainWindow?.webContents) startup.rendered();
    });
    function ownerHandle(channel: string, work: (value: any) => unknown) {
      ipcMain.handle(channel, (event, value) => { checkSender(event); if (event.sender !== mainWindow?.webContents || quitting || accountChanging) throw new Error('History is unavailable.'); if (channel.startsWith('sargosh:history-') || channel === 'sargosh:delete') requireAccount(); return work(value); });
    }
    let authConfig;
    authConfig=publicAuthConfig(desktopEnvironment);
    authStorage = new AuthStorage(path.join(app.getPath('userData'), 'auth-session.bin'), safeStorage);
    auth = new DesktopAuth(authConfig, authStorage, async userId => {
      accountChanging = true;
      try {
        stopOwner('Account changed. Recording stopped.');
        await history?.drain();
        const selected = await helper.call<{ directory: string }>('account.select', { userId });
        history = new LocalHistory(path.join(selected.directory, 'recordings'), helper, () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sargosh:history-changed');
        });
        await history.initialize(); finishedRecordings.clear();
        recordingUpdate({ ...INITIAL_RECORDING_STATE });
        transcriptionStatus = { phase: 'idle', message: '' };
        for (const window of [mainWindow, overlayWindow]) if (window && !window.isDestroyed()) window.webContents.send('sargosh:transcription-state', transcriptionStatus);
        // A fresh renderer drops previous audio previews, transcripts and cached history.
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      } finally { accountChanging = false; }
    }, state => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sargosh:auth-state', state);
      if (state.phase === 'signed-in') showMain();
    }, url => shell.openExternal(url));
    function requireAccount() {
      if (accountChanging || auth?.snapshot().phase !== 'signed-in') throw new Error('Sign in to use Sargosh.');
      if (!hasProfileName(auth.snapshot().user)) throw new Error('Enter your name to finish setting up Sargosh.');
    }
    function authAction(channel: string, work: (value: any) => unknown) {
      ownerHandle(channel, value => { if (recordingBusy(recordingState) || transcriber.busy || activeDelivery || historyRetry) throw new Error('Finish the current dictation first.'); return work(value); });
    }
    ownerHandle('sargosh:usage',async()=>{
      requireAccount();if(!apiBase.startsWith('https://'))return null;
      const response=await fetch(apiBase+'/v1/usage',{headers:{Authorization:'Bearer '+await auth!.accessToken()},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(100000)});
      const value=await response.json().catch(()=>null);
      if(!response.ok||!validAccountUsage(value))throw new Error('Could not load your usage allowance. Please try again.');
      return value;
    });
    ownerHandle('sargosh:auth-state', () => auth!.snapshot());
    authAction('sargosh:auth-send-code', email => auth!.sendCode(email));
    authAction('sargosh:auth-verify-code', value => auth!.verifyCode(value?.email, value?.code));
    authAction('sargosh:auth-google', () => auth!.signInGoogle());
    authAction('sargosh:auth-google-cancel', () => auth!.cancelGoogle());
    authAction('sargosh:auth-sign-out', () => auth!.signOut());
    authAction('sargosh:auth-onboarding', () => auth!.completeOnboarding());
    authAction('sargosh:auth-profile', value => auth!.updateProfile(value?.firstName, value?.lastName));
    const accountDeletion = new AccountDeletion(path.join(dataDirectory, 'account-cleanup.json'), async userId => {
      await history?.drain();
      await helper.call('account.delete', { userId }, 30000);
      finishedRecordings.clear();
    }, async () => { await auth!.forgetDeletedAccount(); });
    authAction('sargosh:auth-delete', async confirmation => {
      requireAccount();
      if (confirmation !== 'DELETE') throw new Error('Confirm account deletion before continuing.');
      const userId = auth!.snapshot().user!.id;
      const token = await auth!.accessToken();
      accountChanging = true;
      let completed = false;
      try { await accountDeletion.remove(apiBase, userId, token); completed = true; }
      finally { accountChanging = !completed && accountDeletion.cloudDeleted; }
    });
    ownerHandle('sargosh:history-save', async (request: HistoryCapture) => {
      const metadata = request && finishedRecordings.get(request.id);
      if (!metadata || !request.audio || request.audio.byteLength !== metadata.bytes || request.mimeType !== metadata.mimeType) throw new Error('Invalid finished recording.');
      await history!.capture(request, { createdAt: metadata.createdAt, durationMs: metadata.durationMs });
    });
    ownerHandle('sargosh:history-update', (request: HistoryResult) => history!.update(request));
    ownerHandle('sargosh:history-list', cursor => history!.list(cursor));
    ownerHandle('sargosh:history-audio', id => history!.audio(id));
    ownerHandle('sargosh:history-copy', async (id: string) => { const entry = await history!.get(id); if (!entry?.text) throw new Error('No transcript available.'); clipboard.writeText(entry.text); });
    ownerHandle('sargosh:history-extract', async (id: string) => {
      const entry = await history!.get(id); if (!entry?.audioMimeType || !entry.audioBytes) throw new Error('Original audio is unavailable.');
      const extension = ({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a' } as Record<string, string>)[audioType(entry.audioMimeType) ?? ''];
      if (!extension) throw new Error('Unsupported recording format.');
      const result = await dialog.showSaveDialog(mainWindow!, { title: 'Extract original audio', defaultPath: 'Sargosh-' + entry.createdAt.replace(/[:.]/g, '-') + '.' + extension, filters: [{ name: 'Original audio', extensions: [extension] }] });
      if (result.canceled || !result.filePath) return false;
      await history!.exportAudio(id, result.filePath); return true;
    });
    ownerHandle('sargosh:history-retry', async (id: string) => {
      if (historyRetry || activeDelivery || transcriber.busy || transcriptionStatus.phase === 'working' || recordingBusy(recordingState) || ['pending', 'listening'].includes(windowsState.phase)) throw new Error('Finish the current dictation first.');
      if (!isHistoryId(id)) throw new Error('Invalid recording.');
      historyRetry = id;
      try {
        await helper.call('windows.set-busy', { busy: true });
        await retrySavedTranscript(id, history!, transcriber);
      } finally {
        historyRetry = null;
        void helper.call('windows.set-busy', { busy: ['working'].includes(transcriptionStatus.phase) }).catch(() => {});
      }
    });
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
    for (const channel of ['sargosh:transcribe', 'sargosh:practice-transcribe']) ipcMain.handle(channel, (event, request: TranscriptionRequest) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !request || !isRequestId(request.requestId) || !isSpeechLanguage(request.language) ||
          !(request.audio instanceof ArrayBuffer) || !request.audio.byteLength || request.audio.byteLength > MAX_AUDIO_BYTES ||
          typeof request.mimeType !== 'string' || !audioType(request.mimeType)) throw new Error('Invalid audio transcription request.');
      if (historyRetry) return { ok: false, code: 'BUSY', message: 'Wait for the transcript retry to finish.' };
      return transcriber.transcribe({ ...request, practice: channel === 'sargosh:practice-transcribe' });
    });
    for (const channel of ['sargosh:cleanup', 'sargosh:practice-cleanup']) ipcMain.handle(channel, (event, request: CleanupRequest) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !request || !isRequestId(request.requestId) || !isSpeechLanguage(request.language) ||
          typeof request.text !== 'string' || !request.text.trim() || request.text.length > MAX_CLEANUP_CHARS) throw new Error('Invalid cleanup request.');
      if (historyRetry) return { ok: false, code: 'BUSY', message: 'Wait for the transcript retry to finish.' };
      return transcriber.cleanup({ ...request, practice: channel === 'sargosh:practice-cleanup' });
    });
    ipcMain.handle('sargosh:transcription-cancel', (event, requestId: unknown) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !isRequestId(requestId)) throw new Error('Invalid transcription cancellation.');
      transcriber.cancel(requestId);
    });
    ipcMain.handle('sargosh:transcription-report', (event, value: TranscriptionStatus) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !value || !['idle', 'working', 'completed', 'failed', 'cancelled'].includes(value.phase) || typeof value.message !== 'string' || value.message.length > 400) throw new Error('Invalid transcription status.');
      if (value.notice !== undefined && !validOverlayNotice(value.notice)) throw new Error('Invalid overlay notice.');
      transcriptionStatus = { phase: value.phase, message: value.message, ...(value.notice ? { notice: value.notice } : {}) };
      void helper.call('windows.set-busy', { busy: value.phase === 'working' || historyRetry !== null }).catch(() => {});
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('sargosh:transcription-state', transcriptionStatus);
    });
    handle('sargosh:transcription-status', () => transcriptionStatus);

    ipcMain.handle('sargosh:recording-report', (event, value: RecordingState) => {
      checkSender(event);
      if (accountChanging) return;
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
      if (value.phase === 'ready' && value.clip && isHistoryId(value.sessionId) && !finishedRecordings.has(value.sessionId)) {
        finishedRecordings.set(value.sessionId, { createdAt: new Date(Date.now() - value.durationMs).toISOString(), durationMs: value.durationMs, bytes: value.clip.bytes, mimeType: value.clip.mimeType });
        if (finishedRecordings.size > 32) finishedRecordings.delete(finishedRecordings.keys().next().value!);
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
    ipcMain.handle('sargosh:deliver-text', async (event, request: unknown): Promise<DeliveryResult> => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !validDeliveryRequest(request)) throw new Error('Invalid text insertion request.');
      if (activeDelivery || windowsState.purpose !== 'recording' || !windowsState.enabled || windowsState.phase !== 'finished' ||
          windowsState.sessionId !== request.sessionId || windowsState.target?.id !== request.targetId ||
          recordingState.sessionId !== request.sessionId || recordingState.phase !== 'ready') {
        return { status: 'unavailable', message: 'The saved input is unavailable. Select a textbox before a new recording. Your transcript is still available.' };
      }
      activeDelivery = request.sessionId;
      try { return await helper.call<DeliveryResult>('windows.insert-text', request, deliveryTimeout(request.text)); }
      finally { activeDelivery = null; }
    });
    ipcMain.handle('sargosh:delivery-cancel', async (event, sessionId: unknown) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !isRequestId(sessionId)) throw new Error('Invalid insertion cancellation.');
      if (activeDelivery === sessionId) await helper.call('windows.cancel-delivery', { sessionId });
    });
    handle('sargosh:recording-start', (shortcut: unknown) => {
      requireAccount();
      if (historyRetry || activeDelivery || recordingBusy(recordingState) || transcriptionStatus.phase === 'working' || typeof shortcut !== 'string' || shortcut.length > 80) throw new Error('Finish recording before changing shortcuts.');
      const ignoredProcessIds = [...new Set([process.pid, ...webContents.getAllWebContents().map(contents => contents.getOSProcessId())])].filter(pid => pid > 0);
      return helper.call('windows.arm', { shortcut, ignoredProcessIds, purpose: 'recording' });
    });
    powerMonitor.on('suspend', () => stopOwner('The computer went to sleep. Any active recording was discarded.'));

    handle('sargosh:windows-start', (shortcut: unknown) => {
      if (historyRetry || activeDelivery || recordingBusy(recordingState) || transcriptionStatus.phase === 'working' || !dev || typeof shortcut !== 'string' || shortcut.length > 80) throw new Error('Invalid Windows test request.');
      const ignoredProcessIds = [...new Set([process.pid, ...webContents.getAllWebContents().map(contents => contents.getOSProcessId())])].filter(pid => pid > 0);
      return helper.call('windows.arm', { shortcut, ignoredProcessIds });
    });
    handle('sargosh:windows-action', (action: unknown) => {
      if (action === 'start-hands-free') requireAccount();
      if (action === 'start-hands-free' && historyRetry) throw new Error('Wait for the transcript retry to finish.');
      if (!['cancel', 'finish', 'start-hands-free', 'disarm'].includes(String(action))) throw new Error('Invalid recording action.');
      return helper.call('windows.' + action);
    });
    handle('sargosh:windows-insert-test', (sessionId: unknown) => {
      if (!dev || typeof sessionId !== 'string' || sessionId.length > 80) throw new Error('Invalid Windows test session.');
      return helper.call('windows.insert-test', { sessionId });
    });
    handle('sargosh:snapshot', () => { requireAccount(); return helper.call('snapshot'); });
    handle('sargosh:preferences', (update: Partial<Preferences>) => helper.call('preferences', update));
    ownerHandle('sargosh:delete', (id: string) => {
      if (historyRetry === id) throw new Error('Wait for this transcript retry to finish.');
      return history!.remove(id);
    });
    ipcMain.handle('sargosh:overlay-copy', (event, id: unknown) => {
      checkSender(event);
      if (event.sender !== overlayWindow?.webContents) throw new Error('Only the overlay can copy recovery text.');
      clipboard.writeText(recoveryTextForCopy(transcriptionStatus, id));
    });
    ipcMain.handle('sargosh:overlay-resize', (event, height: unknown) => {
      checkSender(event);
      if (event.sender !== overlayWindow?.webContents || !overlayWindow || typeof height !== 'number' || !Number.isFinite(height)) throw new Error('Invalid overlay size.');
      const bounds = overlayWindow.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      overlayWindow.setBounds(resizeOverlayBounds(bounds, area, height));
    });
    handle('sargosh:open-settings', () => { showMain(); mainWindow?.webContents.send('sargosh:open-settings'); });
    ipcMain.handle('sargosh:window-theme', (event, theme: unknown) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || (theme !== 'light' && theme !== 'dark')) throw new Error('Invalid window theme.');
      if (process.platform === 'win32') mainWindow?.setTitleBarOverlay(titleBarAppearance(theme));
    });
    handle('sargosh:open-main', () => showMain());
    handle('sargosh:move-overlay', ({ dx, dy }: { dx: number; dy: number }) => {
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 500 || Math.abs(dy) > 500 || !overlayWindow) return;
      const { x, y, width, height } = overlayWindow.getBounds();
      const area = screen.getDisplayNearestPoint({ x, y }).workArea;
      overlayWindow.setPosition(Math.round(Math.max(area.x, Math.min(x + dx, area.x + area.width - width))), Math.round(Math.max(area.y, Math.min(y + dy, area.y + area.height - height))));
    });
    handle('sargosh:status', async (): Promise<RuntimeStatus> => {
      try {
        const response = await fetch(apiBase+'/v1/readiness', { signal: AbortSignal.timeout(1500) });
        const data = await response.json() as { auth: boolean; stt: boolean; cleanup: boolean };
        return { desktop: true, helper: helper.ready, api: response.ok, auth: data.auth === true, stt: data.stt === true, cleanup: data.cleanup === true };
      } catch { return { desktop: true, helper: helper.ready, api: false, auth: false, stt: false, cleanup: false }; }
    });
    await accountDeletion.recover();
    await auth.initialize();
    mainWindow = createWindow(); overlayWindow = createWindow(true);
    tray = new Tray(nativeImage.createFromPath(path.join(root, 'assets', 'app-icon.png')).resize({ width: 20, height: 20 }));
    tray.setToolTip('Sargosh');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Sargosh', click: showMain }, { type: 'separator' }, { label: 'Quit Sargosh', click: () => app.quit() }]));
    tray.on('click', showMain);
  }).catch(() => { startup.cancel(); closeSplash(); dialog.showErrorBox('Sargosh could not open', 'The app could not finish starting. Please restart Sargosh.'); app.quit(); });
}
app.on('window-all-closed', () => { /* The tray owns the application lifetime. */ });
app.on('before-quit', event => {
  if (quitting) { tray?.destroy(); return; }
  event.preventDefault(); quitting = true; startup.cancel(); closeSplash();
  recordingCommands.cancelAll(); transcriber.cancelAll();
  void Promise.all([history?.drain(), auth?.dispose(), authStorage?.drain()]).catch(() => {}).then(() => helper.stop()).finally(() => app.quit());
});
