import type { NextFunction, Request, Response } from "express";
import {
  AnalyticsHistoryUnavailableError,
  AnalyticsUserNotFoundError,
  getDailyProductivity,
  getMonthlyProductivity,
  getWeeklyProductivity,
} from "../services/analytics.service.js";
import {
  dailyAnalyticsQuerySchema,
  monthlyAnalyticsQuerySchema,
  weeklyAnalyticsQuerySchema,
} from "../validators/analytics.validator.js";

function requireUserId(request: Request, response: Response): number | null {
  const userId = request.auth?.userId;
  if (userId === undefined) {
    response.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function handleAnalyticsError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof AnalyticsUserNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof AnalyticsHistoryUnavailableError) {
    response.status(503).json({ error: error.message });
    return;
  }
  next(error);
}

export async function daily(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const parsed = dailyAnalyticsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid daily analytics query", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(200).json(await getDailyProductivity(userId, parsed.data.date));
  } catch (error) {
    handleAnalyticsError(error, response, next);
  }
}

export async function weekly(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const parsed = weeklyAnalyticsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid weekly analytics query", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(200).json(await getWeeklyProductivity(userId, parsed.data.startDate));
  } catch (error) {
    handleAnalyticsError(error, response, next);
  }
}

export async function monthly(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = requireUserId(request, response);
  if (userId === null) return;
  const parsed = monthlyAnalyticsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid monthly analytics query", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(200).json(await getMonthlyProductivity(userId, parsed.data.year, parsed.data.month));
  } catch (error) {
    handleAnalyticsError(error, response, next);
  }
}
