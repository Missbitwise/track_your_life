import { Router } from "express";
import { login, logout, refresh, register } from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const authRoutes = Router();

authRoutes.post("/register", register);
authRoutes.post("/login", login);
authRoutes.post("/refresh", refresh);
authRoutes.post("/logout", authenticate, logout);
