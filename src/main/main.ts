import { DesktopStreamer } from './streaming';
import { StoreUpdates } from './store-updates';
import { NativeStoreBridge } from './store-bridge';
import { registerStoreRestart } from './store-restart';
import { NO_STORE_UPDATES, type StoreUpdateAction } from '../shared/store-update';
import { STREAM_MAX_CHUNK, type StreamRequest } from '../shared/streaming';
import { microphoneCheck, microphoneRequest } from './microphone-permissions';
import { createTimingLog } from './timing-log';
import { safeTiming, setTimingSink, TimingTrace } from '../shared/timing';
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
import { DEFAULT_DOCK, validDockPreference } from '../shared/overlay-dock';
import { OverlayDocking } from './overlay-docking';
import { OverlayDropZones } from './overlay-drop-zones';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { OverlayDrag, type OverlayGripBounds } from './overlay-drag';
import { overlayMousePressed } from './overlay-input';
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
const rendererURL = dev ? process.env.SARGOSH_RENDERER_URL : undefined;
if (dev) app.setPath('userData', path.join(root, '.local', 'electron'));
app.setName('Sargosh');
const timingLog = createTimingLog(path.join(app.getPath('userData'), 'logs'), app.getVersion());
setTimingSink(timingLog);
// MSIX supplies its own identity. The Squirrel ID applies only to direct installs.
if (process.platform === 'win32' && !process.windowsStore) app.setAppUserModelId('com.squirrel.Sargosh.Sargosh');
let mainWindow: BrowserWindow | undefined;
let splashWindow: BrowserWindow | undefined;
function closeSplash() { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy(); splashWindow = undefined; }
const startup = new StartupGate(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); closeSplash(); storeUpdates?.activityChanged(); });
function startupFailed() {
  if (startup.complete || quitting) return;
  startup.cancel(); closeSplash();
  dialog.showErrorBox('Sargosh could not open', 'The app could not finish starting. Please restart Sargosh.');
  app.quit();
}
let overlayWindow: BrowserWindow | undefined;
let overlayDocking: OverlayDocking | undefined;
let overlayDrag: OverlayDrag | undefined;
let overlayReducedMotion = false;
const overlayZones = new OverlayDropZones();
let dockWrites = Promise.resolve();
let tray: Tray | undefined;
let quitting = false;
let activeDelivery: string | null = null;
let firstInputTiming: ReturnType<TimingTrace['span']> | undefined;
let history: LocalHistory | undefined;
let auth: DesktopAuth | undefined;
let authStorage: AuthStorage | undefined;
let accountChanging = false;
let historyRetry: string | null = null;
let storeUpdates:StoreUpdates|undefined;
let appliedWindowTheme:'light'|'dark'=nativeTheme.shouldUseDarkColors?'dark':'light';
const finishedRecordings = new Map<string, { createdAt: string; durationMs: number; bytes: number; mimeType: string }>();
const helper = new Helper();
let desktopEnvironment:Record<string,string|undefined>={...process.env};
if(dev){try{desktopEnvironment={...parseEnv(readFileSync(path.join(root,'.env'),'utf8')),...process.env};}catch{}}
if(!dev){try{desktopEnvironment={...JSON.parse(readFileSync(path.join(root,'dist','desktop-config.json'),'utf8'))};}catch{}}
if(!dev&&!desktopEnvironment.SARGOSH_API_URL)throw new Error('The installed app is missing its hosted API configuration.');
const apiBase=apiEndpoint(desktopEnvironment.SARGOSH_API_URL??'http://127.0.0.1:4318');
const transcriber = new DesktopTranscriber(async () => { if (!auth) throw new Error('Sign in to use cloud dictation.'); return auth.accessToken(); },apiBase);
const streamer = new DesktopStreamer(async()=>{if(!auth)throw new Error('Sign in first.');return auth.accessToken();},apiBase);
const recordingCommands = new RecordingCommands();
let transcriptionStatus: TranscriptionStatus = { phase: 'idle', message: '' };
let recordingState: RecordingState = { ...INITIAL_RECORDING_STATE };
let windowsState: WindowsState = { ...INITIAL_WINDOWS_STATE };
function recordingUpdate(state: RecordingState) {
  recordingState = { ...state, revision: recordingState.revision + 1 };
  storeUpdates?.activityChanged();
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('sargosh:recording-state', recordingState);
  }
}
function stopOwner(message: string) {
  recordingCommands.cancelAll();
  transcriber.cancelAll(); streamer.cancel();
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
    ...(overlay ? { frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false } : process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: titleBarAppearance(appliedWindowTheme) } : {}),
    icon: path.join(root, 'assets', 'app-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
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
    splashWindow = createSplash(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(microphoneRequest(contents.getURL(), permission, details, trustedURL));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => microphoneCheck(contents?.getURL(), permission, details, trustedURL));
    const dataDirectory = dev ? path.join(root, '.local', 'development') : app.getPath('userData');
    try { await helper.start(root, dataDirectory, dev ? undefined : path.join(process.resourcesPath, 'sargosh-helper', 'sargosh-helper.exe')); } catch { throw new Error('The local Windows helper could not start. Restart or reinstall Sargosh.'); }
    history = new LocalHistory(path.join(dataDirectory, 'recordings'), helper, () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sargosh:history-changed');
    });
    await history.initialize().catch(() => console.error('Local recording history could not be opened.'));
    ipcMain.on('sargosh:ui-ready', event => {
      try { checkSender(event); } catch { return; }
      if (event.sender === mainWindow?.webContents) startup.rendered();
    });
    function ownerHandle(channel: string, work: (value: any) => unknown) {
      ipcMain.handle(channel, (event, value) => { checkSender(event); if (event.sender !== mainWindow?.webContents || quitting || accountChanging) throw new Error('History is unavailable.'); if(storeUpdates?.installing)throw new Error('Wait for the app update to finish.'); if (channel.startsWith('sargosh:history-') || channel === 'sargosh:delete') requireAccount(); return work(value); });
    }
    for(const name of ['state','action'] as const)ipcMain.handle('sargosh:store-update-'+name,(event,value:unknown)=>{
      checkSender(event);
      if(event.sender!==mainWindow?.webContents||quitting)throw new Error('Update controls are unavailable.');
      if(name==='state')return storeUpdates?.snapshot()??NO_STORE_UPDATES;
      if(!['check','download','later','install'].includes(value as string))throw new Error('Invalid update action.');
      return storeUpdates?.action(value as StoreUpdateAction)??NO_STORE_UPDATES;
    });
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
      ownerHandle(channel, value => { if (recordingBusy(recordingState) || transcriber.busy || streamer.busy || activeDelivery || historyRetry) throw new Error('Finish the current dictation first.'); return work(value); });
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
      if (historyRetry || activeDelivery || transcriber.busy || streamer.busy || transcriptionStatus.phase === 'working' || recordingBusy(recordingState) || ['pending', 'listening'].includes(windowsState.phase)) throw new Error('Finish the current dictation first.');
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
      if (event === 'windows.delivery-first-input') {
        const id = (data as { sessionId?: unknown } | null)?.sessionId;
        if (typeof id === 'string' && id === activeDelivery) {
          firstInputTiming?.end();
          try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sargosh:delivery-first-input', id); } catch { /* Diagnostics are best-effort. */ }
        }
        return;
      }
      if (event === 'helper.unavailable') { stopOwner('Windows input access stopped. Recording cancelled. Restart Sargosh.'); return; }
      if (event !== 'windows.state') return;
      windowsState = data as WindowsState;
      storeUpdates?.activityChanged();
      for (const window of [mainWindow, overlayWindow]) {
        if (window && !window.isDestroyed()) window.webContents.send('sargosh:windows-state', data);
      }
    });
    ipcMain.handle('sargosh:timing', (event, value: unknown) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents) throw new Error('Invalid timing sender.');
      const entry = safeTiming(value);
      if (entry && (entry.scope === 'desktop' || entry.scope === 'client')) timingLog(entry);
    });
    handle('sargosh:windows-status', () => helper.call('windows.status'));
    handle('sargosh:recording-status', () => recordingState);
    ipcMain.handle('sargosh:stream-start',(event,request:StreamRequest)=>{
      checkSender(event);
      if(event.sender!==mainWindow?.webContents||!request||!isRequestId(request.requestId)||request.traceId!==request.requestId||!isSpeechLanguage(request.language)||typeof request.cleanup!=='boolean'||(request.practice!==undefined&&typeof request.practice!=='boolean'))throw new Error('Invalid live dictation request.');
      if(storeUpdates?.installing||historyRetry||transcriber.busy)return {ok:false,code:'BUSY',message:'Finish the current request first.'};
      return streamer.start(request);
    });
    ipcMain.handle('sargosh:stream-chunk',(event,value)=>{
      checkSender(event);
      if(event.sender!==mainWindow?.webContents||!isRequestId(value?.id)||!(value?.audio instanceof ArrayBuffer)||value.audio.byteLength>STREAM_MAX_CHUNK)throw new Error('Invalid live audio.');
      return streamer.chunk(value.id,value.audio);
    });
    for(const action of ['finish','cancel'] as const)ipcMain.handle('sargosh:stream-'+action,(event,id:unknown)=>{
      checkSender(event);if(event.sender!==mainWindow?.webContents||!isRequestId(id))throw new Error('Invalid live request.');
      if(action==='cancel'){streamer.cancel(id);return;}return streamer.finish(id);
    });
    for (const channel of ['sargosh:transcribe', 'sargosh:practice-transcribe']) ipcMain.handle(channel, (event, request: TranscriptionRequest) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !request || !isRequestId(request.requestId) || !isSpeechLanguage(request.language) ||
          !(request.audio instanceof ArrayBuffer) || !request.audio.byteLength || request.audio.byteLength > MAX_AUDIO_BYTES ||
          typeof request.mimeType !== 'string' || !audioType(request.mimeType) || (request.cleanup !== undefined && typeof request.cleanup !== 'boolean')) throw new Error('Invalid audio transcription request.');
      if (storeUpdates?.installing || historyRetry || streamer.busy) return { ok: false, code: 'BUSY', message: 'Wait for the current task to finish.' };
      return transcriber.transcribe({ ...request, practice: channel === 'sargosh:practice-transcribe' });
    });
    for (const channel of ['sargosh:cleanup', 'sargosh:practice-cleanup']) ipcMain.handle(channel, (event, request: CleanupRequest) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !request || !isRequestId(request.requestId) || !isSpeechLanguage(request.language) ||
          typeof request.text !== 'string' || !request.text.trim() || request.text.length > MAX_CLEANUP_CHARS) throw new Error('Invalid cleanup request.');
      if (storeUpdates?.installing || historyRetry || streamer.busy) return { ok: false, code: 'BUSY', message: 'Wait for the current task to finish.' };
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
      void helper.call('windows.set-busy', { busy: storeUpdates?.installing === true || value.phase === 'working' || historyRetry !== null }).catch(() => {});
      storeUpdates?.activityChanged();
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
      const inputTiming = new TimingTrace(request.sessionId, 'desktop').span('delivery.first_input_ack');
      firstInputTiming = inputTiming;
      try {
        const result = await helper.call<DeliveryResult & import('../shared/timing').TimingMeta>('windows.insert-text', request, deliveryTimeout(request.text));
        // The timing allowlist removes all unapproved native result fields.
        new TimingTrace(request.sessionId, 'desktop').span('delivery.path', {
          method: result.method, fallbackReason: result.fallbackReason, errorCode: result.errorCode,
          clipboardFormat: result.clipboardFormat, windowsError: result.windowsError,
        }).end(result.status === 'sent' ? 'ok' : 'failed');
        return result;
      }
      finally { inputTiming.end('skipped'); firstInputTiming = undefined; activeDelivery = null; }
    });
    ipcMain.handle('sargosh:delivery-cancel', async (event, sessionId: unknown) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || !isRequestId(sessionId)) throw new Error('Invalid insertion cancellation.');
      if (activeDelivery === sessionId) await helper.call('windows.cancel-delivery', { sessionId });
    });
    handle('sargosh:recording-start', (shortcut: unknown) => {
      if(storeUpdates?.installing)throw new Error('Wait for the app update to finish.');
      requireAccount();
      if (historyRetry || activeDelivery || recordingBusy(recordingState) || transcriptionStatus.phase === 'working' || typeof shortcut !== 'string' || shortcut.length > 80) throw new Error('Finish recording before changing shortcuts.');
      const ignoredProcessIds = [...new Set([process.pid, ...webContents.getAllWebContents().map(contents => contents.getOSProcessId())])].filter(pid => pid > 0);
      return helper.call('windows.arm', { shortcut, ignoredProcessIds, purpose: 'recording' });
    });
    powerMonitor.on('suspend', () => stopOwner('The computer went to sleep. Any active recording was discarded.'));

    handle('sargosh:windows-start', (shortcut: unknown) => {
      if(storeUpdates?.installing)throw new Error('Wait for the app update to finish.');
      if (historyRetry || activeDelivery || recordingBusy(recordingState) || transcriptionStatus.phase === 'working' || !dev || typeof shortcut !== 'string' || shortcut.length > 80) throw new Error('Invalid Windows test request.');
      const ignoredProcessIds = [...new Set([process.pid, ...webContents.getAllWebContents().map(contents => contents.getOSProcessId())])].filter(pid => pid > 0);
      return helper.call('windows.arm', { shortcut, ignoredProcessIds });
    });
    handle('sargosh:windows-action', (action: unknown) => {
      if(action==='start-hands-free'&&storeUpdates?.installing)throw new Error('Wait for the app update to finish.');
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
      overlayDocking?.resize(height);
    });
    handle('sargosh:open-settings', () => { showMain(); mainWindow?.webContents.send('sargosh:open-settings'); });
    ipcMain.handle('sargosh:window-theme', (event, theme: unknown) => {
      checkSender(event);
      if (event.sender !== mainWindow?.webContents || (theme !== 'light' && theme !== 'dark')) throw new Error('Invalid window theme.');
      appliedWindowTheme=theme;
      if (process.platform === 'win32') mainWindow?.setTitleBarOverlay(titleBarAppearance(theme));
      if(overlayWindow&&!overlayWindow.isDestroyed())overlayWindow.webContents.send('sargosh:window-theme-changed',theme);
      if(overlayWindow&&!overlayWindow.isDestroyed()&&!overlayDocking?.state.dragging)overlayZones.prepare(screen.getDisplayMatching(overlayWindow.getBounds()),theme);
    });
    handle('sargosh:window-theme-state',()=>appliedWindowTheme);
    ipcMain.handle('sargosh:overlay-dock-state', event => {
      checkSender(event);
      if (event.sender !== overlayWindow?.webContents) throw new Error('Invalid overlay request.');
      return overlayDocking?.state ?? DEFAULT_DOCK;
    });
    handle('sargosh:open-main', () => showMain());
    ipcMain.handle('sargosh:overlay-drag', (event, request: { action: 'start' | 'stop'; pill?: OverlayGripBounds; reducedMotion?: boolean }) => {
      checkSender(event);
      if (event.sender !== overlayWindow?.webContents || !overlayWindow || overlayWindow.isDestroyed()) throw new Error('Invalid overlay drag.');
      if (!request || !['start', 'stop'].includes(request.action)) throw new Error('Invalid overlay drag.');
      if (request.action === 'stop') { overlayDrag?.stop(); return; }
      overlayReducedMotion = request.reducedMotion === true;
      if (!overlayDrag) {
        const window = overlayWindow;
        overlayDrag = new OverlayDrag({ bounds: () => window.getBounds(), cursor: () => screen.getCursorScreenPoint(),
          area: point => screen.getDisplayNearestPoint(point).workArea, pressed: overlayMousePressed(),
          move: (x, y) => window.setPosition(x, y, false), started: (pill, point) => overlayDocking?.start(pill, point),
          moved: point => overlayDocking?.move(point), ended: point => overlayDocking?.end(point) });
        window.once('closed', () => { overlayDrag?.stop(false); overlayDocking?.dispose(); });
        window.webContents.on('did-start-loading', () => { overlayDrag?.stop(false); overlayDocking?.cancel(); });
      }
      if (request.pill) overlayDrag.start(request.pill);
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
    const dockFile = path.join(app.getPath('userData'), 'overlay-dock.json');
    let savedDock;
    try { const value: unknown = JSON.parse(readFileSync(dockFile, 'utf8')); if (validDockPreference(value)) savedDock = value; } catch {}
    const dockWindow = overlayWindow;
    overlayDocking = new OverlayDocking({ bounds: () => dockWindow.getBounds(),
      setBounds: bounds => { if (!dockWindow.isDestroyed()) dockWindow.setBounds(bounds, false); },
      displays: () => screen.getAllDisplays(), primary: () => screen.getPrimaryDisplay(), displayAt: point => screen.getDisplayNearestPoint(point),
      notify: state => { if (!dockWindow.isDestroyed()) dockWindow.webContents.send('sargosh:overlay-dock', state); },
      guides: (display, target) => overlayZones.show(display, target, appliedWindowTheme), hideGuides: () => overlayZones.hide(),
      reducedMotion: () => overlayReducedMotion,
      save: preference => {
        dockWrites = dockWrites.then(async () => { await mkdir(path.dirname(dockFile), { recursive: true });
          await writeFile(dockFile + '.tmp', JSON.stringify(preference), { mode: 0o600 }); await rename(dockFile + '.tmp', dockFile);
        }).catch(() => { console.warn('Overlay dock position could not be saved.'); });
      }
    }, savedDock);
    overlayZones.prepare(screen.getDisplayMatching(dockWindow.getBounds()), appliedWindowTheme);
    const reflowDock = () => overlayDocking?.reflow();
    screen.on('display-removed', reflowDock); screen.on('display-metrics-changed', reflowDock);
    const updateBridge=new NativeStoreBridge(path.join(process.resourcesPath,'sargosh-store-updater.exe'),()=>{
      if(!mainWindow||mainWindow.isDestroyed())throw new Error('Window unavailable.');
      const handle=mainWindow.getNativeWindowHandle();return (handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();
    });
    storeUpdates=new StoreUpdates(!dev&&process.platform==='win32'&&process.windowsStore===true,updateBridge,
      ()=>!startup.complete||accountChanging||quitting||Boolean(historyRetry||activeDelivery)||transcriber.busy||streamer.busy||transcriptionStatus.phase==='working'||recordingBusy(recordingState)||['pending','listening'].includes(windowsState.phase),
      state=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('sargosh:store-update',state);},
      async()=>{
        registerStoreRestart();
        await helper.call('windows.set-busy',{busy:true});
        // Windows ARR refuses automatic restart during a process's first minute.
        // This wait occurs only after an explicit Restart to update click.
        const restartDelay=Math.max(0,Math.ceil((60-process.uptime())*1000));
        if(restartDelay)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,restartDelay);timer.unref();});
        await Promise.all([history?.drain(),authStorage?.drain()]);
      },
      async()=>{await helper.call('windows.set-busy',{busy:transcriptionStatus.phase==='working'||historyRetry!==null});},
      aumid=>{
        // Activate by package identity, never an executable path from the old MSIX.
        app.relaunch({execPath:path.join(process.env.SystemRoot||'C:/Windows','explorer.exe'),args:['shell:AppsFolder\\'+aumid]});
        app.quit();
      });
    storeUpdates.start();
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
  storeUpdates?.dispose();
  overlayDrag?.stop(false); overlayDocking?.dispose(); overlayZones.dispose();
  recordingCommands.cancelAll(); transcriber.cancelAll(); streamer.cancel();
  void Promise.all([history?.drain(), auth?.dispose(), authStorage?.drain(), dockWrites]).catch(() => {}).then(() => helper.stop()).finally(() => app.quit());
});
