import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dailyFriendQuery,
  leaderboardQuery,
  monthlyFriendQuery,
  requestFriendBody,
  searchFriendsQuery,
  usernameBody,
} from "../dist/validators/friends.validator.js";

test("Friends validators enforce usernames, numeric IDs, real calendar dates and supported leaderboard periods", () => {
  assert.equal(searchFriendsQuery.safeParse({ q: "alex" }).success, true);
  assert.equal(searchFriendsQuery.safeParse({ q: "a" }).success, false);
  assert.equal(searchFriendsQuery.safeParse({ q: "a%" }).success, false);
  assert.equal(usernameBody.safeParse({ username: "valid_name9" }).success, true);
  assert.equal(usernameBody.safeParse({ username: "ab" }).success, false);
  assert.equal(requestFriendBody.safeParse({ receiverId: 5 }).success, true);
  assert.equal(requestFriendBody.safeParse({ receiverId: 0 }).success, false);
  assert.equal(requestFriendBody.safeParse({ receiverId: 2_147_483_648 }).success, false);
  assert.equal(dailyFriendQuery.safeParse({ date: "2026-02-28" }).success, true);
  assert.equal(dailyFriendQuery.safeParse({ date: "2026-02-30" }).success, false);
  assert.equal(monthlyFriendQuery.safeParse({ year: "2026", month: "12" }).success, true);
  assert.equal(monthlyFriendQuery.safeParse({ year: "2026", month: "13" }).success, false);
  assert.equal(leaderboardQuery.safeParse({ period: "weekly" }).success, true);
  assert.equal(leaderboardQuery.safeParse({ period: "daily" }).success, false);
});
