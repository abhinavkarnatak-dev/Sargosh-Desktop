# Sargosh

Sargosh is a Windows dictation companion designed to turn natural speech into text in the apps you use. Its interface brings together a floating dictation control, a local recording history, and simple usage insights.

The source currently provides a runnable desktop workspace, an idle overlay, light and dark themes, local preferences and statistics storage, and an on-device microphone level test. An opt-in Windows input test checks hold-to-talk, double-tap hands-free, editable-field tracking, and clipboard-free delivery of a fixed sentence. It does not record audio. Account sign-in, cloud transcription, cleanup, and actual voice-to-text delivery are not available in this build.

## Using the desktop workspace

- **Dictation** is the home for transcripts and original recordings once dictation is connected.
- **Insights** shows total words, recording count, average words per minute, and daily activity. A day's tooltip contains only its date and word count.
- **Settings** contains theme and microphone preferences and a microphone test.
- The tray icon reopens Sargosh. Closing the main window hides it; choose **Quit Sargosh** from the tray menu to exit.
- The floating pill expands on hover. Its microphone button opens the main app. The grip moves the control.
- The microphone test processes sound levels on your computer. It does not save or upload audio.

## Run from source

Use Windows with Node.js 22.16 or newer in the Node 22 line, npm, and Python 3.11 or newer. No cloud accounts or API keys are needed to explore this build.

```powershell
git clone https://github.com/abhinavkarnatak-dev/Sargosh-Desktop.git
cd Sargosh-Desktop
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r helper/requirements.txt
npm run dev
```

This opens the Electron app and starts the development interface at http://127.0.0.1:5173 and the Fastify API at http://127.0.0.1:4318. The interface URL is a browser preview; Windows features require the Electron window.

For interface-only testing, use `npm run dev:preview`. This starts the browser preview and API without launching Electron or the Windows helper. Browser preview preferences last only for the current page session; persistent preferences are provided by the desktop helper.

If the preview services are already running, open the actual Windows app from another terminal with `npm run dev:desktop`. This reuses the running services instead of starting duplicate servers.

The desktop helper automatically uses `.venv\Scripts\python.exe` when present. To use another Python installation, install `helper/requirements.txt` there and set its executable before starting:

```powershell
$env:SARGOSH_PYTHON = 'C:\Path\To\python.exe'
npm run dev
```

Interface edits refresh automatically. Restart the development command after editing the desktop coordinator or Python helper. Stop it with Ctrl+C in its terminal. The development ports must be free before starting.

## How it works

React and TypeScript render the main workspace and a separate Electron overlay window. Electron manages the tray and desktop lifecycle. A restricted preload bridge exposes specific app actions rather than general operating-system access.

The desktop coordinator launches a Python helper and exchanges structured messages over its input/output pipes. `comtypes` connects the helper to Windows UI Automation. Python's built-in Windows-library access handles shortcut events and Unicode keyboard delivery. The helper does not read document text or clipboard contents. Python's built-in SQLite module stores preferences, history records, and accumulated metrics. Development data is kept in `.local/` inside the project and is excluded from Git.

The local Fastify service supplies health and connection-status endpoints. Cloud processing endpoints fail closed until authentication, usage allowances, and AI providers are connected. No sample transcripts or fabricated activity are included.

The agreed dictation design is record-then-upload, with Deepgram recognition and Gemini Flash-Lite cleanup. Recordings and transcript history belong on the computer; account and usage data belong in managed PostgreSQL with Supabase Auth. Cloud processing will transmit audio and text to the respective providers when enabled.

## Check Windows input behavior

In the Electron app, open **Settings > General > Shortcuts > View**. The development-only Windows input test lets you select a shortcut, start the hook, observe a session, and insert the fixed sentence **Sargosh input test.** after finishing.

The default combination is **Control + Alt + Space**. Hold and release it for push-to-talk. Double-tap it to start hands-free, then double-tap again to finish. A short single tap is ignored. The detector reserves a brief interval to distinguish a hold from two taps. This test does not start the microphone or any paid service.

While a session is active, the latest focused writable field becomes its destination. Ordinary buttons and Sargosh's own windows do not replace that field. Finishing freezes the destination; cancellation prevents delivery. Password fields are excluded. A field that disappeared or became hidden may reject insertion. Windows also restricts input across different application permission levels. Do not run the app as administrator to work around these restrictions.

To test without Electron, use the standalone diagnostic:

```powershell
npm run test:windows
```

It reports shortcut and destination metadata without recording text contents. Type `quit` in its terminal to remove the hook and exit. For a full fixed-text check, use a blank disposable editor and explicitly enable insertion:

```powershell
npm run test:windows:insert
```

Confirm the terminal says **Automatic insertion: ENABLED**. Focus the disposable editor, use either shortcut mode, and finish. The fixed sentence is sent through Windows keyboard input without the clipboard. Printable ASCII uses ordinary keys mapped to the destination keyboard layout when that mapping needs no Control or Alt keys. Other characters use Unicode input. Characters are paced with a short gap, and delivery stops if input focus, keyboard modifiers, or the keyboard layout changes. Hold and hands-free sessions can be used repeatedly in any order; each finished session has its own delivery guard. It is inserted at the active caret and replaces selected text. Inspect the result yourself: sending input is not proof that every application accepted it. The test never automatically retries uncertain delivery.

Browser preview cannot access these native Windows controls. Restricted execution environments may also prevent global key events or cross-application focus from being observed. Verify supported destinations on your normal Windows desktop.

## Storage and privacy

The microphone test does not retain audio. Local development preferences survive restarts. There is no signed-in account in this build; its development store is separate from future account-specific history.

Successful recording metrics are stored independently of history entries so deleting history does not erase accumulated statistics. Retrying an existing recording does not count it twice. Dictation speed is total finalized words divided by total recording time in minutes, including pauses.

Secrets, local databases, development recordings, and private assistant configuration must not be committed. A distributed desktop app must never contain private Deepgram, Gemini, or database service keys. Cloud credential setup will be documented with the corresponding integration.

## Checks and builds

```powershell
npm run typecheck
npm test
npm run build
```

The tests cover lifecycle cancellation, late results, destination freezing, duplicate completion, insights calculations, local SQLite persistence, API readiness behavior, shortcut timing, protected fields, target changes, Unicode input layout, and delivery guards.

Electron Forge configuration is included for Windows packaging. This source build currently requires local Python; a self-contained Windows helper must be bundled before distributing an installer. Signing and public distribution are separate from running the source locally.
