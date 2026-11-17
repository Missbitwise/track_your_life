import { Router } from "express";
import { create, getById, list, remove, update } from "../controllers/routine.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const routineRoutes = Router();

routineRoutes.use(authenticate);
routineRoutes.post("/", create);
routineRoutes.get("/", list);
routineRoutes.get("/:id", getById);
routineRoutes.patch("/:id", update);
routineRoutes.delete("/:id", remove);
