import type { NextFunction, Request, Response } from "express";
import { EmailAlreadyExistsError, UsernameAlreadyExistsError, loginUser, logoutUser, RefreshTokenError, registerUser, rotateRefreshToken } from "../services/auth.service.js";
import { loginBodySchema, refreshBodySchema, registerBodySchema } from "../validators/auth.validator.js";
import { clearAuthCookies, isDesktopTokenClient, readCookie, REFRESH_COOKIE, setAuthCookies } from "../config/auth-cookies.js";

export async function register(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = registerBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid registration details", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const result = await registerUser(parsed.data);
    setAuthCookies(response, result);
    response.status(201).json(isDesktopTokenClient(request) ? result : { user: result.user });
  } catch (error) {
    if (error instanceof EmailAlreadyExistsError) {
      response.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    if (error instanceof UsernameAlreadyExistsError) {
      response.status(409).json({ error: error.message });
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
    setAuthCookies(response, result);
    response.status(200).json(isDesktopTokenClient(request) ? result : { user: result.user });
  } catch (error) {
    next(error);
  }
}

export async function refresh(request: Request, response: Response, next: NextFunction): Promise<void> {
  const token = readCookie(request, REFRESH_COOKIE) ?? (isDesktopTokenClient(request)
    ? refreshBodySchema.safeParse(request.body).data?.refreshToken
    : undefined);
  if (!token) { response.status(400).json({ error: "Invalid refresh token request" }); return; }

  try {
    const tokens = await rotateRefreshToken(token);
    setAuthCookies(response, tokens);
    response.status(200).json(isDesktopTokenClient(request) ? tokens : { ok: true });
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
    clearAuthCookies(response);
    response.status(200).json({ message: "Logged out. All refresh tokens for this user have been revoked." });
  } catch (error) {
    next(error);
  }
}
