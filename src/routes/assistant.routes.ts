import { Router } from "express";
import rateLimit from "express-rate-limit";
import { approvePlan, chat, getConversation, listConversations, removeConversation } from "../controllers/assistant.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const assistantRoutes = Router();

assistantRoutes.use(authenticate);
assistantRoutes.use(rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (request) => `user:${request.auth?.userId ?? "unauthenticated"}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Assistant rate limit exceeded. Try again later." },
}));
assistantRoutes.post("/chat", chat);
assistantRoutes.post("/plans/:planId/approve", approvePlan);
assistantRoutes.get("/conversations", listConversations);
assistantRoutes.get("/conversations/:id", getConversation);
assistantRoutes.delete("/conversations/:id", removeConversation);
