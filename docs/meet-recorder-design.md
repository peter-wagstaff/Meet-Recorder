# Google Meet Audio Recorder — Extension Design

**Audience:** Public (Chrome Web Store, open source)
**Browsers:** Chrome and Brave (Firefox lacks tabCapture API)

## Summary

A browser extension that detects Google Meet sessions, prompts the user to record, captures all audio (remote speakers + user's mic) as MP3, and saves to either a local Downloads subfolder or Google Drive.

## Audio Capture Approach

- `chrome.tabCapture` captures tab audio (remote participants)
- `getUserMedia` captures user's microphone
- Web Audio API merges both streams
- `AudioWorkletNode` captures PCM samples and feeds them to `lamejs` for real-time MP3 encoding
- Save via `chrome.downloads` (local) or Drive REST API (Google Drive)

## Architecture

```
Content Script (meet.google.com)
├── Detects active meeting via URL + DOM observation
├── Injects floating recording banner (Shadow DOM)
├── Pause/resume, save, and clear controls with editable filename
├── Gear icon opens options page for settings
├── Sends start/stop/pause/resume/discard messages to service worker

Service Worker (background.js)
├── Handles tabCapture.getMediaStreamId()
├── Manages offscreen document lifecycle (created on record, closed after save)
├── Manages recording state (persisted to chrome.storage.session for SW restarts)
├── Downloads locally (via blob URL from offscreen) or uploads to Google Drive
├── Handles extension icon click (toggle recording)
├── Manages mic permission grant flow (handles tab close gracefully)

Offscreen Document
├── Acquires tab audio stream via stream ID
├── Acquires mic stream via getUserMedia
├── Merges streams with Web Audio API
├── Passes tab audio through to speakers (user hears other participants)
├── Encodes to MP3 in real-time via AudioWorklet + lamejs
├── Supports pause (audioContext.suspend) and resume (audioContext.resume)
├── Supports discard (cleanup without saving)
├── Stores MP3 blob in IndexedDB on stop
├── Provides blob URL for local downloads (avoids base64 OOM in service worker)
├── Closed after recording completes or is discarded

Options Page
├── Save destination: Local download or Google Drive
├── Local subfolder configuration
├── Google sign-in via chrome.identity
├── Shared Drives opt-in checkbox (shown before sign-in)
├── Folder picker (My Drive, + Shared Drives if opted in)

Permissions Page (one-time setup)
└── Grants microphone permission to the extension's origin
```

## Meet Detection

- Content script matches `https://meet.google.com/*`
- Watches DOM for the "Leave call" button (throttled via `requestAnimationFrame`)
- On join: injects floating banner at top-right of page
- On leave: auto-stops recording if active, delays banner removal for save feedback

## Recording UI

Floating banner injected into Meet page, isolated via Shadow DOM. Keyboard events are stopped from propagating to Meet's shortcut handlers.

- **Pre-recording:** Destination display with gear icon, editable filename, [Start Recording]
- **Recording:** Pulsing red dot + elapsed time + [Pause] + [Save] [Clear]
  - Pause/Resume toggles audio capture; timer pauses during pause
  - Save stops recording and saves (same as previous Stop behavior)
  - Clear requires two clicks to confirm, then discards recording without saving
- **Paused:** Red dot stops pulsing, status shows "Paused", timer frozen
- **Processing:** "Saving recording..." then "Recording saved!" for 2 seconds
- **Error state:** Helpful message when extension icon click is required for first recording

Banner updates live when settings change in the options page via `chrome.storage.onChanged`.

### Starting a Recording

- **Extension icon click** (toolbar): Primary method. Required for first recording on a tab (`tabCapture` needs extension to be "invoked" via user gesture).
- **Banner button:** Works for subsequent recordings on the same tab after the icon has been clicked once.

### Save Destination

Configured in the options page (right-click extension icon > Options):

- **Local download:** Saves to a configurable subfolder within the browser Downloads directory (default: `Meet Recordings`). Leave blank to save directly to Downloads.
- **Google Drive:** Saves to a user-selected folder (My Drive or Shared Drives). Drive REST API v3 for upload. See OAuth section below for authentication details.

Filename format: `Meeting - YYYY-MM-DD HH-MM.mp3` (editable in the banner before recording).

## Audio Capture Flow

1. User clicks extension icon (or banner button if icon was clicked previously)
2. Background ensures mic permission is granted (opens permissions page on first use)
3. Background creates offscreen document if needed, waits for readiness signal
4. Background calls `tabCapture.getMediaStreamId()` for the Meet tab
5. Stream ID sent to offscreen document
6. Offscreen document:
   - Gets tab audio stream via `getUserMedia` with `chromeMediaSource: "tab"`
   - Gets mic stream via `getUserMedia` (auto-granted after permissions page)
   - Creates `AudioContext` (explicitly resumed for headless context)
   - Connects both sources to a `MediaStreamDestination`
   - Tab audio also connected directly to `audioContext.destination` for playback
   - `AudioWorkletNode` captures PCM samples from merged stream
   - Samples converted Float32 to Int16 and fed to `lamejs` `Mp3Encoder` in real-time
7. Pause/Resume: `audioContext.suspend()` / `audioContext.resume()`
8. On Save:
   - Flush MP3 encoder, build MP3 blob
   - Store blob in IndexedDB, create blob URL, notify background via `chrome.runtime.sendMessage`
   - Local: background downloads via blob URL (offscreen doc stays alive until download completes)
   - Drive: background retrieves blob from IndexedDB for multipart upload
   - Offscreen document closed after save completes
9. On Discard: Tear down audio resources without flushing/storing MP3, close offscreen document

## Google Drive Upload

- Endpoint: `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`
- Multipart request: JSON metadata (name, parent folder ID, mimeType) + MP3 binary data
- Background retrieves MP3 blob from IndexedDB for upload
- OAuth scopes: `drive.file` (upload) + `drive.metadata.readonly` (base) or `drive.readonly` (if Shared Drives enabled)
- On 401, retries once with interactive re-authentication

### OAuth Token Flow

Two OAuth client IDs are used (same GCP project):

- **Chrome App client** (`oauth2.client_id` in manifest) — used by `chrome.identity.getAuthToken()` on Chrome
- **Web Application client** (hardcoded in `drive-api.js`) — used by `chrome.identity.launchWebAuthFlow()` on Brave and as a fallback

Token retrieval priority:

1. `chrome.identity.getAuthToken({ interactive: false, scopes })` — silent, Chrome-managed token with dynamic scopes (works on Chrome, fails on Brave)
2. Cached token from `chrome.storage.local` — returned if not expired
3. Silent `launchWebAuthFlow` with `prompt=none` — refreshes the token without UI if the user's Google session is still active
4. Interactive `launchWebAuthFlow` — full sign-in prompt (only if caller requests interactive)

Tokens from `launchWebAuthFlow` are cached in `chrome.storage.local` with an expiry timestamp (from Google's `expires_in`, minus 60s buffer). On Chrome, step 1 handles everything. On Brave, step 3 provides silent refresh as long as the user stays logged into Google.

### Two-Tier OAuth Scopes

The manifest declares base scopes (`drive.file` + `drive.metadata.readonly`). At sign-in time, the user is shown a checkbox to enable Shared Drives. If enabled, the `drive.readonly` scope (which includes `drives.list` access) is requested instead of `drive.metadata.readonly`. The preference is stored as `sharedDrivesEnabled` in `chrome.storage.local` and used for all subsequent token requests (including silent refresh). Sign-out clears the preference so the choice is presented again on next sign-in.

## Settings Schema

```json
{
  "saveDestination": "local | drive",
  "subfolder": "Meet Recordings",
  "driveFolder": {
    "id": "folder-id",
    "name": "Folder Name",
    "driveId": "shared-drive-id-or-null"
  },
  "sharedDrivesEnabled": "boolean (opt-in for broader drive.readonly scope)"
}
```

## Permissions

- `tabCapture` — capture tab audio
- `activeTab` — required for tabCapture invocation
- `offscreen` — create offscreen document
- `downloads` — save files locally
- `storage` — persist user preferences
- `identity` — Google OAuth for Drive upload
- Host: `https://meet.google.com/*`

## File Structure

```
meet-recorder/
├── manifest.json
├── build.js                        # esbuild bundler (minified output)
├── package.js                      # Zip packager for Chrome Web Store
├── package.json
├── src/
│   ├── content/
│   │   ├── content.js              # Meet detection + Shadow DOM recording UI
│   │   └── recorder-ui.css         # Host element positioning
│   ├── background/
│   │   └── background.js           # Service worker (coordination, tabCapture, downloads, Drive upload)
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   ├── offscreen.js            # Audio merge + real-time MP3 encoding
│   │   └── pcm-processor.js        # AudioWorklet processor for PCM capture
│   ├── options/
│   │   ├── options.html            # Settings page with OAuth + folder picker
│   │   └── options.js              # Settings logic
│   ├── lib/
│   │   └── drive-api.js            # Drive REST API wrapper (auth, upload, list folders)
│   └── permissions/
│       ├── permissions.html         # One-time mic permission grant page
│       └── permissions.js
├── scripts/
│   └── generate-icons.js           # Icon generation utility
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── dist/                            # Built output (gitignored, run `npm run build`)
    ├── background.js
    ├── content.js
    ├── offscreen.js
    └── options.js
```

## Known Limitations

- **First recording requires icon click:** `tabCapture.getMediaStreamId()` requires the extension to be "invoked" via toolbar icon. The banner button works for subsequent recordings.
- **Firefox unsupported:** No `tabCapture` API equivalent.
