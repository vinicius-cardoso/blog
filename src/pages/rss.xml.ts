import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { articlesFor, bareId } from "../lib/content";

export async function GET(context: APIContext) {
  const articles = await articlesFor("en");
  return rss({
    title: "Vinícius Cardoso",
    description: "Personal projects, things I built and things I learned.",
    site: context.site ?? "http://localhost:4321",
    items: articles.map((a) => ({
      title: a.data.title,
      description: a.data.description,
      pubDate: a.data.pubDate,
      link: `/blog/${bareId(a.id)}/`,
    })),
    customData: "<language>en</language>",
  });
}
