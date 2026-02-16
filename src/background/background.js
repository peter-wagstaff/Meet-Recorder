import { getAuthToken, uploadFile } from "../lib/drive-api.js";

let recordingTabId = null;
let micPermissionGranted = false;
let pendingFilename = null;

function setRecordingTabId(tabId) {
  recordingTabId = tabId;
  if (tabId != null) {
    chrome.storage.session.set({ recordingTabId: tabId });
  } else {
    chrome.storage.session.remove("recordingTabId");
  }
}

// Restore state after service worker restart
async function restoreState() {
  try {
    const result = await navigator.permissions.query({ name: "microphone" });
    micPermissionGranted = result.state === "granted";
  } catch {
    const stored = await chrome.storage.local.get({ micPermissionGranted: false });
    micPermissionGranted = stored.micPermissionGranted;
  }

  const session = await chrome.storage.session.get("recordingTabId");
  if (session.recordingTabId) {
    recordingTabId = session.recordingTabId;
  }
}
restoreState();

// Clean up any stale recording left in IndexedDB from a previous crash
async function cleanupStaleRecording() {
  // Don't clean up if a recording is in progress (service worker may have restarted)
  const session = await chrome.storage.session.get("recordingTabId");
  if (session.recordingTabId) return;

  const request = indexedDB.open("meet-recorder", 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("recordings");
  };
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction("recordings", "readwrite");
    tx.objectStore("recordings").delete("latest");
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  };
}
cleanupStaleRecording();

async function ensureMicPermission(meetTabId) {
  if (micPermissionGranted) return;

  // Open permissions page to request mic access
  const permTab = await chrome.tabs.create({
    url: chrome.runtime.getURL("src/permissions/permissions.html"),
  });

  // Wait for the permission to be granted (or tab to be closed)
  await new Promise((resolve, reject) => {
    function cleanup() {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.tabs.onRemoved.removeListener(tabRemovedListener);
    }
    function messageListener(message) {
      if (message.type === "mic-permission-granted") {
        cleanup();
        micPermissionGranted = true;
        chrome.storage.local.set({ micPermissionGranted: true });
        chrome.tabs.remove(permTab.id).catch(() => {});
        resolve();
      }
    }
    function tabRemovedListener(tabId) {
      if (tabId === permTab.id) {
        cleanup();
        reject(new Error("Microphone permission was not granted"));
      }
    }
    chrome.runtime.onMessage.addListener(messageListener);
    chrome.tabs.onRemoved.addListener(tabRemovedListener);
  });
}

let offscreenReady = false;

function waitForOffscreenReady() {
  if (offscreenReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Offscreen document failed to load"));
    }, 5000);

    function listener(message) {
      if (message.type === "offscreen-ready") {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        offscreenReady = true;
        resolve();
      }
    }
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function closeOffscreenDocument() {
  offscreenReady = false;
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Already closed or doesn't exist
  }
}

// Handle messages from content script and offscreen document
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages targeted at the offscreen document
  if (message.target === "offscreen") return;

  if (message.type === "start-recording") {
    if (!sender.tab) return;
    ensureMicPermission(sender.tab.id)
      .then(() => handleStartRecording(sender.tab.id))
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // async response
  }

  else if (message.type === "stop-recording") {
    if (message.filename) {
      pendingFilename = message.filename;
    }
    chrome.runtime.sendMessage({ type: "stop-recording", target: "offscreen" });
    sendResponse({ success: true });
  }

  else if (message.type === "set-filename") {
    if (message.filename) {
      pendingFilename = message.filename;
    }
  }

  else if (message.type === "pause-recording") {
    chrome.runtime.sendMessage({ type: "pause-recording", target: "offscreen" });
  }

  else if (message.type === "resume-recording") {
    chrome.runtime.sendMessage({ type: "resume-recording", target: "offscreen" });
  }

  else if (message.type === "discard-recording") {
    chrome.runtime.sendMessage({ type: "discard-recording", target: "offscreen" });
  }

  else if (message.type === "recording-discarded") {
    if (recordingTabId) {
      chrome.tabs.sendMessage(recordingTabId, { type: "recording-discarded" });
    }
    setRecordingTabId(null);
    pendingFilename = null;
    closeOffscreenDocument();
  }

  else if (message.type === "recording-complete") {
    handleRecordingComplete(message.data);
  }

  else if (message.type === "recording-error") {
    // Forward error to content script
    if (recordingTabId) {
      chrome.tabs.sendMessage(recordingTabId, {
        type: "recording-error",
        error: message.error,
      });
    }
    setRecordingTabId(null);
  }

  else if (message.type === "open-options") {
    chrome.runtime.openOptionsPage();
  }
});

async function handleStartRecording(tabId) {
  // Set recordingTabId only after we know tabCapture will succeed.
  // Setting it early causes the icon click to think we're already recording
  // if getMediaStreamId fails (e.g., activeTab not granted).

  // Ensure offscreen document exists
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (contexts.length === 0) {
    const readyPromise = waitForOffscreenReady();
    try {
      await chrome.offscreen.createDocument({
        url: "src/offscreen/offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Recording tab audio and microphone for Meet recording",
      });
    } catch (err) {
      // Another call may have created it already — check again
      const recheck = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
      });
      if (recheck.length === 0) throw err;
    }
    await readyPromise;
  }

  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId,
  });

  // Only set recordingTabId after tabCapture succeeds
  setRecordingTabId(tabId);

  chrome.runtime.sendMessage({
    type: "start-recording",
    target: "offscreen",
    data: { streamId },
  });

  return { success: true };
}

async function handleRecordingComplete(data) {
  try {
    const { filename: defaultFilename, blobUrl } = data;
    const filename = pendingFilename || defaultFilename;
    pendingFilename = null;

    // Get save destination preference
    const stored = await chrome.storage.local.get({
      saveDestination: "local",
      subfolder: "Meet Recordings",
      driveFolder: null,
    });

    if (stored.saveDestination === "drive" && stored.driveFolder) {
      // Upload to Google Drive — need the actual blob
      const blob = await retrieveBlob();
      const token = await getAuthToken(true);
      await uploadFile(token, filename, blob, stored.driveFolder.id, stored.driveFolder.driveId);

      if (recordingTabId) {
        chrome.tabs.sendMessage(recordingTabId, { type: "download-started" });
      }
      closeOffscreenDocument();
    } else {
      // Local download — use blob URL from offscreen document directly
      // (avoids base64 conversion that could OOM on large recordings)
      const subfolder = stored.subfolder;
      const filepath = subfolder ? `${subfolder}/${filename}` : filename;

      const downloadId = await chrome.downloads.download({
        url: blobUrl,
        filename: filepath,
        saveAs: false,
      });

      if (recordingTabId) {
        chrome.tabs.sendMessage(recordingTabId, { type: "download-started" });
      }

      // Wait for download to complete before closing offscreen doc
      // (blob URL is only valid while the offscreen document is alive)
      waitForDownloadThenClose(downloadId);
    }
  } catch (err) {
    if (recordingTabId) {
      chrome.tabs.sendMessage(recordingTabId, {
        type: "recording-error",
        error: err.message,
      });
    }
    closeOffscreenDocument();
  }
  setRecordingTabId(null);
}

function waitForDownloadThenClose(downloadId) {
  // Safety timeout — close offscreen doc after 5 minutes regardless
  const safetyTimeout = setTimeout(() => {
    chrome.downloads.onChanged.removeListener(listener);
    closeOffscreenDocument();
  }, 5 * 60 * 1000);

  function listener(delta) {
    if (delta.id !== downloadId) return;
    if (delta.state && (delta.state.current === "complete" || delta.state.current === "interrupted")) {
      clearTimeout(safetyTimeout);
      chrome.downloads.onChanged.removeListener(listener);
      closeOffscreenDocument();
    }
  }
  chrome.downloads.onChanged.addListener(listener);
}

function retrieveBlob() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("meet-recorder", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("recordings");
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("recordings", "readwrite");
      const store = tx.objectStore("recordings");
      const get = store.get("latest");
      get.onsuccess = () => {
        // Clean up after retrieval
        store.delete("latest");
        db.close();
        if (get.result) {
          resolve(get.result);
        } else {
          reject(new Error("No recording found in storage"));
        }
      };
      get.onerror = () => { db.close(); reject(get.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

// Handle extension icon click — toggle recording
chrome.action.onClicked.addListener(async (tab) => {
  // Only work on Google Meet tabs
  if (!tab.url || !tab.url.startsWith("https://meet.google.com/")) {
    return;
  }

  if (recordingTabId) {
    // Currently recording — stop
    chrome.runtime.sendMessage({ type: "stop-recording", target: "offscreen" });
    chrome.tabs.sendMessage(recordingTabId, { type: "stop-from-icon" });
  } else {
    // Start recording
    try {
      await ensureMicPermission(tab.id);
      await handleStartRecording(tab.id);
      chrome.tabs.sendMessage(tab.id, { type: "start-from-icon" });
    } catch (err) {
      chrome.tabs.sendMessage(tab.id, {
        type: "recording-error",
        error: err.message,
      });
    }
  }
});
