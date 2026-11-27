import type { NextFunction, Request, Response } from "express";
import { findCurrentUser } from "../services/user.service.js";

export async function getCurrentUser(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = request.auth?.userId;
  if (userId === undefined) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await findCurrentUser(userId);
    if (!user) {
      response.status(404).json({ error: "User not found" });
      return;
    }
    response.status(200).json(user);
  } catch (error) {
    next(error);
  }
}
