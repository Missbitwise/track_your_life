# Productivity Reminders for Windows

An Electron desktop companion that keeps reminder delivery active in the system tray while the website is closed.

## Run locally

From this folder:

```sh
npm install
npm run start
```

`start` builds the TypeScript main/preload processes and launches the app in Electron.

## Build a Windows installer

Run these commands from `desktop/` on Windows:

```sh
npm install
npm run build
npm run pack:win # Optional: unpacked app for testing
npm run dist:win # NSIS installer
```

The installer is written to `desktop/release/Productivity-Setup-1.0.0.exe` (the version in `package.json` determines the filename). It installs per user by default and allows choosing the install directory. The bundled Electron runtime means end users do not need Node.js or npm.

To publish manually, push the source and create a GitHub Release in `Missbitwise/track_your_life` with a tag matching the app version (for example `v1.0.0`), then attach the generated installer. The GitHub publish provider is configured for future use, but these scripts do not publish or upload anything. No token is stored in the project; electron-builder uses its normal environment-based GitHub authentication if publishing is invoked explicitly.

Sign in with the same account used by the website. Enter the backend origin (for example `http://localhost:3000`). The app polls `GET /api/reminders` every 20 seconds and uses the existing `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, and `PATCH /api/reminders/:id` endpoints.

Closing the main window hides the app in the Windows tray. Use the tray menu to open it or quit. The account can opt into Windows startup from settings or the tray menu.

## Delivery behavior

Reminder delivery modes, snooze state, and duplicate execution keys are stored locally per Windows user. Reminders default to **Notification**. Sound mode displays an always-on-top reminder window, starts the selected audio automatically, and provides Dismiss and Snooze actions. The default snooze duration is five minutes. Ringing duration and snooze duration can be configured in settings.

Access and refresh tokens are stored in Electron `safeStorage` encrypted storage. Renderer code receives only narrow preload APIs and never receives tokens.

The current backend reminder representation has no delivery-mode or reminder-message fields. Therefore the desktop mode selection and sound preference are local to this Windows installation and normal notifications use a generic reminder message. Persisting those choices in the website or synchronizing them across devices would require backend API and database support; this implementation does not change the backend or schema.
