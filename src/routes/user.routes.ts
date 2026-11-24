import { Router } from "express";
import { update } from "../controllers/time-zone.controller.js";
import { updateUsername } from "../controllers/friends.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const userRoutes = Router();

userRoutes.use(authenticate);
userRoutes.patch("/me/time-zone", update);
userRoutes.patch("/me/username", updateUsername);
