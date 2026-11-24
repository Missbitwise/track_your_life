import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { logger } from "./config/logger.js";
import { authRoutes } from "./routes/auth.routes.js";
import { friendsRoutes } from "./routes/friends.routes.js";
import { assistantRoutes } from "./routes/assistant.routes.js";
import { analyticsRoutes } from "./routes/analytics.routes.js";
import { noteRoutes } from "./routes/note.routes.js";
import { reminderRoutes } from "./routes/reminder.routes.js";
import { routineRoutes } from "./routes/routine.routes.js";
import { taskRoutes } from "./routes/task.routes.js";
import { userRoutes } from "./routes/user.routes.js";

export const app = express();
let databaseConnected = false;

export const setDatabaseConnected = (connected: boolean) => {
  databaseConnected = connected;
};

app.disable("x-powered-by");
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({
  logger,
  serializers: {
    req: (request: import("node:http").IncomingMessage) => ({
      method: request.method,
      // Query strings can contain tokens or other secrets.
      url: request.url?.split("?", 1)[0]?.replace(/(\/api\/friends\/invitation\/)[^/]+/, "$1[redacted]"),
    }),
  },
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 }));

app.get("/health", (_request, response) => {
  const status = databaseConnected ? "ok" : "unavailable";
  response.status(databaseConnected ? 200 : 503).json({
    status,
    server: "up",
    database: databaseConnected ? "connected" : "disconnected",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/friends", friendsRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/routines", routineRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/users", userRoutes);

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

function safeErrorMetadata(error: unknown): Record<string, string> {
  if (typeof error !== "object" || error === null) return { name: "UnknownError" };

  const metadata: Record<string, string> = {
    name: error instanceof Error ? error.name : "UnknownError",
  };
  if ("code" in error && typeof error.code === "string") metadata.code = error.code;

  if ("driverError" in error && typeof error.driverError === "object" && error.driverError !== null) {
    const driverError = error.driverError as Record<string, unknown>;
    for (const field of ["code", "constraint", "table", "column", "schema"] as const) {
      if (field in driverError && typeof driverError[field] === "string") {
        metadata[`database${field[0].toUpperCase()}${field.slice(1)}`] = driverError[field];
      }
    }
  }

  return metadata;
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ error: safeErrorMetadata(error) }, "Unhandled request error");
  response.status(500).json({ error: "Internal server error" });
});
