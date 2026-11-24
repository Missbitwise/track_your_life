import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { IsNull, QueryFailedError, type EntityManager } from "typeorm";
import { appDataSource } from "../config/database.js";
import { FriendRequest } from "../entities/FriendRequest.js";
import { Friendship } from "../entities/Friendship.js";
import { User } from "../entities/User.js";
import { UserBlock } from "../entities/UserBlock.js";
import { UserInvitationLink } from "../entities/UserInvitationLink.js";
import { getDailyProductivity, getMonthlyProductivity, getWeeklyProductivity } from "./analytics.service.js";
import { localDateAt } from "./time-zone.service.js";

export class FriendsError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "FriendsError"; }
}

function encryptionKey(): Buffer {
  const encoded = process.env.INVITATION_LINK_ENCRYPTION_KEY;
  if (!encoded) throw new Error("INVITATION_LINK_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("INVITATION_LINK_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptToken(value: string): string {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Invitation token ciphertext is malformed");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function canonicalPair(left: number, right: number): [number, number] { return left < right ? [left, right] : [right, left]; }
async function lockPair(manager: EntityManager, left: number, right: number): Promise<void> {
  const [low, high] = canonicalPair(left, right);
  await manager.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [low, high]);
}
function publicUser(user: Pick<User, "id" | "username" | "first_name" | "last_name">) {
  return { id: user.id, username: user.username, first_name: user.first_name, last_name: user.last_name };
}
function canonicalFriendship(userId: number, friendId: number) {
  const [user_id, friend_id] = canonicalPair(userId, friendId);
  return { id: randomUUID(), user_id, friend_id };
}
function socialErrorFromUnique(error: unknown): never {
  if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === "23505") {
    throw new FriendsError(409, "A matching social relationship already exists");
  }
  throw error;
}

export async function setUsername(userId: number, username: string) {
  try {
    const repository = appDataSource.getRepository(User);
    const user = await repository.findOneBy({ id: userId });
    if (!user) throw new FriendsError(404, "User not found");
    user.username = username;
    await repository.save(user);
    return { id: user.id, username: user.username };
  } catch (error) {
    if (error instanceof QueryFailedError && (error.driverError as { constraint?: string }).constraint === "uq_users_username_lower") {
      throw new FriendsError(409, "This username is already in use");
    }
    socialErrorFromUnique(error);
  }
}

export async function searchUsers(userId: number, query: string) {
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  return appDataSource.getRepository(User).createQueryBuilder("candidate")
    .select(["candidate.id", "candidate.username", "candidate.first_name", "candidate.last_name"])
    .where("candidate.id <> :userId", { userId })
    .andWhere("candidate.username ILIKE :query ESCAPE E'\\\\'", { query: `%${escaped}%` })
    .andWhere(`NOT EXISTS (SELECT 1 FROM friendships f WHERE (f.user_id = :userId AND f.friend_id = candidate.id) OR (f.friend_id = :userId AND f.user_id = candidate.id))`)
    .andWhere(`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = :userId AND b.blocked_user_id = candidate.id) OR (b.blocked_user_id = :userId AND b.blocker_id = candidate.id))`)
    .andWhere(`NOT EXISTS (SELECT 1 FROM friend_requests r WHERE r.status = 'pending' AND ((r.sender_id = :userId AND r.receiver_id = candidate.id) OR (r.receiver_id = :userId AND r.sender_id = candidate.id)))`)
    .orderBy("LOWER(candidate.username)", "ASC").addOrderBy("candidate.id", "ASC").take(25).getMany()
    .then((users) => users.map(publicUser));
}

export async function getInvitationLink(userId: number) {
  return appDataSource.transaction(async (manager) => {
    const user = await manager.getRepository(User).findOne({ where: { id: userId }, lock: { mode: "pessimistic_write" } });
    if (!user) throw new FriendsError(404, "User not found");
    const repo = manager.getRepository(UserInvitationLink);
    const existing = await repo.findOne({ where: { user_id: userId }, lock: { mode: "pessimistic_write" } });
    if (existing && !existing.revoked_at) {
      const token = decryptToken(existing.encrypted_token);
      return { invitationLink: `${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/invite/${token}` };
    }
    const token = randomBytes(32).toString("base64url");
    if (existing) {
      await repo.createQueryBuilder().update().set({
        token_hash: tokenHash(token), encrypted_token: encryptToken(token), revoked_at: null, created_at: () => "CURRENT_TIMESTAMP",
      }).where('"id" = :id', { id: existing.id }).execute();
    } else {
      await repo.save(repo.create({ id: randomUUID(), user_id: userId, token_hash: tokenHash(token), encrypted_token: encryptToken(token), revoked_at: null }));
    }
    return { invitationLink: `${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/invite/${token}` };
  });
}

export async function revokeInvitationLink(userId: number): Promise<void> {
  await appDataSource.transaction(async (manager) => {
    await manager.getRepository(User).findOne({ where: { id: userId }, lock: { mode: "pessimistic_write" } });
    await manager.getRepository(UserInvitationLink).createQueryBuilder().update()
      .set({ revoked_at: () => "CURRENT_TIMESTAMP" }).where('"user_id" = :userId AND "revoked_at" IS NULL', { userId }).execute();
  });
}

export async function validateInvitation(token: string, currentUserId: number) {
  const link = await appDataSource.getRepository(UserInvitationLink).findOne({
    where: { token_hash: tokenHash(token), revoked_at: IsNull() }, relations: { user: true },
  });
  if (!link) throw new FriendsError(404, "Invitation link is invalid or revoked");
  if (link.user_id === currentUserId) throw new FriendsError(400, "You cannot use your own invitation link");
  const inviter = link.user;
  return { inviter: publicUser(inviter), canSendRequest: true };
}

export async function sendFriendRequest(senderId: number, receiverId: number) {
  if (senderId === receiverId) throw new FriendsError(400, "You cannot send a friend request to yourself");
  try {
    return await appDataSource.transaction(async (manager) => {
      await lockPair(manager, senderId, receiverId);
      const users = await manager.getRepository(User).findBy([{ id: senderId }, { id: receiverId }]);
      if (users.length !== 2) throw new FriendsError(404, "User not found");
      const [low, high] = canonicalPair(senderId, receiverId);
      if (await manager.getRepository(Friendship).exist({ where: { user_id: low, friend_id: high } })) throw new FriendsError(409, "You are already friends");
      const blockExists = await manager.getRepository(UserBlock).createQueryBuilder("block")
        .where("(block.blocker_id = :senderId AND block.blocked_user_id = :receiverId) OR (block.blocker_id = :receiverId AND block.blocked_user_id = :senderId)", { senderId, receiverId }).getExists();
      if (blockExists) throw new FriendsError(403, "Friend requests are unavailable for this user");
      const existing = await manager.getRepository(FriendRequest).createQueryBuilder("r")
        .where("r.status = 'pending' AND ((r.sender_id = :senderId AND r.receiver_id = :receiverId) OR (r.sender_id = :receiverId AND r.receiver_id = :senderId))", { senderId, receiverId }).getOne();
      if (existing) throw new FriendsError(409, "A pending request already exists",);
      const request = manager.getRepository(FriendRequest).create({ id: randomUUID(), sender_id: senderId, receiver_id: receiverId, status: "pending", responded_at: null });
      await manager.getRepository(FriendRequest).save(request);
      return { id: request.id, senderId, receiverId, status: request.status, createdAt: request.created_at };
    });
  } catch (error) { socialErrorFromUnique(error); }
}

export async function listFriendRequests(userId: number, direction: "received" | "sent") {
  const field = direction === "received" ? "receiver_id" : "sender_id";
  const other = direction === "received" ? "sender" : "receiver";
  const rows = await appDataSource.getRepository(FriendRequest).createQueryBuilder("request")
    .leftJoinAndSelect(`request.${other}`, "otherUser")
    .where(`request.${field} = :userId AND request.status = 'pending'`, { userId })
    .orderBy("request.created_at", "DESC").addOrderBy("request.id", "DESC").getMany();
  return rows.map((request) => ({ id: request.id, status: request.status, createdAt: request.created_at, user: publicUser(request[other]) }));
}

export async function respondToRequest(userId: number, requestId: string, action: "accept" | "reject" | "cancel") {
  return appDataSource.transaction(async (manager) => {
    const initial = await manager.getRepository(FriendRequest).findOneBy({ id: requestId });
    if (!initial || initial.status !== "pending") throw new FriendsError(404, "Pending friend request not found");
    await lockPair(manager, initial.sender_id, initial.receiver_id);
    const request = await manager.getRepository(FriendRequest).findOne({ where: { id: requestId }, lock: { mode: "pessimistic_write" } });
    if (!request || request.status !== "pending") throw new FriendsError(404, "Pending friend request not found");
    const expectedOwner = action === "cancel" ? request.sender_id : request.receiver_id;
    if (expectedOwner !== userId) throw new FriendsError(403, "You cannot modify this friend request");
    if (action === "accept") {
      const blocked = await manager.getRepository(UserBlock).createQueryBuilder("b")
        .where("(b.blocker_id = :a AND b.blocked_user_id = :b) OR (b.blocker_id = :b AND b.blocked_user_id = :a)", { a: request.sender_id, b: request.receiver_id }).getExists();
      if (blocked) throw new FriendsError(403, "This request cannot be accepted");
      await manager.query(`UPDATE friend_requests SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'pending'`, [request.id]);
      const updated = await manager.getRepository(FriendRequest).findOneBy({ id: request.id });
      if (!updated || updated.status !== "accepted") throw new FriendsError(409, "Friend request is no longer pending");
      const pair = canonicalFriendship(request.sender_id, request.receiver_id);
      await manager.getRepository(Friendship).insert(pair);
      return { id: updated.id, status: updated.status, respondedAt: updated.responded_at };
    } else {
      const status = action === "reject" ? "rejected" : "cancelled";
      await manager.query(`UPDATE friend_requests SET status = $1, responded_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND status = 'pending'`, [status, request.id]);
      const updated = await manager.getRepository(FriendRequest).findOneBy({ id: request.id });
      if (!updated || updated.status !== status) throw new FriendsError(409, "Friend request is no longer pending");
      return { id: updated.id, status: updated.status, respondedAt: updated.responded_at };
    }
  });
}

export async function listFriends(userId: number) {
  const rows = await appDataSource.query(`SELECT u.id, u.username, u.first_name, u.last_name, f.created_at AS friendship_created_at
    FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
    WHERE f.user_id = $1 OR f.friend_id = $1 ORDER BY LOWER(u.username) NULLS LAST, u.id`, [userId]) as Array<User & { friendship_created_at: Date }>;
  return rows.map((row) => ({ ...publicUser(row), friendshipCreatedAt: row.friendship_created_at }));
}

export async function removeFriend(userId: number, friendId: number): Promise<void> {
  if (friendId === userId) throw new FriendsError(400, "Invalid friend ID");
  await appDataSource.transaction(async (manager) => {
    await lockPair(manager, userId, friendId);
    const [low, high] = canonicalPair(userId, friendId);
    const result = await manager.getRepository(Friendship).delete({ user_id: low, friend_id: high });
    if (!result.affected) throw new FriendsError(404, "Friendship not found");
  });
}

export async function blockUser(blockerId: number, blockedId: number): Promise<void> {
  if (blockerId === blockedId) throw new FriendsError(400, "You cannot block yourself");
  await appDataSource.transaction(async (manager) => {
    await lockPair(manager, blockerId, blockedId);
    if (!await manager.getRepository(User).exist({ where: { id: blockedId } })) throw new FriendsError(404, "User not found");
    await manager.getRepository(UserBlock).createQueryBuilder().insert().values({ id: randomUUID(), blocker_id: blockerId, blocked_user_id: blockedId }).orIgnore().execute();
    const [low, high] = canonicalPair(blockerId, blockedId);
    await manager.getRepository(Friendship).delete({ user_id: low, friend_id: high });
    await manager.getRepository(FriendRequest).createQueryBuilder().update()
      .set({ status: "cancelled", responded_at: () => "CURRENT_TIMESTAMP" })
      .where('"status" = \'pending\' AND (("sender_id" = :a AND "receiver_id" = :b) OR ("sender_id" = :b AND "receiver_id" = :a))', { a: blockerId, b: blockedId }).execute();
  });
}

export async function unblockUser(blockerId: number, blockedId: number): Promise<void> {
  const result = await appDataSource.getRepository(UserBlock).delete({ blocker_id: blockerId, blocked_user_id: blockedId });
  if (!result.affected) throw new FriendsError(404, "Block not found");
}

export async function listBlockedUsers(userId: number) {
  const rows = await appDataSource.getRepository(UserBlock).find({ where: { blocker_id: userId }, relations: { blocked_user: true }, order: { created_at: "DESC" } });
  return rows.map((row) => ({ ...publicUser(row.blocked_user), blockedAt: row.created_at }));
}

async function authorizeFriendship(manager: EntityManager, userId: number, friendId: number): Promise<void> {
  if (userId === friendId) throw new FriendsError(400, "Friend ID is invalid");
  const [low, high] = canonicalPair(userId, friendId);
  const rows = await manager.query("SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2", [low, high]) as unknown[];
  if (rows.length === 0) throw new FriendsError(404, "Friend not found");
}

function dailyAggregate(report: Awaited<ReturnType<typeof getDailyProductivity>>) {
  const stats = report.scheduledProductivity;
  return {
    date: report.date,
    scheduledProductivity: stats ? {
      totalTasks: stats.totalTasks, completedTasks: stats.completedTasks,
      incompleteTasks: stats.incompleteTasks, completionPercentage: stats.completionPercentage,
    } : null,
    actualCompletionActivity: {
      completedTasks: report.actualCompletionActivity.completedTasks.length,
      lateCompletions: report.actualCompletionActivity.lateCompletions.length,
      reopenedTasks: report.actualCompletionActivity.reopenedTasks.length,
    },
    coverage: report.coverage,
  };
}

function dateOffset(date: string, offset: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

function completedDayStreak(reports: Array<{ scheduledProductivity: { completedTasks: number } | null }>): number {
  let streak = 0;
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    const stats = reports[index]?.scheduledProductivity;
    if (!stats) continue;
    if (stats.completedTasks === 0) break;
    streak += 1;
  }
  return streak;
}

export async function getFriendDailyProductivity(userId: number, friendId: number, date: string) {
  const report = await getDailyProductivity(friendId, date, (manager) => authorizeFriendship(manager, userId, friendId));
  const streakStart = dateOffset(date, -6);
  const trailing = await getWeeklyProductivity(friendId, streakStart, (manager) => authorizeFriendship(manager, userId, friendId));
  return { ...dailyAggregate(report), productivityStreak: completedDayStreak(trailing.daily) };
}
export async function getFriendWeeklyProductivity(userId: number, friendId: number, startDate: string): Promise<Record<string, unknown>> {
  const report = await getWeeklyProductivity(friendId, startDate, (manager) => authorizeFriendship(manager, userId, friendId));
  return { startDate: report.startDate, endDate: report.endDate, totals: report.totals, coverage: report.coverage,
    productivityStreak: completedDayStreak(report.daily),
    daily: report.daily.map(dailyAggregate), mostProductiveDay: report.mostProductiveDay, leastProductiveDay: report.leastProductiveDay, comparison: report.comparison };
}
export async function getFriendMonthlyProductivity(userId: number, friendId: number, year: number, month: number): Promise<Record<string, unknown>> {
  const report = await getMonthlyProductivity(friendId, year, month, (manager) => authorizeFriendship(manager, userId, friendId));
  return { year: report.year, month: report.month, startDate: report.startDate, endDate: report.endDate, totals: report.totals, coverage: report.coverage,
    productivityStreak: completedDayStreak(report.daily),
    daily: report.daily.map(dailyAggregate), mostProductiveDay: report.mostProductiveDay, leastProductiveDay: report.leastProductiveDay, comparison: report.comparison };
}

export async function getFriendsLeaderboard(userId: number, period: "weekly" | "monthly") {
  const friends = await listFriends(userId);
  const [self] = await appDataSource.query(`SELECT u.username, u.time_zone, transaction_timestamp() AS now
    FROM users u WHERE u.id = $1`, [userId]) as Array<{ username: string | null; time_zone: string; now: Date }>;
  if (!self) throw new FriendsError(404, "User not found");
  const participants = [{ id: userId, username: self.username }, ...friends.map(({ id, username }) => ({ id, username }))]
    .filter((participant) => participant.username !== null);
  const nowDate = localDateAt(self.now, self.time_zone);
  const startDate = period === "weekly"
    ? (() => { const date = new Date(`${nowDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return date.toISOString().slice(0, 10); })()
    : `${nowDate.slice(0, 7)}-01`;
  const reports = await Promise.all(participants.map(async (participant) => {
    const result = period === "weekly"
      ? await getWeeklyProductivity(participant.id, startDate)
      : await getMonthlyProductivity(participant.id, Number(nowDate.slice(0, 4)), Number(nowDate.slice(5, 7)));
    const total = result.totals;
    if (!result.coverage.fullyCovered || total.completionPercentage === null) return null;
    const streak = completedDayStreak(result.daily);
    return { id: participant.id, username: participant.username, productivityPercentage: total.completionPercentage,
      completedTaskCount: total.completedTasks ?? 0, productivityStreak: streak };
  }));
  return reports.filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.productivityPercentage - a.productivityPercentage || b.completedTaskCount - a.completedTaskCount || (a.username ?? "").localeCompare(b.username ?? "") || a.id - b.id)
    .map((row, index) => ({ rank: index + 1, username: row.username, productivityPercentage: row.productivityPercentage,
      completedTaskCount: row.completedTaskCount, productivityStreak: row.productivityStreak }));
}
