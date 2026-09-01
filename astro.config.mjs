// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// `site` is required for canonical URLs, RSS links and the sitemap.
// SITE_URL comes from deploy/local.conf when deploying by hand, and from the
// GitHub Actions workflow in CI. The localhost default keeps `npm run dev`
// working with no configuration at all.
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
