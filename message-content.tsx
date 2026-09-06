import { Check, Copy } from "lucide-react";
import { useState } from "react";

type Block = { type: "text" | "code"; content: string; lang?: string | undefined };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const pattern = /```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    blocks.push({ type: "code", content: match[2] ?? "", lang: match[1] || undefined });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    blocks.push({ type: "text", content: text.slice(lastIndex) });
  }
  return blocks.filter((block) => block.content.trim().length > 0);
}

function CodeBlock({ code, lang }: { code: string; lang?: string | undefined }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-background/70">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {lang ?? "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="scroll-slim overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

function inline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={index}
          className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[0.85em] text-accent-foreground"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function TextBlock({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1.5" />;
        if (/^#{1,6}\s/.test(trimmed)) {
          return (
            <h3 key={index} className="pt-1 font-display text-base font-semibold text-foreground">
              {inline(trimmed.replace(/^#{1,6}\s/, ""))}
            </h3>
          );
        }
        if (/^([-*•]|\d+\.)\s/.test(trimmed)) {
          return (
            <div key={index} className="flex gap-2 pl-1">
              <span className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="flex-1">{inline(trimmed.replace(/^([-*•]|\d+\.)\s/, ""))}</span>
            </div>
          );
        }
        return <p key={index}>{inline(trimmed)}</p>;
      })}
    </div>
  );
}

export function MessageContent({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;

  return (
    <div className="text-[15px] leading-relaxed">
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <CodeBlock key={index} code={block.content} lang={block.lang} />
        ) : (
          <TextBlock key={index} content={block.content} />
        ),
      )}
    </div>
  );
}
