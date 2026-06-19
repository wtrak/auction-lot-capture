# Auction Lot Capture

A simple mobile-friendly web app for photographing auction lots and saving each lot into its own Google Drive folder.

## What it does

- Shows the next lot locator code, starting at `A1`
- Lets you take multiple photos for one lot
- Shows a photo counter
- Lets you undo the last photo
- Uploads the lot to Google Drive when you tap **Submit Lot**
- Creates folders like `A1`, `A2`, `A3`
- Saves photos as `A1-1.jpg`, `A1-2.jpg`, etc.
- Advances automatically: `A1` → `A2` → `A99` → `B1` → `Z99` → `AA1`
- Remembers the next locator in `data/state.json`
- Includes a manual locator override

## Folder output example

```text
Auction Lot Photos/
├── A1/
│   ├── A1-1.jpg
│   ├── A1-2.jpg
│   └── A1-3.jpg
├── A2/
│   └── A2-1.jpg
└── A3/
```

## Local setup

```bash
npm install
cp .env.example .env
npm start
```

Open:

```text
http://localhost:3000
```

On your phone, the camera will only work reliably over HTTPS or localhost. For real phone use, deploy it to Render/Railway/Fly or another HTTPS host.

## Google Drive setup

This app uses a Google Cloud service account.

1. Create a Google Cloud project.
2. Enable the Google Drive API.
3. Create a service account.
4. Create a JSON key for the service account.
5. Put the service account email and private key into `.env`.
6. If you want uploads inside your personal Drive, create a Google Drive folder and share it with the service account email.
7. Paste that folder ID into `GOOGLE_DRIVE_MASTER_FOLDER_ID`.

If you do not set `GOOGLE_DRIVE_MASTER_FOLDER_ID`, the app will create a master folder in the service account's own Drive space.

## Required environment variables

```env
PORT=3000
MASTER_FOLDER_NAME=Auction Lot Photos
GOOGLE_DRIVE_MASTER_FOLDER_ID=
GOOGLE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nPASTE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

## Deploying from GitHub

1. Create a new GitHub repo.
2. Upload/push this project.
3. Deploy the repo on Render, Railway, Fly.io, or another Node host.
4. Add the environment variables in the host dashboard.
5. Open the deployed HTTPS URL on your Android phone.
6. Tap browser menu → **Add to Home screen**.

## Important note about persistence

The included version stores the next locator in `data/state.json`. That works locally and on simple persistent servers. Some hosts may reset the filesystem during redeploys.

For long-term hosted use, the next upgrade should store state in one of these:

- Google Drive app data file
- SQLite with persistent disk
- PostgreSQL
- Firebase
