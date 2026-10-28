# Sargosh

Sargosh is a Windows dictation companion designed to turn natural speech into text in the apps you use. Its interface brings together a floating dictation control, a local recording history, and simple usage insights.

Speak in English, Hindi, or Hinglish using a custom shortcut. Sargosh streams speech to Deepgram when the backend supports it, cleans the transcript with AI, and pastes the complete result into the selected textbox. Recordings, transcripts, and usage insights remain available in account-specific local history. Sign in with Google or a six-digit email OTP.

[Website](https://sargosh.abhinavkarnatak.com) | [Get Sargosh from Microsoft Store](https://apps.microsoft.com/detail/9NCB52CT6X88)

The current source version is **1.0.1**. Source changes, backend deployments, and Microsoft Store package updates are separate release steps; pushing this repository does not publish a desktop update.

## Using the desktop workspace

The app uses a deep-green dark theme and warm light theme, with matching native controls, overlay, sign-in screens, and splash. Dictation, Insights, and Usage headings share a subtle travelling wave. Motion effects respect the system's reduced-motion preference.

- On launch, Sargosh shows its compact animated logo, bold lowercase `sargosh.` wordmark, and loading indicator while it opens local storage and restores sign-in. The splash uses the Sargosh taskbar icon, follows the Windows light/dark palette, and respects reduced-motion settings. It closes as soon as the first usable screen is rendered and the desktop window is ready to paint. There is no minimum display time, and reopening from the tray does not show it again.
- The top bar holds the sidebar toggle and native Windows minimize, maximize, and close controls. Its empty area moves the window, and its colors follow the app theme. Theme selection is in Settings, ordered System, Dark, Light. A fresh installation defaults to System; subsequent choices are saved.
- The rounded page frame stays fixed while its content scrolls. Scrollbars are hidden; mouse-wheel, touchpad, and keyboard scrolling remain available.
- Icon hover labels use custom tooltips that follow the app theme, appear on keyboard focus, and dismiss on Escape or click.
- The sidebar expands smoothly with fading labels. Its animated logo keeps the S steady while the wave flows continuously, with the lowercase `sargosh.` wordmark matching the website. Settings stays at the bottom. Clicking the brand returns to Dictation and plays a brief water effect across the outer frame, leaving dashboard content unchanged.
- **Dictation** places the saved shortcut and usage instructions above compact word and speaking-pace statistics. History follows in a grouped table with a time column, transcript, and row actions.
- Word totals on Dictation and Insights use up to one truncated decimal in K notation from 1,000 onward: 1,356 becomes 1.3K, and 1,999 becomes 1.9K. Rolling digits animate from their current value, and the exact count remains available to assistive technology.
- **Insights** shows total words, recording count, average words per minute, and daily activity. A day's tooltip contains only its date and word count. On opening Insights, the activity grid reveals smoothly from left to right, one week column at a time. The animation respects the system's reduced-motion setting.
- **Usage** shows the signed-in account's hosted allowance and reset times in the device's local timezone. Local development explains when hosted allowance tracking is unavailable.
- **Settings** contains theme, microphone, shortcut, language, and account preferences. Panels and dropdowns expand smoothly. While Settings is open, the background cannot scroll or receive input. Click outside, press Escape, or use X to dismiss it. Transcript and account deletion dialogs use the same smooth dismissal and reduced-motion support.
- App confirmations, including shortcut/profile saves, copy, delete, audio export, and OTP messages, use compact bottom-right toasts. Success confirmations disappear after two seconds. Overlay cards remain beside the floating control rather than moving to the main window's toast area.
- The tray icon reopens Sargosh. Closing the main window hides it; choose **Quit Sargosh** from the tray menu to exit.
- The floating control rests as a small circle with a centre dot and expands on hover. Its microphone button opens the app until shortcuts are enabled, then starts hands-free recording. Drag its dotted grip to reveal three preloaded drop zones: left-centre, right-centre, and bottom-centre. Release to snap smoothly to a zone. Side controls stack vertically; bottom controls stay horizontal. The dock and monitor are saved locally, with a primary-monitor fallback if that display is disconnected.
- While text is prepared and inserted, the overlay shows audio dots and a loader without exposing transcription or cleanup stage names. Cards and tooltips open above the bottom dock or inward from either side. Error, information, and recovery cards have a five-second circular countdown around X. Timeout and X dismissal fade toward the current dock. Opening Sargosh or microphone settings from a card closes it when the action succeeds. If insertion fails, the card offers the prepared text and **Copy text**; the saved transcript remains in history after dismissal.
- The microphone list in setup and Settings refreshes when inputs connect or disconnect. Listing devices does not switch the microphone on. The microphone level test processes sound levels on your computer and does not save or upload audio.
- New accounts receive a three-step setup modal: test a microphone locally, choose a saved shortcut, and practice a dictation. Completion is saved on the account, so subsequent logins and other devices do not repeat it. Accounts created before the tutorial rollout keep their existing dashboard flow. Practice has a separate lifetime allowance of three recordings of up to 20 seconds while setup is unfinished. It does not consume normal daily/monthly audio allowance, create history or audio files, or contribute to word counts, WPM, and Insights. Practice text stays inside the modal; provider costs still count toward the service spending caps.

Practice requests use dedicated desktop IPC and hosted API routes. An older desktop or backend cannot silently fall back to normal paid dictation. The server checks verified identity, unfinished onboarding, lifetime practice attempts, request pairing, recording length, and shared spending budgets. Client-supplied practice flags alone do not grant unlimited access. Usage recorded before practice isolation remains unchanged because it was not tagged as practice.

Live desktop dictation uses an authenticated `/v1/stream` WebSocket when streaming is enabled on the backend. Speech is recognized while recording, then finalized and cleaned before delivery. If streaming is explicitly unavailable before paid audio is sent, the app can use the combined upload endpoint `/v1/dictations`. Tutorial practice uses `/v1/practice/dictations`, and saved-history retries use upload or cleanup-only recovery as appropriate. Original and prepared text are returned together; failed cleanup retains the original without automatically pasting unfinished text. Transcription and cleanup have separate spending reservations, and only transcription consumes audio minutes. See [Streaming dictation](#streaming-dictation) for rollout and failure behavior.

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

Copy `.env.example` to a private `.env` file at the project root. Add your Deepgram key and, for cleanup, your OpenAI key. Keep the local development switch enabled and save. Edit an existing `.env` in place rather than replacing its credentials:

```dotenv
DEEPGRAM_API_KEY=
CLEANUP_PROVIDER=openai
OPENAI_API_KEY=
SARGOSH_LOCAL_TRANSCRIPTION=1
```

Git ignores `.env`. Do not put either key in a `VITE_` variable, the desktop interface, or the distributed app. The Fastify backend loads `.env` when it starts. Restart the API after editing credentials. Only the backend sends provider keys to their respective services; the browser and Electron renderer receive a separate temporary local session token. Built-in fetch handles batch provider requests, and ws handles streaming connections; no provider SDK is required. Create keys in [Deepgram Console](https://console.deepgram.com/) and [OpenAI API dashboard](https://platform.openai.com/api-keys).

## How it works

React and TypeScript render the main workspace and a separate Electron overlay window. Electron manages the tray and desktop lifecycle. Koffi connects a small TypeScript overlay adapter to Windows so the floating controls accept mouse clicks while your input keeps keyboard focus. A restricted preload bridge exposes specific app actions rather than general operating-system access.

The desktop coordinator launches a Python helper and exchanges structured messages over its input/output pipes. `comtypes` connects the helper to Windows UI Automation. Python's built-in Windows-library access handles shortcut events and Unicode keyboard delivery. The helper does not read document text. During automatic paste, it temporarily preserves supported clipboard formats in process memory; this clipboard data is never sent to the backend or written to logs. Python's built-in SQLite module stores preferences, history records, and accumulated metrics. Development data is kept in `.local/` inside the project and is excluded from Git.

The local Fastify service supplies health and connection-status endpoints, forwards audio to Deepgram, and sends transcript text to the selected cleanup provider when enabled. Its development transcription bridge binds to `127.0.0.1`, checks Host and Origin, requires a temporary local token, limits upload size, allows one cloud operation at a time, and limits each provider stage to 10 attempts per minute. Local mode requires an explicit environment switch and is disabled when `NODE_ENV=production`. It is not a public authenticated backend. No sample transcripts or fabricated activity are included.

The current design combines streaming recognition, a single final cleanup, and whole-text paste. Deepgram Nova-3 recognizes audio; the supplied cleanup configuration uses OpenAI GPT-6 Luna. The app also retains a combined record-then-upload path for practice, retries, and backends where streaming is disabled. Recordings and transcript history stay on the computer; account and allowance data live in Supabase. Cloud processing transmits audio and text to the respective providers.

## Record and play local audio

Recording shortcuts activate automatically when the signed-in workspace opens. Click a writable textbox in another app, hold your configured shortcut, speak, and release to finish. Double-tap to start hands-free and double-tap again to finish. The floating control also offers recording controls. The Dictation page explains the current shortcut and provides a retry if shortcuts become unavailable. Customize the shortcut and microphone in Settings. Shortcut labels use compact key names such as Ctrl, Alt, and Win throughout the interface; the overlay action is labeled Dictate.

The microphone is opened only for a microphone test or recording and is stopped on finish or cancellation. The microphone test stays local. Finishing a dictation collects the final audio chunk, saves the recording locally, and automatically transcribes and cleans it before text delivery. There are no manual transcription or cleanup switches on the dashboard. Play, copy, retry, extract, or delete saved dictations from history.

Recordings are limited to 5 minutes and 25 MiB. Permission failures, disconnected microphones, no-speech recordings, and processing errors are explained near the floating control. Closing the main window keeps Sargosh running in the tray. Sleep or input-access failures stop the current recording; use Try again on Dictation if shortcuts need to resume.

## Transcribe with Deepgram

English, Hindi, and Hinglish can be selected in Settings > General > My languages or during practice dictation. Recognition uses Nova-3. Hinglish cleanup romanizes Hindi speech while preserving English words. Language selection currently lasts for the page session.

The streaming flow is microphone capture > 16 kHz mono PCM packets > Electron main > authenticated API WebSocket and allowance reservation > Deepgram while speaking > final transcript > GPT-6 Luna cleanup > whole-text insertion. A separate WebM/Opus recording is saved locally for history. The batch path instead uploads the finished binary recording, validates and normalizes it on the backend, then transcribes and cleans it. Users need no provider API keys; credentials stay on the backend.

Audio is sent to Deepgram and transcript text to the configured AI cleanup provider (OpenAI for the supplied configuration). These requests consume allowance and provider credits. Temporary cleanup connection/server errors can be retried once within the same deadline and reserved spending bound; audio transcription is not automatically repeated. Use Retry transcript in history to explicitly retry a saved recording. Cancellation cannot undo processing already received by a provider. The backend does not write audio or transcript contents to its database or logs; local history remains on the computer. Deepgram requests set `mip_opt_out=true`; see [Deepgram's data policy](https://developers.deepgram.com/trust-security/your-data).

## Text cleanup

Cleanup recognizes clear spoken lists from context, including natural introductions such as "the options include", without requiring "first, second, third". It uses hyphen bullets for options and numbered lists for ordered steps. It preserves surrounding prose and keeps ambiguous narration as sentences. These rules also apply to Hindi/Hinglish enumerations. With Hinglish selected and cleanup enabled, Hindi speech is written in natural Romanized Hindi while English words remain English. Hindi mode preserves the original script. Without cleanup, the original recognition script is retained.

The backend passes finalized Deepgram text directly to its selected cleanup provider through the streaming session or combined batch request. No manual action is needed between recording, transcription, cleanup, and insertion.

Cleanup removes clear fillers and false starts, applies explicit spoken corrections, and improves punctuation. It is instructed to preserve meaning, names, technical identifiers, amounts, negations, language, and script. Dictated questions and instructions remain dictation; the model has no tools or operating-system access. Both the instructions and deterministic output processing require ordinary hyphens instead of en or em dashes.

The supplied configuration selects `CLEANUP_PROVIDER=openai`, which pins `gpt-6-luna`, `reasoning.effort=none`, and `service_tier=fast` through the Responses API. Requests use strict JSON output, `store=false`, no tools, and no previous-response history. Missing credentials or errors do not silently switch providers, models or tiers. The provider may report a different actual tier under its routing policy; the live report and successful combined dictation timing include the returned tier rather than claiming every response was Fast. Fast-tier rates are $0.20 per million input tokens and $1 per million output tokens; actual returned Standard-tier usage is counted at the lower Standard rate. Reservations cover both possible attempts before dispatch. Legacy configurations can explicitly select `CLEANUP_PROVIDER=gemini` with `GEMINI_API_KEY` and a supported `GEMINI_MODEL`; older Gemini-only environments remain compatible. Provider/model selection is backend configuration, never a request-supplied URL or model name.

The prepared text is inserted into the saved textbox and retained in local history. Retry transcript reuses an existing original transcript after failed cleanup, avoiding another audio charge. Retrying an already completed transcript or an entry without recognized text transcribes its audio again. Empty recognition results do not call the cleanup model.

If the cleanup provider is unavailable, refuses a request, is rate-limited, times out, or returns incomplete or invalid JSON, the original transcript stays available. Cleanup edits can still be mistaken; compare with the original when accuracy matters. Input is limited to 24,000 characters, provider requests time out after 20 seconds, and the local client has a separate deadline. Output is schema-validated and length-bounded. No partially generated result is used.

The local API checks its session token, bounds request size and concurrency, and keeps at most 32 successful cleanup responses in memory for 5 minutes to avoid duplicate calls for identical request IDs. The backend does not save transcript text or cleaned text to disk or request logs; the desktop app stores these in its local history. The selected cleanup provider receives the transcript and language hint. See [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) for the OpenAI configuration. Legacy Gemini configurations follow [Gemini API terms](https://ai.google.dev/gemini-api/terms).

Cleanup receives a compact editing policy, the selected language instructions, and only the current transcript. It is instructed to remove fillers, apply clear corrections, fix light grammar and punctuation, preserve the speaker's tone, and organize clear lists. Clearly spoken email addresses and URLs can be formatted when their spelling and structure are unambiguous; unclear addresses are preserved rather than guessed. Hinglish uses Roman-script Hindi, while Hindi retains its script. No previous dictations or textbox contents are sent as cleanup context. Model edits can still be imperfect; review important names, addresses, numbers, and corrections.

Cleanup produces text; a separate Windows delivery step inserts it into the saved input. Completed desktop dictations are saved to local history. Local previews are removed when replaced, discarded, reloaded, or closed, while the bounded backend deduplication caches expire independently.

## Insert into a Windows textbox

Open the Electron app and finish first-time setup if prompted. Recording shortcuts, transcription, and cleanup are enabled automatically. Click a writable textbox in another app, then dictate with either hold or hands-free mode. Finishing the recording prepares the text and inserts it into the saved input.

The latest writable input focused during recording becomes the destination. Finishing freezes that destination, so selecting another field while text is being prepared does not redirect it. The app activates the saved field before typing. Insertion takes place at its current caret and replaces selected text. It automatically pastes the complete text through a temporary Unicode clipboard and Ctrl + V. It does not press Send or synthesize a plain Enter command. Paragraph/list breaks are preserved; the keyboard fallback uses Shift+Enter where multiline input is supported. Browser-preview recordings remain local previews and do not type into other apps.

When cleanup is enabled, only successfully cleaned text is inserted. Cleanup failure or cancellation leaves the original text available and does not automatically insert it. A successful cleanup retry can deliver the text if that recording has not already attempted insertion. With cleanup disabled, the original transcript is inserted. Empty recognition results do not insert anything.

The overlay keeps its dots and loader until delivery finishes. While text is being prepared or inserted, additional recording shortcuts are ignored. Whole-text paste avoids character-by-character typing delays. If clipboard preparation is unavailable, locked, too large, or contains formats that cannot safely be preserved, delivery uses the paced keyboard fallback. Bitmap clipboard data uses a Windows image-handle copy so ordinary screenshot clips can be preserved without forcing that fallback. A paste that has already been dispatched is never automatically retried as keyboard input. Reloading or quitting stops delivery; cancellation cannot undo text or a paste action already sent.

Every recording permits one insertion attempt. Repeated completion events and processing retries do not insert a second copy. If delivery fails or only partly completes, the app retains the text and does not automatically retry. Check the destination before taking further action. The previous clipboard formats are restored only while Sargosh still owns the clipboard and the destination is identified as having requested the text. A new user copy is never overwritten. If the reader cannot be identified, or a dispatched paste times out, the transcript may remain on the clipboard to avoid a delayed paste inserting old contents. Temporary dictation is marked to exclude it from Windows clipboard history and cloud clipboard sync; third-party clipboard managers may behave differently. If there is no usable textbox or delivery cannot be confirmed, an overlay card shows the prepared text and **Copy text**. Dismissal or a new recording hides the card; saved text remains in history.

Password fields, read-only fields, closed windows, and unavailable or hidden controls are excluded. Focus, keyboard modifiers, and keyboard layout are checked before paste dispatch and between characters in the keyboard fallback. An editor that ignores Ctrl + V cannot be reliably detected from keyboard acknowledgement alone; check the result before retrying. Some editors and background browser tabs do not expose a usable Windows input control. The overlay explains unavailable delivery, and saved transcripts remain in history. Windows also restricts delivery between apps running with different permissions.

## Local history and audio

Every finished desktop recording appears in **Your dictations**, grouped under Today, Yesterday, or its local calendar date. The time is on the left, the transcript is in the middle, and Play, Copy, and the three-dot menu are on the right. Hover over a row or move keyboard focus into it to reveal its controls. **Load older dictations** retrieves older pages without discarding recordings.

**Play audio** plays the original saved recording. **Copy transcript** copies the currently saved text and shows a bottom-right confirmation with a gentle fade and slide. Copy, deletion, and audio-export confirmations share this bottom-right style, have no close button, and disappear automatically after two seconds. They respect reduced-motion preferences. The menu contains exactly **Retry transcript**, **Delete transcript**, and **Extract audio**. Extract opens a Windows Save dialog and saves the original bytes in their recorded format, such as WebM/Opus. It does not convert the audio to MP3 or another format.

**Retry transcript** retries cleanup only when a failed entry already has an original transcript. Otherwise it uploads the saved audio to Deepgram, uses its saved language and cleanup choice, and updates the same entry. Retranscription may consume audio allowance and provider credits; cleanup-only recovery does not consume additional audio minutes. Neither path inserts text into another app again. Failed retries preserve an existing successful transcript. If the first attempt failed, the retained recording can be retried later. Cancelled or silent recordings do not earn word statistics until a successful nonempty transcript is saved.

Delete asks for confirmation and removes both the transcript and original audio. Click outside the confirmation to dismiss it without deleting. It does not remove text already inserted into other apps. Accumulated word totals and activity stay unchanged. Each recording contributes to total words, recording count, WPM, and the local-day activity calendar once, using its first successful prepared transcript; retries never count it twice.

Metadata, original transcript, final text, language, and metrics are stored in SQLite. Original audio is stored as separate files. Development data lives in `.local/development/history.sqlite3` and `.local/development/recordings/` and is excluded from Git. Installed builds use Electron's per-user app data directory. The first signed-in account owns existing development history; other accounts use separate `accounts/<user-id>/` folders. The `legacy-owner.json` file records that ownership. Signing out hides the data without deleting it. These are ordinary local files, not encrypted cloud backups. No history is uploaded to a storage service; recognition and explicit retries still transmit audio and enabled cleanup transmits text to their providers.

History writes are serialized, partially written files are cleaned up on startup, and interrupted deletions are recovered. Existing databases are upgraded without replacing preferences or older entries. Older entries without an original audio file can still be copied or deleted. The overlay reports preparation or delivery failures, while the current recording and local save result determine the available recovery options. Quitting waits for history writes already received by the desktop coordinator to finish.

## Sign-in and account setup

Create a Supabase project and add its Project URL and publishable key to private `.env`:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

These public project settings are read by the Electron coordinator and local API. Private provider keys remain in the backend. Do not substitute a Supabase secret or service-role key for the publishable key. Restart the desktop app and API after configuration changes.

For email OTPs, enable the Email provider and signup in Supabase Authentication. Under Authentication > Sign In / Providers > Email, set **Email OTP length** to **6** and save. Sargosh accepts exactly six digits; this Supabase setting controls the length generated in emails. Request a new OTP after changing it. New Free-plan projects must configure custom SMTP before editing email templates; the default sender uses fixed sign-in-link templates. Once SMTP is configured, in Authentication's Email Templates, change **Magic Link** to display `{{ .Token }}` instead of a sign-in link. Use the token in **Confirm signup** too if that template is used by your project. For the Sargosh design, paste the full contents of [`assets/email/sign-in.html`](assets/email/sign-in.html) into each template's Source editor. Use **Your Sargosh sign-in OTP** as the subject. Keep `{{ .Token }}` unchanged; Supabase replaces it with the actual OTP. The template uses a rounded card with an integrated green accent, inline styles, and table layout for email compatibility, with optional dark-mode styles for clients that support them. It uses system fonts, no tracking resources, and transparent black and white PNG logos hosted at the repository's public raw-image URLs. Supported email clients show the black logo in light mode and the white logo in dark mode; clients without image-swap support use the default black logo. Both images must remain publicly accessible. The adjacent Sargosh wordmark remains readable if an email client blocks images. The logo URL can later move to a public HTTPS asset on your own domain. Email applications may override theme colors; browser previews do not guarantee identical rendering in every inbox.

Enter an email in Sargosh, choose **Send OTP**, then enter the received OTP on the separate verification screen. This screen shows the destination email and six digit boxes with a visible caret, whole-code paste, keyboard editing, and supported OTP autofill. A one-minute countdown precedes Resend OTP; send, resend, and cooldown messages use toasts. It also provides a way back to sign-in. Accounts without a saved first name then enter their first name and optional last name before the workspace opens. The name is saved to the Supabase profile. Returning accounts with a saved name go directly to the workspace; closing the app before completing this step brings it back on the next sign-in. Resend requests have a one-minute app cooldown as well as Supabase's own limits. Supabase's default email sender is restricted to project-team addresses and has low limits; configure custom SMTP in Supabase before inviting other users. See [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless) and [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp).

For Google, create a Google Cloud OAuth client of type Web application, set its authorized redirect URI to the Supabase callback shown in the Google provider settings, and enable that provider in Supabase with its client ID and secret. Keep the Google secret in Supabase. Under Authentication > URL Configuration > Redirect URLs, add exactly:

```text
http://127.0.0.1:48123/auth/callback/**
```

The Google button includes the official multicolor [Google G logo](https://developers.google.com/identity/branding-guidelines), bundled locally so displaying it makes no network request. It opens the system browser for authorization and returns to the running desktop app. While waiting, the Google icon transitions to a spinner and a cancel X appears inside the same button area, keeping the email form in place. The desktop uses PKCE and a random callback path; its callback listener binds only to `127.0.0.1:48123`, accepts a single matching code, and times out after five minutes. That port must be free. The browser completion page uses the animated Sargosh logo and follows the device light or dark theme and removes the authorization code and random path from the address bar after completion. After the desktop saves the Google session, the browser redirects to `https://sargosh.abhinavkarnatak.com/auth/complete`. This public confirmation page receives no authorization code, token, email, or session data. Failed or cancelled sign-in stays on the local error page. Close the tab and return to Sargosh. If the Google consent app is in testing, add each intended tester to its test-user list. See [Google provider setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

The official `@supabase/supabase-js` library handles authentication and refresh. Tokens stay in the Electron main process and are encrypted on disk with Electron `safeStorage`, backed by Windows user protection. They are not sent to React, localStorage, SQLite, or the Python helper. Encryption availability is required; there is no plaintext fallback. Session restoration verifies the user with Supabase before opening local account data, so starting the app requires a working connection to restore sign-in.

Settings > Account edits first and last name, signs out this device, and provides **Delete account** beside Sign out. Sign-out clears the local session and visible previews, stops recording, and hides that account's local history without deleting it or signing out other devices. Account deletion requires an explicit confirmation; see [Delete your account](#delete-your-account) for its scope and retained spending records. The first verified account keeps existing development history; later accounts get separate SQLite and audio directories. Local history is not uploaded to Supabase.

When Supabase is configured, the local API validates the user's access token with Supabase before any transcription or cleanup provider call. Recognition caches are separated by verified account. Browser preview can show the workspace and test local recording, but cloud requests require desktop sign-in. Public distribution still requires a hosted backend and production email/provider configuration.

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

Confirm the terminal says **Automatic insertion: ENABLED**. Focus the disposable editor, use either shortcut mode, and finish. The fixed sentence uses the same automatic whole-text paste and conservative keyboard fallback as dictation. Printable ASCII uses ordinary keys mapped to the destination keyboard layout when that mapping needs no Control or Alt keys. Other characters use Unicode input. Characters are paced with a short gap, and delivery stops if input focus, keyboard modifiers, or the keyboard layout changes. Hold and hands-free sessions can be used repeatedly in any order; each finished session has its own delivery guard. It is inserted at the active caret and replaces selected text. Inspect the result yourself: sending input is not proof that every application accepted it. The test never automatically retries uncertain delivery.

Browser preview cannot access these native Windows controls. Restricted execution environments may also prevent global key events or cross-application focus from being observed. Verify supported destinations on your normal Windows desktop.

## Storage and privacy

The microphone level test does not retain audio. Recording previews remain in memory only and are removed when replaced, discarded, reloaded, or closed. Local development preferences survive restarts. Supabase identifies the signed-in account. History and recordings remain on this computer, with separate storage for each account. The overlay's dock position and monitor are a device-level preference stored in `overlay-dock.json` inside Electron's user-data directory (`.local/electron/` in development); they are not synced through the account.

Successful recording metrics are stored independently of history entries so deleting history does not erase accumulated statistics. Retrying an existing recording does not count it twice. Dictation speed is total finalized words divided by total recording time in minutes, including pauses.

Secrets, local databases, development recordings, and private assistant configuration must not be committed. A distributed desktop app must never contain private Deepgram, OpenAI, Gemini, or database service keys. Provider credential setup is documented above. Neither private `.env` files nor actual keys belong in Git or an installer.

## Checks and builds

```powershell
npm run typecheck
npm test
npm run build
```

The tests cover lifecycle cancellation, late results, destination freezing, duplicate completion, insights calculations, local SQLite persistence, API readiness behavior, shortcut timing, protected fields, target changes, Unicode input layout, delivery guards, final audio chunk ordering, recording cancellation races, repeated hold/hands-free recording sessions, microphone disconnection, recording limits, transcription cancellation and stale responses, provider errors, binary audio uploads, request deduplication, local API access controls, transcription rate limits, structured cleanup validation, cleanup cancellation and late responses, preservation of the original transcript on failure, cleanup retries without another transcription, saved audio recovery, history paging, retry counts, audio export, and history menu controls.

Running from source requires local Python. Windows distribution builds bundle a self-contained Python helper through Electron Forge. Signing and public distribution are separate from running the source locally.

## Hosted API and usage allowances

The hosted Fastify API supports unlimited account registrations. Every verified account receives 10 audio minutes per UTC day and 100 audio minutes per UTC calendar month, with a five-minute limit per recording, one active cloud operation per account, and up to 20 submitted operations per minute per operation type. Transcription and cleanup have separate service-wide estimated monthly budgets of $15 and $5. These allowances are server-controlled; reinstalling the app or changing the computer clock does not reset them. Reset times are shown in the user's local timezone on the Usage page in the sidebar.

The backend verifies the Supabase session before accepting paid work. It validates uploaded audio with FFmpeg, converts it to 16 kHz mono PCM, and measures its duration before reserving allowance. Supabase PostgreSQL holds durable usage metadata and uses a transaction lock to reserve account and global budgets together across processes. The desktop-supplied duration and user ID are never trusted. Unsubmitted reservations expire after two minutes. Requests already dispatched to a provider remain charged conservatively when the outcome is uncertain; the backend does not automatically resend them or refund uncertain costs. Explicit retranscription with a new request ID consumes allowance again. Cleanup consumes its own service budget, not audio minutes.

Batch transcription uses the configured `SARGOSH_STT_RATE_MICRO_PER_MINUTE` estimate (default 5200 microdollars per minute); streaming uses `SARGOSH_STREAM_RATE_MICRO_PER_MINUTE` (default 9200). Audio time is rounded up to seconds. Cleanup reserves a bounded input/output estimate for the selected model and both allowed attempts, then reconciles returned usage when available. The OpenAI configuration uses the Fast-tier estimates in [cleanup-budget.ts](src/server/cleanup-budget.ts); legacy Gemini configurations use their separate rates. Confirm these accounting settings against the provider account's tariff, including Deepgram's `mip_opt_out=true` setting, before public deployment. These are application estimates, not provider-enforced billing caps. Local development and other apps sharing a key are outside the hosted ledger; Resend, Supabase, hosting, and taxes are separate. Successful results are cached in server memory for five minutes. PostgreSQL stores usage IDs, hashes, timing, and cost metadata, not audio or transcripts. A request ID whose response cache was lost on restart is rejected rather than silently billed again.

### Supabase setup

Run [`supabase/migrations/202610260002_usage_limits.sql`](supabase/migrations/202610260002_usage_limits.sql), then [`supabase/migrations/202610260003_practice_usage.sql`](supabase/migrations/202610260003_practice_usage.sql), in the project's SQL Editor. Apply the practice migration before deploying practice endpoints. It does not cap account counts or create an invitation list. The policy and operation tables are private, RLS-enabled, and inaccessible to public clients. Only server credentials can execute the usage RPCs. The usage ledger intentionally retains opaque user IDs after account deletion so deleting an account cannot erase overall provider spending. [`supabase/setup/usage-overview.sql`](supabase/setup/usage-overview.sql) provides an operator-only overview without transcript contents or credentials. Account deletion retains these spending records without a name or email, as disclosed in the deletion confirmation.

To check the live database rules without consuming provider credits, run the complete [`supabase/setup/verify-usage-limits.sql`](supabase/setup/verify-usage-limits.sql) in SQL Editor after replacing its email placeholder with your verified sign-in email. Finish active dictations first. The script checks daily limits, monthly limits (when daily/monthly windows differ), the shared STT budget, duplicate request IDs, and simultaneous-request rejection. It makes no provider calls and rolls back all policy/usage changes. Run the entire file, including the final `rollback`, without selecting only part of it. A successful run confirms database enforcement; a short real desktop dictation is still needed to verify hosted authentication, audio conversion, providers, insertion, and the UI counter together. Refresh the Usage page before and after that recording and use the operator overview to inspect `stt` and `cleanup` rows.

### Render Free deployment

1. Publish the reviewed backend changes to the connected repository before creating the service. In Render, choose New > Web Service, connect this repository, choose **Docker**, set Dockerfile Path to **Dockerfile.api**, select the **Singapore** region, and select **Free**. Alternatively, use the supplied `render.yaml` Blueprint. Automatic deployment is disabled in the Blueprint so future repository pushes do not publish changes unexpectedly.
2. In Render Environment, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from the existing project, `SUPABASE_SERVER_KEY` with that project's server-only secret API key (or legacy service_role JWT), and the existing `DEEPGRAM_API_KEY` and `OPENAI_API_KEY`. Leave all provider/server secrets on Render. Do not add `WELCOME_JOB_TOKEN` or the Resend key; the welcome function remains hosted separately on Supabase. Set `NODE_ENV=production`, `SARGOSH_API_MODE=hosted`, and `CLEANUP_PROVIDER=openai`. Render supplies `PORT` and `RENDER_EXTERNAL_URL`; `SARGOSH_PUBLIC_API_URL` can explicitly set the HTTPS origin if needed.
3. Deploy. The API-only image installs FFmpeg and the runtime dependencies in `deploy/api/package.json`, including WebSocket support. It contains no Electron app, private `.env`, recordings, helper, or test libraries. Build and start commands come from the Dockerfile. The backend listens on `0.0.0.0:$PORT` and the health-check path is `/health`.
4. Visit `https://YOUR-SERVICE.onrender.com/health`. Expect JSON with `status: "ok"` and `service: "sargosh-api"`. An unauthenticated paid request must return 401. Health checks do not spend allowance or call the AI providers. This same URL can be used in an external uptime monitor; no monitoring service is configured by this repository.
5. In the private local `.env`, set `SARGOSH_API_URL=https://YOUR-SERVICE.onrender.com`, keep the public Supabase configuration, then restart the Electron app. The app sends its user access token from Electron main directly to the hosted API. It does not request a development session token from a public endpoint. Open Usage in the sidebar to check remaining allowance, then record a short sentence and inspect usage. The API continues to support the existing explicitly enabled loopback development mode when `SARGOSH_API_URL` is unset.
6. Before packaging the installed desktop app, run `npm run build:desktop-config` after setting the hosted API URL. This writes only `SARGOSH_API_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` to `dist/desktop-config.json`; provider and server keys are not copied. Packaged apps require hosted configuration. Packaging and native helper distribution have their own setup requirements.

Render Free can sleep after 15 minutes without inbound traffic, and waking can take about a minute. The desktop first requests the health endpoint before sending a paid operation and permits a longer deadline for startup; it never automatically retries a paid POST. Render restarts clear only the short-lived response cache, not the Supabase ledger. Free hosting remains subject to Render's compute, bandwidth, build, and outbound-traffic limitations. See [Render Free](https://render.com/docs/free), [Docker deployment](https://render.com/docs/docker), [Deepgram pricing](https://deepgram.com/pricing), and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

Run `npm run test:api-build` to validate a clean API-only install, TypeScript build, and pruned production runtime in an isolated folder. The API manifest and lockfile must not contain local links to the desktop repository. The Docker builder explicitly installs development dependencies needed by TypeScript, then removes them from the runtime.

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

## Delete your account

Open Settings > Account and choose the red Delete account button beside Sign out, read the confirmation, and type DELETE. An internet connection to the hosted API is required. The backend deletes only the user verified from the current access token, using its private Supabase server key. Profile, authentication identities, sessions, and associated welcome-email records are removed. The desktop removes that account's local history database, metrics, preferences, recordings, and saved sign-in. Other accounts on the computer are unaffected. Exported files and account data on other computers are not erased remotely.

Usage records retain the opaque account ID, request metadata, duration, and estimated cost without a name, email, audio, or transcript. They continue contributing to service spending totals. Account deletion does not delete historical email-provider delivery logs or backups maintained by infrastructure providers. Local cleanup interrupted after a confirmed cloud deletion is retried on the next app launch. Deploy the updated backend before using this feature; no new secrets or SQL migration are required.

## Windows installer

The Windows x64 installer includes Electron and the local Python helper with its runtime. Users do not need Node.js, Python, or API keys. An internet connection and a microphone are required for dictation. Run `Sargosh-1.0.1-Setup.exe`, open Sargosh, sign in, and complete the microphone, shortcut, and practice setup. Closing the window keeps Sargosh in the tray; use Quit Sargosh to exit.

Installed account data is stored under the Windows user's application data folder, separately from development data in `.local/`. Installing the app does not import development history or sign-in. Text delivery requires a writable input and may be restricted in elevated or protected applications. The direct installer has no automatic update check yet; updates require a new installer. The direct installer is unsigned, so Windows may show an unknown-publisher warning.

### Build the Windows installer from source

Build on Windows x64 with Node.js 22.16 or newer in the Node 22 line, npm 10.9 or newer, and 64-bit Python 3.11. The native Store updater build also needs the Windows SDK metadata and .NET Framework C# compiler; its build script checks for these tools. Install the normal development dependencies, create `.venv`, and install the build requirements:

```powershell
.\.venv\Scripts\python.exe -m pip install -r helper/requirements-build.txt
npm run make
```

Before building, set `SARGOSH_API_URL` to the hosted HTTPS backend origin, plus `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the private project `.env`. Only these three public settings are written into the app. Deepgram, OpenAI, Gemini, Resend, and Supabase server keys belong on the backend and are excluded from the installer. The build rejects a private Supabase key in the public-key field.

`npm run make` builds the interface and desktop coordinator, prepares public configuration, bundles the helper with PyInstaller, and uses Electron Forge and Squirrel.Windows to create the installer. Outputs are in `out/make/squirrel.windows/x64/`; the Setup executable is the file users install. Generated executables and packages are ignored by Git. After making the installer, run `npm run test:packaged` to check the packaged resources and helper. It compares the packaged app and helper against the current build and rejects stale files, then checks public configuration and private-credential exclusion. Building an installer does not publish a GitHub release or deploy the backend.

To inspect an unpacked application instead, use `npm run package`. Run `npm run test:bundled-helper` to check the bundled Python runtime, SQLite, UI Automation, shortcut hook, and clean shutdown without recording audio or inserting text. Installer startup events are handled before the normal app opens, so installation and removal can create or remove shortcuts without starting dictation.

### Microsoft Store package (MSIX)

The Store build uses the same Electron app and bundled Python helper as the direct installer. Windows manages installation and updates, so Squirrel is not used in this distribution. The reserved identity is in `packaging/msix/identity.json`; its name, publisher, and publisher display name must exactly match Partner Center. Package version `1.0.1` becomes MSIX version `1.0.1.0`; increment the source version for later submissions and leave the fourth component at zero.

Build on Windows x64 with the existing source-build requirements and Windows SDK MSIX Packaging Tools (`MakeAppx.exe`). No additional npm library is required. `SARGOSH_MAKEAPPX` can select an explicit SDK executable when it is not installed in the normal Windows Kits location.

```powershell
npm run make:msix
```

The command rebuilds the app and Python helper, packages Electron, checks that packaged files match the current build and exclude private credentials, generates Store icons from the app logo, and creates `out/make/msix/x64/Sargosh-1.0.1.0-x64.msix`. It then extracts the actual MSIX and compares every application file, including the Python helper/runtime, against the verified Electron package. The manifest requests full-trust desktop execution, internet access, and microphone access. The build does not request administrator privileges or UIAccess.

This output is an **unsigned Store submission package**, not a publicly trusted installer for sharing directly. Upload it to the MSIX product's Packages section in Partner Center. Microsoft signs approved Store packages and delivers updates. Registering or installing a development package locally does not prove that the Store-delivered package works on another computer. Store certification, package-identity testing, and testing on a separate Windows device remain necessary.

When submitting, explain the full-trust capability: Sargosh runs an Electron desktop app and a bundled Python helper to support user-configured global dictation shortcuts, direct text insertion into the user's selected application, and local SQLite history. It records microphone audio only when the user starts dictation and sends audio/text to the configured transcription and cleanup services. Provide an accurate privacy policy, screenshots, support details, and review instructions for account creation, microphone setup, dictation, cancellation, and text insertion. Approval is determined by Microsoft.

Test the installed Store version for OTP/Google login, onboarding, microphone selection/playback, hold and hands-free shortcuts, overlay controls, insertion into Notepad and a browser textbox, account-separated history across restart, audio export, usage limits, and uninstall. Quit any existing Sargosh instance before testing to avoid its global shortcut hook or single-instance lock interfering. No automatic migration from the Squirrel installation is provided; do not assume the two distribution methods share saved sessions or history.

### Dictation performance diagnostics

Sargosh records structured timings for microphone startup, capture completion, local history saves, authentication, connection checks, transcription, cleanup, and delivery. A dictation shares one `traceId`. Batch transcription and cleanup can have separate request IDs, while a streaming session uses its live request ID across the server stages. Explicit history retries create a new trace ID. These are diagnostic correlation labels, not credentials.

Desktop events are printed in the desktop launch terminal and written asynchronously to `logs/dictation-timing.jsonl` inside the app's user-data directory. Development uses `.local/electron/logs/dictation-timing.jsonl` in the desktop project. There is one rotated backup, `.jsonl.1`, with approximately 2 MiB per file and a bounded write queue. Diagnostics are best-effort: unwritten events can be lost on abrupt exit, and a full queue or logging failure does not block dictation. Browser preview events appear in its developer console instead.

The API prints server timing events to its terminal or Render logs. They separate authentication, request-body handling, eligibility checks, audio normalization, usage reservation/dispatch/completion, and provider requests.

| Backend stage | What is measured |
| --- | --- |
| `server.auth` | Checking the session through Supabase Auth, including that request's network wait |
| `server.body` | Receiving and parsing the request body after authentication; some upload data may already be buffered |
| `server.eligibility` | Loading the account's eligibility/usage snapshot from Supabase |
| `server.normalize` | Preparing and validating audio through FFmpeg before transcription |
| `server.reserve` | Reserving the account allowance and shared budget through the usage database |
| `server.dispatch` | Recording that the billable provider request is about to start |
| `server.stt` / `server.cleanup` | The complete provider operation, including request preparation, response handling, and result validation |
| `provider.stt.headers` / `provider.cleanup.headers` | Sending the provider request and waiting for response headers; includes network, provider processing and any provider-side wait |
| `provider.stt.body` / `provider.cleanup.body` | Reading the provider response body and decoding its outer JSON |
| `server.finish` | Recording completed usage/cost in Supabase |
| `server.release` | Releasing a reservation when work fails before dispatch; this is a failure path, not a normal extra step |
| `server.stt.total` / `server.cleanup.total` | From the API receiving the request through sending its response, including validation and framework work |

Provider header/body timings are children of the complete provider operation. Do not add both child timings and their parent to a total. Database timings include network round trips, not just PostgreSQL execution. These logs do not expose the provider's internal queue, model computation, DNS, TLS, or separate upload/download timings. Comparing a client HTTP duration with its matching server total gives an approximate remainder outside the measured server lifetime, not a pure network measurement.

Cached responses are marked so they can be excluded from fresh-request comparisons. Deploy the updated backend and run the updated desktop app to collect both sides of a trace; the backend must support the combined dictation endpoints before using the updated desktop app. Older desktop versions can continue using the separate endpoints. No new service account, API key, or analytics library is required.

Timings use a monotonic clock inside each process. Client HTTP timings include sending the request, server processing, receiving the response, and JSON decoding; they are not pure upload measurements. Parent and child stages can overlap and should not be added together. `dictation.stop_to_complete` measures from handling the finish request to the delivery outcome. `dictation.stop_to_first_input_ack` ends when the desktop receives acknowledgement that Windows accepted the first input batch. It does not prove when another app visually displayed the text. Missing input acknowledgements, practice/manual sessions without insertion, failures, and cancellations have explicit non-success outcomes rather than being reported as successful insertion.

Events contain stage names, elapsed milliseconds, outcomes, sizes, selected provider model, and correlation IDs. The desktop file also includes app version and log time. Raw audio, transcript text, textbox contents, application titles, email addresses, credentials, and raw exception messages are excluded. This is local/server diagnostic logging, not a PostHog or Langfuse integration.

To inspect recent development events, run this command from the desktop project folder:

```powershell
Get-Content -LiteralPath .local/electron/logs/dictation-timing.jsonl -Tail 40
```

For a baseline, compare a short sentence and a longer paragraph in both hold and hands-free modes. Include repeated recordings and a request after backend inactivity. Check successful non-cached traces separately from errors, practice sessions, and retries. Timing collection does not change the recording, transcription, cleanup, or insertion strategy.

Delivery diagnostics include a `delivery.path` entry with `method: paste` or `method: keyboard`. Keyboard fallback includes an allowlisted `fallbackReason` and, when available, numeric `clipboardFormat` and `windowsError` values. These entries contain no clipboard or transcript contents. They show whether whole-text paste was dispatched or the paced compatibility path was used; they do not prove that an editor accepted the text.

Failed spans include an allowlisted `errorCode` when available, including cleanup timeout/quota codes and native delivery codes such as `focus-denied`, `focus-changed`, or `paste-unconfirmed`. WebSocket handshake diagnostics include bounded HTTP status, socket error category, and close code when available. Arbitrary exception messages, credentials, and editor contents are excluded. An input acknowledgement confirms Windows accepted an input batch, not that the textbox received its contents. An unconfirmed paste is not retried automatically because that could duplicate text.

To collect backend timings on Render, deploy a revision containing the timing code. Diagnostics alone need no SQL migration or extra environment variable; enabling streaming still requires its documented rollout steps. Restart the desktop, make fresh dictations, and match each `traceId` between the desktop JSONL file and Render Logs. Capture the complete trace. Compare short/long recordings, hold/hands-free sessions, and requests after inactivity separately. Requests that never reach the API cannot be measured by its hooks.

Combined dictations use `dictation.transport` and `dictation.http` on the client, and `server.dictation.total` on the backend. The backend still records `server.stt`, `server.cleanup`, provider timings, and each usage reservation/dispatch/finish separately. Compare the combined HTTP duration with the combined server total; do not add the individual provider durations to their parent total. A successful HTTP response can contain a failed cleanup outcome with a recoverable original transcript; inspect the cleanup stage and the desktop's final dictation outcome as well. The combined flow removes the second upload/session check and repeated authentication/eligibility lookup, but keeps provider calls sequential and all required usage accounting. It does not resolve provider timeouts.

For combined requests, `dictation.http` reports transport success while `dictation.transport` reports the full processing result. If cleanup fails after successful transcription, the latter records a failed outcome with its allowlisted cleanup error code. History retains the original transcript and the cleanup failure message. Explicit spoken self-corrections are handled even when transcription places a period or ellipsis before the correction marker.

### Cleanup reliability and recovery

Cleanup retries a transient connection failure or HTTP 500/502/503/504 at most once, with a short delay inside the original 20-second deadline. Auth, quota, safety and invalid-output failures are not retried. Hosted cleanup reserves spending room for both possible attempts before contacting the provider. A failed attempt may still have incurred provider cost, so its conservative estimate remains counted when the successful attempt is reconciled. Audio is not transcribed again and no extra audio minutes are consumed by this retry.

For a failed history entry with a saved original transcript, Retry transcript retries cleanup only. Entries without a saved transcript still retry audio transcription; explicitly retrying an already completed entry also transcribes again. Failed cleanup does not erase the original transcript or insert partially prepared text automatically.

`npm run test:cleanup:live` makes real calls using the private key for the selected cleanup provider and its configured model. It checks synthetic examples for corrections, grammar, filler removal, negations, lists, lowercase email addresses (unless letter case is explicitly dictated), spoken website domains, links and Latin-script Hinglish. It prints the actual outputs and saves a report in the ignored `.local/cleanup-evaluation/latest.json`. This developer check uses provider quota but does not use a signed-in account's audio allowance. It is opt-in and is not run by the regular test suite. Passing its examples is not a guarantee that every future dictation will be correct.

The OpenAI migration requires both the updated backend and updated desktop client because older clients validate only Gemini model names. Publish the compatible client before switching an existing production service to return GPT-6 Luna results. API-key rotation within the selected provider remains a backend-only environment change. No OpenAI key is included in desktop configuration or the renderer bundle.

### Recording sounds

A short local sound confirms when the microphone begins an accepted recording. A second sound plays after capture stops, including cancellation or a microphone failure after recording began. Hold, hands-free, overlay, and tutorial recordings use the same cues. Repeated state updates do not replay them, and opening or permission failures do not play a false start cue. Sounds are bundled with the app, work in the background, and do not wait for transcription or cleanup. Audio output failure never blocks dictation. The cues are played through the speakers or headphones, without digitally mixing them into the recorded microphone stream.

### Streaming dictation

The desktop streams 16 kHz mono PCM audio in roughly 100 ms packets to the API over an authenticated WebSocket. The API forwards audio to Deepgram Nova-3 while recording continues. The existing WebM/Opus recording remains available locally for history, playback, export, and explicit retries. Provider keys remain on the backend.

Releasing the hold shortcut or finishing hands-free recording flushes the audio thread, sends its final packet, and closes the Deepgram stream gracefully. Only finalized transcript segments enter the existing cleanup request. Interim hypotheses are never pasted or appended as duplicate words. The cleanup model, reasoning setting, service tier, instructions, and whole-text insertion behavior are unchanged by streaming.

Local development enables streaming automatically when local transcription is configured. Quit the desktop from the tray and restart `npm run dev:desktop` after updating the main/preload bridge. Browser preview, tutorial practice, and retries from saved history continue using record-then-upload. Practice remains separate from normal usage and insights.

For the hosted API:

1. Run `supabase/migrations/202610280001_streaming_usage.sql` in Supabase SQL Editor after the existing usage migrations.
2. Set `SARGOSH_STREAMING_ENABLED=1` on Render, then deploy the updated API. Until enabled, the new desktop uses the existing upload path.
3. `SARGOSH_STREAM_RATE_MICRO_PER_MINUTE` defaults to 9200, a conservative live-transcription budget estimate covering the multilingual rate. Set it to match the provider account's live rate. This does not change daily or monthly user allowances.
4. Distribute an updated desktop build for the streaming bridge and audio worklet. Existing clients continue using the upload endpoints.

Before accepting paid audio, the backend reserves a window bounded by the remaining daily/monthly allowance and the five-minute recording maximum. It accepts only fixed-format PCM, measures its duration from byte counts, stops at the reserved limit, and settles to the audio actually sent, rounded up to seconds. Cancelling after audio has already reached Deepgram still consumes that audio time. If the backend crashes or settlement cannot be confirmed, the reservation remains conservatively charged. No new signups or provider keys are needed.

The desktop buffers at most 15 seconds while connecting. A connection failure after streaming starts does not silently resend the entire recording. The saved clip can be retried explicitly from history. Old or disabled backends return a streaming-unavailable response before paid audio and allow the existing batch path. Streaming is not an offline mode.

`ws` supplies the persistent connection; `@types/ws` supplies development-time TypeScript definitions. Both versions already present in the repository's lockfile are now explicit dependencies of the desktop/API builds. The audio worklet uses browser APIs and adds no audio SDK. See [Deepgram live transcription](https://developers.deepgram.com/reference/speech-to-text/listen-streaming), [closing the audio stream](https://developers.deepgram.com/docs/close-stream), and [Deepgram pricing](https://deepgram.com/pricing).

To check the real desktop-to-API WebSocket wiring with fake paid providers, run `npx vitest run tests/streaming-integration.test.ts`. Unit coverage checks final segment assembly, last-packet flushing, sample-rate conversion, cancellation, bounded buffering, usage settlement, and isolation between recordings. Real microphone and Deepgram behavior must also be checked in the desktop app.

Timing logs add `stream.handshake`, `stream.open`, `stream.connect`, `stream.finalize`, and `stream.transport`. Connection work normally occurs while speaking; finalization and cleanup show the remaining work after stopping. Existing stop-to-complete and delivery measurements provide the overall comparison. One WebSocket serves one recording and closes on completion, cancellation, or failure. Health-monitor HTTP pings are separate from that connection. A deployment, server restart, or network interruption can end an active stream; the saved recording remains available for an explicit retry. Raw audio, transcript text, and credentials are excluded from timing events.

### Microsoft Store updates

Store-installed copies check for published updates after startup and every 15 minutes while idle. Choose **Update now** to download through Windows, or **Later** to keep the update available in the sidebar. Once Windows confirms the download is complete, the action becomes **Restart to update**. Windows may ask for permission to download or install. Installation waits until recording, transcription, text insertion and account work have finished; saved history and sign-in state are flushed before installation. Declining a Windows prompt leaves the app usable and the update available.

The updater only operates under the signed Sargosh Microsoft Store package identity. Browser preview, development builds and direct EXE installations do not show Store update controls. Packages continue to come from Microsoft, with no download server, provider keys or update credentials in the client.

`npm run prepare:desktop` also compiles the small native Store bridge using the installed Windows SDK and .NET Framework. The bridge is bundled beside the app and included in packaged freshness checks. No new npm or Python dependencies are required. Windows handles package installation and update restarts; if installation returns without closing the current process, Sargosh relaunches through its package identity rather than the old executable path.

For a UI-only development preview, keep `npm run dev:preview` running and open `http://127.0.0.1:5173/dev/update-preview.html`. It simulates the update popup, Later/sidebar action, download progress, and restart state in both themes. It does not contact the Store, record audio, download a package, or restart the app. This separate development entry is excluded from the production build.

Actual Store download, consent and restart behavior must be tested with two Store-published package versions, preferably a package flight: first install a version containing the updater, then publish a higher version to that test group. Mocked tests cover update states, progress, dismissal, cancellations, failed connections and protection of active dictation; they do not substitute for that packaged update test.
