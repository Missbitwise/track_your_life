import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "./shared.js";

const desktopApi: DesktopApi = {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  setApiOrigin: (apiOrigin) => ipcRenderer.invoke("desktop:set-api-origin", apiOrigin),
  login: (email, password) => ipcRenderer.invoke("desktop:login", email, password),
  logout: () => ipcRenderer.invoke("desktop:logout"),
  syncReminders: () => ipcRenderer.invoke("desktop:sync-reminders"),
  setDeliveryMode: (reminderId, mode) => ipcRenderer.invoke("desktop:set-delivery-mode", reminderId, mode),
  getSettings: () => ipcRenderer.invoke("desktop:get-settings"),
  updateSettings: (settings) => ipcRenderer.invoke("desktop:update-settings", settings),
  chooseSoundFile: () => ipcRenderer.invoke("desktop:choose-sound"),
  setLaunchAtStartup: (enabled) => ipcRenderer.invoke("desktop:set-startup", enabled),
  getActiveReminder: () => ipcRenderer.invoke("desktop:get-active-reminder"),
  getSoundData: () => ipcRenderer.invoke("desktop:get-sound-data"),
  dismissReminder: () => ipcRenderer.invoke("desktop:dismiss-reminder"),
  snoozeReminder: () => ipcRenderer.invoke("desktop:snooze-reminder"),
  openMainWindow: () => ipcRenderer.invoke("desktop:open-main-window"),
};

contextBridge.exposeInMainWorld("productivityDesktop", desktopApi);
