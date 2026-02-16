import {
  getAuthToken,
  removeCachedToken,
  listFolders,
  listSharedDrives,
  listSharedDriveFolders,
} from "../lib/drive-api.js";

// DOM elements
const subfolderInput = document.getElementById("subfolder");
const destinationRadios = document.querySelectorAll('input[name="destination"]');
const driveSettings = document.getElementById("drive-settings");
const signInSection = document.getElementById("sign-in-section");
const signedIn = document.getElementById("signed-in");
const signInBtn = document.getElementById("sign-in-btn");
const signOutBtn = document.getElementById("sign-out-btn");
const pickFolderBtn = document.getElementById("pick-folder-btn");
const selectedFolderEl = document.getElementById("selected-folder");
const folderNameEl = document.getElementById("folder-name");
const folderTree = document.getElementById("folder-tree");
const statusMsg = document.getElementById("status-msg");
const errorMsg = document.getElementById("error-msg");

let authToken = null;

// --- Load saved settings ---
chrome.storage.local.get(
  { subfolder: "Meet Recordings", saveDestination: "local", driveFolder: null },
  (stored) => {
    subfolderInput.value = stored.subfolder;

    // Set destination radio
    destinationRadios.forEach((r) => {
      r.checked = r.value === stored.saveDestination;
    });
    updateDriveVisibility(stored.saveDestination);

    // If drive is configured, try silent auth
    if (stored.saveDestination === "drive") {
      trySignIn(false);
    }

    // Show saved folder if any
    if (stored.driveFolder) {
      showSelectedFolder(stored.driveFolder.name);
    }
  }
);

// --- Event listeners ---

const saveBtn = document.getElementById("save-btn");
const savedMsg = document.getElementById("saved-msg");

destinationRadios.forEach((r) => {
  r.addEventListener("change", () => {
    updateDriveVisibility(r.value);
    if (r.value === "drive" && !authToken) {
      trySignIn(false);
    }
  });
});

saveBtn.addEventListener("click", () => {
  const dest = document.querySelector('input[name="destination"]:checked').value;
  chrome.storage.local.set({
    subfolder: subfolderInput.value.trim(),
    saveDestination: dest,
  });
  savedMsg.textContent = "Settings saved";
  setTimeout(() => { savedMsg.textContent = ""; }, 2000);
});

const scopeChoice = document.getElementById("scope-choice");
const sharedDrivesCheck = document.getElementById("shared-drives-check");
const continueSignIn = document.getElementById("continue-sign-in");

signInBtn.addEventListener("click", () => {
  signInBtn.style.display = "none";
  scopeChoice.style.display = "block";
});

continueSignIn.addEventListener("click", async () => {
  const enabled = sharedDrivesCheck.checked;
  await chrome.storage.local.set({ sharedDrivesEnabled: enabled });
  scopeChoice.style.display = "none";
  trySignIn(true);
});

signOutBtn.addEventListener("click", async () => {
  if (authToken) {
    await removeCachedToken(authToken);
    authToken = null;
  }
  chrome.storage.local.remove(["driveFolder", "sharedDrivesEnabled"]);
  signedIn.classList.remove("visible");
  signInSection.style.display = "block";
  signInBtn.style.display = "";
  scopeChoice.style.display = "none";
  sharedDrivesCheck.checked = false;
  selectedFolderEl.classList.remove("visible");
  folderTree.classList.remove("visible");
  folderTree.innerHTML = "";
  statusMsg.textContent = "";
  errorMsg.textContent = "";
});

pickFolderBtn.addEventListener("click", () => loadFolderTree());

// --- Functions ---

function updateDriveVisibility(dest) {
  if (dest === "drive") {
    driveSettings.classList.add("visible");
  } else {
    driveSettings.classList.remove("visible");
  }
}

async function trySignIn(interactive) {
  try {
    errorMsg.textContent = "";
    authToken = await getAuthToken(interactive);
    signInSection.style.display = "none";
    signedIn.classList.add("visible");
  } catch (err) {
    if (interactive) {
      errorMsg.textContent = "Sign-in failed: " + err.message;
    }
  }
}

function showSelectedFolder(name) {
  folderNameEl.textContent = name;
  selectedFolderEl.classList.add("visible");
}

async function loadFolderTree() {
  if (!authToken) return;
  folderTree.innerHTML = "";
  folderTree.classList.add("visible");
  statusMsg.textContent = "Loading folders...";
  errorMsg.textContent = "";

  try {
    // My Drive root + folders
    const myDriveSection = document.createElement("div");
    const myDriveHeader = document.createElement("div");
    myDriveHeader.className = "drive-header";
    myDriveHeader.style.cursor = "pointer";
    myDriveHeader.textContent = "My Drive";
    myDriveHeader.addEventListener("click", () => {
      folderTree.querySelectorAll(".folder-item.selected, .drive-header.selected").forEach((el) => {
        el.classList.remove("selected");
      });
      myDriveHeader.classList.add("selected");
      const driveFolder = { id: "root", name: "My Drive", driveId: null };
      chrome.storage.local.set({ driveFolder });
      showSelectedFolder("My Drive");
    });
    myDriveSection.appendChild(myDriveHeader);

    const myFolders = await listFolders(authToken, "root");
    renderFolderList(myDriveSection, myFolders, null);
    folderTree.appendChild(myDriveSection);

    // Shared Drives (only if user opted in, non-fatal if this fails)
    const { sharedDrivesEnabled } = await chrome.storage.local.get("sharedDrivesEnabled");
    if (!sharedDrivesEnabled) {
      statusMsg.textContent = "";
      return;
    }
    try {
      const drives = await listSharedDrives(authToken);
      for (const drive of drives) {
        const driveSection = document.createElement("div");
        const driveHeader = document.createElement("div");
        driveHeader.className = "drive-header";
        driveHeader.style.cursor = "pointer";
        driveHeader.textContent = drive.name;
        driveHeader.addEventListener("click", () => {
          folderTree.querySelectorAll(".folder-item.selected, .drive-header.selected").forEach((el) => {
            el.classList.remove("selected");
          });
          driveHeader.classList.add("selected");
          const driveFolder = { id: drive.id, name: drive.name, driveId: drive.id };
          chrome.storage.local.set({ driveFolder });
          showSelectedFolder(drive.name);
        });
        driveSection.appendChild(driveHeader);

        const folders = await listSharedDriveFolders(authToken, drive.id);
        renderFolderList(driveSection, folders, drive.id);
        folderTree.appendChild(driveSection);
      }
    } catch (err) {
      console.warn("Could not load shared drives:", err.message);
    }

    statusMsg.textContent = "";
  } catch (err) {
    errorMsg.textContent = "Failed to load folders: " + err.message;
    statusMsg.textContent = "";
  }
}

function renderFolderList(container, folders, driveId) {
  for (const folder of folders) {
    const item = document.createElement("div");
    item.className = "folder-item";
    item.innerHTML = `<span class="folder-toggle">&#9654;</span><span>&#128193; ${escapeHtml(folder.name)}</span>`;

    const childContainer = document.createElement("div");
    childContainer.className = "folder-children";
    childContainer.style.display = "none";
    let childrenLoaded = false;

    // Click folder name to select
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      // Remove other selections
      folderTree.querySelectorAll(".folder-item.selected").forEach((el) => {
        el.classList.remove("selected");
      });
      item.classList.add("selected");

      const driveFolder = { id: folder.id, name: folder.name, driveId: driveId };
      chrome.storage.local.set({ driveFolder });
      showSelectedFolder(folder.name);
    });

    // Click toggle to expand
    const toggle = item.querySelector(".folder-toggle");
    toggle.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (childContainer.style.display === "none") {
        childContainer.style.display = "block";
        toggle.innerHTML = "&#9660;";
        if (!childrenLoaded) {
          childrenLoaded = true;
          try {
            const subFolders = driveId
              ? await listSharedDriveFolders(authToken, driveId, folder.id)
              : await listFolders(authToken, folder.id);
            renderFolderList(childContainer, subFolders, driveId);
          } catch (err) {
            childContainer.textContent = "Error loading subfolders";
          }
        }
      } else {
        childContainer.style.display = "none";
        toggle.innerHTML = "&#9654;";
      }
    });

    container.appendChild(item);
    container.appendChild(childContainer);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
