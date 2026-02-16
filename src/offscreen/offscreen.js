import { Mp3Encoder } from "@breezystack/lamejs";

let audioContext = null;
let tabSource = null;
let micSource = null;
let workletNode = null;
let mp3Encoder = null;
let mp3Chunks = [];
let tabStream = null;
let micStream = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "offscreen") return;

  if (message.type === "start-recording") {
    startRecording(message.data.streamId);
  }

  if (message.type === "stop-recording") {
    stopRecording();
  }

  if (message.type === "pause-recording") {
    if (audioContext) audioContext.suspend();
  }

  if (message.type === "resume-recording") {
    if (audioContext) audioContext.resume();
  }

  if (message.type === "discard-recording") {
    discardRecording();
  }
});

// Signal to the background that we're ready to receive messages
chrome.runtime.sendMessage({ type: "offscreen-ready" });

async function startRecording(streamId) {
  try {
    // 1. Get tab audio stream
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    // 2. Get microphone stream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (micErr) {
      console.warn("Mic access denied, recording tab audio only:", micErr);
    }

    // 3. Set up Web Audio API to merge streams
    audioContext = new AudioContext({ sampleRate: 44100 });
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();

    tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(destination);
    // Also play tab audio to speakers so the user can still hear other participants
    tabSource.connect(audioContext.destination);

    if (micStream) {
      micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
    }

    // 4. Set up real-time MP3 encoding via AudioWorklet
    const sampleRate = audioContext.sampleRate;
    mp3Encoder = new Mp3Encoder(1, sampleRate, 128);
    mp3Chunks = [];

    await audioContext.audioWorklet.addModule("/src/offscreen/pcm-processor.js");
    const mergedSource = audioContext.createMediaStreamSource(destination.stream);
    workletNode = new AudioWorkletNode(audioContext, "pcm-processor");

    workletNode.port.onmessage = (e) => {
      const samples = e.data;

      // Convert Float32 to Int16
      const int16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      const mp3buf = mp3Encoder.encodeBuffer(int16);
      if (mp3buf.length > 0) {
        mp3Chunks.push(mp3buf);
      }
    };

    mergedSource.connect(workletNode);

  } catch (err) {
    chrome.runtime.sendMessage({
      type: "recording-error",
      error: err.message,
    });
  }
}

async function stopRecording() {
  // Disconnect audio nodes
  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
  }
  if (tabSource) tabSource.disconnect();
  if (micSource) micSource.disconnect();

  // Stop all media tracks
  if (tabStream) tabStream.getTracks().forEach((t) => t.stop());
  if (micStream) micStream.getTracks().forEach((t) => t.stop());

  // Flush MP3 encoder
  if (mp3Encoder) {
    const finalBuf = mp3Encoder.flush();
    if (finalBuf.length > 0) {
      mp3Chunks.push(finalBuf);
    }
  }

  // Store MP3 blob in IndexedDB for the background to retrieve.
  // This avoids the message size limit that base64 data URLs hit on long recordings.
  const mp3Blob = new Blob(mp3Chunks, { type: "audio/mp3" });

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `Meeting - ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}.mp3`;

  try {
    await storeBlob(mp3Blob);
    const blobUrl = URL.createObjectURL(mp3Blob);
    chrome.runtime.sendMessage({
      type: "recording-complete",
      data: { filename, blobUrl },
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "recording-error",
      error: err.message,
    });
  }

  // Clean up
  if (audioContext) audioContext.close();
  audioContext = null;
  tabSource = null;
  micSource = null;
  workletNode = null;
  mp3Encoder = null;
  mp3Chunks = [];
  tabStream = null;
  micStream = null;
}

function discardRecording() {
  // Disconnect audio nodes
  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
  }
  if (tabSource) tabSource.disconnect();
  if (micSource) micSource.disconnect();

  // Stop all media tracks
  if (tabStream) tabStream.getTracks().forEach((t) => t.stop());
  if (micStream) micStream.getTracks().forEach((t) => t.stop());

  // Clean up without flushing/storing MP3
  if (audioContext) audioContext.close();
  audioContext = null;
  tabSource = null;
  micSource = null;
  workletNode = null;
  mp3Encoder = null;
  mp3Chunks = [];
  tabStream = null;
  micStream = null;

  chrome.runtime.sendMessage({ type: "recording-discarded" });
}

function storeBlob(blob) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("meet-recorder", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("recordings");
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("recordings", "readwrite");
      tx.objectStore("recordings").put(blob, "latest");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}
