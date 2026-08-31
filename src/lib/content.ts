import { getCollection, type CollectionEntry } from "astro:content";
import type { Lang } from "../i18n/ui";

export type Article = CollectionEntry<"articles">;
export type Series = CollectionEntry<"series">;

/**
 * Collection ids carry the language directory, e.g. "en/oci-blog".
 * Frontmatter refers to the bare name ("oci-blog"), and so do URLs, so
 * everything that compares or links the two goes through this.
 */
export const bareId = (id: string) => id.replace(/^(en|pt)\//, "");

/** Drafts are visible while developing, never in a production build. */
const isVisible = (e: { data: { draft: boolean } }) =>
  import.meta.env.DEV || !e.data.draft;

/** Average adult reading speed for technical prose. */
const WPM = 200;

export function readingTime(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / WPM));
}

export async function articlesFor(lang: Lang): Promise<Article[]> {
  const all = await getCollection("articles", (e) => isVisible(e) && e.data.lang === lang);
  return all.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function seriesFor(lang: Lang): Promise<Series[]> {
  const all = await getCollection("series", (e) => isVisible(e) && e.data.lang === lang);
  return all.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/** The parts of one series, in reading order. */
export async function partsOf(seriesId: string, lang: Lang): Promise<Article[]> {
  const all = await articlesFor(lang);
  return all
    .filter((a) => a.data.series === seriesId)
    .sort((a, b) => (a.data.part ?? 0) - (b.data.part ?? 0));
}

/**
 * One entry per row of the main list: either a standalone article, or a
 * whole series collapsed into a single item so four parts don't flood the
 * homepage. Sorted by the most recent activity in each.
 */
export type ListEntry =
  | { kind: "article"; article: Article; date: Date }
  | { kind: "series"; series: Series; parts: Article[]; date: Date };

export async function mainList(lang: Lang): Promise<ListEntry[]> {
  const [articles, allSeries] = await Promise.all([articlesFor(lang), seriesFor(lang)]);

  const known = new Set(allSeries.map((s) => bareId(s.id)));
  const entries: ListEntry[] = [];

  for (const a of articles) {
    // An article naming a series that has no metadata file still shows up
    // standalone rather than vanishing.
    if (!a.data.series || !known.has(a.data.series)) {
      entries.push({ kind: "article", article: a, date: a.data.pubDate });
    }
  }

  for (const s of allSeries) {
    const id = bareId(s.id);
    const parts = articles
      .filter((a) => a.data.series === id)
      .sort((x, y) => (x.data.part ?? 0) - (y.data.part ?? 0));
    if (parts.length === 0) continue;

    const latest = parts.reduce(
      (max, p) => (p.data.pubDate > max ? p.data.pubDate : max),
      parts[0].data.pubDate,
    );
    entries.push({ kind: "series", series: s, parts, date: latest });
  }

  return entries.sort((a, b) => b.date.valueOf() - a.date.valueOf());
}

/**
 * Finds the same article in the other language.
 *
 * Either side may carry `translationOf`, so the link works whichever one was
 * written first. Returns undefined when no translation exists yet — the caller
 * decides whether to fall back or hide the switch.
 */
export async function translationOf(
  article: Article,
  to: Lang,
): Promise<Article | undefined> {
  const candidates = await articlesFor(to);
  const mine = article.data.translationOf;

  return candidates.find(
    (c) => (mine && c.id.endsWith(mine)) || (c.data.translationOf && article.id.endsWith(c.data.translationOf)),
  );
}
