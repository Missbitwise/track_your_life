import type { NextFunction, Request, Response } from "express";
import { EmailAlreadyExistsError, GoogleAccountConflictError, GoogleConfigurationError, GoogleCredentialError, UsernameAlreadyExistsError, loginUser, loginWithGoogle, logoutUser, RefreshTokenError, registerUser, rotateRefreshToken } from "../services/auth.service.js";
import { googleBodySchema, loginBodySchema, refreshBodySchema, registerBodySchema } from "../validators/auth.validator.js";
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

export async function google(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = googleBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid Google authentication request", details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const result = await loginWithGoogle(parsed.data.credential);
    setAuthCookies(response, result);
    response.status(200).json({ user: result.user });
  } catch (error) {
    if (error instanceof GoogleCredentialError) { response.status(401).json({ error: error.message }); return; }
    if (error instanceof GoogleAccountConflictError) { response.status(409).json({ error: error.message, code: "GOOGLE_ACCOUNT_CONFLICT" }); return; }
    if (error instanceof GoogleConfigurationError) { response.status(503).json({ error: error.message }); return; }
    next(error);
  }
}

export async function refresh(request: Request, response: Response, next: NextFunction): Promise<void> {
  const desktopClient = isDesktopTokenClient(request);
  const token = readCookie(request, REFRESH_COOKIE) ?? (desktopClient
    ? refreshBodySchema.safeParse(request.body).data?.refreshToken
    : undefined);
  if (!token) {
    if (!desktopClient) clearAuthCookies(response);
    response.status(desktopClient ? 400 : 401).json({ error: desktopClient ? "Invalid refresh token request" : "Refresh token is missing" });
    return;
  }

  try {
    const tokens = await rotateRefreshToken(token);
    setAuthCookies(response, tokens);
    response.status(200).json(isDesktopTokenClient(request) ? tokens : { ok: true });
  } catch (error) {
    if (error instanceof RefreshTokenError) {
      if (!desktopClient) clearAuthCookies(response);
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
