export type DeliveryMode = "notification" | "sound";
export type ReminderStatus = "scheduled" | "sent" | "cancelled";

export interface DesktopReminder {
  id: number;
  task_id: number | null;
  scheduled_at: string;
  status: ReminderStatus;
  delivery_mode: DeliveryMode;
}

export interface PublicDesktopUser {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface DesktopSettings {
  apiOrigin: string;
  soundFilePath: string | null;
  ringingDurationSeconds: number;
  launchAtStartup: boolean;
  snoozeMinutes: number;
}

export interface ActiveSoundReminder {
  reminderId: number;
  scheduledAt: string;
  taskId: number | null;
  startedAt: number;
}

export interface DesktopApi {
  getState(): Promise<{ user: PublicDesktopUser | null; settings: DesktopSettings }>;
  setApiOrigin(apiOrigin: string): Promise<DesktopSettings>;
  login(email: string, password: string): Promise<PublicDesktopUser>;
  logout(): Promise<void>;
  syncReminders(): Promise<DesktopReminder[]>;
  setDeliveryMode(reminderId: number, mode: DeliveryMode): Promise<void>;
  getSettings(): Promise<DesktopSettings>;
  testNotification(): Promise<void>;
  updateSettings(settings: Pick<DesktopSettings, "ringingDurationSeconds" | "snoozeMinutes">): Promise<DesktopSettings>;
  chooseSoundFile(): Promise<string | null>;
  setLaunchAtStartup(enabled: boolean): Promise<void>;
  getActiveReminder(): Promise<ActiveSoundReminder | null>;
  getSoundData(): Promise<string | null>;
  dismissReminder(): Promise<void>;
  snoozeReminder(): Promise<void>;
  openMainWindow(): Promise<void>;
}

declare global {
  interface Window {
    productivityDesktop: DesktopApi;
  }
}
