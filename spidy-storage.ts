export type SpidyMode = "chat" | "code" | "image";

export type SpidyAttachment = {
  name: string;
  /** MIME type of the uploaded file. */
  type: string;
  /** data: URL with the file contents. */
  url: string;
};

export type SpidySource = {
  n: number;
  title: string;
  url?: string | undefined;
  source: string;
  kind: "web" | "doc";
};

export type SpidyMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  attachments?: SpidyAttachment[];
  sources?: SpidySource[];
  mode: SpidyMode;
};

export type SpidyConversation = {
  id: string;
  title: string;
  createdAt: number;
  messages: SpidyMessage[];
};

const STORAGE_KEY = "spidy-ai:conversations:v1";

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createConversation(): SpidyConversation {
  return { id: newId(), title: "New chat", createdAt: Date.now(), messages: [] };
}

export function loadConversations(): SpidyConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SpidyConversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: SpidyConversation[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    /* storage full or unavailable — history is best-effort */
  }
}

export function titleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

const MODE_LABEL: Record<SpidyMode, string> = {
  chat: "Answers",
  code: "Coding",
  image: "Images",
};

export function conversationToText(conversation: SpidyConversation) {
  const lines: string[] = [
    "Spidy AI — chat export",
    `Title: ${conversation.title}`,
    `Started: ${new Date(conversation.createdAt).toLocaleString()}`,
    `Exported: ${new Date().toLocaleString()}`,
    `Messages: ${conversation.messages.length}`,
    "",
    "=".repeat(60),
    "",
  ];

  conversation.messages.forEach((message, index) => {
    lines.push(
      `[${index + 1}] ${message.role === "user" ? "You" : "Spidy AI"} · ${MODE_LABEL[message.mode]}`,
      "",
    );
    if (message.content.trim()) lines.push(message.content.trim(), "");
    if (message.attachments?.length) {
      lines.push("Attachments:");
      message.attachments.forEach((file) => lines.push(`- ${file.name} (${file.type})`, file.url));
      lines.push("");
    }
    if (message.sources?.length) {
      lines.push("Sources:");
      message.sources.forEach((source) =>
        lines.push(`- [${source.n}] ${source.title} (${source.source})${source.url ? ` ${source.url}` : ""}`),
      );
      lines.push("");
    }
    if (message.image) {
      lines.push("Image:", message.image, "");
    }
    lines.push("-".repeat(60), "");
  });

  return lines.join("\n");
}

export function downloadConversation(conversation: SpidyConversation) {
  if (typeof window === "undefined") return;
  const safeTitle = conversation.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const blob = new Blob([conversationToText(conversation)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `spidy-ai-${safeTitle || "chat"}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
