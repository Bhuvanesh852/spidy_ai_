export type Artifact = {
  id: string;
  title: string;
  lang: string;
  code: string;
};

const EXTENSIONS: Record<string, string> = {
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  jsx: "jsx",
  python: "py",
  py: "py",
  html: "html",
  css: "css",
  json: "json",
  bash: "sh",
  sh: "sh",
  sql: "sql",
  java: "java",
  go: "go",
  rust: "rs",
  c: "c",
  cpp: "cpp",
  markdown: "md",
};

export function artifactExtension(lang: string) {
  return EXTENSIONS[lang.toLowerCase()] ?? "txt";
}

/** Pull fenced code blocks out of an assistant message so they can open in the artifacts panel. */
export function extractArtifacts(messageId: string, text: string): Artifact[] {
  const pattern = /```([\w+-]*)\n?([\s\S]*?)```/g;
  const artifacts: Artifact[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    const code = (match[2] ?? "").trim();
    if (code.split("\n").length < 3) continue;
    const lang = match[1] || "text";
    index += 1;
    artifacts.push({
      id: `${messageId}-${index}`,
      title: `${lang === "text" ? "Snippet" : lang} · ${index}`,
      lang,
      code,
    });
  }

  return artifacts;
}

export function downloadArtifact(artifact: Artifact) {
  if (typeof window === "undefined") return;
  const blob = new Blob([artifact.code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `spidy-artifact.${artifactExtension(artifact.lang)}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
