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
- Checks the Google Drive master folder so the next locator does not reset after a redeploy
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

On your phone, the camera will only work reliably over HTTPS or localhost. For real phone use, deploy it to Render or another HTTPS host.

## Google Drive OAuth setup

This app uses your Google account through OAuth.

1. In Google Cloud, enable the **Google Drive API**.
2. Go to **OAuth consent screen**.
3. Configure the app as External/Test and add yourself as a test user.
4. Go to **Credentials**.
5. Create an **OAuth client ID**.
6. Choose **Web application**.
7. Add your Render app as an Authorized JavaScript origin:

```text
https://your-render-app.onrender.com
```

8. Add this Authorized redirect URI:

```text
https://your-render-app.onrender.com/oauth2callback
```

9. Copy the client ID and client secret.

## Render environment variables

Add these in Render under your web service's Environment tab:

```env
MASTER_FOLDER_NAME=Auction Lot Photos
GOOGLE_DRIVE_MASTER_FOLDER_ID=your-google-drive-folder-id
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_REDIRECT_URI=https://your-render-app.onrender.com/oauth2callback
```

Create a Google Drive folder for this app, open it, and copy the folder ID from the URL. Paste that as `GOOGLE_DRIVE_MASTER_FOLDER_ID`.

## Getting the refresh token

After deploying with the variables above, open:

```text
https://your-render-app.onrender.com/auth/google
```

Sign in with Google. The callback page will show a refresh token. Copy it and add this final Render environment variable:

```env
GOOGLE_REFRESH_TOKEN=the-refresh-token-from-the-callback-page
```

Then redeploy the Render service.

## Deploying from GitHub

1. Push this project to GitHub.
2. Deploy the repo on Render as a Node web service.
3. Use `npm install` as the build command.
4. Use `npm start` as the start command.
5. Add the environment variables above in Render.
6. Open the deployed HTTPS URL on your Android phone.
7. Tap browser menu → **Add to Home screen**.

## Important note about persistence

The app stores short-term state in `data/state.json`, but hosted filesystems can reset during redeploys.

To avoid locator resets, the app also scans the Google Drive master folder for existing lot folders and advances to the next unused locator. For best results, always set `GOOGLE_DRIVE_MASTER_FOLDER_ID` in Render.
