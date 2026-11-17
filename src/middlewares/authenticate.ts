import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getJwtConfiguration } from "../config/jwt.js";

export function authenticate(request: Request, response: Response, next: NextFunction): void {
  const authorization = request.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const configuration = getJwtConfiguration();
    const payload = jwt.verify(match[1], configuration.accessSecret, { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub || !/^\d+$/.test(payload.sub)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    request.auth = { userId };
    next();
  } catch {
    response.status(401).json({ error: "Unauthorized" });
  }
}
