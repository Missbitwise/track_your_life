import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { test } from "node:test";

process.env.JWT_ACCESS_SECRET = "auth-regression-access-secret-at-least-32-characters";
process.env.JWT_REFRESH_SECRET = "auth-regression-refresh-secret-at-least-32-characters";

const [{ appDataSource }, { User }, { RefreshToken }, auth] = await Promise.all([
  import("../dist/config/database.js"), import("../dist/entities/User.js"), import("../dist/entities/RefreshToken.js"),
  import("../dist/services/auth.service.js"),
]);

test("existing password login, refresh rotation, and logout revocation still work", async () => {
  const user = {
    id: 734, email: "existing-password@example.test", username: null, first_name: "Existing", last_name: "User",
    password_hash: await bcrypt.hash("password-for-test", 4), created_at: new Date(),
  };
  const stored = [];
  const userRepo = { findOne: async ({ where }) => where.id === user.id || where.email === user.email ? user : null };
  const refreshRepo = {
    create: (record) => record,
    save: async (record) => { if (!stored.includes(record)) stored.push(record); return record; },
    findOne: async ({ where }) => stored.find((record) => record.token_hash === where.token_hash) ?? null,
    createQueryBuilder: () => ({
      update: () => ({ set: () => ({ where: () => ({ execute: async () => {
        for (const record of stored) if (record.user_id === user.id && !record.revoked_at) record.revoked_at = new Date();
        return { affected: stored.length };
      } }) }) }),
    }),
  };
  const manager = {
    getRepository(entity) {
      if (entity === User) return userRepo;
      if (entity === RefreshToken) return refreshRepo;
      throw new Error(`Unexpected repository ${entity.name}`);
    },
  };
  const originalGet = appDataSource.getRepository;
  const originalTransaction = appDataSource.transaction;
  appDataSource.getRepository = (entity) => entity === User ? userRepo : (() => { throw new Error(`Unexpected repository ${entity.name}`); })();
  appDataSource.transaction = async (operation) => operation(manager);
  try {
    const login = await auth.loginUser({ email: user.email, password: "password-for-test" });
    assert.ok(login);
    assert.equal(login.user.id, user.id);
    assert.equal(stored.length, 1);
    const firstRefresh = login.refreshToken;

    const rotated = await auth.rotateRefreshToken(firstRefresh);
    assert.notEqual(rotated.refreshToken, firstRefresh);
    assert.ok(stored[0].revoked_at);
    assert.equal(stored.length, 2);

    await auth.logoutUser(user.id);
    assert.ok(stored.every((record) => record.revoked_at));
  } finally {
    appDataSource.getRepository = originalGet;
    appDataSource.transaction = originalTransaction;
  }
});
