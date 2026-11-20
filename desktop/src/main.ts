import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray, type OpenDialogOptions } from "electron";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ActiveSoundReminder, DeliveryMode, DesktopSettings } from "./shared.js";
import { BackendClient, validateApiOrigin } from "./services/backend-client.js";
import { LocalStore } from "./services/local-store.js";
import { ReminderScheduler } from "./services/reminder-scheduler.js";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const notificationAppUserModelId = app.isPackaged ? "com.productivity.reminders" : process.execPath;
const toastActivatorClsid = "{DCC4B67A-1EAD-4E8F-9B81-24A00EAE5A30}";
if (process.platform === "win32") {
  app.setAppUserModelId(notificationAppUserModelId);
  app.setToastActivatorCLSID(toastActivatorClsid);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

const store = new LocalStore();
const backend = new BackendClient(
  "http://localhost:3000",
  () => store.loadSecrets(),
  (value) => store.saveSecrets(value),
  () => store.clearSecrets(),
);
const scheduler = new ReminderScheduler(backend, store);
let mainWindow: BrowserWindow | null = null;
let soundWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let soundCloseAllowed = false;

const appRoot = app.getAppPath();
const preloadPath = path.join(appRoot, "dist", "preload.cjs");
const rendererRoot = path.join(appRoot, "src", "renderer");

function createMainWindow(show = true): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (show) {
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }

  mainWindow = new BrowserWindow({
    width: 820,
    height: 700,
    minWidth: 620,
    minHeight: 560,
    show,
    title: "Productivity Reminders",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void mainWindow.loadFile(path.join(rendererRoot, "index.html"));
  mainWindow.on("minimize", () => {
    mainWindow?.hide();
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function closeSoundWindow(): void {
  if (soundWindow && !soundWindow.isDestroyed()) {
    soundCloseAllowed = true;
    soundWindow.close();
    soundCloseAllowed = false;
  }
  soundWindow = null;
}

function showSoundWindow(_reminder: ActiveSoundReminder): void {
  if (soundWindow && !soundWindow.isDestroyed()) {
    soundWindow.show();
    soundWindow.focus();
    return;
  }

  soundWindow = new BrowserWindow({
    width: 370,
    height: 260,
    minWidth: 370,
    maxWidth: 370,
    minHeight: 260,
    maxHeight: 260,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    title: "Reminder",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  soundWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  soundWindow.on("close", (event) => {
    if (!soundCloseAllowed) event.preventDefault();
  });
  soundWindow.on("closed", () => { soundWindow = null; });
  soundWindow.once("ready-to-show", () => soundWindow?.show());
  void soundWindow.loadFile(path.join(rendererRoot, "reminder.html"));
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu());
    return;
  }
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="8" fill="#5b6cff"/><path d="M16 7a7 7 0 0 0-7 7v5l-2 3h18l-2-3v-5a7 7 0 0 0-7-7zm-3 17a3 3 0 0 0 6 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  tray = new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}`));
  tray.setToolTip("Productivity Reminders");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => createMainWindow(true));
  tray.on("double-click", () => createMainWindow(true));
}

async function registerWindowsNotificationShortcut(): Promise<void> {
  if (process.platform !== "win32") return;

  const programsDirectory = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  await mkdir(programsDirectory, { recursive: true });
  const shortcutPath = path.join(programsDirectory, "Productivity Reminders.lnk");
  const created = shell.writeShortcutLink(shortcutPath, "create", {
    target: process.execPath,
    args: `"${app.getAppPath()}"`,
    description: "Productivity desktop reminders",
    icon: process.execPath,
    iconIndex: 0,
    appUserModelId: notificationAppUserModelId,
    toastActivatorClsid,
  });
  if (!created) console.error("Could not register the Productivity Reminders Start Menu shortcut for Windows notifications");
}

function buildTrayMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: "Open Productivity Reminders", click: () => createMainWindow(true) },
    { type: "separator" },
    {
      label: "Launch at Windows startup",
      type: "checkbox",
      checked: store.getSettings().launchAtStartup,
      click: (item) => setLaunchAtStartup(item.checked),
    },
    { type: "separator" },
    { label: "Quit", click: () => { isQuitting = true; app.quit(); } },
  ]);
}

async function setLaunchAtStartup(enabled: boolean): Promise<void> {
  await store.updateSettings({ launchAtStartup: enabled });
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [app.getAppPath()] });
  createTray();
}

function registerIpc(): void {
  ipcMain.handle("desktop:get-state", () => ({ user: backend.getUser(), settings: store.getSettings() }));
  ipcMain.handle("desktop:set-api-origin", async (_event, origin: unknown) => {
    if (typeof origin !== "string") throw new Error("Backend URL is required");
    if (backend.getUser()) throw new Error("Sign out before changing the backend URL");
    const validated = validateApiOrigin(origin);
    backend.setApiOrigin(validated);
    return store.updateSettings({ apiOrigin: validated });
  });
  ipcMain.handle("desktop:login", async (_event, email: unknown, password: unknown) => {
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      throw new Error("Email and password are required");
    }
    const user = await backend.login(email.trim(), password);
    await store.useAccount(user.id);
    scheduler.start();
    return user;
  });
  ipcMain.handle("desktop:logout", async () => {
    scheduler.stop();
    await backend.logout();
  });
  ipcMain.handle("desktop:sync-reminders", async () => scheduler.syncNow());
  ipcMain.handle("desktop:set-delivery-mode", async (_event, id: unknown, mode: unknown) => {
    if (!Number.isSafeInteger(id) || (mode !== "notification" && mode !== "sound")) throw new Error("Invalid reminder delivery setting");
    await store.setDeliveryMode(id as number, mode as DeliveryMode);
  });
  ipcMain.handle("desktop:get-settings", () => store.getSettings());
  ipcMain.handle("desktop:test-notification", async () => {
    if (!Notification.isSupported()) throw new Error("Windows notifications are not supported on this system");
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      const notification = new Notification({
        title: "Productivity notification test",
        body: "Windows desktop notifications are working.",
        silent: true,
      });
      notification.once("show", () => finish());
      notification.once("failed", (_event, error) => finish(new Error(error)));
      notification.show();
      setTimeout(() => finish(new Error("Windows did not confirm the test notification")), 10_000).unref();
    });
  });
  ipcMain.handle("desktop:update-settings", async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) throw new Error("Invalid settings");
    const settings = input as Partial<DesktopSettings>;
    const update: Partial<DesktopSettings> = {};
    if (settings.ringingDurationSeconds !== undefined) {
      if (!Number.isInteger(settings.ringingDurationSeconds) || settings.ringingDurationSeconds < 5 || settings.ringingDurationSeconds > 600) {
        throw new Error("Ringing duration must be between 5 and 600 seconds");
      }
      update.ringingDurationSeconds = settings.ringingDurationSeconds;
    }
    if (settings.snoozeMinutes !== undefined) {
      if (!Number.isInteger(settings.snoozeMinutes) || settings.snoozeMinutes < 1 || settings.snoozeMinutes > 60) {
        throw new Error("Snooze duration must be between 1 and 60 minutes");
      }
      update.snoozeMinutes = settings.snoozeMinutes;
    }
    return store.updateSettings(update);
  });
  ipcMain.handle("desktop:choose-sound", async () => {
    const options: OpenDialogOptions = {
      title: "Choose reminder sound",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a"] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const soundFilePath = result.filePaths[0];
    await store.updateSettings({ soundFilePath });
    return path.basename(soundFilePath);
  });
  ipcMain.handle("desktop:set-startup", async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid startup setting");
    await setLaunchAtStartup(enabled);
  });
  ipcMain.handle("desktop:get-active-reminder", () => store.getActiveSound());
  ipcMain.handle("desktop:get-sound-data", async () => {
    const soundPath = store.getSettings().soundFilePath;
    if (!soundPath) return null;
    const data = await readFile(soundPath);
    if (data.byteLength > 15 * 1024 * 1024) throw new Error("Choose an audio file smaller than 15 MB");
    const extension = path.extname(soundPath).toLowerCase();
    const mime = ({ ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4" } as Record<string, string>)[extension];
    if (!mime) throw new Error("Unsupported audio format");
    return `data:${mime};base64,${data.toString("base64")}`;
  });
  ipcMain.handle("desktop:dismiss-reminder", async () => {
    await scheduler.dismissActiveSound();
    closeSoundWindow();
  });
  ipcMain.handle("desktop:snooze-reminder", async () => {
    await scheduler.snoozeActiveSound();
    closeSoundWindow();
  });
  ipcMain.handle("desktop:open-main-window", () => createMainWindow(true));
}

scheduler.setSoundHandlers(showSoundWindow, closeSoundWindow);

app.on("second-instance", () => createMainWindow(true));
app.on("window-all-closed", () => { /* Tray companion stays active until Quit is selected. */ });
app.on("before-quit", () => {
  isQuitting = true;
  scheduler.stop();
});

void app.whenReady().then(async () => {
  await store.load();
  backend.setApiOrigin(store.getSettings().apiOrigin);
  await backend.restore();
  if (backend.getUser()) await store.useAccount(backend.getUser()!.id);
  registerIpc();
  await registerWindowsNotificationShortcut();
  createTray();
  createMainWindow(true);
  if (backend.getUser()) scheduler.start();
  app.on("activate", () => createMainWindow(true));
}).catch((error: unknown) => {
  dialog.showErrorBox("Productivity Reminders failed to start", error instanceof Error ? error.message : "Unknown startup error");
  app.quit();
});

