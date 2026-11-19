import { Router } from "express";
import { create, getById, list, remove, update } from "../controllers/reminder.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const reminderRoutes = Router();

reminderRoutes.use(authenticate);
reminderRoutes.post("/", create);
reminderRoutes.get("/", list);
reminderRoutes.get("/:id", getById);
reminderRoutes.patch("/:id", update);
reminderRoutes.delete("/:id", remove);
