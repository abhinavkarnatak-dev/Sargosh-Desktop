# Sargosh

Sargosh is a Windows dictation companion designed to turn natural speech into text in the apps you use. Its interface brings together a floating dictation control, a local recording history, and simple usage insights.

The source provides a Windows desktop workspace with light and dark themes, a floating recording control, local audio playback, Deepgram transcription, and optional Gemini Flash-Lite cleanup. An opt-in Windows input test checks clipboard-free delivery of a fixed sentence. Finished desktop dictations can insert text directly into the saved input without using the clipboard. Finished recordings and transcripts are saved locally and remain after restart. Account sign-in is not available in this build.

## Using the desktop workspace

- The top bar holds the sidebar toggle, a Light/Dark/System theme menu, and native Windows minimize, maximize, and close controls. Its empty area can be dragged to move the window, and its colors follow the app theme. The theme button uses the native window-control bounds to keep a small gap beside Minimize at different display scales.
- The rounded page frame stays fixed while its content scrolls. Scrollbars are hidden; mouse-wheel, touchpad, and keyboard scrolling remain available.
- The sidebar expands smoothly with fading labels. Its logo and navigation icons stay aligned, with Settings anchored at the bottom.
- **Dictation** shows saved transcripts and original recordings, grouped by day.
- **Insights** shows total words, recording count, average words per minute, and daily activity. A day's tooltip contains only its date and word count.
- **Settings** contains theme and microphone preferences and a microphone test. While Settings is open, the background stays still and cannot be interacted with. Click outside the dialog, press Escape, or use its close button to return.
- The tray icon reopens Sargosh. Closing the main window hides it; choose **Quit Sargosh** from the tray menu to exit.
- The floating pill expands on hover. Its microphone button opens the main app until recording shortcuts are enabled; it then starts hands-free recording. The grip moves the control. After you finish speaking, the control keeps the audio dots and shows a small loader on their right while your text is prepared. It does not display processing-stage names or cancel buttons during this step. Microphone warnings, no-speech results, and cancellation messages appear in a dismissible card above the pill. A card that opens Sargosh or microphone settings closes when that action succeeds; the pill stays visible. If text cannot be inserted, the card shows the prepared text and a Copy button.
- The microphone level test processes sound levels on your computer. It does not save or upload audio.
- **Check your recording** captures audio with start, finish, cancel, playback, and clear-preview controls. Finishing saves the original recording locally in the desktop app.

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

Interface edits refresh automatically. After editing the desktop coordinator, preload bridge, or Python helper, choose **Quit Sargosh** from the tray and run `npm run dev:desktop` again if the preview services are already running. Closing the main window only hides it and does not load desktop changes. Stop it with Ctrl+C in its terminal. The development ports must be free before starting.

## Cloud credential setup

Copy `.env.example` to a private `.env` file at the project root. Add your Deepgram key and, for cleanup, your Gemini key. Keep the local development switch enabled and save. Edit an existing `.env` in place rather than replacing its credentials:

```dotenv
DEEPGRAM_API_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
SARGOSH_LOCAL_TRANSCRIPTION=1
```

Git ignores `.env`. Do not put either key in a `VITE_` variable, the desktop interface, or the distributed app. The Fastify backend loads `.env` when it starts. Restart the API after editing credentials. Only the backend sends provider keys to their respective services; the browser and Electron renderer receive a separate temporary local session token. Node.js built-in HTTP tools handle both providers, so no Deepgram or Gemini SDK is required. Create keys in [Deepgram Console](https://console.deepgram.com/) and [Google AI Studio](https://aistudio.google.com/apikey).

## How it works

React and TypeScript render the main workspace and a separate Electron overlay window. Electron manages the tray and desktop lifecycle. Koffi connects a small TypeScript overlay adapter to Windows so the floating controls accept mouse clicks while your input keeps keyboard focus. A restricted preload bridge exposes specific app actions rather than general operating-system access.

The desktop coordinator launches a Python helper and exchanges structured messages over its input/output pipes. `comtypes` connects the helper to Windows UI Automation. Python's built-in Windows-library access handles shortcut events and Unicode keyboard delivery. The helper does not read document text or clipboard contents. Python's built-in SQLite module stores preferences, history records, and accumulated metrics. Development data is kept in `.local/` inside the project and is excluded from Git.

The local Fastify service supplies health and connection-status endpoints, forwards audio to Deepgram, and sends transcript text to Gemini when cleanup is enabled. Its development transcription bridge binds to `127.0.0.1`, checks Host and Origin, requires a temporary local token, limits upload size, allows one cloud operation at a time, and limits each provider stage to 10 attempts per minute. Local mode requires an explicit environment switch and is disabled when `NODE_ENV=production`. It is not a public authenticated backend. No sample transcripts or fabricated activity are included.

The agreed dictation design is record-then-upload, with Deepgram recognition and Gemini Flash-Lite cleanup. Recordings and transcript history belong on the computer; account and usage data belong in managed PostgreSQL with Supabase Auth. Cloud processing will transmit audio and text to the respective providers when enabled.

## Record and play local audio

On **Dictation**, use **Start recording**, speak after **Listening** appears, and choose **Finish recording**. The app collects the last audio chunk before making playback available. **Cancel recording** discards that session, including audio that arrives late. You can cancel during microphone startup or finalization too.

The browser preview supports the recording buttons. For background recording, open Electron with `npm run dev:desktop` while the preview services are running. Choose your microphone in Settings, then select **Enable recording shortcuts** on Dictation. Hold and release your configured shortcut, or double-tap to start hands-free and double-tap again to finish. Separate sessions can use either mode in any order. The overlay shows microphone activity and offers cancel and hands-free finish controls. Closing the main window to the tray keeps recording available.

Microphone access starts when you begin a recording, including the brief shortcut-recognition interval, and stops on finish or cancellation. It is not kept open while idle. A very short first attempt can finish before the microphone becomes ready; the app discards it and explains why. A short unconfirmed single tap is also discarded.

Each session is limited to 5 minutes and 25 MiB. No microphone activity for several seconds produces a level warning, not a speech-recognition result. Permission failures, a disconnected microphone, empty output, and audio finalization timeouts are reported without uploading or retrying the audio. Changing the selected microphone applies to the next recording.

The current preview stays in memory, while finished desktop recordings are saved to local audio files and SQLite history. A new recording or **Clear preview** replaces only the preview; saved history remains until you delete it. Cancellation before finishing discards the recording. Finished audio is saved before automatic transcription starts, so it can be retried after a cloud failure. Browser-preview clips stay in memory and are not saved to desktop history. Audio is sent to Deepgram only when you request transcription or enable automatic transcription; enabled cleanup sends transcript text to Gemini. Recording mode does not insert the fixed test sentence.

The main renderer owns one microphone and recorder. The overlay receives state and sends commands through Electron; it never opens a second recorder. On Windows, a small native mouse-activation hook lets its buttons receive clicks without taking keyboard focus from your input. The overlay Cancel button stops an active recording. Processing can still be cancelled from the main recording panel. Finish stops microphone capture immediately and waits for both the final audio and the saved destination before making the clip available. If a control cannot reach the recording window, the overlay shows a restart message. The main renderer's background timer throttling is disabled so hiding it does not suspend recording controls. Reloading the owner, losing Windows input access, or putting the computer to sleep cancels active recording and disarms shortcuts.

## Transcribe with Deepgram

Record and finish a clip, then choose **Transcribe recording**. The transcript appears below the playback controls. Alternatively, turn on **Transcribe automatically after recording** before starting; finishing either shortcut mode then starts transcription. Automatic transcription is off initially, so checking recording and playback alone does not use provider credits.

Choose English, Hindi, or Hinglish on Dictation or in Settings > General > My languages. Language and microphone menus follow the selected light or dark theme and support keyboard navigation. These choices use Nova-3. Multilingual mode includes English and Hindi code-switching; it does not guarantee Romanized Hinglish output or translate between languages. Language and automatic-transcription choices currently last for the page session.

The flow is recording > final audio chunk > local Fastify API > Deepgram > transcript display. Browser preview uses Vite's same-origin `/api` proxy. Electron forwards audio through its restricted main-process bridge to the local API, so packaged file pages do not need direct browser access to the API. Container audio is uploaded as binary data; the server does not incorrectly label WebM/Opus as raw PCM.

Wait for transcription and any enabled cleanup to finish, or cancel the current stage, before starting another recording. Cancellation aborts the local request and ignores any late response; it cannot undo processing or charges already incurred at the provider. Failures leave the clip available for an explicit retry. The app does not automatically retry paid calls. **Transcribe again** starts a new request and may consume credits. Empty results are shown as no speech recognized rather than fabricated text. The provider request times out after 60 seconds; the local client also has a deadline.

The latest audio and transcript preview stays in memory; completed desktop recordings are also retained in local history. For exact duplicate request IDs, the local API keeps at most 32 successful response entries for 5 minutes to prevent duplicate provider calls. The backend does not write audio or transcripts to disk or request logs; the desktop app retains its local history separately. Deepgram receives the audio and processes it under its own data policies; requests set `mip_opt_out=true` to opt out of the Model Improvement Program. See [Deepgram's data policy](https://developers.deepgram.com/trust-security/your-data).

The transcript is displayed as text and can optionally be cleaned with Gemini. Automatic insertion into the remembered Windows input and saving completed dictations to history are separate integrations. This local development bridge must be replaced by authenticated account access and usage allowances before public deployment. Never ship private provider credentials inside the installer.

## Clean up with Gemini

With **Clean up with Gemini after transcription** selected, completed Deepgram text is sent to the backend cleanup route and then to Gemini. The checkbox is on initially. Turn it off to keep transcription as a Deepgram-only operation. **Transcribe automatically after recording** remains a separate setting, initially off. These settings last for the page session.

Cleanup removes clear fillers and false starts, applies explicit spoken corrections, and improves punctuation. It is instructed to preserve meaning, names, technical identifiers, amounts, negations, language, and script. Dictated questions and instructions remain dictation; the model has no tools or operating-system access. Both the instructions and deterministic output processing require ordinary hyphens instead of en or em dashes.

The default is `gemini-3.5-flash-lite`. `GEMINI_MODEL` can select `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite`, or `gemini-3.5-flash-lite`; unsupported values use the default. Availability depends on the Google project. The app does not retry with another model when a request fails. Model choice is backend configuration, never a request-supplied URL or model name.

The cleaned text appears above an expandable **Original Deepgram transcript**. You can copy either version, cancel cleanup, or choose **Retry cleanup** after a failure. A cleanup retry uses the retained transcript and does not upload the audio to Deepgram again. **Clean up again** explicitly makes another Gemini request and may consume quota or credits. Empty recognition results do not call Gemini.

If Gemini is unavailable, blocked, rate-limited, times out, or returns incomplete or invalid JSON, the original transcript stays available. Cleanup edits can still be mistaken; compare with the original when accuracy matters. Input is limited to 24,000 characters, provider requests time out after 20 seconds, and the local client has a separate deadline. Output is schema-validated and length-bounded. No partially generated result is used.

The local API checks its session token, bounds request size and concurrency, and keeps at most 32 successful cleanup responses in memory for 5 minutes to avoid duplicate calls for identical request IDs. The backend does not save transcript text or cleaned text to disk or request logs; the desktop app stores these in its local history. Google receives the transcript and language hint; its data-use rules depend on the project and billing tier. Review [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [Gemini pricing and data-use information](https://ai.google.dev/gemini-api/docs/pricing).

Cleanup produces text; a separate Windows delivery step inserts it into the saved input. Completed desktop dictations are saved to local history. Local previews are removed when replaced, discarded, reloaded, or closed, while the bounded backend deduplication caches expire independently.

## Insert into a Windows textbox

Open the Electron app, enable recording shortcuts, and enable **Transcribe automatically after recording** for the complete hands-free flow. Click a writable textbox in another app, then dictate with either hold or hands-free mode. Finishing the recording prepares the text and inserts it into the saved input. With automatic transcription off, **Transcribe recording** starts the same processing and delivery steps for the current desktop recording.

The latest writable input focused during recording becomes the destination. Finishing freezes that destination, so selecting another field while text is being prepared does not redirect it. The app activates the saved field before typing. Insertion takes place at its current caret and replaces selected text. It does not press a Send button, synthesize a keyboard Enter command, or use the clipboard. Browser-preview recordings remain local previews and do not type into other apps.

When cleanup is enabled, only successfully cleaned text is inserted. Cleanup failure or cancellation leaves the original text available and does not automatically insert it. A successful cleanup retry can deliver the text if that recording has not already attempted insertion. With cleanup disabled, the original transcript is inserted. Empty recognition results do not insert anything.

The overlay keeps its dots and loader until delivery finishes. While text is being prepared or inserted, additional recording shortcuts are ignored. Text is paced character by character for editor compatibility; longer text takes longer to insert. The main recording panel shows the delivery result and provides **Stop insertion**. Discarding the clip, reloading the app, or quitting also stops delivery. Cancellation cannot remove characters already sent.

Every recording permits one insertion attempt. Repeated completion events, **Clean up again**, and **Transcribe again** do not insert a second copy. If delivery fails or only partly completes, the app retains the text and does not automatically retry. Check the destination before taking further action. No text is saved to the clipboard automatically. If there is no usable textbox or delivery cannot be confirmed, a card above the overlay shows the prepared text and an explicit **Copy text** button. It reports **Copied** on success and explains a failed copy. Dismissal or a new recording hides the card; the transcript remains available in the main panel.

Password fields, read-only fields, closed windows, and unavailable or hidden controls are excluded. Switching focus, holding keyboard modifiers, or changing keyboard layout during insertion stops it to avoid typing into another field. Some editors and background browser tabs do not expose a usable Windows input control. A clear result appears in the main panel and the transcript remains available. Windows also restricts delivery between apps running with different permissions.

## Local history and audio

Every finished desktop recording appears in **Your dictations**, grouped under Today, Yesterday, or its local calendar date. The time is on the left, the transcript is in the middle, and Play, Copy, and the three-dot menu are on the right. Hover over a row or move keyboard focus into it to reveal its controls. **Load older dictations** retrieves older pages without discarding recordings.

**Play audio** plays the original saved recording. **Copy transcript** copies the currently saved text and shows a bottom-right confirmation with a gentle fade and slide. Copy, deletion, and audio-export confirmations share this bottom-right style, have no close button, and disappear automatically after two seconds. They respect reduced-motion preferences. The menu contains exactly **Retry transcript**, **Delete transcript**, and **Extract audio**. Extract opens a Windows Save dialog and saves the original bytes in their recorded format, such as WebM/Opus. It does not convert the audio to MP3 or another format.

Retry uploads that entry's original audio to Deepgram, uses its saved language and cleanup choice, and updates the same entry. It may use provider credits. It does not insert text into another app again. Failed retries preserve an existing successful transcript. If the first attempt failed, the retained recording can be retried later. Cancelled or silent recordings do not earn word statistics until a successful nonempty transcript is saved.

Delete asks for confirmation and removes both the transcript and original audio. Click outside the confirmation to dismiss it without deleting. It does not remove text already inserted into other apps. Accumulated word totals and activity stay unchanged. Each recording contributes to total words, recording count, WPM, and the local-day activity calendar once, using its first successful prepared transcript; retries never count it twice.

Metadata, original transcript, final text, language, and metrics are stored in SQLite. Original audio is stored as separate files. Development data lives in `.local/development/history.sqlite3` and `.local/development/recordings/` and is excluded from Git. Installed builds use Electron's per-user app data directory. These are ordinary local files, not encrypted cloud backups. No history is uploaded to a storage service; recognition and explicit retries still transmit audio and enabled cleanup transmits text to their providers.

History writes are serialized, partially written files are cleaned up on startup, and interrupted deletions are recovered. Existing databases are upgraded without replacing preferences or older entries. Older entries without an original audio file can still be copied or deleted. Saving failures are reported in the recording panel while the current preview remains available. Quitting waits for history writes already received by the desktop coordinator to finish.

## Check Windows input behavior

To change the dictation shortcut, open **Settings > General > Shortcuts > View**, choose **Change shortcut**, then press and release a supported combination. It saves automatically to local preferences. Enabled shortcuts pause during editing and resume with the saved combination. Cancel or close Settings to keep the previous combination. Finish any current dictation or text processing before changing shortcuts.

The standalone Windows input test can check the hook, observe a session, and insert the fixed sentence **Sargosh input test.** after finishing.

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

The microphone level test does not retain audio. Recording previews remain in memory only and are removed when replaced, discarded, reloaded, or closed. Local development preferences survive restarts. There is no signed-in account in this build; its development store is separate from future account-specific history.

Successful recording metrics are stored independently of history entries so deleting history does not erase accumulated statistics. Retrying an existing recording does not count it twice. Dictation speed is total finalized words divided by total recording time in minutes, including pauses.

Secrets, local databases, development recordings, and private assistant configuration must not be committed. A distributed desktop app must never contain private Deepgram, Gemini, or database service keys. Provider credential setup is documented above. Neither private `.env` files nor actual keys belong in Git or an installer.

## Checks and builds

```powershell
npm run typecheck
npm test
npm run build
```

The tests cover lifecycle cancellation, late results, destination freezing, duplicate completion, insights calculations, local SQLite persistence, API readiness behavior, shortcut timing, protected fields, target changes, Unicode input layout, delivery guards, final audio chunk ordering, recording cancellation races, repeated hold/hands-free recording sessions, microphone disconnection, recording limits, transcription cancellation and stale responses, provider errors, binary audio uploads, request deduplication, local API access controls, transcription rate limits, structured cleanup validation, cleanup cancellation and late responses, preservation of the original transcript on failure, cleanup retries without another transcription, saved audio recovery, history paging, retry counts, audio export, and history menu controls.

Electron Forge configuration is included for Windows packaging. This source build currently requires local Python; a self-contained Windows helper must be bundled before distributing an installer. Signing and public distribution are separate from running the source locally.
