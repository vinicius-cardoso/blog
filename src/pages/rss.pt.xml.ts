import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { articlesFor, bareId } from "../lib/content";

export async function GET(context: APIContext) {
  const articles = await articlesFor("pt");
  return rss({
    title: "Vinícius Cardoso",
    description: "Projetos pessoais, coisas que construí e o que aprendi.",
    site: context.site ?? "http://localhost:4321",
    items: articles.map((a) => ({
      title: a.data.title,
      description: a.data.description,
      pubDate: a.data.pubDate,
      link: `/pt/blog/${bareId(a.id)}/`,
    })),
    customData: "<language>pt-BR</language>",
  });
}
