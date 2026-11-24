import type { NextFunction, Request, Response } from "express";
import { AnalyticsHistoryUnavailableError, AnalyticsUserNotFoundError } from "../services/analytics.service.js";
import * as service from "../services/friends.service.js";
import {
  dailyFriendQuery, friendIdParam, leaderboardQuery, monthlyFriendQuery, requestFriendBody,
  requestIdParam, searchFriendsQuery, userIdParam, usernameBody, weeklyFriendQuery,
} from "../validators/friends.validator.js";

function userId(request: Request): number { return request.auth!.userId; }
function invalid(response: Response, message: string, details?: unknown): void {
  response.status(400).json({ error: message, ...(details ? { details } : {}) });
}
function handle(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof service.FriendsError) { response.status(error.status).json({ error: error.message }); return; }
  if (error instanceof AnalyticsHistoryUnavailableError) { response.status(503).json({ error: error.message }); return; }
  if (error instanceof AnalyticsUserNotFoundError) { response.status(404).json({ error: error.message }); return; }
  next(error);
}

export async function updateUsername(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = usernameBody.safeParse(request.body);
  if (!parsed.success) { invalid(response, "Invalid username", parsed.error.flatten().fieldErrors); return; }
  try { response.status(200).json(await service.setUsername(userId(request), parsed.data.username)); }
  catch (error) { handle(error, response, next); }
}
export async function search(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = searchFriendsQuery.safeParse(request.query);
  if (!parsed.success) { invalid(response, "Invalid username search", parsed.error.flatten().fieldErrors); return; }
  try { response.status(200).json({ users: await service.searchUsers(userId(request), parsed.data.q) }); }
  catch (error) { handle(error, response, next); }
}
export async function invitationLink(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { response.status(200).json(await service.getInvitationLink(userId(request))); }
  catch (error) { handle(error, response, next); }
}
export async function revokeInvitation(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { await service.revokeInvitationLink(userId(request)); response.status(200).json({ message: "Invitation link revoked" }); }
  catch (error) { handle(error, response, next); }
}
export async function invitation(request: Request, response: Response, next: NextFunction): Promise<void> {
  const tokenParam = request.params.token;
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;
  if (!token || token.length > 100) { invalid(response, "Invalid invitation token"); return; }
  try { response.status(200).json(await service.validateInvitation(token, userId(request))); }
  catch (error) { handle(error, response, next); }
}
export async function sendRequest(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = requestFriendBody.safeParse(request.body);
  if (!parsed.success) { invalid(response, "Invalid friend request", parsed.error.flatten().fieldErrors); return; }
  try { response.status(201).json(await service.sendFriendRequest(userId(request), parsed.data.receiverId)); }
  catch (error) { handle(error, response, next); }
}
export async function receivedRequests(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { response.status(200).json({ requests: await service.listFriendRequests(userId(request), "received") }); }
  catch (error) { handle(error, response, next); }
}
export async function sentRequests(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { response.status(200).json({ requests: await service.listFriendRequests(userId(request), "sent") }); }
  catch (error) { handle(error, response, next); }
}
async function respond(request: Request, response: Response, next: NextFunction, action: "accept" | "reject" | "cancel"): Promise<void> {
  const parsed = requestIdParam.safeParse(request.params);
  if (!parsed.success) { invalid(response, "Invalid friend request ID"); return; }
  try { response.status(200).json(await service.respondToRequest(userId(request), parsed.data.id, action)); }
  catch (error) { handle(error, response, next); }
}
export function acceptRequest(request: Request, response: Response, next: NextFunction): Promise<void> { return respond(request, response, next, "accept"); }
export function rejectRequest(request: Request, response: Response, next: NextFunction): Promise<void> { return respond(request, response, next, "reject"); }
export function cancelRequest(request: Request, response: Response, next: NextFunction): Promise<void> { return respond(request, response, next, "cancel"); }
export async function friends(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { response.status(200).json({ friends: await service.listFriends(userId(request)) }); }
  catch (error) { handle(error, response, next); }
}
export async function removeFriend(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = friendIdParam.safeParse(request.params);
  if (!parsed.success) { invalid(response, "Invalid friend ID"); return; }
  try { await service.removeFriend(userId(request), parsed.data.friendId); response.status(200).json({ message: "Friend removed" }); }
  catch (error) { handle(error, response, next); }
}
export async function block(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = userIdParam.safeParse(request.params);
  if (!parsed.success) { invalid(response, "Invalid user ID"); return; }
  try { await service.blockUser(userId(request), parsed.data.userId); response.status(201).json({ message: "User blocked" }); }
  catch (error) { handle(error, response, next); }
}
export async function unblock(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = userIdParam.safeParse(request.params);
  if (!parsed.success) { invalid(response, "Invalid user ID"); return; }
  try { await service.unblockUser(userId(request), parsed.data.userId); response.status(200).json({ message: "User unblocked" }); }
  catch (error) { handle(error, response, next); }
}
export async function blocked(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { response.status(200).json({ users: await service.listBlockedUsers(userId(request)) }); }
  catch (error) { handle(error, response, next); }
}
export async function friendDaily(request: Request, response: Response, next: NextFunction): Promise<void> {
  const id = friendIdParam.safeParse(request.params); const query = dailyFriendQuery.safeParse(request.query);
  if (!id.success || !query.success) { invalid(response, "Invalid daily productivity query"); return; }
  try { response.status(200).json(await service.getFriendDailyProductivity(userId(request), id.data.friendId, query.data.date)); }
  catch (error) { handle(error, response, next); }
}
export async function friendWeekly(request: Request, response: Response, next: NextFunction): Promise<void> {
  const id = friendIdParam.safeParse(request.params); const query = weeklyFriendQuery.safeParse(request.query);
  if (!id.success || !query.success) { invalid(response, "Invalid weekly productivity query"); return; }
  try { response.status(200).json(await service.getFriendWeeklyProductivity(userId(request), id.data.friendId, query.data.startDate)); }
  catch (error) { handle(error, response, next); }
}
export async function friendMonthly(request: Request, response: Response, next: NextFunction): Promise<void> {
  const id = friendIdParam.safeParse(request.params); const query = monthlyFriendQuery.safeParse(request.query);
  if (!id.success || !query.success) { invalid(response, "Invalid monthly productivity query"); return; }
  try { response.status(200).json(await service.getFriendMonthlyProductivity(userId(request), id.data.friendId, query.data.year, query.data.month)); }
  catch (error) { handle(error, response, next); }
}
export async function leaderboard(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = leaderboardQuery.safeParse(request.query);
  if (!parsed.success) { invalid(response, "Invalid leaderboard period"); return; }
  try { response.status(200).json({ period: parsed.data.period, leaderboard: await service.getFriendsLeaderboard(userId(request), parsed.data.period) }); }
  catch (error) { handle(error, response, next); }
}
