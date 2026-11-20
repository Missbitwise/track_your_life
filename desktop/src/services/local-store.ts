import { app, safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActiveSoundReminder, DeliveryMode, DesktopSettings } from "../shared.js";

interface LocalState {
  accountUserId: number | null;
  settings: DesktopSettings;
  deliveryModes: Record<string, DeliveryMode>;
  handled: Record<string, number>;
  snoozedUntil: Record<string, number>;
  activeSound: ActiveSoundReminder | null;
}

const defaultState = (): LocalState => ({
  accountUserId: null,
  settings: {
    apiOrigin: "http://localhost:3000",
    soundFilePath: null,
    ringingDurationSeconds: 60,
    launchAtStartup: false,
    snoozeMinutes: 5,
  },
  deliveryModes: {},
  handled: {},
  snoozedUntil: {},
  activeSound: null,
});

export class LocalStore {
  private readonly directory = app.getPath("userData");
  private readonly statePath = path.join(this.directory, "desktop-state.json");
  private readonly secretPath = path.join(this.directory, "auth.enc");
  private state: LocalState = defaultState();

  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.statePath, "utf8"));
      if (typeof parsed === "object" && parsed !== null) {
        const stored = parsed as Partial<LocalState>;
        this.state = {
          ...defaultState(),
          ...stored,
          settings: { ...defaultState().settings, ...stored.settings },
          deliveryModes: stored.deliveryModes ?? {},
          handled: stored.handled ?? {},
          snoozedUntil: stored.snoozedUntil ?? {},
          activeSound: stored.activeSound ?? null,
        };
      }
    } catch {
      this.state = defaultState();
    }
    await this.persist();
  }

  getSettings(): DesktopSettings {
    return { ...this.state.settings };
  }

  async useAccount(userId: number): Promise<void> {
    if (this.state.accountUserId !== userId) {
      this.state.accountUserId = userId;
      this.state.deliveryModes = {};
      this.state.handled = {};
      this.state.snoozedUntil = {};
      this.state.activeSound = null;
      await this.persist();
    }
  }

  async updateSettings(update: Partial<DesktopSettings>): Promise<DesktopSettings> {
    this.state.settings = { ...this.state.settings, ...update };
    await this.persist();
    return this.getSettings();
  }

  getDeliveryMode(reminderId: number): DeliveryMode {
    return this.state.deliveryModes[String(reminderId)] ?? "notification";
  }

  async setDeliveryMode(reminderId: number, mode: DeliveryMode): Promise<void> {
    this.state.deliveryModes[String(reminderId)] = mode;
    await this.persist();
  }

  async retainReminderIds(ids: Set<number>): Promise<void> {
    for (const id of Object.keys(this.state.deliveryModes)) if (!ids.has(Number(id))) delete this.state.deliveryModes[id];
    await this.persist();
  }

  isHandled(key: string): boolean {
    return this.state.handled[key] !== undefined;
  }

  async markHandled(key: string): Promise<void> {
    this.state.handled[key] = Date.now();
    const entries = Object.entries(this.state.handled).sort((a, b) => b[1] - a[1]);
    this.state.handled = Object.fromEntries(entries.slice(0, 5000));
    delete this.state.snoozedUntil[key];
    await this.persist();
  }

  getSnoozedUntil(key: string): number | undefined {
    return this.state.snoozedUntil[key];
  }

  async snooze(key: string, until: number): Promise<void> {
    this.state.snoozedUntil[key] = until;
    this.state.activeSound = null;
    await this.persist();
  }

  async clearSnooze(key: string): Promise<void> {
    delete this.state.snoozedUntil[key];
    await this.persist();
  }

  getActiveSound(): ActiveSoundReminder | null {
    return this.state.activeSound ? { ...this.state.activeSound } : null;
  }

  async setActiveSound(reminder: ActiveSoundReminder | null): Promise<void> {
    this.state.activeSound = reminder ? { ...reminder } : null;
    await this.persist();
  }

  async saveSecrets(value: string): Promise<void> {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("Windows secure token storage is unavailable");
    const encrypted = await safeStorage.encryptStringAsync(value);
    await writeFile(this.secretPath, encrypted, { mode: 0o600 });
  }

  async loadSecrets(): Promise<string | null> {
    if (!await safeStorage.isAsyncEncryptionAvailable()) return null;
    try {
      const encrypted = await readFile(this.secretPath);
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      if (decrypted.shouldReEncrypt) {
        await writeFile(this.secretPath, await safeStorage.encryptStringAsync(decrypted.result), { mode: 0o600 });
      }
      return decrypted.result;
    } catch {
      return null;
    }
  }

  async clearSecrets(): Promise<void> {
    await rm(this.secretPath, { force: true });
  }

  private async persist(): Promise<void> {
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }
}
