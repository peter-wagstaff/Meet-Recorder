const btn = document.getElementById("grant");
const status = document.getElementById("status");

btn.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission granted — stop the stream immediately
    stream.getTracks().forEach((t) => t.stop());
    status.className = "success";
    status.textContent = "Microphone access granted! You can close this tab.";
    btn.style.display = "none";
    // Notify background
    chrome.runtime.sendMessage({ type: "mic-permission-granted" });
  } catch (e) {
    status.className = "error";
    status.textContent = "Permission denied. Please click the button and allow microphone access.";
  }
});
