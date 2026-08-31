import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * Articles live at src/content/articles/<lang>/<slug>.md
 *
 * A series is NOT a separate content type — it is the `series` field on an
 * ordinary article. That keeps a standalone post and a series part identical
 * everywhere except where the series affordances are deliberately rendered.
 */
const articles = defineCollection({
  loader: glob({ base: "./src/content/articles", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),

    lang: z.enum(["en", "pt"]),

    /** Pairs this article with its twin in the other language. */
    translationOf: z.string().optional(),

    /** Series membership. Both must be present, or neither. */
    series: z.string().optional(),
    part: z.number().int().positive().optional(),

    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    heroImage: z.string().optional(),
  }).refine(
    (d) => (d.series === undefined) === (d.part === undefined),
    { message: "`series` and `part` must be set together, or not at all." },
  ),
});

/** Series metadata: title, blurb and ordering live here, once per language. */
const series = defineCollection({
  loader: glob({ base: "./src/content/series", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(["en", "pt"]),
    translationOf: z.string().optional(),
    pubDate: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles, series };
