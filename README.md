# Meet Recorder

A Chrome/Brave extension that records Google Meet audio (all speakers + your microphone) as MP3. Save recordings locally or to Google Drive.

I made this because the built in save recording feature in Google Meet only allows you to save to an unchangeable, predetermined folder. I wanted to be able to save meetings wherever I wanted, including locally, my own Drive, or a shared Drive.

## Features

- Detects Google Meet sessions and shows a recording banner
- Captures all participants and your microphone as a single MP3
- Pause and resume recording at any time
- Save or discard recordings with a confirmation step
- Editable filename before recording
- Save to a local Downloads subfolder or Google Drive (including Shared Drives)
- Settings page with Google sign-in and Drive folder picker
- Real-time MP3 encoding via AudioWorklet + lamejs
- Tab audio passthrough — hear other participants normally while recording

## Install

### From source

1. Clone the repo
2. `npm install`
3. `npm run build`
4. Open the extensions page, enable Developer mode, click "Load unpacked" and select the project folder
   - **Chrome:** `chrome://extensions/`
   - **Brave:** `brave://extensions/`

### Chrome Web Store / Brave Web Store

Coming soon.

## Usage

1. Join a Google Meet
2. Click the Meet Recorder icon in the browser toolbar to start your first recording (see below)
3. The banner shows the filename and save destination — edit the filename if needed
4. During recording you can:
   - **Pause / Resume** — temporarily pause audio capture (timer pauses too)
   - **Save** — stop recording and save the file
   - **Clear** — discard the recording (click twice to confirm)
5. The recording saves to your configured destination

> **Note:** The first recording on a tab must be triggered from the toolbar icon — the browser requires a user gesture for `tabCapture`. After that, the banner's Start Recording button works for subsequent recordings on the same tab.

## Settings

Right-click the extension icon and select "Options", or click the gear icon in the banner.

- **Local download:** Choose a subfolder within your Downloads directory (leave blank for Downloads root)
- **Google Drive:** Sign in with Google, pick a folder from My Drive or Shared Drives. At sign-in you can optionally enable Shared Drives access (requires broader read-only permission)

## Development

```
npm install
npm run build      # bundle src/ into dist/
npm run package    # build + create .zip for Chrome Web Store
```

The build bundles `src/` into `dist/` using esbuild (minified). After making changes, run `npm run build` and reload the extension from the extensions page (`chrome://extensions/` or `brave://extensions/`).

### Project structure

```
src/
├── background/background.js    # Service worker (coordination, downloads, Drive upload)
├── content/content.js          # Meet detection + Shadow DOM recording banner
├── offscreen/offscreen.js      # Audio capture + real-time MP3 encoding
├── offscreen/pcm-processor.js  # AudioWorklet processor
├── options/options.html        # Settings page
├── options/options.js          # Settings logic + Drive folder picker
├── lib/drive-api.js            # Google Drive REST API wrapper
└── permissions/permissions.js  # One-time mic permission grant

build.js                        # esbuild bundler (minified output)
package.js                      # Zip packager for Chrome Web Store
```

## Known Limitations

- First recording on a tab requires clicking the toolbar icon (`tabCapture` needs a user gesture)
- Firefox is not supported (no `tabCapture` API)

## License

MIT
