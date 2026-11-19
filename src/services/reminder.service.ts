import { appDataSource } from "../config/database.js";
import { Reminder } from "../entities/Reminder.js";
import { Task } from "../entities/Task.js";
import type { CreateReminderBody, UpdateReminderBody } from "../validators/reminder.validator.js";
import type { EntityManager } from "typeorm";

export class ReminderNotFoundError extends Error {
  constructor() {
    super("Reminder not found");
    this.name = "ReminderNotFoundError";
  }
}

export class ReminderTaskNotFoundError extends Error {
  constructor() {
    super("Task not found");
    this.name = "ReminderTaskNotFoundError";
  }
}

async function assertTaskBelongsToUser(
  manager: EntityManager,
  userId: number,
  taskId: number,
): Promise<void> {
  const task = await manager.getRepository(Task).findOne({
    where: { id: taskId, user_id: userId },
    select: { id: true },
    lock: { mode: "pessimistic_write" },
  });
  if (!task) throw new ReminderTaskNotFoundError();
}

function statusFields(
  reminder: Reminder,
  status: UpdateReminderBody["status"],
): void {
  if (status === undefined) return;
  reminder.status = status;
  if (status === "sent") {
    reminder.sent_at ??= new Date();
  } else {
    reminder.sent_at = null;
  }
}

export async function createReminder(userId: number, input: CreateReminderBody): Promise<Reminder> {
  return appDataSource.transaction(async (manager) => {
    if (input.task_id != null) await assertTaskBelongsToUser(manager, userId, input.task_id);

    return manager.getRepository(Reminder).save(manager.getRepository(Reminder).create({
      user_id: userId,
      task_id: input.task_id ?? null,
      routine_id: null,
      scheduled_at: new Date(input.scheduled_at),
      status: "scheduled",
      sent_at: null,
    }));
  });
}

export async function getRemindersForUser(userId: number): Promise<Reminder[]> {
  return appDataSource.getRepository(Reminder).find({
    where: { user_id: userId },
    order: { scheduled_at: "ASC", id: "ASC" },
  });
}

export async function getReminderForUser(userId: number, reminderId: number): Promise<Reminder> {
  const reminder = await appDataSource.getRepository(Reminder).findOne({
    where: { id: reminderId, user_id: userId },
  });
  if (!reminder) throw new ReminderNotFoundError();
  return reminder;
}

export async function updateReminderForUser(
  userId: number,
  reminderId: number,
  input: UpdateReminderBody,
): Promise<Reminder> {
  return appDataSource.transaction(async (manager) => {
    const repository = manager.getRepository(Reminder);
    const reminder = await repository.findOne({
      where: { id: reminderId, user_id: userId },
      lock: { mode: "pessimistic_write" },
    });
    if (!reminder) throw new ReminderNotFoundError();

    if (input.task_id !== undefined && input.task_id !== null) {
      await assertTaskBelongsToUser(manager, userId, input.task_id);
    }
    if (input.task_id !== undefined) reminder.task_id = input.task_id;
    if (input.scheduled_at !== undefined) reminder.scheduled_at = new Date(input.scheduled_at);
    statusFields(reminder, input.status);

    return repository.save(reminder);
  });
}

export async function deleteReminderForUser(userId: number, reminderId: number): Promise<void> {
  const result = await appDataSource.getRepository(Reminder).delete({ id: reminderId, user_id: userId });
  if (!result.affected) throw new ReminderNotFoundError();
}
