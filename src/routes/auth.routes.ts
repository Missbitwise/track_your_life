import { Router } from "express";
import { google, login, logout, refresh, register } from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const authRoutes = Router();

authRoutes.post("/register", register);
authRoutes.post("/login", login);
authRoutes.post("/google", google);
authRoutes.post("/refresh", refresh);
authRoutes.post("/logout", authenticate, logout);
