import "dotenv/config";
import type { AddressInfo } from "node:net";
import { app, setDatabaseConnected } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { validateJwtConfiguration } from "./config/jwt.js";
import { logger } from "./config/logger.js";

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  logger.fatal("PORT must be an integer between 1 and 65535");
  process.exit(1);
}

function errorMetadata(error: unknown): { name: string; code?: string; databaseCode?: string; detail?: string } {
  if (!(error instanceof Error)) return { name: "UnknownError" };

  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  const message = error.message.toLowerCase();

  let detail: string | undefined;
  if (/can't reach|could not connect|econnrefused|enotfound|ehostunreach|enetunreach/.test(message)
    || ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(code ?? "")) {
    detail = "Unable to reach the configured PostgreSQL endpoint. Check Supabase availability and the connection URL settings.";
  } else if (/authentication failed|password authentication failed|invalid password/.test(message)
    || code === "28P01") {
    detail = "PostgreSQL authentication failed. Check the Supabase username and password.";
  } else if (/timed out|timeout/.test(message) || code === "ETIMEDOUT") {
    detail = "The PostgreSQL connection timed out. Check Supabase availability and network access.";
  } else if (/certificate|tls|ssl/.test(message)) {
    detail = "The secure PostgreSQL connection failed. Check the Supabase connection string and TLS settings.";
  } else if (code === "3D000") {
    detail = "The configured PostgreSQL database was not found. Check the Supabase database URL.";
  } else if (/database_url is not configured/.test(message)) {
    detail = "DATABASE_URL is not configured.";
  } else if (code) {
    detail = "The PostgreSQL connection probe failed. Check the database configuration and provider status.";
  }

  if (!code && !detail) return { name: error.name };

  return {
    name: error.name,
    ...(code ? { code } : {}),
    ...(detail ? { detail } : {}),
  };
}

async function startServer(): Promise<void> {
  try {
    validateJwtConfiguration();
  } catch {
    logger.fatal("JWT configuration is invalid; set separate JWT_ACCESS_SECRET and JWT_REFRESH_SECRET values before starting the server");
    process.exitCode = 1;
    return;
  }

  try {
    await connectDatabase();
    setDatabaseConnected(true);
    logger.info("PostgreSQL connection established");
  } catch (error) {
    logger.fatal({ error: errorMetadata(error) }, "PostgreSQL connection failed; server will not start");
    await disconnectDatabase().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  const server = app.listen(port);
  let shuttingDown = false;

  server.on("listening", () => {
    const address = server.address() as AddressInfo;
    logger.info({ port: address.port }, "Express server started");
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    logger.fatal({ code: error.code }, "HTTP server failed to start");
    process.exitCode = 1;
    void disconnectDatabase().catch(() => undefined);
  });

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");
    setDatabaseConnected(false);

    server.close(async (error) => {
      if (error) {
        logger.error({ error: errorMetadata(error) }, "HTTP server close failed");
        process.exitCode = 1;
      }

      try {
        await disconnectDatabase();
        logger.info("Database connections closed");
      } catch (disconnectError) {
        logger.error({ error: errorMetadata(disconnectError) }, "Database shutdown failed");
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void startServer().catch((error: unknown) => {
  logger.fatal({ error: errorMetadata(error) }, "Backend startup failed");
  process.exitCode = 1;
});
