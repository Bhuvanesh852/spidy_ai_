import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { CHAT_MODEL, createAiGatewayProvider, getApiKey } from "./ai-gateway.server";

const InputSchema = z.object({
  question: z.string().min(1).max(4000),
  answer: z.string().min(1).max(8000),
});

/** Suggests three short follow-up prompts ("next steps") after an answer. */
export const suggestNextSteps = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const gateway = createAiGatewayProvider(getApiKey());
      const result = await generateText({
        model: gateway(CHAT_MODEL),
        system:
          "You propose follow-up prompts. Reply with exactly three short follow-up questions the user " +
          "could ask next, each under 60 characters, one per line, no numbering, no quotes, no extra text.",
        prompt: `User asked:\n${data.question}\n\nAssistant answered:\n${data.answer.slice(0, 4000)}`,
      });
      return {
        suggestions: result.text
          .split("\n")
          .map((line) => line.replace(/^[-*\d.\s]+/, "").replace(/^["']|["']$/g, "").trim())
          .filter((line) => line.length > 2 && line.length < 120)
          .slice(0, 3),
      };
    } catch {
      return { suggestions: [] as string[] };
    }
  });
