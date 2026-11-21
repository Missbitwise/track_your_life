import type { NextFunction, Request, Response } from "express";
import {
  createNote,
  deleteNoteForUser,
  getNoteForUser,
  getNotesForUser,
  NoteNotFoundError,
  updateNoteForUser,
} from "../services/note.service.js";
import { createNoteBodySchema, listNotesQuerySchema, updateNoteBodySchema } from "../validators/note.validator.js";

function parseNoteId(value: string | string[] | undefined): number | null {
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

function handleNoteError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof NoteNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  next(error);
}

export async function create(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const parsed = createNoteBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid note details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(201).json(await createNote(userId, parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function list(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const parsed = listNotesQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid note query", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(200).json(await getNotesForUser(userId, parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function getById(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const noteId = parseNoteId(request.params.id);
  if (noteId === null) {
    response.status(400).json({ error: "Note ID must be a positive integer" });
    return;
  }

  try {
    response.status(200).json(await getNoteForUser(userId, noteId));
  } catch (error) {
    handleNoteError(error, response, next);
  }
}

export async function update(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const noteId = parseNoteId(request.params.id);
  if (noteId === null) {
    response.status(400).json({ error: "Note ID must be a positive integer" });
    return;
  }
  const parsed = updateNoteBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid note details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(200).json(await updateNoteForUser(userId, noteId, parsed.data));
  } catch (error) {
    handleNoteError(error, response, next);
  }
}

export async function remove(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const noteId = parseNoteId(request.params.id);
  if (noteId === null) {
    response.status(400).json({ error: "Note ID must be a positive integer" });
    return;
  }

  try {
    await deleteNoteForUser(userId, noteId);
    response.status(204).end();
  } catch (error) {
    handleNoteError(error, response, next);
  }
}
