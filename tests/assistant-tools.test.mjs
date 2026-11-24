import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantFunctionDeclarations, validateAssistantToolArguments } from "../dist/services/assistant-tools.service.js";
import { classifyGeminiProviderFailure } from "../dist/services/assistant.service.js";

const names = [
  "get_productivity_report",
  "get_incomplete_tasks",
  "get_task_postponements",
  "get_routine_patterns",
  "get_schedule_context",
];

test("assistant exposes only the five approved read-only productivity tools", () => {
  assert.deepEqual(assistantFunctionDeclarations.map((tool) => tool.name), names);
});

test("Gemini provider failures map rate limits and timeout errors without exposing provider details", () => {
  assert.equal(classifyGeminiProviderFailure({ status: 429 }), "rate_limited");
  assert.equal(classifyGeminiProviderFailure({ code: "RESOURCE_EXHAUSTED" }), "rate_limited");
  assert.equal(classifyGeminiProviderFailure({ name: "RequestTimeoutError" }), "timeout");
  assert.equal(classifyGeminiProviderFailure({ code: "ETIMEDOUT" }), "timeout");
  assert.equal(classifyGeminiProviderFailure(new Error("provider internal detail")), "unavailable");
});

test("tool argument validation rejects malformed dates, oversized ranges, and extra identity fields", () => {
  assert.equal(validateAssistantToolArguments("get_productivity_report", { period: "daily", date: "2026-11-22" }), true);
  assert.equal(validateAssistantToolArguments("get_productivity_report", { period: "daily", date: "2026-02-30" }), false);
  assert.equal(validateAssistantToolArguments("get_productivity_report", { period: "daily", date: "2026-11-22", userId: 7 }), false);
  assert.equal(validateAssistantToolArguments("get_incomplete_tasks", {
    startDate: "2026-01-01", endDate: "2026-02-01", limit: 10,
  }), false);
  assert.equal(validateAssistantToolArguments("get_task_postponements", {
    startDate: "2026-01-01", endDate: "2026-04-01", limit: 10,
  }), false);
  assert.equal(validateAssistantToolArguments("unknown_tool", {}), false);
});
