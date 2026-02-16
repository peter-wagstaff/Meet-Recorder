/**
 * Get an OAuth token via chrome.identity.
 * Tries chrome.identity.getAuthToken() first (works in Chrome with a signed-in
 * Google account). Falls back to launchWebAuthFlow() for browsers like Brave
 * that don't support the native token flow.
 * @param {boolean} interactive - Show consent UI if needed
 * @returns {Promise<string>} access token
 */
const BASE_SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";
const EXTENDED_SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly";

async function getScopesForAuth() {
  const { sharedDrivesEnabled } = await chrome.storage.local.get("sharedDrivesEnabled");
  return sharedDrivesEnabled ? EXTENDED_SCOPES : BASE_SCOPES;
}

export async function getAuthToken(interactive = false) {
  const scopes = await getScopesForAuth();

  // Try silent token retrieval first (non-interactive only)
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false, scopes: scopes.split(" ") }, (tok) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(tok);
        }
      });
    });
    return token;
  } catch (_nativeErr) {
    // Silent flow failed — fall back below
  }

  // Check for a cached token from a previous launchWebAuthFlow
  const { oauth_token, oauth_token_expiry } = await chrome.storage.local.get(["oauth_token", "oauth_token_expiry"]);
  if (oauth_token && oauth_token_expiry && Date.now() < oauth_token_expiry) {
    return oauth_token;
  }

  // Token missing or expired — clear stale cache
  if (oauth_token) {
    await chrome.storage.local.remove(["oauth_token", "oauth_token_expiry"]);
  }

  // Try silent token refresh (works if user still has an active Google session)
  try {
    return await launchWebAuth(false, scopes);
  } catch (_silentErr) {
    // Silent refresh failed — need interactive sign-in
  }

  if (!interactive) {
    throw new Error("Not signed in");
  }

  return launchWebAuth(true, scopes);
}

async function launchWebAuth(interactive = true, scopes = null) {
  const webClientId = "946764655751-rrupf2iqo1emmfhlnnf1i8lkbmn7ri59.apps.googleusercontent.com";
  if (!scopes) {
    scopes = await getScopesForAuth();
  }
  const redirectUrl = chrome.identity.getRedirectURL();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", webClientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUrl);
  authUrl.searchParams.set("scope", scopes);
  if (!interactive) {
    authUrl.searchParams.set("prompt", "none");
  }

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive,
  });

  const hash = new URL(responseUrl).hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  if (!token) {
    throw new Error("No access token in OAuth response");
  }

  const expiresIn = parseInt(params.get("expires_in"), 10) || 3600;
  // Store with expiry, subtract 60s buffer to avoid edge-case failures
  const expiry = Date.now() + (expiresIn - 60) * 1000;
  await chrome.storage.local.set({ oauth_token: token, oauth_token_expiry: expiry });
  return token;
}

/**
 * Remove cached auth token (for sign-out or token refresh).
 * @param {string} token
 */
export async function removeCachedToken(token) {
  await new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
  // Also clear the fallback cache in case it was stored by launchWebAuthFlow
  const { oauth_token } = await chrome.storage.local.get("oauth_token");
  if (oauth_token === token) {
    await chrome.storage.local.remove(["oauth_token", "oauth_token_expiry"]);
  }
}

/**
 * List folders inside a parent folder in My Drive.
 * @param {string} token
 * @param {string} parentId - Parent folder ID, or "root" for top-level
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listFolders(token, parentId = "root") {
  const q = `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("orderBy", "name");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive API error: ${res.status}`);
  const data = await res.json();
  return data.files || [];
}

/**
 * List shared drives the user has access to.
 * @param {string} token
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listSharedDrives(token) {
  const url = new URL("https://www.googleapis.com/drive/v3/drives");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("fields", "drives(id,name)");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive API error: ${res.status}`);
  const data = await res.json();
  return data.drives || [];
}

/**
 * List folders inside a shared drive (or a folder within it).
 * @param {string} token
 * @param {string} driveId - Shared drive ID
 * @param {string} parentId - Parent folder ID, or driveId for root
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listSharedDriveFolders(token, driveId, parentId = null) {
  const parent = parentId || driveId;
  const q = `mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("orderBy", "name");
  url.searchParams.set("corpora", "drive");
  url.searchParams.set("driveId", driveId);
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive API error: ${res.status}`);
  const data = await res.json();
  return data.files || [];
}

/**
 * Upload an MP3 blob to Google Drive.
 * @param {string} token
 * @param {string} filename
 * @param {Blob} blob - MP3 blob
 * @param {string} folderId - Destination folder ID
 * @param {string|null} driveId - Shared drive ID, or null for My Drive
 * @returns {Promise<{id: string, name: string}>}
 */
export async function uploadFile(token, filename, blob, folderId, driveId = null) {
  const metadata = {
    name: filename,
    mimeType: "audio/mpeg",
    parents: [folderId],
  };

  const boundary = "meet_recorder_boundary";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadataStr =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: audio/mpeg\r\n\r\n";

  const encoder = new TextEncoder();
  const metaBytes = encoder.encode(metadataStr);
  const closeBytes = encoder.encode(closeDelimiter);
  const fileBytes = new Uint8Array(await blob.arrayBuffer());

  const body = new Uint8Array(metaBytes.length + fileBytes.length + closeBytes.length);
  body.set(metaBytes, 0);
  body.set(fileBytes, metaBytes.length);
  body.set(closeBytes, metaBytes.length + fileBytes.length);

  let uploadUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";

  let res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: body,
  });

  // Retry once with a fresh token if expired
  if (res.status === 401) {
    await removeCachedToken(token);
    const newToken = await getAuthToken(true);
    res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${newToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: body,
    });
  }

  if (!res.ok) {
    throw new Error(`Drive upload failed (${res.status})`);
  }
  return await res.json();
}
