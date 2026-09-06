import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, FileText, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  loadKnowledge,
  saveKnowledge,
  MAX_DOC_CHARS,
  type KnowledgeDoc,
} from "@/lib/knowledge-storage";
import { newId } from "@/lib/spidy-storage";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Base — Spidy AI" },
      {
        name: "description",
        content:
          "Upload your own articles, notes and documents so Spidy AI answers from your library and cites the exact source.",
      },
      { property: "og:title", content: "Knowledge Base — Spidy AI" },
      {
        property: "og:description",
        content: "Add your own articles and documents and let Spidy AI cite them in answers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: KnowledgePage,
});

const TEXT_TYPES = /\.(txt|md|markdown|csv|json|html?|log|tsv|xml|ya?ml)$/i;

function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    setDocs(loadKnowledge());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveKnowledge(docs);
  }, [docs, hydrated]);

  const addDoc = (docTitle: string, body: string) => {
    const clean = body.replace(/\u0000/g, "").trim();
    if (!clean) {
      toast.error("That file had no readable text.");
      return;
    }
    setDocs((current) => [
      {
        id: newId(),
        title: docTitle.trim() || "Untitled document",
        text: clean.slice(0, MAX_DOC_CHARS),
        addedAt: Date.now(),
      },
      ...current,
    ]);
    toast.success(`Added "${docTitle}" to your library`);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (!TEXT_TYPES.test(file.name) && !file.type.startsWith("text/")) {
        toast.error(`${file.name} isn't a text document — paste its text below instead.`);
        continue;
      }
      try {
        addDoc(file.name.replace(/\.[^.]+$/, ""), await file.text());
      } catch {
        toast.error(`Could not read ${file.name}.`);
      }
    }
  };

  const totalWords = docs.reduce((sum, doc) => sum + doc.text.split(/\s+/).length, 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft className="size-4" /> Back to chat
        </Link>
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">
          {docs.length} document{docs.length === 1 ? "" : "s"} · {totalWords.toLocaleString()} words
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="flex items-center gap-3">
          <div className="gold-surface glow grid size-12 place-items-center rounded-2xl">
            <BookOpen className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">
              Your <span className="gold-text">knowledge base</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Spidy searches these first and cites them by name in every answer.
            </p>
          </div>
        </div>

        <div className="panel mt-8 rounded-2xl p-5">
          <label className="gold-surface inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-[filter] hover:brightness-110">
            <Upload className="size-4" /> Upload documents
            <input
              type="file"
              multiple
              accept=".txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.log,.xml,.yml,.yaml,text/*"
              className="hidden"
              onChange={(event) => {
                void onFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Text files work directly (.txt, .md, .csv, .json, .html). For a PDF or Word file, copy
            the text and paste it below.
          </p>

          <div className="mt-5 space-y-2 border-t border-border pt-5">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title — e.g. Q3 industry briefing"
              className="w-full rounded-xl bg-secondary px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              placeholder="Paste an article, report or your own notes…"
              className="scroll-slim w-full resize-y rounded-xl bg-secondary px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => {
                addDoc(title, text);
                setTitle("");
                setText("");
              }}
              className="gold-surface inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
            >
              Add to library
            </button>
          </div>
        </div>

        <div className="mt-8 space-y-2">
          {docs.length === 0 ? (
            <p className="panel rounded-2xl px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing here yet. Add your first document and ask Spidy a question about it.
            </p>
          ) : (
            docs.map((doc) => (
              <div key={doc.id} className="panel flex items-start gap-3 rounded-xl px-4 py-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
                    {doc.text.slice(0, 220)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {new Date(doc.addedAt).toLocaleDateString()} ·{" "}
                    {doc.text.split(/\s+/).length.toLocaleString()} words
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${doc.title}`}
                  onClick={() => setDocs((current) => current.filter((item) => item.id !== doc.id))}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          Documents stay in this browser only — they are sent to Spidy just for the question you ask.
        </p>
      </main>
    </div>
  );
}
