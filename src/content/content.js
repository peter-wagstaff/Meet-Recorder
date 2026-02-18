(function () {
  // Avoid double-injection
  if (document.getElementById("meet-recorder-host")) return;

  let isRecording = false;
  let isPaused = false;
  let timerInterval = null;
  let startTime = null;
  let elapsedAtPause = 0;
  let meetDetected = false;

  // --- Meet Detection ---
  // Google Meet shows a bottom bar with call controls when in a meeting.
  // We watch for the presence of buttons with known aria-labels or
  // the data-call-ended attribute.

  function isMeetingActive() {
    // The end-call button is a reliable signal that you're in a meeting
    const endCallBtn = document.querySelector('[data-tooltip*="Leave call"]')
      || document.querySelector('[aria-label*="Leave call"]');
    return !!endCallBtn;
  }

  function watchForMeeting() {
    let checkScheduled = false;
    const observer = new MutationObserver(() => {
      if (checkScheduled) return;
      checkScheduled = true;
      requestAnimationFrame(() => {
        checkScheduled = false;
        if (!meetDetected && isMeetingActive()) {
          meetDetected = true;
          showBanner();
        }
        if (meetDetected && !isMeetingActive()) {
          meetDetected = false;
          if (isRecording) {
            stopRecording();
            // Delay banner removal so user sees save feedback
            setTimeout(() => removeBanner(), 4000);
          } else {
            removeBanner();
          }
        }
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Also check immediately
    if (isMeetingActive()) {
      meetDetected = true;
      showBanner();
    }
  }

  // --- Banner UI (Shadow DOM) ---

  let host = null;
  let shadow = null;

  function showBanner() {
    if (host) return;

    host = document.createElement("div");
    host.id = "meet-recorder-host";
    shadow = host.attachShadow({ mode: "closed" });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .banner {
          background: #1a1a2e;
          color: #fff;
          border-radius: 12px;
          padding: 12px 16px;
          min-width: 260px;
          max-width: 320px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          font-family: 'Google Sans', Roboto, Arial, sans-serif;
          font-size: 13px;
        }
        .title {
          font-weight: 500;
          font-size: 14px;
          margin-bottom: 8px;
        }
        .dest-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 10px;
          font-size: 12px;
          color: #aaa;
        }
        .dest-row input {
          background: #2a2a3e;
          border: 1px solid #444;
          border-radius: 4px;
          color: #fff;
          padding: 3px 6px;
          font-size: 12px;
          flex: 1;
          min-width: 0;
        }
        .settings-btn {
          background: #2a2a3e;
          border: 1px solid #444;
          border-radius: 4px;
          cursor: pointer;
          padding: 2px 6px;
          font-size: 14px;
          line-height: 1;
          color: #aaa;
          flex-shrink: 0;
          margin-left: auto;
        }
        .settings-btn:hover { color: #fff; background: #3a3a4e; }
        .btn {
          border: none;
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          width: 100%;
        }
        .btn-start {
          background: #ea4335;
          color: #fff;
        }
        .btn-start:hover { background: #d33426; }
        .btn-pause {
          background: #ea4335;
          color: #fff;
          margin-bottom: 8px;
        }
        .btn-pause:hover { background: #d33426; }
        .btn-row {
          display: flex;
          gap: 8px;
        }
        .btn-row .btn {
          flex: 1;
        }
        .btn-save {
          background: #34a853;
          color: #fff;
        }
        .btn-save:hover { background: #2d9249; }
        .btn-clear {
          background: #3a3a4e;
          color: #aaa;
        }
        .btn-clear:hover { background: #4a4a5e; }
        .btn-clear.confirm {
          background: #ea4335;
          color: #fff;
        }
        .btn-clear.confirm:hover { background: #d33426; }
        .recording-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .red-dot {
          width: 10px;
          height: 10px;
          background: #ea4335;
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        }
        .red-dot.paused {
          animation: none;
          opacity: 0.4;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .timer { font-variant-numeric: tabular-nums; }
        .processing { text-align: center; color: #aaa; padding: 8px 0; }
        .dismiss {
          position: absolute;
          top: 6px;
          right: 10px;
          background: none;
          border: none;
          color: #666;
          cursor: pointer;
          font-size: 16px;
          padding: 2px;
        }
        .dismiss:hover { color: #fff; }
        .banner { position: relative; }
.error-hint {
          font-size: 12px;
          color: #ea4335;
          text-align: center;
          margin-top: 8px;
          display: none;
        }
        .error-hint img {
          display: block;
          margin: 8px auto 0;
          max-width: 100%;
          border-radius: 4px;
        }
      </style>
      <div class="banner" id="banner">
        <button class="dismiss" id="dismiss-btn">&times;</button>
        <div id="pre-record">
          <div class="title">Record this meeting?</div>
          <div class="dest-row" id="dest-row">
            <span id="dest-label">Save to: ...</span>
            <button class="settings-btn" id="settings-btn" title="Change save destination">&#9881;</button>
          </div>
          <div class="dest-row">
            Filename: <input type="text" id="filename-input" value="" />
          </div>
          <button class="btn btn-start" id="start-btn">Start Recording</button>

          <div class="error-hint" id="error-hint">Please click the extension icon in the toolbar to start your first recording.<img id="toolbar-img" /></div>
        </div>
        <div id="during-record" style="display:none">
          <div class="recording-row">
            <div class="red-dot" id="red-dot"></div>
            <span id="rec-status">Recording</span>
            <span class="timer" id="timer">00:00:00</span>
          </div>
          <button class="btn btn-pause" id="pause-btn">Pause</button>
          <div class="btn-row">
            <button class="btn btn-save" id="save-btn">Save</button>
            <button class="btn btn-clear" id="clear-btn">Clear</button>
          </div>
        </div>
        <div id="processing" style="display:none">
          <div class="processing" id="processing-text">Saving recording...</div>
        </div>
      </div>
    `;

    document.body.appendChild(host);

    // Set toolbar hint image src (must use runtime URL for content scripts)
    shadow.getElementById("toolbar-img").src =
      chrome.runtime.getURL("images/from_toolbar.png");

    // Prevent keyboard events from reaching Google Meet's shortcut handlers
    ["keydown", "keyup", "keypress"].forEach((eventType) => {
      host.addEventListener(eventType, (e) => {
        e.stopPropagation();
      });
    });

    // Load saved settings and update destination display
    updateDestLabel();

    // Auto-populate default filename
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const defaultFilename = `Meeting - ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
    shadow.getElementById("filename-input").value = defaultFilename;

    // Dismiss button (only when not recording)
    shadow.getElementById("dismiss-btn").addEventListener("click", () => {
      if (!isRecording) {
        removeBanner();
      }
    });

    // Settings button — open options page
    shadow.getElementById("settings-btn").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "open-options" });
    });

    // Start recording
    shadow.getElementById("start-btn").addEventListener("click", () => {
      startRecording();
    });

    // Pause / Resume
    let clearConfirm = false;

    function resetClearConfirm() {
      clearConfirm = false;
      const clearBtn = shadow.getElementById("clear-btn");
      if (clearBtn) {
        clearBtn.textContent = "Clear";
        clearBtn.classList.remove("confirm");
      }
    }

    shadow.getElementById("pause-btn").addEventListener("click", () => {
      resetClearConfirm();
      isPaused = !isPaused;
      const pauseBtn = shadow.getElementById("pause-btn");
      const redDot = shadow.getElementById("red-dot");
      const recStatus = shadow.getElementById("rec-status");
      if (isPaused) {
        chrome.runtime.sendMessage({ type: "pause-recording" });
        pauseBtn.textContent = "Resume";
        redDot.classList.add("paused");
        recStatus.textContent = "Paused";
        // Stop the timer, accumulate elapsed time
        elapsedAtPause += (Date.now() - startTime) / 1000;
        clearInterval(timerInterval);
      } else {
        chrome.runtime.sendMessage({ type: "resume-recording" });
        pauseBtn.textContent = "Pause";
        redDot.classList.remove("paused");
        recStatus.textContent = "Recording";
        // Restart the timer from now
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
      }
    });

    // Save (same as old stop)
    shadow.getElementById("save-btn").addEventListener("click", () => {
      resetClearConfirm();
      stopRecording();
    });

    // Clear with confirmation
    shadow.getElementById("clear-btn").addEventListener("click", () => {
      if (!clearConfirm) {
        clearConfirm = true;
        const clearBtn = shadow.getElementById("clear-btn");
        clearBtn.textContent = "Sure?";
        clearBtn.classList.add("confirm");
      } else {
        // Confirmed — discard
        isRecording = false;
        isPaused = false;
        clearInterval(timerInterval);
        chrome.runtime.sendMessage({ type: "discard-recording" });
      }
    });
  }

  function removeBanner() {
    if (host) {
      clearInterval(timerInterval);
      host.remove();
      host = null;
      shadow = null;
    }
  }

  function startRecording() {
    isRecording = true;
    isPaused = false;
    shadow.getElementById("pre-record").style.display = "none";
    shadow.getElementById("during-record").style.display = "block";
    shadow.getElementById("dismiss-btn").style.display = "none";
    // Reset pause UI for fresh recording
    const pauseBtn = shadow.getElementById("pause-btn");
    if (pauseBtn) pauseBtn.textContent = "Pause";
    const redDot = shadow.getElementById("red-dot");
    if (redDot) redDot.classList.remove("paused");
    const recStatus = shadow.getElementById("rec-status");
    if (recStatus) recStatus.textContent = "Recording";

    startTime = Date.now();
    elapsedAtPause = 0;
    timerInterval = setInterval(updateTimer, 1000);

    chrome.runtime.sendMessage({ type: "start-recording" }, (response) => {
      if (!response || !response.success) {
        // Revert to pre-record state
        isRecording = false;
        clearInterval(timerInterval);
        if (shadow) {
          shadow.getElementById("during-record").style.display = "none";
          shadow.getElementById("pre-record").style.display = "block";
          shadow.getElementById("dismiss-btn").style.display = "";
          // Show helpful error if it's the activeTab issue
          const errorHint = shadow.getElementById("error-hint");
          if (errorHint) {
            errorHint.style.display = "block";
          }
        }
      }
    });
  }

  function stopRecording() {
    isRecording = false;
    isPaused = false;
    clearInterval(timerInterval);

    let customFilename = null;
    if (shadow) {
      shadow.getElementById("during-record").style.display = "none";
      shadow.getElementById("processing").style.display = "block";
      const filenameInput = shadow.getElementById("filename-input");
      if (filenameInput) {
        customFilename = sanitizeFilename(filenameInput.value);
      }
    }

    chrome.runtime.sendMessage({ type: "stop-recording", filename: customFilename });
  }

  function sanitizeFilename(raw) {
    if (!raw || !raw.trim()) return null;
    let name = raw.trim().replace(/[\/\\:*?"<>|]/g, "").substring(0, 200);
    if (name && !name.endsWith(".mp3")) name += ".mp3";
    return name || null;
  }

  function updateTimer() {
    if (!shadow) return;
    const elapsed = Math.floor(elapsedAtPause + (Date.now() - startTime) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    const timer = shadow.getElementById("timer");
    if (timer) timer.textContent = `${h}:${m}:${s}`;
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "download-started") {
      if (shadow) {
        const processingText = shadow.getElementById("processing-text");
        if (processingText) {
          processingText.textContent = "Recording saved!";
        }
        // Reset after 2 seconds
        setTimeout(() => {
          if (shadow) {
            shadow.getElementById("processing").style.display = "none";
            shadow.getElementById("pre-record").style.display = "block";
            shadow.getElementById("dismiss-btn").style.display = "";
            const pt = shadow.getElementById("processing-text");
            if (pt) pt.textContent = "Saving recording...";
          }
        }, 2000);
      }
      isRecording = false;
    }

    if (message.type === "start-from-icon") {
      // Extension icon was clicked to start recording
      if (!isRecording && shadow) {
        isRecording = true;
        isPaused = false;
        shadow.getElementById("pre-record").style.display = "none";
        shadow.getElementById("during-record").style.display = "block";
        shadow.getElementById("dismiss-btn").style.display = "none";
        // Reset pause/clear UI for fresh recording
        const pauseBtn = shadow.getElementById("pause-btn");
        if (pauseBtn) pauseBtn.textContent = "Pause";
        const redDot = shadow.getElementById("red-dot");
        if (redDot) redDot.classList.remove("paused");
        const recStatus = shadow.getElementById("rec-status");
        if (recStatus) recStatus.textContent = "Recording";
        // Hide error hint since recording is working now
        const errorHint = shadow.getElementById("error-hint");
        if (errorHint) errorHint.style.display = "none";
        startTime = Date.now();
        elapsedAtPause = 0;
        timerInterval = setInterval(updateTimer, 1000);
        // Sync the current filename to background
        const filenameInput = shadow.getElementById("filename-input");
        if (filenameInput) {
          const fn = sanitizeFilename(filenameInput.value);
          if (fn) {
            chrome.runtime.sendMessage({ type: "set-filename", filename: fn });
          }
        }
      }
    }

    if (message.type === "stop-from-icon") {
      // Extension icon already sent stop to offscreen — just update UI
      // and send the custom filename (if any) to background
      isRecording = false;
      isPaused = false;
      clearInterval(timerInterval);
      if (shadow) {
        shadow.getElementById("during-record").style.display = "none";
        shadow.getElementById("processing").style.display = "block";
        const filenameInput = shadow.getElementById("filename-input");
        if (filenameInput) {
          const customFilename = sanitizeFilename(filenameInput.value);
          if (customFilename) {
            chrome.runtime.sendMessage({ type: "set-filename", filename: customFilename });
          }
        }
      }
    }

    if (message.type === "recording-discarded") {
      isRecording = false;
      isPaused = false;
      clearInterval(timerInterval);
      elapsedAtPause = 0;
      if (shadow) {
        shadow.getElementById("during-record").style.display = "none";
        shadow.getElementById("pre-record").style.display = "block";
        shadow.getElementById("dismiss-btn").style.display = "";
      }
    }

    if (message.type === "recording-error") {
      if (shadow) {
        shadow.getElementById("processing").style.display = "none";
        shadow.getElementById("during-record").style.display = "none";
        shadow.getElementById("pre-record").style.display = "block";
        shadow.getElementById("dismiss-btn").style.display = "";
      }
      isRecording = false;
      isPaused = false;
      clearInterval(timerInterval);
      elapsedAtPause = 0;
      console.error("Meet Recorder error:", message.error);
    }
  });

  function updateDestLabel() {
    if (!shadow) return;
    chrome.storage.local.get(
      { subfolder: "Meet Recordings", saveDestination: "local", driveFolder: null },
      (stored) => {
        const destLabel = shadow && shadow.getElementById("dest-label");
        if (!destLabel) return;
        if (stored.saveDestination === "drive" && stored.driveFolder) {
          destLabel.innerHTML = `Save to: Google Drive / <strong>${escapeHtml(stored.driveFolder.name)}</strong>`;
        } else {
          destLabel.textContent = stored.subfolder
            ? `Save to: Downloads / ${stored.subfolder}`
            : `Save to: Downloads`;
        }
      }
    );
  }

  // Update banner when settings change
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.saveDestination || changes.driveFolder || changes.subfolder) {
      updateDestLabel();
    }
  });

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Init ---
  // Only run on actual meeting pages, not the landing page
  if (window.location.pathname.length > 1 && window.location.pathname !== "/") {
    watchForMeeting();
  }
})();
