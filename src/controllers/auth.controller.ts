import type { NextFunction, Request, Response } from "express";
import { EmailAlreadyExistsError, loginUser, logoutUser, RefreshTokenError, registerUser, rotateRefreshToken } from "../services/auth.service.js";
import { loginBodySchema, refreshBodySchema, registerBodySchema } from "../validators/auth.validator.js";

export async function register(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = registerBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid registration details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const result = await registerUser(parsed.data);
    response.status(201).json(result);
  } catch (error) {
    if (error instanceof EmailAlreadyExistsError) {
      response.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    next(error);
  }
}

export async function login(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = loginBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid login details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const result = await loginUser(parsed.data);
    if (!result) {
      response.status(401).json({ error: "Invalid email or password" });
      return;
    }
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function refresh(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = refreshBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid refresh token request" });
    return;
  }

  try {
    const tokens = await rotateRefreshToken(parsed.data.refreshToken);
    response.status(200).json(tokens);
  } catch (error) {
    if (error instanceof RefreshTokenError) {
      response.status(401).json({ error: error.message, code: error.code });
      return;
    }
    next(error);
  }
}

export async function logout(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    await logoutUser(request.auth!.userId);
    response.status(200).json({ message: "Logged out. All refresh tokens for this user have been revoked." });
  } catch (error) {
    next(error);
  }
}
