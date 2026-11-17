import type { NextFunction, Request, Response } from "express";
import {
  createTask,
  deleteTask,
  getTasksForDate,
  setTaskStatus,
  TaskNotFoundError,
  TaskRoutineDateConflictError,
  updateTask,
} from "../services/task.service.js";
import { createTaskBodySchema, taskDateSchema, taskStatusBodySchema, updateTaskBodySchema } from "../validators/task.validator.js";

function parseTaskId(value: string | string[] | undefined): number | null {
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

function handleTaskError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof TaskNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof TaskRoutineDateConflictError) {
    response.status(409).json({ error: error.message });
    return;
  }
  next(error);
}

export async function create(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const parsed = createTaskBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid task details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(201).json(await createTask(userId, parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function listForDate(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const parsedDate = taskDateSchema.safeParse(request.query.date);
  if (!parsedDate.success) {
    response.status(400).json({ error: "A valid date query parameter is required (YYYY-MM-DD)" });
    return;
  }

  try {
    response.status(200).json(await getTasksForDate(userId, parsedDate.data));
  } catch (error) {
    next(error);
  }
}

export async function update(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const taskId = parseTaskId(request.params.id);
  if (taskId === null) {
    response.status(400).json({ error: "Task ID must be a positive integer" });
    return;
  }
  const parsed = updateTaskBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid task details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(200).json(await updateTask(userId, taskId, parsed.data));
  } catch (error) {
    handleTaskError(error, response, next);
  }
}

export async function updateStatus(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const taskId = parseTaskId(request.params.id);
  if (taskId === null) {
    response.status(400).json({ error: "Task ID must be a positive integer" });
    return;
  }
  const parsed = taskStatusBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Status must be either 'pending' or 'completed'" });
    return;
  }

  try {
    response.status(200).json(await setTaskStatus(userId, taskId, parsed.data.status));
  } catch (error) {
    handleTaskError(error, response, next);
  }
}

export async function remove(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const taskId = parseTaskId(request.params.id);
  if (taskId === null) {
    response.status(400).json({ error: "Task ID must be a positive integer" });
    return;
  }

  try {
    await deleteTask(userId, taskId);
    response.status(204).end();
  } catch (error) {
    handleTaskError(error, response, next);
  }
}
