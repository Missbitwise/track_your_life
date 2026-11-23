import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
import { z } from "zod";

const geminiEnvironmentSchema = z.object({
  GEMINI_API_KEY: z.string().trim().min(1),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.8-flash"),
});

export interface GeminiConfiguration {
  apiKey: string;
  model: string;
}

export class GeminiConfigurationError extends Error {
  constructor() {
    super("Gemini configuration is invalid. Set GEMINI_API_KEY and GEMINI_MODEL.");
    this.name = "GeminiConfigurationError";
  }
}

let cachedClient: GoogleGenAI | undefined;
let cachedApiKey: string | undefined;

export function getGeminiConfiguration(): GeminiConfiguration {
  const result = geminiEnvironmentSchema.safeParse(process.env);
  if (!result.success) throw new GeminiConfigurationError();

  return {
    apiKey: result.data.GEMINI_API_KEY,
    model: result.data.GEMINI_MODEL,
  };
}

export function getGeminiClient(): GoogleGenAI {
  const configuration = getGeminiConfiguration();
  if (!cachedClient || cachedApiKey !== configuration.apiKey) {
    cachedClient = new GoogleGenAI({ apiKey: configuration.apiKey });
    cachedApiKey = configuration.apiKey;
  }
  return cachedClient;
}
