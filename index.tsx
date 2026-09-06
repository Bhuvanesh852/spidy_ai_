import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUp,
  BookOpen,
  Check,
  Code2,
  Copy,
  Download,
  FileText,
  ImageIcon,
  ExternalLink,
  Loader2,
  MessageCircleQuestion,
  Mic,
  MicOff,
  PanelLeft,
  Paperclip,
  Plus,
  RefreshCw,
  Share2,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MessageContent } from "@/components/spidy/message-content";
import { downloadArtifact, extractArtifacts, type Artifact } from "@/lib/artifacts";
import { generateSpidyImage } from "@/lib/image.functions";
import { loadKnowledge, searchKnowledge } from "@/lib/knowledge-storage";
import {
  createConversation,
  downloadConversation,
  loadConversations,
  newId,
  saveConversations,
  titleFrom,
  type SpidyAttachment,
  type SpidyConversation,
  type SpidyMessage,
  type SpidyMode,
  type SpidySource,
} from "@/lib/spidy-storage";
import { suggestNextSteps } from "@/lib/suggestions.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Spidy AI — Answers, Coding & Image Generation" },
      {
        name: "description",
        content:
          "Spidy AI by S. Bhuvanesh: a dark-gold AI assistant with streaming answers, a coding artifacts panel, file uploads and image generation.",
      },
      { property: "og:title", content: "Spidy AI — Answers, Coding & Image Generation" },
      {
        property: "og:description",
        content:
          "Streaming AI answers, an artifacts panel for code, file and image uploads, and instant image generation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SpidyApp,
});

const MODES: { id: SpidyMode; label: string; icon: typeof Sparkles; hint: string }[] = [
  { id: "chat", label: "Answers", icon: MessageCircleQuestion, hint: "Ask anything" },
  { id: "code", label: "Coding", icon: Code2, hint: "Write or debug code" },
  { id: "image", label: "Images", icon: ImageIcon, hint: "Describe an image to generate" },
];

const MAX_FILE_BYTES = 8 * 1024 * 1024;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function SpidyApp() {
  const [conversations, setConversations] = useState<SpidyConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<SpidyMode>("chat");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<SpidyAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [nextSteps, setNextSteps] = useState<string[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const generateImage = useServerFn(generateSpidyImage);
  const nextStepsFn = useServerFn(suggestNextSteps);

  useEffect(() => {
    const stored = loadConversations();
    if (stored.length > 0) {
      setConversations(stored);
      setActiveId(stored[0]!.id);
    } else {
      const fresh = createConversation();
      setConversations([fresh]);
      setActiveId(fresh.id);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveConversations(conversations);
  }, [conversations, hydrated]);

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages]);

  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy, activeId]);

  const patchActive = useCallback(
    (updater: (conversation: SpidyConversation) => SpidyConversation) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeId ? updater(conversation) : conversation,
        ),
      );
    },
    [activeId],
  );

  const startNewChat = () => {
    const fresh = createConversation();
    setConversations((current) => [fresh, ...current]);
    setActiveId(fresh.id);
    setSidebarOpen(false);
    setArtifact(null);
  };

  const deleteConversation = (id: string) => {
    setConversations((current) => {
      const next = current.filter((conversation) => conversation.id !== id);
      if (next.length === 0) {
        const fresh = createConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0]!.id);
      return next;
    });
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: SpidyAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is larger than 8 MB.`);
        continue;
      }
      try {
        accepted.push({
          name: file.name,
          type: file.type || "application/octet-stream",
          url: await readFileAsDataUrl(file),
        });
      } catch {
        toast.error(`Could not read ${file.name}.`);
      }
    }
    if (accepted.length) setPending((current) => [...current, ...accepted]);
  };

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast.error("Speech is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, " code block "));
    utterance.rate = 1.02;
    window.speechSynthesis.speak(utterance);
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Recognition =
      (window as unknown as { SpeechRecognition?: new () => never }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!Recognition) {
      toast.error("Voice input needs Chrome or Edge.");
      return;
    }
    const recognition = new Recognition() as unknown as {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      start: () => void;
      stop: () => void;
      onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
    };
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results as ArrayLike<ArrayLike<{ transcript: string }>>)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) setInput((current) => (current ? `${current} ${transcript}` : transcript));
    };
    recognition.onerror = () => {
      setListening(false);
      toast.error("Could not capture audio.");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const copyArtifact = async () => {
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard is blocked in this browser.");
    }
  };

  /** Streams a response into an existing assistant message slot. Shared by send() and regenerate(). */
  const runAssistant = async (
    assistantId: string,
    historySoFar: SpidyMessage[],
    prompt: string,
    modeParam: SpidyMode,
  ) => {
    const updateAssistant = (patch: Partial<SpidyMessage>) =>
      patchActive((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistantId ? { ...message, ...patch } : message,
        ),
      }));

    setBusy(true);
    setNextSteps([]);

    try {
      if (modeParam === "image") {
        const result = await generateImage({ data: { prompt } });
        updateAssistant({
          image: result.image,
          content: result.text?.trim() || `Here's your image: ${prompt}`,
        });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const history = historySoFar
        .filter((message) => message.content.trim().length > 0 || message.attachments?.length)
        .map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        }));

      const knowledge = prompt
        ? searchKnowledge(loadKnowledge(), prompt).map((match) => ({
            title: match.title,
            text: match.text,
          }))
        : [];

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: modeParam, messages: history, knowledge }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response
          .json()
          .catch(() => ({ error: "The AI request failed." }))
          .then((data: { error?: string }) => data.error ?? "The AI request failed.");
        throw new Error(detail);
      }

      let sources: SpidySource[] = [];
      const rawSources = response.headers.get("X-Spidy-Sources");
      if (rawSources) {
        try {
          sources = JSON.parse(decodeURIComponent(rawSources)) as SpidySource[];
        } catch {
          sources = [];
        }
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        updateAssistant({ content: text, ...(sources.length ? { sources } : {}) });
      }
      if (!text.trim()) {
        updateAssistant({ content: "_No response was returned._" });
      } else if (prompt) {
        setNextSteps([]);
        void nextStepsFn({ data: { question: prompt, answer: text } })
          .then((result) => setNextSteps(result.suggestions))
          .catch(() => setNextSteps([]));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        updateAssistant({ content: "_Stopped._" });
      } else {
        const message = error instanceof Error ? error.message : "Something went wrong.";
        toast.error(message);
        updateAssistant({ content: `⚠️ ${message}` });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const send = async () => {
    const prompt = input.trim();
    if ((!prompt && pending.length === 0) || busy || !active) return;

    const attachments = pending;
    const userMessage: SpidyMessage = {
      id: newId(),
      role: "user",
      content: prompt,
      mode,
      ...(attachments.length ? { attachments } : {}),
    };
    const assistantId = newId();
    const isFirst = active.messages.length === 0;

    patchActive((conversation) => ({
      ...conversation,
      title: isFirst ? titleFrom(prompt || attachments[0]?.name || "New chat") : conversation.title,
      messages: [
        ...conversation.messages,
        userMessage,
        { id: assistantId, role: "assistant", content: "", mode },
      ],
    }));
    setInput("");
    setPending([]);

    await runAssistant(assistantId, [...active.messages, userMessage], prompt, mode);
  };

  /** Re-runs the AI response for a given assistant message using the same preceding history. */
  const regenerate = async (assistantId: string) => {
    if (busy || !active) return;
    const index = active.messages.findIndex((message) => message.id === assistantId);
    if (index < 1) return;
    const priorUser = active.messages[index - 1];
    if (!priorUser || priorUser.role !== "user") return;

    const historySoFar = active.messages.slice(0, index + 1);
    patchActive((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === assistantId
          ? { ...message, content: "", image: undefined, sources: undefined }
          : message,
      ),
    }));

    await runAssistant(assistantId, historySoFar, priorUser.content, priorUser.mode ?? mode);
  };

  const shareMessage = async (message: SpidyMessage) => {
    try {
      if (navigator.share) {
        await navigator.share({ text: message.content, title: "Spidy AI" });
        return;
      }
      await navigator.clipboard.writeText(message.content);
      toast.success("Copied — sharing isn't supported here, so it's on your clipboard instead.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Couldn't share this message.");
    }
  };

  const downloadMessage = (message: SpidyMessage) => {
    const blob = new Blob([message.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spidy-response-${message.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Response downloaded");
  };

  const activeMode = MODES.find((item) => item.id === mode)!;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-sidebar-border bg-sidebar transition-transform md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 border-b border-sidebar-border p-4">
          <div className="gold-surface glow grid size-10 place-items-center rounded-xl text-lg">
            🕷️
          </div>
          <div>
            <p className="gold-text font-display text-base font-bold tracking-wide">Spidy AI</p>
            <p className="text-[11px] text-muted-foreground">by S. Bhuvanesh</p>
          </div>
        </div>

        <button
          type="button"
          onClick={startNewChat}
          className="gold-surface mx-4 mt-4 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
        >
          <Plus className="size-4" /> New chat
        </button>

        <div className="scroll-slim mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                conversation.id === activeId
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveId(conversation.id);
                  setSidebarOpen(false);
                  setArtifact(null);
                }}
                className="flex-1 truncate text-left"
              >
                {conversation.title}
              </button>
              <button
                type="button"
                aria-label="Delete chat"
                onClick={() => deleteConversation(conversation.id)}
                className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        <p className="border-t border-sidebar-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Chats are stored in this browser. Generated with Spidy AI.
        </p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden"
          >
            <PanelLeft className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-sm font-semibold">
              {active?.title ?? "New chat"}
            </h1>
            <p className="text-[11px] text-muted-foreground">{activeMode.hint}</p>
          </div>
          <Link
            to="/knowledge"
            aria-label="Knowledge base"
            title="Your knowledge base"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <BookOpen className="size-4" />
          </Link>
          <button
            type="button"
            aria-label="Download chat"
            title="Download chat as text file"
            disabled={!active || active.messages.length === 0}
            onClick={() => {
              if (!active || active.messages.length === 0) return;
              downloadConversation(active);
              toast.success("Chat downloaded");
            }}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="size-4" />
          </button>
          <div className="panel flex items-center gap-1 rounded-full p-1">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === item.id
                    ? "gold-surface"
                    : "text-muted-foreground hover:text-accent-foreground",
                )}
              >
                <item.icon className="size-3.5" />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} className="scroll-slim flex-1 overflow-y-auto px-4 py-8">
              <div className="mx-auto w-full max-w-2xl space-y-8">
                {!active || active.messages.length === 0 ? (
                  <div className="mt-10 text-center">
                    <div className="gold-surface glow mx-auto grid size-16 place-items-center rounded-2xl text-3xl">
                      🕷️
                    </div>
                    <h2 className="mt-5 font-display text-2xl font-bold">
                      <span className="gold-text">Spidy AI</span> is ready
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                      Ask a question, attach a file, get coding help with artifacts, or generate an
                      image.
                    </p>
                    <div className="mx-auto mt-6 grid max-w-xl gap-2 sm:grid-cols-3">
                      {[
                        { mode: "chat" as SpidyMode, text: "Explain quantum computing simply" },
                        { mode: "code" as SpidyMode, text: "Write a Python web scraper" },
                        { mode: "image" as SpidyMode, text: "A neon spider in a rainy city" },
                      ].map((suggestion) => (
                        <button
                          key={suggestion.text}
                          type="button"
                          onClick={() => {
                            setMode(suggestion.mode);
                            setInput(suggestion.text);
                          }}
                          className="panel rounded-xl px-3 py-3 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {suggestion.text}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  active.messages.map((message, messageIndex) => {
                    const isLast = messageIndex === active.messages.length - 1;
                    const artifacts =
                      message.role === "assistant"
                        ? extractArtifacts(message.id, message.content)
                        : [];
                    return (
                      <div key={message.id} className="space-y-2">
                        {message.role === "user" ? (
                          <div className="flex justify-end">
                            <div className="max-w-[85%] space-y-2">
                              {message.attachments?.map((file) => (
                                <div key={file.url.slice(-24) + file.name} className="flex justify-end">
                                  {file.type.startsWith("image/") ? (
                                    <img
                                      src={file.url}
                                      alt={file.name}
                                      className="max-h-56 rounded-xl border border-border"
                                    />
                                  ) : (
                                    <span className="panel inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground">
                                      <FileText className="size-3.5" /> {file.name}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {message.content && (
                                <div className="rounded-2xl bg-secondary px-4 py-3 text-[15px] leading-relaxed text-secondary-foreground">
                                  {message.content}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <div className="gold-surface mt-1 grid size-7 shrink-0 place-items-center rounded-lg text-xs">
                              🕷️
                            </div>
                            <div className="min-w-0 flex-1">
                              {message.image && (
                                <img
                                  src={message.image}
                                  alt={message.content || "Generated by Spidy AI"}
                                  className="mb-3 w-full rounded-xl border border-border"
                                  loading="lazy"
                                />
                              )}
                              {message.content ? (
                                <MessageContent text={message.content} />
                              ) : (
                                <Loader2 className="size-4 animate-spin text-primary" />
                              )}
                              {message.content && (
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => speak(message.content)}
                                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                                  >
                                    <Volume2 className="size-3" /> Speak
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await navigator.clipboard.writeText(message.content);
                                        setCopiedMessageId(message.id);
                                        window.setTimeout(() => setCopiedMessageId(null), 1500);
                                      } catch {
                                        toast.error("Clipboard is blocked in this browser.");
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                                  >
                                    {copiedMessageId === message.id ? (
                                      <Check className="size-3" />
                                    ) : (
                                      <Copy className="size-3" />
                                    )}
                                    {copiedMessageId === message.id ? "Copied" : "Copy"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => downloadMessage(message)}
                                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                                  >
                                    <Download className="size-3" /> Download
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void shareMessage(message)}
                                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                                  >
                                    <Share2 className="size-3" /> Share
                                  </button>
                                  {isLast && !busy && (
                                    <button
                                      type="button"
                                      onClick={() => void regenerate(message.id)}
                                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                                    >
                                      <RefreshCw className="size-3" /> Regenerate
                                    </button>
                                  )}
                                  {artifacts.map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      onClick={() => setArtifact(item)}
                                      className="panel inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                      <Code2 className="size-3" /> Open {item.title}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {message.sources && message.sources.length > 0 && (
                                <div className="mt-3 space-y-1.5">
                                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                                    Sources
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {message.sources.map((source) =>
                                      source.url ? (
                                        <a
                                          key={source.n}
                                          href={source.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="panel inline-flex max-w-72 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                        >
                                          <span className="text-primary">[{source.n}]</span>
                                          <span className="truncate">{source.source}</span>
                                          <ExternalLink className="size-3 shrink-0" />
                                        </a>
                                      ) : (
                                        <span
                                          key={source.n}
                                          title={source.title}
                                          className="panel inline-flex max-w-72 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-muted-foreground"
                                        >
                                          <span className="text-primary">[{source.n}]</span>
                                          <FileText className="size-3 shrink-0" />
                                          <span className="truncate">{source.title}</span>
                                        </span>
                                      ),
                                    )}
                                  </div>
                                </div>
                              )}
                              {isLast && !busy && nextSteps.length > 0 && (
                                <div className="mt-4 space-y-1.5">
                                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                                    Next steps
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {nextSteps.map((step) => (
                                      <button
                                        key={step}
                                        type="button"
                                        onClick={() => {
                                          setInput(step);
                                          textareaRef.current?.focus();
                                        }}
                                        className="panel rounded-full px-3 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                                      >
                                        {step}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="px-4 pb-5">
              <div className="panel mx-auto w-full max-w-2xl rounded-2xl p-2">
                {pending.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-2 pb-2 pt-1">
                    {pending.map((file, index) => (
                      <span
                        key={`${file.name}-${index}`}
                        className="inline-flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5 text-[11px] text-secondary-foreground"
                      >
                        {file.type.startsWith("image/") ? (
                          <ImageIcon className="size-3" />
                        ) : (
                          <FileText className="size-3" />
                        )}
                        <span className="max-w-40 truncate">{file.name}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setPending((current) => current.filter((_, i) => i !== index))
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={
                    mode === "image" ? "Describe the image to generate…" : "Message Spidy AI…"
                  }
                  className="scroll-slim max-h-48 min-h-12 w-full resize-none bg-transparent px-3 py-3 text-[15px] outline-none placeholder:text-muted-foreground"
                />

                <div className="flex items-center gap-1 px-1 pb-1">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="image/*,application/pdf,.txt,.md,.csv,.json"
                    className="hidden"
                    onChange={(event) => {
                      void addFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Attach file"
                    title="Attach images or documents"
                    disabled={mode === "image"}
                    onClick={() => fileRef.current?.click()}
                    className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                  >
                    <Paperclip className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Voice input"
                    onClick={toggleVoice}
                    className={cn(
                      "grid size-9 place-items-center rounded-lg transition-colors",
                      listening
                        ? "bg-destructive text-destructive-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  </button>
                  <span className="flex-1" />
                  {busy ? (
                    <button
                      type="button"
                      aria-label="Stop"
                      onClick={stopStreaming}
                      className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground transition-colors hover:bg-accent"
                    >
                      {mode === "image" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Square className="size-4" />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label="Send"
                      onClick={() => void send()}
                      disabled={!input.trim() && pending.length === 0}
                      className="gold-surface grid size-9 place-items-center rounded-lg transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
                    >
                      <ArrowUp className="size-4" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Spidy AI can make mistakes — verify important answers.
              </p>
            </div>
          </div>

          {artifact && (
            <aside className="hidden w-[26rem] shrink-0 flex-col border-l border-border bg-card lg:flex">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Code2 className="size-4 text-primary" />
                <p className="min-w-0 flex-1 truncate font-display text-sm font-semibold">
                  {artifact.title}
                </p>
                <button
                  type="button"
                  aria-label="Copy artifact"
                  onClick={() => void copyArtifact()}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </button>
                <button
                  type="button"
                  aria-label="Download artifact"
                  onClick={() => downloadArtifact(artifact)}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Download className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Close artifact panel"
                  onClick={() => setArtifact(null)}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <pre className="scroll-slim flex-1 overflow-auto p-4 text-[13px] leading-relaxed">
                <code className="font-mono">{artifact.code}</code>
              </pre>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
