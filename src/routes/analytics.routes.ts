import { Router } from "express";
import { daily, monthly, weekly } from "../controllers/analytics.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

export const analyticsRoutes = Router();

analyticsRoutes.use(authenticate);
analyticsRoutes.get("/productivity/daily", daily);
analyticsRoutes.get("/productivity/weekly", weekly);
analyticsRoutes.get("/productivity/monthly", monthly);
