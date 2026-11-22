import type { NextFunction, Request, Response } from "express";
import { changeUserTimeZone, UserNotFoundForTimeZoneError } from "../services/time-zone.service.js";
import { updateTimeZoneBodySchema } from "../validators/time-zone.validator.js";

export async function update(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = request.auth?.userId;
  if (userId === undefined) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = updateTimeZoneBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid timezone", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    response.status(200).json(await changeUserTimeZone(userId, parsed.data.time_zone));
  } catch (error) {
    if (error instanceof UserNotFoundForTimeZoneError) {
      response.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof TypeError) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
}
