import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleGenAI } from "@google/genai";
import { GeminiConfigurationError, getGeminiClient, getGeminiConfiguration } from "../dist/config/gemini.js";

test("Gemini configuration reads the key and configurable model without making a network request", () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_API_KEY = "test-key-not-for-network-use";
    delete process.env.GEMINI_MODEL;

    assert.deepEqual(getGeminiConfiguration(), {
      apiKey: "test-key-not-for-network-use",
      model: "gemini-3.8-flash",
    });
    assert.ok(getGeminiClient() instanceof GoogleGenAI);

    process.env.GEMINI_MODEL = "configured-test-model";
    assert.equal(getGeminiConfiguration().model, "configured-test-model");

    delete process.env.GEMINI_API_KEY;
    assert.throws(() => getGeminiClient(), GeminiConfigurationError);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});
