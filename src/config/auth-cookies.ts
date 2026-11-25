import type { CookieOptions, Request, Response } from "express";

export const ACCESS_COOKIE = "productivity_access";
export const REFRESH_COOKIE = "productivity_refresh";
const ACCESS_MAX_AGE = 15 * 60 * 1000;
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(maxAge: number): CookieOptions {
  const configuredSameSite = process.env.AUTH_COOKIE_SAME_SITE?.toLowerCase();
  const sameSite: "lax" | "strict" | "none" = configuredSameSite === "strict" || configuredSameSite === "none"
    ? configuredSameSite
    : "lax";
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    sameSite,
    path: "/",
    maxAge,
  };
}

export function setAuthCookies(response: Response, tokens: { accessToken: string; refreshToken: string }): void {
  response.cookie(ACCESS_COOKIE, tokens.accessToken, cookieOptions(ACCESS_MAX_AGE));
  response.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE));
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(ACCESS_COOKIE, cookieOptions(0));
  response.clearCookie(REFRESH_COOKIE, cookieOptions(0));
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

export function isDesktopTokenClient(request: Request): boolean {
  return request.get("x-client-type") === "productivity-desktop";
}

export function getAllowedOrigins(): string[] {
  return (process.env.FRONTEND_ORIGINS ?? "http://localhost:5173,http://localhost:3000")
    .split(",").map((value) => value.trim()).filter(Boolean);
}

export function enforceAllowedOrigin(request: Request, response: Response): boolean {
  const origin = request.get("origin");
  if (!origin) return true;
  if (getAllowedOrigins().includes(origin)) return true;
  response.status(403).json({ error: "Origin not allowed" });
  return false;
}
