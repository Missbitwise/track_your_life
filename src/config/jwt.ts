import "dotenv/config";
import { z } from "zod";

const jwtEnvironmentSchema = z.object({
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
}).refine((configuration) => configuration.JWT_ACCESS_SECRET !== configuration.JWT_REFRESH_SECRET);

export interface JwtConfiguration {
  accessSecret: string;
  refreshSecret: string;
}

export function getJwtConfiguration(): JwtConfiguration {
  const result = jwtEnvironmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error("JWT configuration is invalid. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to different secrets of at least 32 characters each.");
  }

  return {
    accessSecret: result.data.JWT_ACCESS_SECRET,
    refreshSecret: result.data.JWT_REFRESH_SECRET,
  };
}

export function validateJwtConfiguration(): void {
  getJwtConfiguration();
}
