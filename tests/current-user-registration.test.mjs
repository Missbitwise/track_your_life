import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { once } from "node:events";

process.env.FRONTEND_ORIGINS = "http://localhost:3001";
process.env.JWT_ACCESS_SECRET = "current-user-test-access-secret-at-least-32-characters";
process.env.JWT_REFRESH_SECRET = "current-user-test-refresh-secret-at-least-32-characters";

const [{ app }, { appDataSource }, { User }, { UserTimeZoneVersion }, { RefreshToken }] = await Promise.all([
  import("../dist/app.js"),
  import("../dist/config/database.js"),
  import("../dist/entities/User.js"),
  import("../dist/entities/UserTimeZoneVersion.js"),
  import("../dist/entities/RefreshToken.js"),
]);

const server = app.listen(0);
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
const apiOrigin = `http://127.0.0.1:${address.port}/api`;

after(async () => {
  server.close();
  await once(server, "close");
});

function mockRegistrationTransaction({ duplicateEmail = null } = {}) {
  const now = new Date("2026-01-02T03:04:05.000Z");
  let savedUser = null;
  const userRepository = {
    findOne: async ({ where }) => duplicateEmail === where.email
      ? { id: 701, email: duplicateEmail, username: null, first_name: "Existing", last_name: null, created_at: now }
      : null,
    create: (fields) => ({ id: 701, ...fields, time_zone: "UTC", created_at: now }),
    save: async (user) => { savedUser = user; return user; },
  };
  const manager = {
    getRepository(entity) {
      if (entity === User) return userRepository;
      if (entity === UserTimeZoneVersion) return { save: async () => undefined };
      if (entity === RefreshToken) return { create: (value) => value, save: async () => undefined };
      throw new Error(`Unexpected repository: ${entity.name}`);
    },
    query: async () => [{ now }],
  };
  const originalTransaction = appDataSource.transaction;
  appDataSource.transaction = async (operation) => operation(manager);
  return {
    restore() { appDataSource.transaction = originalTransaction; },
    savedUser: () => savedUser,
  };
}

test("registration establishes HttpOnly cookies and GET /users/me returns the cookie-authenticated user", async () => {
  const email = `registration-${randomUUID()}@example.test`;
  const transaction = mockRegistrationTransaction();
  try {
    const registration = await fetch(`${apiOrigin}/auth/register`, {
      method: "POST",
      headers: { Origin: "http://localhost:3001", "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "test-password-123", first_name: "New User" }),
    });
    assert.equal(registration.status, 201);
    assert.equal(registration.headers.get("access-control-allow-origin"), "http://localhost:3001");
    assert.equal(registration.headers.get("access-control-allow-credentials"), "true");
    const setCookies = registration.headers.getSetCookie();
    assert.equal(setCookies.length, 2);
    assert.ok(setCookies.some((cookie) => cookie.startsWith("productivity_access=") && /httponly/i.test(cookie)));
    assert.ok(setCookies.some((cookie) => cookie.startsWith("productivity_refresh=") && /httponly/i.test(cookie)));
    const body = await registration.json();
    assert.equal(body.user.email, email);
    assert.equal("accessToken" in body, false);
    assert.equal("refreshToken" in body, false);

    const registeredUser = transaction.savedUser();
    const originalGetRepository = appDataSource.getRepository;
    appDataSource.getRepository = (entity) => {
      if (entity !== User) throw new Error(`Unexpected repository: ${entity.name}`);
      return { findOne: async ({ where }) => where.id === registeredUser.id ? registeredUser : null };
    };
    try {
      const cookieHeader = setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
      const current = await fetch(`${apiOrigin}/users/me`, {
        headers: { Origin: "http://localhost:3001", Cookie: cookieHeader },
      });
      assert.equal(current.status, 200);
      assert.deepEqual(await current.json(), {
        id: registeredUser.id,
        email: registeredUser.email,
        username: null,
        first_name: "New User",
        last_name: null,
        created_at: registeredUser.created_at.toISOString(),
      });
    } finally {
      appDataSource.getRepository = originalGetRepository;
    }
  } finally {
    transaction.restore();
  }
});

test("registration returns a clear 409 for an existing email without writing a user", async () => {
  const email = `existing-${randomUUID()}@example.test`;
  const transaction = mockRegistrationTransaction({ duplicateEmail: email });
  try {
    const response = await fetch(`${apiOrigin}/auth/register`, {
      method: "POST",
      headers: { Origin: "http://localhost:3001", "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "test-password-123", first_name: "Duplicate" }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "An account with this email already exists" });
    assert.equal(transaction.savedUser(), null);
  } finally {
    transaction.restore();
  }
});
