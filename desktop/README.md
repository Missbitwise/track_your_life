# Productivity Reminders for Windows

An Electron desktop companion that keeps reminder delivery active in the system tray while the website is closed.

## Run locally

From this folder:

```sh
npm install
npm run start
```

The start command installs the matching Electron runtime before building and launching the app.

Sign in with the same account used by the website. Enter the backend origin (for example `http://localhost:3000`). The app polls `GET /api/reminders` every 20 seconds and uses the existing `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, and `PATCH /api/reminders/:id` endpoints.

Closing the main window hides the app in the Windows tray. Use the tray menu to open it or quit. The account can opt into Windows startup from settings or the tray menu.

## Delivery behavior

Reminder delivery modes, snooze state, and duplicate execution keys are stored locally per Windows user. Reminders default to **Notification**. Sound mode displays an always-on-top reminder window, starts the selected audio automatically, and provides Dismiss and Snooze actions. The default snooze duration is five minutes. Ringing duration and snooze duration can be configured in settings.

Access and refresh tokens are stored in Electron `safeStorage` encrypted storage. Renderer code receives only narrow preload APIs and never receives tokens.

The current backend reminder representation has no delivery-mode or reminder-message fields. Therefore the desktop mode selection and sound preference are local to this Windows installation and normal notifications use a generic reminder message. Persisting those choices in the website or synchronizing them across devices would require backend API and database support; this implementation does not change the backend or schema.
