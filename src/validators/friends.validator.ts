import { z } from "zod";

const idSchema = z.string().uuid();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const usernameSchema = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/);
export const searchFriendsQuery = z.object({ q: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_]+$/) }).strict();
const userId = z.coerce.number().int().min(1).max(2_147_483_647);
export const requestFriendBody = z.object({ receiverId: userId }).strict();
export const requestIdParam = z.object({ id: idSchema }).strict();
export const friendIdParam = z.object({ friendId: userId }).strict();
export const userIdParam = z.object({ userId }).strict();
export const usernameBody = z.object({ username: usernameSchema }).strict();
export const dailyFriendQuery = z.object({ date: calendarDate }).strict();
export const weeklyFriendQuery = z.object({ startDate: calendarDate }).strict();
export const monthlyFriendQuery = z.object({ year: z.coerce.number().int().min(2000).max(9999), month: z.coerce.number().int().min(1).max(12) }).strict();
export const leaderboardQuery = z.object({ period: z.enum(["weekly", "monthly"]) }).strict();
