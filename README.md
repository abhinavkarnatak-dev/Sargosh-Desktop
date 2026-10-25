# Sargosh

Sargosh is a Windows dictation companion designed to turn natural speech into text in the apps you use. Its interface brings together a floating dictation control, a local recording history, and simple usage insights.

The source provides a Windows desktop workspace with light and dark themes, a floating recording control, local audio playback, Deepgram transcription, and optional Gemini Flash-Lite cleanup. An opt-in Windows input test checks clipboard-free delivery of a fixed sentence. Finished desktop dictations can insert text directly into the saved input without using the clipboard. Finished recordings and transcripts are saved locally and remain after restart. The desktop app supports Supabase email OTP sign-in, Google sign-in, saved sessions, and account-specific local history.

## Using the desktop workspace

- The top bar holds the sidebar toggle, a Light/Dark/System theme menu, and native Windows minimize, maximize, and close controls. Its empty area can be dragged to move the window, and its colors follow the app theme. The theme button uses the native window-control bounds to keep a small gap beside Minimize at different display scales.
- The rounded page frame stays fixed while its content scrolls. Scrollbars are hidden; mouse-wheel, touchpad, and keyboard scrolling remain available.
- The sidebar expands smoothly with fading labels. Its logo and navigation icons stay aligned, with Settings anchored at the bottom.
- **Dictation** shows saved transcripts and original recordings, grouped by day.
- **Insights** shows total words, recording count, average words per minute, and daily activity. A day's tooltip contains only its date and word count. On opening Insights, the activity grid reveals smoothly from left to right, one week column at a time. The animation respects the system's reduced-motion setting.
- **Settings** contains theme and microphone preferences and a microphone test. While Settings is open, the background stays still and cannot be interacted with. Click outside the dialog, press Escape, or use its close button to return.
- The tray icon reopens Sargosh. Closing the main window hides it; choose **Quit Sargosh** from the tray menu to exit.
- The floating pill expands on hover. Its microphone button opens the main app until recording shortcuts are enabled; it then starts hands-free recording. The grip moves the control. After you finish speaking, the control keeps the audio dots and shows a small loader on their right while your text is prepared. It does not display processing-stage names or cancel buttons during this step. Microphone warnings, no-speech results, and cancellation messages appear in a dismissible card above the pill. A card that opens Sargosh or microphone settings closes when that action succeeds; the pill stays visible. If text cannot be inserted, the card shows the prepared text and a Copy button.
- The microphone level test processes sound levels on your computer. It does not save or upload audio.
- **Check your recording** captures audio with start, finish, cancel, playback, and clear-preview controls. Finishing saves the original recording locally in the desktop app.

## Run from source

Use Windows with Node.js 22.16 or newer in the Node 22 line, npm, and Python 3.11 or newer. Browser preview can be explored without cloud credentials. Desktop sign-in requires a Supabase project.

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

Metadata, original transcript, final text, language, and metrics are stored in SQLite. Original audio is stored as separate files. Development data lives in `.local/development/history.sqlite3` and `.local/development/recordings/` and is excluded from Git. Installed builds use Electron's per-user app data directory. The first signed-in account owns existing development history; other accounts use separate `accounts/<user-id>/` folders. The `legacy-owner.json` file records that ownership. Signing out hides the data without deleting it. These are ordinary local files, not encrypted cloud backups. No history is uploaded to a storage service; recognition and explicit retries still transmit audio and enabled cleanup transmits text to their providers.

History writes are serialized, partially written files are cleaned up on startup, and interrupted deletions are recovered. Existing databases are upgraded without replacing preferences or older entries. Older entries without an original audio file can still be copied or deleted. Saving failures are reported in the recording panel while the current preview remains available. Quitting waits for history writes already received by the desktop coordinator to finish.

## Sign-in and account setup

Create a Supabase project and add its Project URL and publishable key to private `.env`:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

These public project settings are read by the Electron coordinator and local API. Private provider keys remain in the backend. Do not substitute a Supabase secret or service-role key for the publishable key. Restart the desktop app and API after configuration changes.

For email OTPs, enable the Email provider and signup in Supabase Authentication. Under Authentication > Sign In / Providers > Email, set **Email OTP length** to **6** and save. Sargosh accepts exactly six digits; this Supabase setting controls the length generated in emails. Request a new OTP after changing it. New Free-plan projects must configure custom SMTP before editing email templates; the default sender uses fixed sign-in-link templates. Once SMTP is configured, in Authentication's Email Templates, change **Magic Link** to display `{{ .Token }}` instead of a sign-in link. Use the token in **Confirm signup** too if that template is used by your project. For the Sargosh design, paste the full contents of [`assets/email/sign-in.html`](assets/email/sign-in.html) into each template's Source editor. Use **Your Sargosh sign-in OTP** as the subject. Keep `{{ .Token }}` unchanged; Supabase replaces it with the actual OTP. The template uses a rounded card with an integrated green accent, inline styles, and table layout for email compatibility, with optional dark-mode styles for clients that support them. It uses system fonts, no tracking resources, and transparent black and white PNG logos hosted at the repository's public raw-image URLs. Supported email clients show the black logo in light mode and the white logo in dark mode; clients without image-swap support use the default black logo. Both images must remain publicly accessible. The adjacent Sargosh wordmark remains readable if an email client blocks images. The logo URL can later move to a public HTTPS asset on your own domain. Email applications may override theme colors; browser previews do not guarantee identical rendering in every inbox.

Enter an email in Sargosh, choose **Send OTP**, then enter the received OTP on the separate verification screen. This screen shows the destination email, supports resending the OTP, and provides a way back to sign-in. Accounts without a saved first name then enter their first name and optional last name before the workspace opens. The name is saved to the Supabase profile. Returning accounts with a saved name go directly to the workspace; closing the app before completing this step brings it back on the next sign-in. Resend requests have a one-minute app cooldown as well as Supabase's own limits. Supabase's default email sender is restricted to project-team addresses and has low limits; configure custom SMTP in Supabase before inviting other users. See [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless) and [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp).

For Google, create a Google Cloud OAuth client of type Web application, set its authorized redirect URI to the Supabase callback shown in the Google provider settings, and enable that provider in Supabase with its client ID and secret. Keep the Google secret in Supabase. Under Authentication > URL Configuration > Redirect URLs, add exactly:

```text
http://127.0.0.1:48123/auth/callback/**
```

The Google button includes the official multicolor [Google G logo](https://developers.google.com/identity/branding-guidelines), bundled locally so displaying it makes no network request. It opens the system browser for authorization and returns to the running desktop app. The desktop uses PKCE and a random callback path; its callback listener binds only to `127.0.0.1:48123`, accepts a single matching code, and times out after five minutes. That port must be free. The browser completion page follows the device light or dark theme and removes the authorization code and random path from the address bar after completion. The address remains local to your computer; you can close the tab and return to Sargosh. If the Google consent app is in testing, add each intended tester to its test-user list. See [Google provider setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

The official `@supabase/supabase-js` library handles authentication and refresh. Tokens stay in the Electron main process and are encrypted on disk with Electron `safeStorage`, backed by Windows user protection. They are not sent to React, localStorage, SQLite, or the Python helper. Encryption availability is required; there is no plaintext fallback. Session restoration verifies the user with Supabase before opening local account data, so starting the app requires a working connection to restore sign-in.

The Account screen edits first and last name and signs out this device. Sign-out clears the local session and visible previews, stops recording, and hides that account's local history. It does not delete recordings or sign out other devices. Account deletion is not exposed in this build. The first verified account keeps existing development history; later accounts get separate SQLite and audio directories. Local history is not uploaded to Supabase.

When Supabase is configured, the local API validates the user's access token with Supabase before any Deepgram or Gemini call. Recognition caches are separated by verified account. Browser preview can show the workspace and test local recording, but cloud requests require desktop sign-in. Public distribution still requires a hosted backend and production email/provider configuration.

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

The microphone level test does not retain audio. Recording previews remain in memory only and are removed when replaced, discarded, reloaded, or closed. Local development preferences survive restarts. Supabase identifies the signed-in account. History and recordings remain on this computer, with separate storage for each account.

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

## Hosted API and usage allowances

The hosted Fastify API supports unlimited account registrations. Every verified account receives 10 audio minutes per UTC day and 100 audio minutes per UTC calendar month, with a five-minute limit per recording, one active cloud operation per account, and up to 20 submitted operations per minute per operation type. Transcription and cleanup have separate service-wide estimated monthly budgets of $15 and $5. These allowances are server-controlled; reinstalling the app or changing the computer clock does not reset them. Reset times are shown in the user's local timezone under Settings > Account > Usage allowance.

The backend verifies the Supabase session before accepting paid work. It validates uploaded audio with FFmpeg, converts it to 16 kHz mono PCM, and measures its duration before reserving allowance. Supabase PostgreSQL holds durable usage metadata and uses a transaction lock to reserve account and global budgets together across processes. The desktop-supplied duration and user ID are never trusted. Unsubmitted reservations expire after two minutes. Requests already dispatched to a provider remain charged conservatively when the outcome is uncertain; the backend does not automatically resend them or refund uncertain costs. Explicit retranscription with a new request ID consumes allowance again. Cleanup consumes its own service budget, not audio minutes.

Transcription reserves a conservative $0.0052 per minute at the server-measured duration rounded up to a second for all supported languages. Cleanup reserves a conservative UTF-8 input bound and maximum output at $0.30/$2.50 per million input/output tokens, including thinking tokens, then reconciles from provider usage metadata when available. Set `SARGOSH_STT_RATE_MICRO_PER_MINUTE` to the effective Deepgram rate in microdollars per minute if your account tariff differs; the default is 5200. The app keeps `mip_opt_out=true`, so confirm the account rate for that data-handling option before public deployment. The meter covers calls made through this hosted backend; local development calls or other apps using the same provider key are outside it. These are estimates at the configured model prices, not provider-enforced billing caps; review the accounting rates when changing pricing/model configuration. Resend, Supabase, hosting, and taxes are separate. Successful results are cached in server memory for five minutes; only usage IDs, hashes, timing, and cost metadata are saved in PostgreSQL, not audio or transcript contents. After a cache is lost on restart, a previously submitted request ID is rejected rather than silently billed again. The local saved result remains available in desktop history.

### Supabase setup

Run [`supabase/migrations/202610260002_usage_limits.sql`](supabase/migrations/202610260002_usage_limits.sql) in the project's SQL Editor. It does not cap account counts or create an invitation list. The policy and operation tables are private, RLS-enabled, and inaccessible to public clients. Only server credentials can execute the usage RPCs. The usage ledger intentionally retains opaque user IDs after account deletion so deleting an account cannot erase overall provider spending. [`supabase/setup/usage-overview.sql`](supabase/setup/usage-overview.sql) provides an operator-only overview without transcript contents or credentials. Account deletion and retention policy must account for these records before adding account deletion to the UI.

### Render Free deployment

1. Publish the reviewed backend changes to the connected repository before creating the service. In Render, choose New > Web Service, connect this repository, choose **Docker**, set Dockerfile Path to **Dockerfile.api**, select the **Singapore** region, and select **Free**. Alternatively, use the supplied `render.yaml` Blueprint. Automatic deployment is disabled in the Blueprint so future repository pushes do not publish changes unexpectedly.
2. In Render Environment, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from the existing project, `SUPABASE_SERVER_KEY` with that project's server-only secret API key (or legacy service_role JWT), and the existing `DEEPGRAM_API_KEY` and `GEMINI_API_KEY`. Leave all provider/server secrets on Render. Do not add `WELCOME_JOB_TOKEN` or the Resend key; the welcome function remains hosted separately on Supabase. Set `NODE_ENV=production`, `SARGOSH_API_MODE=hosted`, and `GEMINI_MODEL=gemini-3.5-flash-lite`. Render supplies `PORT` and `RENDER_EXTERNAL_URL`; `SARGOSH_PUBLIC_API_URL` can explicitly set the HTTPS origin if needed.
3. Deploy. The API-only image installs FFmpeg and its two runtime Node dependencies; it contains no Electron app, private `.env`, recordings, helper, or test libraries. Build and start commands come from the Dockerfile. The backend listens on `0.0.0.0:$PORT` and the health-check path is `/health`.
4. Visit `https://YOUR-SERVICE.onrender.com/health`. Expect JSON with `status: "ok"` and `service: "sargosh-api"`. An unauthenticated paid request must return 401. Health checks do not spend allowance or call Deepgram/Gemini. This same URL can be used in an external uptime monitor; no monitoring service is configured by this repository.
5. In the private local `.env`, set `SARGOSH_API_URL=https://YOUR-SERVICE.onrender.com`, keep the public Supabase configuration, then restart the Electron app. The app sends its user access token from Electron main directly to the hosted API. It does not request a development session token from a public endpoint. Open Account settings to check remaining allowance, then record a short sentence and inspect usage. The API continues to support the existing explicitly enabled loopback development mode when `SARGOSH_API_URL` is unset.
6. Before packaging the installed desktop app, run `npm run build:desktop-config` after setting the hosted API URL. This writes only `SARGOSH_API_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` to `dist/desktop-config.json`; provider and server keys are not copied. Packaged apps require hosted configuration. Packaging and native helper distribution have their own setup requirements.

Render Free can sleep after 15 minutes without inbound traffic, and waking can take about a minute. The desktop first requests the health endpoint before sending a paid operation and permits a longer deadline for startup; it never automatically retries a paid POST. Render restarts clear only the short-lived response cache, not the Supabase ledger. Free hosting remains subject to Render's compute, bandwidth, build, and outbound-traffic limitations. See [Render Free](https://render.com/docs/free), [Docker deployment](https://render.com/docs/docker), [Deepgram pricing](https://deepgram.com/pricing), and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

For development, `npm run build:api` builds the server without Electron, and `npm run start:api` starts it. `ffmpeg-static` is a development-only test dependency for real audio validation tests on Windows; hosted images install system FFmpeg instead. Usage/database tests run PostgreSQL in PGlite and provider tests use fake responses. Live hosted authentication, quota persistence across a Render restart, and a real short dictation must also be verified after deployment.

## Welcome email setup

Sargosh can send one welcome email after a new account has a verified email and a saved name. Google names are accepted automatically. The Supabase migration records an activation time, so accounts created before installation are excluded even if they later update their name. No existing accounts are backfilled. Email delivery runs on Supabase and does not depend on the desktop remaining open.

1. In **Edge Functions > Secrets**, set `RESEND_API_KEY` to the existing sending key used for SMTP, and `WELCOME_FROM_EMAIL` to your verified sender, for example `Sargosh <noreply@sargosh.abhinavkarnatak.com>`. Leave OTP SMTP settings unchanged. Also add `WELCOME_JOB_TOKEN` with the exact same legacy service_role JWT saved as `welcome_worker_token` in Vault. This explicit caller token is checked separately from the built-in `SUPABASE_SERVICE_ROLE_KEY`, which the function uses for database requests. Supabase may supply a different API-key format there. Never put either server credential in desktop configuration.
2. In **SQL Editor**, open a new query, paste the full contents of [`supabase/migrations/202610260001_welcome_email.sql`](supabase/migrations/202610260001_welcome_email.sql), and run it. This creates the delivery table, signup trigger, and server-only functions. Both the delivery table and private activation configuration have RLS enabled and no client access. The migration creates or replaces only its own welcome trigger; it does not delete account data.
3. In **Edge Functions**, choose **Deploy a new function > Via Editor**. Name it `send-welcome`. Replace the starter code with the entire [`supabase/deploy/send-welcome.ts`](supabase/deploy/send-welcome.ts), then deploy. Keep JWT verification enabled. This generated file contains the function and email design in one file, with no imports or credentials. The normal source files are under `supabase/functions/send-welcome/`.
4. Enable **pg_cron** and **pg_net** under Database > Extensions if they are not enabled already. In Supabase Vault, create `welcome_worker_url` with the deployed HTTPS function URL and `welcome_worker_token` with the existing **legacy service_role JWT** from Project Settings > API Keys. The publishable/anon key and `sb_secret_` key are not interchangeable with this JWT. These are server-only Vault values, not local files or SQL literals. Keep the Vault token in sync if rotating the legacy server credential.
5. In **SQL Editor**, run [`supabase/setup/schedule-welcome.sql`](supabase/setup/schedule-welcome.sql). It creates or updates the `sargosh-welcome-email` job to run every minute. Each run claims up to five ready emails; small batches normally send within about a minute, and larger queues take longer. There is no separate webhook to configure.
6. Complete signup with a fresh account created after step 2. Email OTP accounts must verify the OTP and save their name; Google accounts can already have both. Check `welcome_emails` in Table Editor, the Edge Function logs, Cron job history, and Resend's email delivery log. A `sent` row means Resend accepted the email; inspect Resend to confirm delivery or a bounce. Signing out and back in should not create another row or send another welcome email.

The worker checks the caller against `WELCOME_JOB_TOKEN`, ignores caller-supplied recipients, and uses server-claimed jobs. Each job has a five-minute lease, a stable recipient/name snapshot, and the Resend request identifier `welcome/<user-id>`. Temporary errors retry after increasing delays, up to five attempts. Jobs that exhaust attempts or remain uncertain after 20 hours move to `review` instead of automatically retrying outside Resend's 24-hour deduplication window. Inspect Resend before manually retrying an uncertain job. Permanent provider errors move to `failed`; changed or unverified destination addresses are also stopped. Account deletion removes its delivery record. Old-account filtering is permanent for this installation; rerunning the migration does not reset activation time.

To inspect the full welcome flow without revealing credentials or recipients, run [`supabase/setup/diagnose-welcome.sql`](supabase/setup/diagnose-welcome.sql) in SQL Editor. It returns queue counts, account eligibility, Vault entry checks, Cron status, and recent HTTP status codes. HTTP 200 with an empty queue and zero new accounts means the worker has no eligible signup to email, rather than a sending failure. Test using an email that has never had an account in the project, created after activation, then verify and complete its name. Existing accounts remain excluded when signing in again.

The worker also writes safe `welcome_worker` version 4 events for configuration, queue count, provider failures, completion, and database status codes. It never logs raw provider/database response bodies, names, email addresses, or keys.

For a function response of `401 {"error":"unauthorized"}`, inspect Edge Functions > send-welcome > Logs for `welcome_auth_check` (version 3). It reports whether the configured job token/header is present, whether a Bearer prefix was duplicated, whether whitespace is present, and whether the credentials match. Unverified role/project labels are diagnostic only and never authorize a call. Tokens, project identifiers, and credential fingerprints are not logged. A gateway error such as `Invalid JWT` occurs before this handler and will not produce that diagnostic. Keep JWT verification enabled during diagnosis.

The scheduled job is the only caller; the desktop app cannot send arbitrary welcome emails. If sending stops, first inspect job/function/provider status and the function secrets. To pause sending, disable `sargosh-welcome-email` in Cron. New eligible signups can still queue while it is paused. Do not delete queue records to resend accepted emails.

Edit [`assets/email/welcome.html`](assets/email/welcome.html) for the light/dark email design, then run `npm run build:welcome` and redeploy the function. The generated dashboard file and deployed template must be kept in sync. Do not paste the welcome template into Supabase's OTP templates. The welcome email uses the same public logo assets and email-client theme support as the OTP template.

The sending function uses built-in `fetch`; no Resend SDK is installed. Development tests use PGlite to run the real PostgreSQL migration and account/lease/retry checks in an isolated in-memory database. Tests use fake recipient addresses and mock Resend calls; they never send email. The deployed Supabase scheduler and inbox delivery must also be checked with a fresh test account after setup. See [Supabase dashboard deployment](https://supabase.com/docs/guides/functions/quickstart-dashboard), [Cron setup](https://supabase.com/docs/guides/cron/quickstart), and [Resend request identifiers](https://resend.com/docs/dashboard/emails/idempotency-keys).
