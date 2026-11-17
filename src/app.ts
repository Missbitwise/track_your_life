import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { logger } from "./config/logger.js";
import { authRoutes } from "./routes/auth.routes.js";
import { routineRoutes } from "./routes/routine.routes.js";
import { taskRoutes } from "./routes/task.routes.js";

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
      url: request.url?.split("?", 1)[0],
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
app.use("/api/routines", routineRoutes);
app.use("/api/tasks", taskRoutes);

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled request error");
  response.status(500).json({ error: "Internal server error" });
});
