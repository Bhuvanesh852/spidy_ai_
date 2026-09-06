/** Live web retrieval (RAG) so answers are grounded in current data. */

export type WebResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  published?: string | undefined;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decode(html: string) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

async function get(url: string, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xml,*/*" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cleanDdgUrl(raw: string) {
  const decoded = decode(raw);
  const match = decoded.match(/uddg=([^&]+)/);
  const url = match?.[1] ? decodeURIComponent(match[1]) : decoded;
  return url.startsWith("//") ? `https:${url}` : url;
}

async function searchDuckDuckGo(query: string, limit: number): Promise<WebResult[]> {
  const html = await get(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);
  if (!html) return [];

  const results: WebResult[] = [];
  const linkPattern = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetPattern = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
  const snippets: string[] = [];
  for (let m = snippetPattern.exec(html); m; m = snippetPattern.exec(html)) {
    snippets.push(decode(m[1] ?? ""));
  }

  let index = 0;
  for (let m = linkPattern.exec(html); m && results.length < limit; m = linkPattern.exec(html)) {
    const url = cleanDdgUrl(m[1] ?? "");
    const title = decode(m[2] ?? "");
    if (!url.startsWith("http") || !title) continue;
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // keep raw url as source label
    }
    results.push({ title, url, snippet: snippets[index] ?? "", source: host });
    index += 1;
  }
  return results;
}

async function searchNews(query: string, limit: number): Promise<WebResult[]> {
  const xml = await get(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
  );
  if (!xml) return [];

  const results: WebResult[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  for (let m = itemPattern.exec(xml); m && results.length < limit; m = itemPattern.exec(xml)) {
    const item = m[1] ?? "";
    const title = decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const url = decode(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
    const published = decode(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "");
    const source = decode(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "news");
    if (!title || !url.startsWith("http")) continue;
    results.push({ title, url, snippet: "", source, published });
  }
  return results;
}

async function searchWikipedia(query: string, limit: number): Promise<WebResult[]> {
  const json = await get(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=${limit}&srsearch=${encodeURIComponent(
      query,
    )}&format=json&origin=*`,
  );
  if (!json) return [];
  try {
    const data = JSON.parse(json) as {
      query?: { search?: Array<{ title: string; snippet: string; timestamp?: string }> };
    };
    return (data.query?.search ?? []).slice(0, limit).map((hit) => ({
      title: hit.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
      snippet: decode(hit.snippet),
      source: "wikipedia.org",
      published: hit.timestamp,
    }));
  } catch {
    return [];
  }
}

const FRESHNESS_HINTS =
  /\b(latest|current|now|today|yesterday|recent|recently|news|update|updated|20(2[4-9]|3\d)|this (week|month|year)|price|stock|score|release[ds]?|who is|winner|election|weather|version)\b/i;

/** True when the question likely needs live data rather than model memory. */
export function needsLiveData(question: string) {
  return question.length > 0 && (FRESHNESS_HINTS.test(question) || question.trim().endsWith("?"));
}

export async function retrieveWebContext(question: string, limit = 6) {
  const query = question.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!query) return { results: [] as WebResult[], block: "" };

  const [web, news, wiki] = await Promise.all([
    searchDuckDuckGo(query, limit),
    searchNews(query, 4),
    searchWikipedia(query, 2),
  ]);

  const seen = new Set<string>();
  const results: WebResult[] = [];
  for (const item of [...news, ...web, ...wiki]) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    results.push(item);
    if (results.length >= limit + 4) break;
  }

  if (!results.length) return { results, block: "" };

  const block = results
    .map((item, i) => {
      const meta = [item.source, item.published].filter(Boolean).join(" · ");
      const body = item.snippet ? `\n   ${item.snippet.slice(0, 400)}` : "";
      return `[${i + 1}] ${item.title} (${meta})\n   ${item.url}${body}`;
    })
    .join("\n");

  return { results, block };
}
