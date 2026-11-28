import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import type { TokenPayload } from "google-auth-library";
import { QueryFailedError, Raw, type EntityManager } from "typeorm";
import { appDataSource } from "../config/database.js";
import { getGoogleClientId } from "../config/google.js";
import { getJwtConfiguration } from "../config/jwt.js";
import { RefreshToken } from "../entities/RefreshToken.js";
import { User } from "../entities/User.js";
import { UserTimeZoneVersion } from "../entities/UserTimeZoneVersion.js";
import { databaseNow, isValidTimeZone, localDateAt } from "./time-zone.service.js";
import type { LoginBody, RegisterBody } from "../validators/auth.validator.js";

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_LIFETIME = "15m" as const;
const REFRESH_TOKEN_LIFETIME = "7d" as const;
const googleClient = new OAuth2Client();

export interface PublicUser {
  id: number;
  email: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}

export type RefreshTokenErrorCode = "INVALID_REFRESH_TOKEN" | "REFRESH_TOKEN_EXPIRED" | "REFRESH_TOKEN_REUSED";

export class RefreshTokenError extends Error {
  constructor(public readonly code: RefreshTokenErrorCode) {
    super(code === "INVALID_REFRESH_TOKEN"
      ? "Refresh token is invalid"
      : code === "REFRESH_TOKEN_EXPIRED"
        ? "Refresh token has expired"
        : "Refresh token was revoked or has already been used");
    this.name = "RefreshTokenError";
  }
}

export class EmailAlreadyExistsError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "EmailAlreadyExistsError";
  }
}

export class UsernameAlreadyExistsError extends Error {
  constructor() { super("This username is already in use"); this.name = "UsernameAlreadyExistsError"; }
}

export class GoogleCredentialError extends Error {
  constructor() { super("Google credential is invalid or could not be verified"); this.name = "GoogleCredentialError"; }
}

export class GoogleAccountConflictError extends Error {
  constructor() { super("This email is already associated with a different Google identity"); this.name = "GoogleAccountConflictError"; }
}

export class GoogleConfigurationError extends Error {
  constructor() { super("Google authentication is not configured"); this.name = "GoogleConfigurationError"; }
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    created_at: user.created_at,
  };
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createAccessToken(userId: number): string {
  const { accessSecret } = getJwtConfiguration();
  return jwt.sign({}, accessSecret, {
    algorithm: "HS256",
    jwtid: randomUUID(),
    subject: String(userId),
    expiresIn: ACCESS_TOKEN_LIFETIME,
  });
}

async function issueTokenPair(manager: EntityManager, userId: number): Promise<AuthTokens> {
  const { refreshSecret } = getJwtConfiguration();
  const refreshToken = jwt.sign({}, refreshSecret, {
    algorithm: "HS256",
    jwtid: randomUUID(),
    subject: String(userId),
    expiresIn: REFRESH_TOKEN_LIFETIME,
  });
  const decoded = jwt.decode(refreshToken);
  if (!decoded || typeof decoded === "string" || typeof decoded.exp !== "number") {
    throw new Error("Generated refresh token is missing its expiration claim");
  }

  const repository = manager.getRepository(RefreshToken);
  await repository.save(repository.create({
    user_id: userId,
    token_hash: hashRefreshToken(refreshToken),
    expires_at: new Date(decoded.exp * 1000),
    revoked_at: null,
  }));

  return { accessToken: createAccessToken(userId), refreshToken };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: unknown };
  return driverError.code === "23505";
}

function verifyRefreshToken(token: string): number {
  const { refreshSecret } = getJwtConfiguration();
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, refreshSecret, { algorithms: ["HS256"] });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new RefreshTokenError("REFRESH_TOKEN_EXPIRED");
    }
    throw new RefreshTokenError("INVALID_REFRESH_TOKEN");
  }

  if (typeof payload === "string" || !payload.sub || !/^\d+$/.test(payload.sub)) {
    throw new RefreshTokenError("INVALID_REFRESH_TOKEN");
  }
  const userId = Number(payload.sub);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new RefreshTokenError("INVALID_REFRESH_TOKEN");
  }
  return userId;
}

async function lockUser(manager: EntityManager, userId: number): Promise<User | null> {
  return manager.getRepository(User).findOne({
    where: { id: userId },
    lock: { mode: "pessimistic_write" },
  });
}

async function revokeActiveRefreshTokens(manager: EntityManager, userId: number): Promise<void> {
  await manager.getRepository(RefreshToken)
    .createQueryBuilder()
    .update(RefreshToken)
    .set({ revoked_at: new Date() })
    .where('"user_id" = :userId AND "revoked_at" IS NULL', { userId })
    .execute();
}

export async function registerUser(input: RegisterBody): Promise<AuthResult> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  try {
    return await appDataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const existingUser = await userRepository.findOne({ where: { email: input.email } });
      if (existingUser) throw new EmailAlreadyExistsError();

      const user = userRepository.create({
        email: input.email,
        username: input.username ?? null,
        password_hash: passwordHash,
        first_name: input.first_name ?? null,
        last_name: input.last_name ?? null,
      });
      const savedUser = await userRepository.save(user);
      if (!isValidTimeZone(savedUser.time_zone)) {
        throw new Error("User timezone default is not a valid IANA timezone");
      }
      const createdAt = await databaseNow(manager);
      await manager.getRepository(UserTimeZoneVersion).save({
        user_id: savedUser.id,
        version_no: 1,
        time_zone: savedUser.time_zone,
        effective_from_date: localDateAt(createdAt, savedUser.time_zone),
        effective_at: createdAt,
      });
      const tokens = await issueTokenPair(manager, savedUser.id);
      return { ...tokens, user: toPublicUser(savedUser) };
    });
  } catch (error) {
    if (error instanceof QueryFailedError && isUniqueConstraintViolation(error)) {
      const constraint = (error.driverError as { constraint?: string }).constraint;
      if (constraint === "uq_users_username_lower") throw new UsernameAlreadyExistsError();
      throw new EmailAlreadyExistsError();
    }
    throw error;
  }
}

export async function loginUser(input: LoginBody): Promise<AuthResult | null> {
  const repository = appDataSource.getRepository(User);
  const user = await repository.findOne({ where: { email: input.email } });
  if (!user?.password_hash || !(await bcrypt.compare(input.password, user.password_hash))) return null;

  return appDataSource.transaction(async (manager) => {
    const currentUser = await lockUser(manager, user.id);
    if (!currentUser) return null;
    const tokens = await issueTokenPair(manager, currentUser.id);
    return { ...tokens, user: toPublicUser(currentUser) };
  });
}

export async function loginWithGoogle(credential: string): Promise<AuthResult> {
  const clientId = getGoogleClientId();
  if (!clientId) throw new GoogleConfigurationError();

  let payload: TokenPayload | undefined;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    throw new GoogleCredentialError();
  }
  const issuer = payload?.iss;
  if (!payload || !payload.sub || !payload.email || payload.email_verified !== true
    || (issuer !== "accounts.google.com" && issuer !== "https://accounts.google.com")
    || payload.aud !== clientId || (payload.exp !== undefined && payload.exp <= Math.floor(Date.now() / 1000))) {
    throw new GoogleCredentialError();
  }

  const email = payload.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GoogleCredentialError();

  return appDataSource.transaction(async (manager) => {
    const users = manager.getRepository(User);
    let user = await users.findOne({ where: { google_id: payload!.sub } });
    if (!user) {
      const emailOwner = await users.findOne({
        where: { email: Raw((column) => `LOWER(${column}) = :googleEmail`, { googleEmail: email }) },
        lock: { mode: "pessimistic_write" },
      });
      if (emailOwner) {
        if (emailOwner.google_id && emailOwner.google_id !== payload!.sub) {
          throw new GoogleAccountConflictError();
        }
        emailOwner.google_id = payload!.sub;
        user = await users.save(emailOwner);
      } else {
        user = await users.save(users.create({
          google_id: payload!.sub,
          email,
          username: null,
          password_hash: null,
          first_name: payload!.given_name ?? null,
          last_name: payload!.family_name ?? null,
        }));
        if (!isValidTimeZone(user.time_zone)) throw new Error("User timezone default is not a valid IANA timezone");
        const createdAt = await databaseNow(manager);
        await manager.getRepository(UserTimeZoneVersion).save({
          user_id: user.id,
          version_no: 1,
          time_zone: user.time_zone,
          effective_from_date: localDateAt(createdAt, user.time_zone),
          effective_at: createdAt,
        });
      }
    }
    const currentUser = await lockUser(manager, user.id);
    if (!currentUser) throw new GoogleCredentialError();
    const tokens = await issueTokenPair(manager, currentUser.id);
    return { ...tokens, user: toPublicUser(currentUser) };
  }).catch(async (error: unknown) => {
    if (error instanceof QueryFailedError && isUniqueConstraintViolation(error)) {
      const constraint = (error.driverError as { constraint?: string }).constraint;
      if (constraint === "uq_users_email_lower" || constraint === "uq_users_google_id") {
        const user = await appDataSource.getRepository(User).findOne({ where: { google_id: payload!.sub } });
        if (user) {
          return appDataSource.transaction(async (manager) => {
            const currentUser = await lockUser(manager, user.id);
            if (!currentUser) throw error;
            const tokens = await issueTokenPair(manager, currentUser.id);
            return { ...tokens, user: toPublicUser(currentUser) };
          });
        }
        throw new GoogleAccountConflictError();
      }
    }
    throw error;
  });
}

export async function rotateRefreshToken(token: string): Promise<AuthTokens> {
  const userId = verifyRefreshToken(token);
  const tokenHash = hashRefreshToken(token);

  const outcome = await appDataSource.transaction(async (manager) => {
    const user = await lockUser(manager, userId);
    if (!user) return { type: "invalid" } as const;

    const repository = manager.getRepository(RefreshToken);
    const storedToken = await repository.findOne({
      where: { token_hash: tokenHash },
      lock: { mode: "pessimistic_write" },
    });
    if (!storedToken || storedToken.user_id !== userId) return { type: "invalid" } as const;

    if (storedToken.revoked_at) {
      await revokeActiveRefreshTokens(manager, userId);
      return { type: "reused" } as const;
    }
    if (storedToken.expires_at.getTime() <= Date.now()) return { type: "expired" } as const;

    storedToken.revoked_at = new Date();
    await repository.save(storedToken);
    return { type: "success", tokens: await issueTokenPair(manager, userId) } as const;
  });

  if (outcome.type === "invalid") throw new RefreshTokenError("INVALID_REFRESH_TOKEN");
  if (outcome.type === "expired") throw new RefreshTokenError("REFRESH_TOKEN_EXPIRED");
  if (outcome.type === "reused") throw new RefreshTokenError("REFRESH_TOKEN_REUSED");
  return outcome.tokens;
}

export async function logoutUser(userId: number): Promise<void> {
  await appDataSource.transaction(async (manager) => {
    const user = await lockUser(manager, userId);
    if (user) await revokeActiveRefreshTokens(manager, userId);
  });
}
