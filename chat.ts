import { createFileRoute } from "@tanstack/react-router";
import { streamText } from "ai";
import { z } from "zod";

import {
  CHAT_MODEL,
  createAiGatewayProvider,
  getApiKey,
} from "@/lib/ai-gateway.server";
import { needsLiveData, retrieveWebContext, type WebResult } from "@/lib/web-search.server";

const AttachmentSchema = z.object({
  name: z.string(),
  type: z.string(),
  url: z.string(),
});

const KnowledgeSchema = z.object({ title: z.string(), text: z.string() });

const BodySchema = z.object({
  mode: z.enum(["chat", "code"]).default("chat"),
  knowledge: z.array(KnowledgeSchema).max(6).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        attachments: z.array(AttachmentSchema).optional(),
      }),
    )
    .min(1),
});

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string }
  | { type: "file"; data: string; mediaType: string; filename?: string };

function toModelMessages(messages: z.infer<typeof BodySchema>["messages"]) {
  return messages.map((message) => {
    if (message.role !== "user" || !message.attachments?.length) {
      return { role: message.role, content: message.content };
    }
    const parts: ContentPart[] = [{ type: "text", text: message.content || "See the attachment." }];
    for (const file of message.attachments) {
      if (file.type.startsWith("image/")) {
        parts.push({ type: "image", image: file.url });
      } else {
        parts.push({
          type: "file",
          data: file.url,
          mediaType: file.type || "application/octet-stream",
          filename: file.name,
        });
      }
    }
    return { role: "user" as const, content: parts };
  });
}

const SYSTEM_PROMPTS: Record<"chat" | "code", string> = {
  chat: [
    "You are Spidy AI, a thoughtful, careful assistant created by S. Bhuvanesh.",
    "Think before answering: identify what the person actually needs, then give a direct answer first",
    "and the supporting reasoning after it.",
    "Structure longer answers with short headings, tight paragraphs and bullet lists;",
    "keep simple answers to one or two sentences without headings or filler.",
    "Be honest about uncertainty, name trade-offs, and ask a clarifying question when the request is ambiguous.",
    "Never flatter the user or open with praise. Use fenced code blocks with a language tag for any code.",
    "When a file or image is attached, examine it closely and ground your answer in what it actually contains.",
  ].join(" "),
  code: [
    "You are Spidy AI in coding mode, an expert software engineer created by S. Bhuvanesh.",
    "Start with a one-line summary of the approach, then give complete, runnable code.",
    "Always wrap code in fenced blocks with the correct language tag, and keep each file in its own block",
    "so it can be opened as a standalone artifact.",
    "After the code, briefly explain the key decisions and flag bugs, edge cases, performance and security issues.",
    "Prefer clear, idiomatic solutions over clever ones, and say so when a requirement is underspecified.",
  ].join(" "),
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Invalid request body." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const gateway = createAiGatewayProvider(getApiKey());
          const now = new Date();
          const today = now.toISOString().slice(0, 10);

          const lastUser = [...parsed.messages].reverse().find((m) => m.role === "user");
          const question = lastUser?.content ?? "";

          type Source = { n: number; title: string; url?: string; source: string; kind: "web" | "doc" };
          const sources: Source[] = [];
          const blocks: string[] = [];

          const docs = parsed.knowledge ?? [];
          docs.forEach((doc) => {
            const n = sources.length + 1;
            sources.push({ n, title: doc.title, source: "your library", kind: "doc" });
            blocks.push(`[${n}] ${doc.title} (your knowledge base)\n   ${doc.text.slice(0, 1400)}`);
          });

          let web: WebResult[] = [];
          if (question && needsLiveData(question)) {
            const retrieved = await retrieveWebContext(question);
            web = retrieved.results;
            web.forEach((item) => {
              const n = sources.length + 1;
              sources.push({
                n,
                title: item.title,
                url: item.url,
                source: item.source,
                kind: "web",
              });
              const meta = [item.source, item.published].filter(Boolean).join(" · ");
              const body = item.snippet ? `\n   ${item.snippet.slice(0, 400)}` : "";
              blocks.push(`[${n}] ${item.title} (${meta})\n   ${item.url}${body}`);
            });
          }

          const grounding = blocks.length
            ? [
                "\n\nSOURCES available for this question.",
                docs.length
                  ? "Entries marked \"your knowledge base\" are the user's own documents: trust them above everything else for their domain, and quote them when relevant."
                  : "",
                web.length
                  ? "Entries with a URL were retrieved from the live web just now: prefer them over your training memory for anything current."
                  : "",
                "Cite every claim you take from a source inline as [1], [2] with the source name.",
                "If the sources conflict, say so. If they do not cover the question, answer from your own knowledge and say that explicitly.",
                `\n\n${blocks.join("\n")}`,
              ]
                .filter(Boolean)
                .join(" ")
            : "";

          const result = streamText({
            model: gateway(CHAT_MODEL),
            system: `${SYSTEM_PROMPTS[parsed.mode]}\n\nToday's date is ${today} (${now.toUTCString()}). Treat this as the current date when reasoning about dates, deadlines, ages, versions or "latest" releases, and do the date arithmetic from it. Your training data ends before today, so for anything that could have changed recently rely on the sources below when they are present, and never claim a later year or event is "in the future".${grounding}`,
            messages: toModelMessages(parsed.messages) as never,
          });

          return result.toTextStreamResponse({
            headers: {
              "Cache-Control": "no-cache, no-transform",
              "X-Spidy-Sources": encodeURIComponent(JSON.stringify(sources)),
              "Access-Control-Expose-Headers": "X-Spidy-Sources",
            },
          });
        } catch (error) {
          const status =
            typeof error === "object" && error && "statusCode" in error
              ? Number((error as { statusCode?: number }).statusCode) || 500
              : 500;
          const message =
            status === 402
              ? "AI credits are exhausted for this workspace. Add credits to keep chatting."
              : status === 429
                ? "Too many requests right now. Please try again in a moment."
                : error instanceof Error
                  ? error.message
                  : "The AI request failed.";
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
