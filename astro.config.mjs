// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// `site` is required for canonical URLs, RSS links and the sitemap.
// Override per-environment with SITE_URL rather than editing this file —
// the real domain is not committed to a public repo.
const site = process.env.SITE_URL ?? "http://localhost:4321";

export default defineConfig({
  site,
  integrations: [sitemap()],
  build: { format: "directory" },
  markdown: {
    shikiConfig: {
      // Matches the Warm Ink palette closely enough in both themes.
      themes: { light: "github-light", dark: "github-dark-dimmed" },
      wrap: false,
    },
  },
});
