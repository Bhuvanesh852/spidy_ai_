export type KnowledgeDoc = {
  id: string;
  title: string;
  text: string;
  addedAt: number;
};

const STORAGE_KEY = "spidy-ai:knowledge:v1";

export const MAX_DOC_CHARS = 120_000;

export function loadKnowledge(): KnowledgeDoc[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as KnowledgeDoc[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveKnowledge(docs: KnowledgeDoc[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
  } catch {
    /* storage full — best effort */
  }
}

const STOP = new Set([
  "the","a","an","and","or","of","to","in","is","are","for","on","with","how","what","why","when",
  "does","do","did","can","i","my","me","it","this","that","be","as","at","by","from","about",
]);

function terms(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

/** Split a document into overlapping passages so citations point at a specific chunk. */
function chunks(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const size = 1200;
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size - 200) {
    out.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return out;
}

export type KnowledgeMatch = { title: string; text: string; score: number };

/** Keyword-scored retrieval over the user's own documents. */
export function searchKnowledge(docs: KnowledgeDoc[], question: string, limit = 4): KnowledgeMatch[] {
  const words = terms(question);
  if (!words.length || !docs.length) return [];

  const matches: KnowledgeMatch[] = [];
  for (const doc of docs) {
    for (const chunk of chunks(doc.text)) {
      const haystack = chunk.toLowerCase();
      let score = 0;
      for (const word of words) {
        const hits = haystack.split(word).length - 1;
        if (hits > 0) score += 1 + Math.min(hits, 4) * 0.25;
      }
      if (doc.title.toLowerCase().includes(words[0] ?? "")) score += 0.5;
      if (score > 0) matches.push({ title: doc.title, text: chunk, score });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}
