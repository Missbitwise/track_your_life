import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["password", "DATABASE_URL", "DIRECT_URL", "GEMINI_API_KEY", "req.headers.authorization", "req.headers.cookie"],
    censor: "[REDACTED]",
  },
});
