import type { ApiReminder, BackendClient } from "./backend-client.js";
import type { ActiveSoundReminder, DesktopReminder } from "../shared.js";
import { LocalStore } from "./local-store.js";
import { Notification } from "electron";

const SYNC_INTERVAL_MS = 20_000;

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ringTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private shownSoundKey: string | null = null;
  private onSoundDue: (reminder: ActiveSoundReminder) => void = () => undefined;
  private onSoundEnd: () => void = () => undefined;

  constructor(
    private readonly backend: BackendClient,
    private readonly store: LocalStore,
  ) {}

  setSoundHandlers(onDue: (reminder: ActiveSoundReminder) => void, onEnd: () => void): void {
    this.onSoundDue = onDue;
    this.onSoundEnd = onEnd;
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.syncNow().catch(() => undefined), SYNC_INTERVAL_MS);
    void this.syncNow().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
    this.shownSoundKey = null;
    this.onSoundEnd();
  }

  async syncNow(): Promise<DesktopReminder[]> {
    if (this.isSyncing || !this.backend.getUser()) return [];
    this.isSyncing = true;
    try {
      const reminders = await this.backend.listReminders();
      const ids = new Set(reminders.map(({ id }) => id));
      await this.store.retainReminderIds(ids);
      await this.reconcileActiveSound(reminders);

      const active = this.store.getActiveSound();
      const now = Date.now();
      for (const reminder of reminders) {
        if (reminder.status !== "scheduled") continue;
        const key = executionKey(reminder);
        if (this.store.isHandled(key) || active?.reminderId === reminder.id) continue;
        const snoozedUntil = this.store.getSnoozedUntil(key);
        const dueAt = snoozedUntil ?? new Date(reminder.scheduled_at).getTime();
        if (!Number.isFinite(dueAt) || dueAt > now) continue;

        if (this.store.getDeliveryMode(reminder.id) === "sound") {
          await this.beginSoundReminder(reminder, key);
          break;
        }

        const shown = await this.showNormalNotification(reminder);
        if (!shown) continue;
        // Only consume the reminder after Electron confirms Windows displayed it.
        await this.store.markHandled(key);
        void this.backend.markSent(reminder.id).catch(() => undefined);
      }

      return reminders.map((reminder) => ({
        ...reminder,
        delivery_mode: this.store.getDeliveryMode(reminder.id),
      }));
    } finally {
      this.isSyncing = false;
    }
  }

  async dismissActiveSound(): Promise<void> {
    const active = this.store.getActiveSound();
    if (!active) return;
    await this.finishSound(active);
  }

  async snoozeActiveSound(): Promise<void> {
    const active = this.store.getActiveSound();
    if (!active) return;
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
    await this.store.snooze(executionKey(active), Date.now() + this.store.getSettings().snoozeMinutes * 60_000);
    this.onSoundEnd();
  }

  private async reconcileActiveSound(reminders: ApiReminder[]): Promise<void> {
    const active = this.store.getActiveSound();
    if (!active) return;
    if (this.store.isHandled(executionKey(active))) {
      await this.store.setActiveSound(null);
      this.shownSoundKey = null;
      this.onSoundEnd();
      return;
    }
    const current = reminders.find((reminder) => reminder.id === active.reminderId);
    if (!current || current.status !== "scheduled" || current.scheduled_at !== active.scheduledAt) {
      if (this.ringTimer) clearTimeout(this.ringTimer);
      this.ringTimer = null;
      await this.store.setActiveSound(null);
      this.shownSoundKey = null;
      this.onSoundEnd();
      return;
    }
    this.resumeSound(active);
  }

  private async beginSoundReminder(reminder: ApiReminder, key: string): Promise<void> {
    const active: ActiveSoundReminder = {
      reminderId: reminder.id,
      scheduledAt: reminder.scheduled_at,
      taskId: reminder.task_id,
      startedAt: Date.now(),
    };
    await this.store.setActiveSound(active);
    await this.store.clearSnooze(key);
    this.shownSoundKey = key;
    this.onSoundDue(active);
    this.armRingTimer(active);
  }

  private resumeSound(active: ActiveSoundReminder): void {
    const key = executionKey(active);
    if (this.shownSoundKey !== key) {
      this.shownSoundKey = key;
      this.onSoundDue(active);
    }
    this.armRingTimer(active);
  }

  private armRingTimer(active: ActiveSoundReminder): void {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    const duration = this.store.getSettings().ringingDurationSeconds * 1000;
    const remaining = Math.max(0, duration - (Date.now() - active.startedAt));
    this.ringTimer = setTimeout(() => void this.finishSound(active), remaining);
  }

  private async finishSound(active: ActiveSoundReminder): Promise<void> {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
    const current = this.store.getActiveSound();
    if (!current || current.reminderId !== active.reminderId || current.scheduledAt !== active.scheduledAt) return;
    await this.store.markHandled(executionKey(active));
    await this.store.setActiveSound(null);
    this.shownSoundKey = null;
    this.onSoundEnd();
    void this.backend.markSent(active.reminderId).catch(() => undefined);
    void this.syncNow().catch(() => undefined);
  }

  private showNormalNotification(reminder: ApiReminder): Promise<boolean> {
    if (!Notification.isSupported()) return Promise.resolve(false);
    const body = reminder.task_id === null
      ? "A scheduled reminder is due."
      : `A reminder for task ${reminder.task_id} is due.`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (shown: boolean) => {
        if (settled) return;
        settled = true;
        resolve(shown);
      };
      try {
        const notification = new Notification({ title: "Productivity reminder", body, silent: false });
        notification.once("show", () => finish(true));
        notification.once("failed", (_event, error) => {
          console.error("Windows reminder notification failed:", error);
          finish(false);
        });
        notification.show();
        setTimeout(() => finish(false), 10_000).unref();
      } catch (error) {
        console.error("Windows reminder notification could not be created:", error);
        finish(false);
      }
    });
  }
}

function executionKey(reminder: Pick<ApiReminder, "id" | "scheduled_at"> | ActiveSoundReminder): string {
  return "scheduled_at" in reminder
    ? `${reminder.id}:${reminder.scheduled_at}`
    : `${reminder.reminderId}:${reminder.scheduledAt}`;
}
