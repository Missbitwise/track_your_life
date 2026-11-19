import type { NextFunction, Request, Response } from "express";
import {
  createReminder,
  deleteReminderForUser,
  getReminderForUser,
  getRemindersForUser,
  ReminderNotFoundError,
  ReminderTaskNotFoundError,
  updateReminderForUser,
} from "../services/reminder.service.js";
import { createReminderBodySchema, updateReminderBodySchema } from "../validators/reminder.validator.js";

function parseReminderId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function requireUserId(request: Request, response: Response): number | null {
  const userId = request.auth?.userId;
  if (userId === undefined) {
    response.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function handleReminderError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof ReminderNotFoundError || error instanceof ReminderTaskNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  next(error);
}

export async function create(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const parsed = createReminderBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid reminder details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(201).json(await createReminder(userId, parsed.data));
  } catch (error) {
    handleReminderError(error, response, next);
  }
}

export async function list(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  try {
    response.status(200).json(await getRemindersForUser(userId));
  } catch (error) {
    next(error);
  }
}

export async function getById(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const reminderId = parseReminderId(request.params.id);
  if (reminderId === null) {
    response.status(400).json({ error: "Reminder ID must be a positive integer" });
    return;
  }

  try {
    response.status(200).json(await getReminderForUser(userId, reminderId));
  } catch (error) {
    handleReminderError(error, response, next);
  }
}

export async function update(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const reminderId = parseReminderId(request.params.id);
  if (reminderId === null) {
    response.status(400).json({ error: "Reminder ID must be a positive integer" });
    return;
  }
  const parsed = updateReminderBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid reminder details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(200).json(await updateReminderForUser(userId, reminderId, parsed.data));
  } catch (error) {
    handleReminderError(error, response, next);
  }
}

export async function remove(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const reminderId = parseReminderId(request.params.id);
  if (reminderId === null) {
    response.status(400).json({ error: "Reminder ID must be a positive integer" });
    return;
  }

  try {
    await deleteReminderForUser(userId, reminderId);
    response.status(204).end();
  } catch (error) {
    handleReminderError(error, response, next);
  }
}
