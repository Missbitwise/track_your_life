import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { app } from "../dist/app.js";
import { appDataSource } from "../dist/config/database.js";
import { AssistantConversation } from "../dist/entities/AssistantConversation.js";
import { AssistantMessage } from "../dist/entities/AssistantMessage.js";
import { User } from "../dist/entities/User.js";
import {
  AssistantConversationNotFoundError,
  deleteAssistantConversation,
  getAssistantConversation,
  listAssistantConversations,
  persistAssistantExchange,
} from "../dist/services/assistant.service.js";

test("assistant conversations persist messages, scope ownership, retrieve history, and cascade on deletion", async (context) => {
  if (process.env.RUN_DB_INTEGRATION !== "1") {
    context.skip("Set RUN_DB_INTEGRATION=1 to run database-backed assistant tests");
    return;
  }

  const createdUserIds = [];
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET;
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  let server;
  try {
    if (!appDataSource.isInitialized) await appDataSource.initialize();
    process.env.JWT_ACCESS_SECRET = "assistant-integration-access-secret-at-least-32-characters";
    process.env.JWT_REFRESH_SECRET = "assistant-integration-refresh-secret-at-least-32-characters";
    const users = appDataSource.getRepository(User);
    const owner = await users.save(users.create({
      email: `assistant-owner-${randomUUID()}@example.test`,
      password_hash: "integration-test-only-hash",
      first_name: "Assistant",
      last_name: "Test",
    }));
    createdUserIds.push(owner.id);
    const other = await users.save(users.create({
      email: `assistant-other-${randomUUID()}@example.test`,
      password_hash: "integration-test-only-hash",
      first_name: "Other",
      last_name: "Test",
    }));
    createdUserIds.push(other.id);

    const conversationId = randomUUID();
    const saved = await persistAssistantExchange(owner.id, conversationId, "synthetic question", "synthetic answer");
    assert.equal(saved.conversationId, conversationId);
    assert.equal(saved.message, "synthetic answer");

    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}/api/assistant`;
    const ownerToken = jwt.sign({ sub: String(owner.id) }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const otherToken = jwt.sign({ sub: String(other.id) }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const api = (token, path, init = {}) => fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });

    const ownerList = await listAssistantConversations(owner.id, 1, 10);
    const otherList = await listAssistantConversations(other.id, 1, 10);
    assert.equal(ownerList.conversations.some((conversation) => conversation.id === conversationId), true);
    assert.equal(otherList.conversations.some((conversation) => conversation.id === conversationId), false);

    const history = await getAssistantConversation(owner.id, conversationId, 10);
    assert.deepEqual(history.messages.map((message) => [message.role, message.content]), [
      ["user", "synthetic question"],
      ["assistant", "synthetic answer"],
    ]);
    await assert.rejects(getAssistantConversation(other.id, conversationId, 10), AssistantConversationNotFoundError);
    assert.equal(await deleteAssistantConversation(other.id, conversationId), false);

    const listResponse = await api(ownerToken, "/conversations");
    assert.equal(listResponse.status, 200);
    assert.equal((await listResponse.json()).conversations.some((conversation) => conversation.id === conversationId), true);
    const historyResponse = await api(ownerToken, `/conversations/${conversationId}`);
    assert.equal(historyResponse.status, 200);
    assert.equal((await historyResponse.json()).messages.length, 2);
    assert.equal((await api(otherToken, `/conversations/${conversationId}`)).status, 404);
    assert.equal((await api(otherToken, `/conversations/${conversationId}`, { method: "DELETE" })).status, 404);

    delete process.env.GEMINI_API_KEY;
    const unavailableResponse = await api(ownerToken, "/chat", {
      method: "POST",
      body: JSON.stringify({ message: "synthetic integration prompt" }),
    });
    assert.equal(unavailableResponse.status, 503);
    assert.deepEqual(await unavailableResponse.json(), { error: "AI assistant is not configured" });
    assert.equal((await listAssistantConversations(owner.id, 1, 10)).pagination.total, 1);

    const messageCount = await appDataSource.getRepository(AssistantMessage).count({ where: { conversation_id: conversationId } });
    assert.equal(messageCount, 2);
    assert.equal((await api(otherToken, `/conversations/${conversationId}`, { method: "DELETE" })).status, 404);
    assert.equal((await api(ownerToken, `/conversations/${conversationId}`, { method: "DELETE" })).status, 204);
    assert.equal(await appDataSource.getRepository(AssistantConversation).exist({ where: { id: conversationId } }), false);
    assert.equal(await appDataSource.getRepository(AssistantMessage).count({ where: { conversation_id: conversationId } }), 0);

    for (let requestNumber = 0; requestNumber < 16; requestNumber++) {
      assert.equal((await api(ownerToken, "/conversations")).status, 200);
    }
    assert.equal((await api(ownerToken, "/conversations")).status, 429);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (originalAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalAccessSecret;
    if (originalRefreshSecret === undefined) delete process.env.JWT_REFRESH_SECRET;
    else process.env.JWT_REFRESH_SECRET = originalRefreshSecret;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (appDataSource.isInitialized) {
      if (createdUserIds.length > 0) await appDataSource.getRepository(User).delete(createdUserIds);
      await appDataSource.destroy();
    }
  }
});
