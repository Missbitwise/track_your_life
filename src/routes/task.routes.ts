import { Router } from "express";
import { create, listForDate, remove, update, updateStatus } from "../controllers/task.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const taskRoutes = Router();

taskRoutes.use(authenticate);
taskRoutes.post("/", create);
taskRoutes.get("/", listForDate);
taskRoutes.patch("/:id/status", updateStatus);
taskRoutes.patch("/:id", update);
taskRoutes.delete("/:id", remove);
