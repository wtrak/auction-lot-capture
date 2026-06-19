require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const MASTER_FOLDER_NAME = process.env.MASTER_FOLDER_NAME || 'Auction Lot Photos';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function ensureState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw);
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

function nextLocator(code) {
  const match = /^([A-Z]+)(\d{1,2})$/.exec(String(code).trim().toUpperCase());
  if (!match) throw new Error('Invalid locator format. Use A1 through Z99, AA1, etc.');

  let letters = match[1];
  let number = Number(match[2]);

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

function getDrive() {
  const required = ['GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing ${key} in .env`);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  return google.drive({ version: 'v3', auth });
}

async function findOrCreateMasterFolder(drive, state) {
  if (state.masterFolderId) return state.masterFolderId;

  const created = await drive.files.create({
    requestBody: {
      name: MASTER_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  state.masterFolderId = created.data.id;
  await saveState(state);
  return state.masterFolderId;
}

async function createFolder(drive, name, parentId) {
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, webViewLink',
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

app.get('/api/state', async (_req, res) => {
  try {
    const state = await ensureState();
    res.json({ nextLocator: state.nextLocator, masterFolderId: state.masterFolderId || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/state/next-locator', async (req, res) => {
  try {
    const locator = String(req.body.nextLocator || '').trim().toUpperCase();
    if (!/^([A-Z]+)(\d{1,2})$/.test(locator)) {
      return res.status(400).json({ error: 'Use locator format like A1, A99, AA1.' });
    }

    const state = await ensureState();
    state.nextLocator = locator;
    await saveState(state);
    res.json({ nextLocator: state.nextLocator });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/lots', upload.array('photos', 60), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Add at least one photo before submitting.' });
    }

    const state = await ensureState();
    const locator = String(req.body.locator || state.nextLocator).trim().toUpperCase();
    if (locator !== state.nextLocator) {
      return res.status(409).json({ error: `Locator mismatch. Current next locator is ${state.nextLocator}. Refresh and try again.` });
    }

    const drive = getDrive();
    const masterFolderId = await findOrCreateMasterFolder(drive, state);
    const lotFolder = await createFolder(drive, locator, masterFolderId);

    for (let i = 0; i < req.files.length; i++) {
      const filename = `${locator}-${i + 1}.jpg`;
      await uploadPhoto(drive, req.files[i].buffer, filename, lotFolder.id, req.files[i].mimetype);
    }

    state.nextLocator = nextLocator(locator);
    await saveState(state);

    res.json({ uploaded: req.files.length, locator, nextLocator: state.nextLocator, folderId: lotFolder.id, folderUrl: lotFolder.webViewLink });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Auction Lot Capture running on port ${PORT}`);
});
