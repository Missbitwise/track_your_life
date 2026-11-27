import { Router } from "express";
import { update } from "../controllers/time-zone.controller.js";
import { updateUsername } from "../controllers/friends.controller.js";
import { getCurrentUser } from "../controllers/user.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const userRoutes = Router();

userRoutes.use(authenticate);
userRoutes.get("/me", getCurrentUser);
userRoutes.patch("/me/time-zone", update);
userRoutes.patch("/me/username", updateUsername);
