import { Router } from "express";
import { update } from "../controllers/time-zone.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const userRoutes = Router();

userRoutes.use(authenticate);
userRoutes.patch("/me/time-zone", update);
