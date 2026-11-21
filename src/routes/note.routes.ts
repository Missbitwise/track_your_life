import { Router } from "express";
import { create, getById, list, remove, update } from "../controllers/note.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const noteRoutes = Router();

noteRoutes.use(authenticate);
noteRoutes.post("/", create);
noteRoutes.get("/", list);
noteRoutes.get("/:id", getById);
noteRoutes.patch("/:id", update);
noteRoutes.delete("/:id", remove);
