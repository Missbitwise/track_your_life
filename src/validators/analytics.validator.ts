import { z } from "zod";

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return year >= 1000 && year <= 9998
      && parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }, "Date must be a valid calendar date");

export const dailyAnalyticsQuerySchema = z.object({
  date: dateSchema,
}).strict();

export const weeklyAnalyticsQuerySchema = z.object({
  startDate: dateSchema,
}).strict();

export const monthlyAnalyticsQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/, "Year must use YYYY format")
    .transform(Number)
    .pipe(z.number().int().min(1000).max(9998)),
  month: z.string().regex(/^\d{1,2}$/, "Month must be between 1 and 12")
    .transform(Number)
    .pipe(z.number().int().min(1).max(12)),
}).strict();

export type DailyAnalyticsQuery = z.infer<typeof dailyAnalyticsQuerySchema>;
export type WeeklyAnalyticsQuery = z.infer<typeof weeklyAnalyticsQuerySchema>;
export type MonthlyAnalyticsQuery = z.infer<typeof monthlyAnalyticsQuerySchema>;
