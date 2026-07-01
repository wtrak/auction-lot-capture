require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const { google } = require('googleapis');

const app = express();
app.set('trust proxy', 1);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const TOKEN_PATH = path.join(DATA_DIR, 'google-token.json');
const MASTER_FOLDER_NAME = process.env.MASTER_FOLDER_NAME || 'Auction Lot Photos';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function ensureState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    const state = JSON.parse(raw);
    if (!state.nextLocator) state.nextLocator = 'A1';
    if (!state.masterFolderId && process.env.GOOGLE_DRIVE_MASTER_FOLDER_ID) {
      state.masterFolderId = process.env.GOOGLE_DRIVE_MASTER_FOLDER_ID;
    }
    return state;
  } catch {
    const state = { nextLocator: 'A1', masterFolderId: process.env.GOOGLE_DRIVE_MASTER_FOLDER_ID || null };
    await saveState(state);
    return state;
  }
}

async function saveState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

function normalizeLocator(code) {
  return String(code || '').trim().toUpperCase();
}

function validateLocator(code) {
  return /^([A-Z]+)([1-9][0-9]?)$/.test(normalizeLocator(code));
}

function lettersToNumber(letters) {
  let total = 0;
  for (const char of letters) {
    total = total * 26 + (char.charCodeAt(0) - 64);
  }
  return total;
}

function locatorToIndex(code) {
  const match = /^([A-Z]+)([1-9][0-9]?)$/.exec(normalizeLocator(code));
  if (!match) throw new Error('Invalid locator format. Use A1 through Z99, AA1, etc.');
  return (lettersToNumber(match[1]) - 1) * 99 + Number(match[2]);
}

function nextLocator(code) {
  const match = /^([A-Z]+)([1-9][0-9]?)$/.exec(normalizeLocator(code));
  if (!match) throw new Error('Invalid locator format. Use A1 through Z99, AA1, etc.');

  const letters = match[1];
  const number = Number(match[2]);

  if (number < 99) return `${letters}${number + 1}`;
  return `${incrementLetters(letters)}1`;
}

function incrementLetters(letters) {
  const chars = letters.split('');
  let i = chars.length - 1;

  while (i >= 0) {
    if (chars[i] !== 'Z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
    i--;
  }

  return 'A' + chars.join('');
}

function isInvalidGrant(error) {
  const text = [
    error?.message,
    error?.response?.data?.error,
    error?.response?.data?.error_description,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('invalid_grant');
}

function makeAuthExpiredError() {
  const error = new Error('Google Drive authorization expired. Open /auth/google on the Render app, sign in again, copy the new refresh token into GOOGLE_REFRESH_TOKEN in Render, then redeploy.');
  error.status = 401;
  return error;
}

function cleanError(error) {
  if (isInvalidGrant(error)) return makeAuthExpiredError();
  return error;
}

function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return `${req.protocol}://${req.get('host')}/oauth2callback`;
}

function getOAuthClient(req) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('Missing GOOGLE_CLIENT_ID environment variable.');
  if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error('Missing GOOGLE_CLIENT_SECRET environment variable.');

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri(req)
  );
}

async function readSavedTokens() {
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    return { refresh_token: process.env.GOOGLE_REFRESH_TOKEN.trim() };
  }

  try {
    const raw = await fs.readFile(TOKEN_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveTokens(tokens) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

async function getDrive(req) {
  const auth = getOAuthClient(req);
  const tokens = await readSavedTokens();

  if (!tokens || !tokens.refresh_token) {
    throw new Error('Google Drive is not authorized yet. Open /auth/google, sign in, then add GOOGLE_REFRESH_TOKEN in Render.');
  }

  auth.setCredentials(tokens);

  try {
    await auth.getAccessToken();
  } catch (error) {
    throw cleanError(error);
  }

  return google.drive({ version: 'v3', auth });
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findOrCreateMasterFolder(drive, state) {
  const envFolderId = process.env.GOOGLE_DRIVE_MASTER_FOLDER_ID;
  if (envFolderId) {
    state.masterFolderId = envFolderId;
    return envFolderId;
  }

  if (state.masterFolderId) return state.masterFolderId;

  const created = await drive.files.create({
    requestBody: {
      name: MASTER_FOLDER_NAME,
      mimeType: DRIVE_FOLDER_MIME,
    },
    fields: 'id, webViewLink',
  });

  state.masterFolderId = created.data.id;
  await saveState(state);
  return state.masterFolderId;
}

async function findFolderByName(drive, name, parentId) {
  const safeName = escapeDriveQueryValue(name);
  const safeParentId = escapeDriveQueryValue(parentId);

  const result = await drive.files.list({
    q: `'${safeParentId}' in parents and mimeType = '${DRIVE_FOLDER_MIME}' and name = '${safeName}' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
  });

  return result.data.files && result.data.files[0] ? result.data.files[0] : null;
}

async function createFolder(drive, name, parentId) {
  const existing = await findFolderByName(drive, name, parentId);
  if (existing) {
    const error = new Error(`A folder named ${name} already exists in Google Drive. Set the next locator to a new code.`);
    error.status = 409;
    throw error;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: DRIVE_FOLDER_MIME,
      parents: [parentId],
    },
    fields: 'id, name, webViewLink',
  });

  return created.data;
}

async function uploadPhoto(drive, buffer, filename, parentId, mimeType) {
  const { Readable } = require('stream');
  const stream = Readable.from(buffer);

  return drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType: mimeType || 'image/jpeg', body: stream },
    fields: 'id, name',
  });
}

async function getNextLocatorFromDrive(drive, masterFolderId) {
  let pageToken;
  let highest = null;

  do {
    const safeParentId = escapeDriveQueryValue(masterFolderId);
    const result = await drive.files.list({
      q: `'${safeParentId}' in parents and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 1000,
      pageToken,
    });

    for (const file of result.data.files || []) {
      if (!validateLocator(file.name)) continue;
      if (!highest || locatorToIndex(file.name) > locatorToIndex(highest)) {
        highest = normalizeLocator(file.name);
      }
    }

    pageToken = result.data.nextPageToken;
  } while (pageToken);

  return highest ? nextLocator(highest) : 'A1';
}

async function syncNextLocatorWithDrive(req, state) {
  const tokens = await readSavedTokens();
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !tokens?.refresh_token) {
    return state;
  }

  const drive = await getDrive(req);
  const masterFolderId = await findOrCreateMasterFolder(drive, state);
  const driveNext = await getNextLocatorFromDrive(drive, masterFolderId);

  if (locatorToIndex(driveNext) > locatorToIndex(state.nextLocator)) {
    state.nextLocator = driveNext;
    await saveState(state);
  }

  return state;
}

app.get('/auth/google', (req, res) => {
  try {
    const auth = getOAuthClient(req);
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: DRIVE_SCOPES,
    });
    res.redirect(authUrl);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get('/oauth2callback', async (req, res) => {
  try {
    if (!req.query.code) return res.status(400).send('Missing Google authorization code.');

    const auth = getOAuthClient(req);
    const { tokens } = await auth.getToken(String(req.query.code));
    await saveTokens(tokens);

    const refreshToken = tokens.refresh_token || '';
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 40px auto; line-height: 1.45;">
          <h1>Google Drive connected</h1>
          ${refreshToken ? `
            <p>Copy this refresh token and add it to Render as <strong>GOOGLE_REFRESH_TOKEN</strong>.</p>
            <textarea style="width:100%;height:140px;">${refreshToken}</textarea>
            <p>After adding it in Render, redeploy your service.</p>
          ` : `
            <p>Google connected, but no new refresh token was returned. If you already added GOOGLE_REFRESH_TOKEN in Render, you are done.</p>
            <p>If you still need a token, remove this app's access from your Google Account permissions, then visit <code>/auth/google</code> again.</p>
          `}
          <p><a href="/">Return to app</a></p>
        </body>
      </html>
    `);
  } catch (error) {
    const clean = cleanError(error);
    res.status(clean.status || 500).send(clean.message);
  }
});

app.get('/api/state', async (req, res) => {
  try {
    let state = await ensureState();
    try {
      state = await syncNextLocatorWithDrive(req, state);
    } catch (syncError) {
      // The capture UI should still load even if Google Drive needs reauthorization.
    }
    res.json({ nextLocator: state.nextLocator, masterFolderId: state.masterFolderId || null });
  } catch (error) {
    const clean = cleanError(error);
    res.status(clean.status || 500).json({ error: clean.message });
  }
});

app.post('/api/state/next-locator', async (req, res) => {
  try {
    const locator = normalizeLocator(req.body.nextLocator);
    if (!validateLocator(locator)) {
      return res.status(400).json({ error: 'Use locator format like A1, A99, AA1.' });
    }

    const state = await ensureState();
    state.nextLocator = locator;
    await saveState(state);
    res.json({ nextLocator: state.nextLocator });
  } catch (error) {
    const clean = cleanError(error);
    res.status(clean.status || 500).json({ error: clean.message });
  }
});

app.post('/api/lots', upload.array('photos', 60), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Add at least one photo before submitting.' });
    }

    let state = await ensureState();
    state = await syncNextLocatorWithDrive(req, state);

    const locator = normalizeLocator(req.body.locator || state.nextLocator);
    if (!validateLocator(locator)) {
      return res.status(400).json({ error: 'Use locator format like A1, A99, AA1.' });
    }

    if (locator !== state.nextLocator) {
      return res.status(409).json({ error: `Locator mismatch. Current next locator is ${state.nextLocator}. Refresh and try again.` });
    }

    const drive = await getDrive(req);
    const masterFolderId = await findOrCreateMasterFolder(drive, state);
    const lotFolder = await createFolder(drive, locator, masterFolderId);

    for (let i = 0; i < req.files.length; i++) {
      const filename = `${locator}-${i + 1}.jpg`;
      await uploadPhoto(drive, req.files[i].buffer, filename, lotFolder.id, req.files[i].mimetype);
    }

    state.nextLocator = nextLocator(locator);
    await saveState(state);

    res.json({
      uploaded: req.files.length,
      locator,
      nextLocator: state.nextLocator,
      folderId: lotFolder.id,
      folderUrl: lotFolder.webViewLink,
    });
  } catch (error) {
    const clean = cleanError(error);
    res.status(clean.status || error.status || 500).json({ error: clean.message });
  }
});

app.listen(PORT, () => {
  console.log(`Auction Lot Capture running on port ${PORT}`);
});
