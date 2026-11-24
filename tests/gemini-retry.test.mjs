import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GeminiRequestDeadlineError,
  getGeminiRetryAfterMs,
  isRetryableGeminiError,
  withGeminiRetries,
} from "../dist/services/gemini-retry.js";

test("retries a transient provider failure and succeeds within the request deadline", async () => {
  let calls = 0;
  const delays = [];
  const failures = [];
  const result = await withGeminiRetries(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("temporary"), { status: 503 });
    return "ok";
  }, {
    timeoutMs: 2_000,
    sleep: async (delayMs) => { delays.push(delayMs); },
    onAttemptFailure: (failure) => failures.push(failure),
  });

  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [300]);
  assert.equal(failures[0].willRetry, true);
});

test("retries only transient HTTP statuses", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableGeminiError({ status }), true, `status ${status} should retry`);
  }
  for (const status of [400, 401, 403, 404, 501]) {
    assert.equal(isRetryableGeminiError({ status }), false, `status ${status} should not retry`);
  }
});

test("stops after the initial attempt plus two retries", async () => {
  let calls = 0;
  const error = Object.assign(new Error("unavailable"), { status: 503 });
  await assert.rejects(withGeminiRetries(async () => {
    calls++;
    throw error;
  }, { timeoutMs: 5_000, sleep: async () => undefined }), (actual) => actual === error);
  assert.equal(calls, 3);
});

test("retries 429 using the provider Retry-After delay", async () => {
  let calls = 0;
  const delays = [];
  const result = await withGeminiRetries(async () => {
    calls++;
    if (calls === 1) {
      throw Object.assign(new Error("limited"), {
        status: 429,
        headers: new Headers({ "retry-after": "1" }),
      });
    }
    return "ok";
  }, { timeoutMs: 5_000, sleep: async (delayMs) => { delays.push(delayMs); } });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1_000]);
});

test("does not retry permanent authentication or request errors", async () => {
  for (const status of [400, 401, 403]) {
    let calls = 0;
    const error = Object.assign(new Error("permanent"), { status });
    await assert.rejects(withGeminiRetries(async () => {
      calls++;
      throw error;
    }, { timeoutMs: 5_000, sleep: async () => undefined }), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});

test("honors Retry-After and declines a retry that cannot fit the deadline", async () => {
  const error = Object.assign(new Error("rate limited"), {
    status: 429,
    headers: new Headers({ "retry-after": "3" }),
  });
  assert.equal(getGeminiRetryAfterMs(error), 3_000);
  let calls = 0;
  let slept = false;
  await assert.rejects(withGeminiRetries(async () => {
    calls++;
    throw error;
  }, { timeoutMs: 30, sleep: async () => { slept = true; } }), (actual) => actual === error);
  assert.equal(calls, 1);
  assert.equal(slept, false);
});

test("aborts an in-flight attempt at the overall deadline", async () => {
  let aborted = false;
  await assert.rejects(withGeminiRetries(({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      aborted = true;
      reject(new Error("aborted"));
    }, { once: true });
  }), { timeoutMs: 20 }), GeminiRequestDeadlineError);
  assert.equal(aborted, true);
});
