import type { NextFunction, Request, Response } from "express";
import {
  createRoutine,
  deleteRoutineForUser,
  getRoutineForUser,
  getRoutinesForUser,
  RoutineDateRangeError,
  RoutineNotFoundError,
  updateRoutineForUser,
} from "../services/routine.service.js";
import { createRoutineBodySchema, updateRoutineBodySchema } from "../validators/routine.validator.js";

function parseRoutineId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string") return null;
  if (!/^[1-9]\d*$/.test(value)) return null;
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

function handleRoutineError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof RoutineNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof RoutineDateRangeError) {
    response.status(400).json({ error: error.message });
    return;
  }
  next(error);
}

export async function create(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;

  const parsed = createRoutineBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid routine details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(201).json(await createRoutine(userId, parsed.data));
  } catch (error) {
    handleRoutineError(error, response, next);
  }
}

export async function list(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;

  try {
    response.status(200).json(await getRoutinesForUser(userId));
  } catch (error) {
    next(error);
  }
}

export async function getById(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const routineId = parseRoutineId(request.params.id);
  if (routineId === null) {
    response.status(400).json({ error: "Routine ID must be a positive integer" });
    return;
  }

  try {
    response.status(200).json(await getRoutineForUser(userId, routineId));
  } catch (error) {
    handleRoutineError(error, response, next);
  }
}

export async function update(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const routineId = parseRoutineId(request.params.id);
  if (routineId === null) {
    response.status(400).json({ error: "Routine ID must be a positive integer" });
    return;
  }

  const parsed = updateRoutineBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid routine details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(200).json(await updateRoutineForUser(userId, routineId, parsed.data));
  } catch (error) {
    handleRoutineError(error, response, next);
  }
}

export async function remove(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const routineId = parseRoutineId(request.params.id);
  if (routineId === null) {
    response.status(400).json({ error: "Routine ID must be a positive integer" });
    return;
  }

  try {
    await deleteRoutineForUser(userId, routineId);
    response.status(204).end();
  } catch (error) {
    handleRoutineError(error, response, next);
  }
}
