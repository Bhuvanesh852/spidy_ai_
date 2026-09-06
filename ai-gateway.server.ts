import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/** Your own AI provider API key (set SPIDY_API_KEY in your .env file). */
export function getApiKey() {
  const key = process.env["SPIDY_API_KEY"];
  if (!key) throw new Error("Missing SPIDY_API_KEY. Add it to your .env file.");
  return key;
}

export function createAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "spidy",
    baseURL: process.env["SPIDY_API_BASE_URL"] ?? "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export const CHAT_MODEL = process.env["SPIDY_CHAT_MODEL"] ?? "gpt-4o-mini";
export const IMAGE_MODEL = process.env["SPIDY_IMAGE_MODEL"] ?? "gpt-4o-mini";
