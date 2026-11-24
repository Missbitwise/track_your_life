import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  AssistantConversationNotFoundError,
  AssistantProviderError,
  chatWithAssistant,
  deleteAssistantConversation,
  getAssistantConversation,
  listAssistantConversations,
} from "../services/assistant.service.js";
import { AssistantToolArgumentError } from "../services/assistant-tools.service.js";
import { GeminiConfigurationError } from "../config/gemini.js";
import {
  AssistantPlanConflictError,
  AssistantPlanNotDraftError,
  AssistantPlanNotFoundError,
  AssistantPlanValidationError,
  approveAssistantTaskPlan,
} from "../services/assistant-task-plans.service.js";

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  conversationId: z.string().uuid().optional(),
}).strict();

const conversationIdSchema = z.string().uuid();

function userId(request: Request, response: Response): number | null {
  const id = request.auth?.userId;
  if (!id) {
    response.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return id;
}

function handleAssistantError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof AssistantConversationNotFoundError) {
    response.status(404).json({ error: "Conversation not found" });
    return;
  }
  if (error instanceof AssistantToolArgumentError) {
    response.status(400).json({ error: "Invalid tool arguments" });
    return;
  }
  if (error instanceof AssistantPlanNotFoundError) {
    response.status(404).json({ error: "Task plan not found" });
    return;
  }
  if (error instanceof AssistantPlanNotDraftError || error instanceof AssistantPlanConflictError) {
    response.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof AssistantPlanValidationError) {
    response.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof GeminiConfigurationError) {
    response.status(503).json({ error: "AI assistant is not configured" });
    return;
  }
  if (error instanceof AssistantProviderError) {
    if (error.kind === "rate_limited") {
      response.setHeader("Retry-After", String(error.retryAfterSeconds ?? 30));
      response.status(503).json({ error: "AI assistant is temporarily unavailable. Please retry shortly." });
      return;
    }
    if (error.kind === "timeout") {
      response.status(504).json({ error: "AI assistant request timed out" });
      return;
    }
    if (error.kind === "unavailable") {
      response.status(503).json({ error: "AI assistant is temporarily unavailable. Please retry shortly." });
      return;
    }
    response.status(502).json({ error: "AI assistant is temporarily unavailable" });
    return;
  }
  next(error);
}

export async function chat(request: Request, response: Response, next: NextFunction): Promise<void> {
  const id = userId(request, response);
  if (id === null) return;
  const parsed = chatSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid chat request", details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    response.status(200).json(await chatWithAssistant(id, parsed.data));
  } catch (error) {
    handleAssistantError(error, response, next);
  }
}

export async function listConversations(request: Request, response: Response, next: NextFunction): Promise<void> {
  const id = userId(request, response);
  if (id === null) return;
  const pageValue = request.query.page;
  const limitValue = request.query.limit;
  const page = pageValue === undefined ? 1 : typeof pageValue === "string" && /^\d+$/.test(pageValue) ? Number(pageValue) : NaN;
  const limit = limitValue === undefined ? 20 : typeof limitValue === "string" && /^\d+$/.test(limitValue) ? Number(limitValue) : NaN;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    response.status(400).json({ error: "page and limit must be positive integers; limit cannot exceed 50" });
    return;
  }
  try {
    response.status(200).json(await listAssistantConversations(id, page, limit));
  } catch (error) {
    handleAssistantError(error, response, next);
  }
}

export async function getConversation(request: Request, response: Response, next: NextFunction): Promise<void> {
  const id = userId(request, response);
  if (id === null) return;
  const parsed = conversationIdSchema.safeParse(request.params.id);
  const limitValue = request.query.limit;
  const limit = limitValue === undefined ? 50 : typeof limitValue === "string" && /^\d+$/.test(limitValue) ? Number(limitValue) : NaN;
  if (!parsed.success || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    response.status(400).json({ error: "A valid conversation ID and limit (1-100) are required" });
    return;
  }
  try {
    response.status(200).json(await getAssistantConversation(id, parsed.data, limit));
  } catch (error) {
    handleAssistantError(error, response, next);
  }
}

export async function removeConversation(request: Request, response: Response, next: NextFunction): Promise<void> {
  const id = userId(request, response);
  if (id === null) return;
  const parsed = conversationIdSchema.safeParse(request.params.id);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid conversation ID" });
    return;
  }
  try {
    const deleted = await deleteAssistantConversation(id, parsed.data);
    if (!deleted) {
      response.status(404).json({ error: "Conversation not found" });
      return;
    }
    response.status(204).end();
  } catch (error) {
    handleAssistantError(error, response, next);
  }
}

export async function approvePlan(request: Request, response: Response, next: NextFunction): Promise<void> {
  const id = userId(request, response);
  if (id === null) return;
  const parsed = conversationIdSchema.safeParse(request.params.planId);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid task plan ID" });
    return;
  }
  try {
    response.status(200).json(await approveAssistantTaskPlan(id, parsed.data));
  } catch (error) {
    handleAssistantError(error, response, next);
  }
}
