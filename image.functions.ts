import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({ prompt: z.string().min(1).max(2000) });

type ImageResult = { image: string; text: string | null };

export const generateSpidyImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<ImageResult> => {
    const { getApiKey, IMAGE_MODEL } = await import("@/lib/ai-gateway.server");
    const baseURL = process.env["SPIDY_API_BASE_URL"] ?? "https://api.openai.com/v1";

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: "user", content: data.prompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      if (response.status === 402) {
        throw new Error("AI credits are exhausted for this workspace. Add credits to continue.");
      }
      if (response.status === 429) {
        throw new Error("Image requests are rate limited right now. Try again shortly.");
      }
      throw new Error(`Image generation failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          images?: Array<{ image_url?: { url?: string } }>;
        };
      }>;
    };

    const message = payload.choices?.[0]?.message;
    const url = message?.images?.[0]?.image_url?.url;
    if (!url) {
      throw new Error(
        message?.content
          ? `No image returned. Model said: ${message.content}`
          : "No image was returned by the model.",
      );
    }

    return { image: url, text: message?.content ?? null };
  });
