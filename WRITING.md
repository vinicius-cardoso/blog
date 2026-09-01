# Writing a post

Every article is one Markdown file per language, in
`src/content/articles/<lang>/`. The directory sets the language and the
filename becomes the URL. Publishing is `git push` — a workflow builds the site
and deploys it in about 20 seconds.

```
src/content/articles/
  en/caddy-vs-nginx.md   →  https://vinilabs.cc/blog/caddy-vs-nginx
  pt/caddy-vs-nginx.md   →  https://vinilabs.cc/pt/blog/caddy-vs-nginx
```

Keep the same filename in both languages. Nothing enforces it, but it makes a
pair obvious at a glance.

---

## A standalone post, in both languages

**`src/content/articles/en/caddy-vs-nginx.md`**

```markdown
---
title: "Why I chose Caddy over nginx"
description: "One line. Used in listings, RSS, and link previews."
pubDate: 2026-09-01
lang: "en"
translationOf: "caddy-vs-nginx"
tags: ["infra"]
---

Your text here, in Markdown.
```

**`src/content/articles/pt/caddy-vs-nginx.md`**

```markdown
---
title: "Por que escolhi o Caddy em vez do nginx"
description: "Uma linha. Usada nas listagens, no RSS e nas prévias de link."
pubDate: 2026-09-01
lang: "pt"
translationOf: "caddy-vs-nginx"
tags: ["infra"]
---

Seu texto aqui, em Markdown.
```

**`translationOf` is what pairs the two.** It is a shared label, not a path or a
filename — use any string you like, as long as both files carry exactly the
same one. That pairing is what makes the EN/PT switch in the header carry a
reader to the same article instead of dropping them on the homepage.

Then:

```bash
git add src/content/articles
git commit -m "post: why I chose Caddy over nginx"
git push
```

---

## Writing one language first

This is the normal case. **Publish the English file on its own** — nothing
breaks. The site does not 404, and the PT switch falls back to the Portuguese
homepage.

Add the translation whenever you get to it, with the same `translationOf`
value. The pairing starts working the moment you push it; nothing else needs
changing.

---

## A post that is part of a series

Add two more fields to **both** language files:

```yaml
series: "oci-blog"
part: 3
```

- `series` points at a file in `src/content/series/<lang>/oci-blog.md`, which
  holds the series title and blurb. It must exist in every language that
  series is published in.
- `part` is the reading order, counting from 1.

Both fields must be set together — the schema rejects one without the other,
so a typo fails the build instead of shipping something broken.

That single field is all a series needs. From it you automatically get:

- one collapsed entry on the homepage, rather than one row per part
- a series index at `/series/oci-blog`
- a continuous read at `/series/oci-blog/all` — every part on one scrolling
  page, with a progress bar and a floating index
- a "Part 3 of 4" rail inside each part, so someone arriving from a search
  engine can find the rest

### Starting a new series

Create the metadata file first, in each language:

**`src/content/series/en/my-series.md`**

```markdown
---
title: "Self-hosting on a 1 GB box"
description: "One or two lines describing the whole series."
lang: "en"
pubDate: 2026-09-01
---
```

The file has no body — the title and blurb are the whole point. Then reference
it as `series: "my-series"` from each part.

---

## Every frontmatter field

| Field | Required | What it does |
|---|---|---|
| `title` | yes | Headline, page `<title>`, and listing entry |
| `description` | yes | Listings, RSS, and link previews |
| `pubDate` | yes | `YYYY-MM-DD`. Sorts the homepage, newest first |
| `lang` | yes | `en` or `pt`. Must match the directory |
| `translationOf` | no | Shared label pairing an article with its twin |
| `series` | no | Bare id of a file in `src/content/series/<lang>/` |
| `part` | with `series` | Reading order within the series, from 1 |
| `tags` | no | List of strings. Defaults to none |
| `draft` | no | `true` hides it from the built site |
| `updatedDate` | no | Shown next to the publication date |
| `heroImage` | no | Path to an image in `public/` |

---

## Drafts

```yaml
draft: true
```

A draft is **visible in `npm run dev`** and **excluded from the built site**, so
you can push work in progress without publishing it. Flip it to `false` (or
delete the line) when it is ready.

---

## Writing from your phone or another machine

You do not need this repository checked out. On GitHub, open
`src/content/articles/en/`, press **Add file → Create new file**, paste the
template above, and commit to `main`. The workflow builds and deploys it.

---

## Previewing locally

```bash
npm install     # first time only
npm run dev     # http://localhost:4321
```

The dev server reloads as you save, and shows drafts.

---

## If a post does not appear

**Check the build first.** The workflow refuses to deploy a broken build, so
the live site keeps serving the previous version rather than breaking. A failed
run shows a red ✗ beside the commit on GitHub — open it to see the error.

Common causes:

| Symptom | Cause |
|---|---|
| Build fails on the article | `pubDate` not `YYYY-MM-DD`, or a missing `title` / `description` |
| Build fails mentioning `series` | `series` set without `part`, or the other way round |
| Post is missing, build passed | `draft: true` is still set |
| Series index is missing a part | `series` does not match a filename in `src/content/series/<lang>/` |
| Language switch goes to the homepage | The twin has a different `translationOf`, or does not exist yet |

Nothing here can take the live site down: the server only ever receives a
finished, verified build.

---

## Changing the favicon

Everything lives in `public/`, and every file there is served at the site root.
The current mark is a placeholder — a `v` in the accent colour — meant to be
replaced.

### If you have an SVG

Replace `public/favicon.svg` with yours, then regenerate the raster sizes from
it so they all stay in sync:

```bash
cd public
rsvg-convert -w 180 -h 180 favicon.svg -o apple-touch-icon.png
rsvg-convert -w 192 -h 192 favicon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 favicon.svg -o icon-512.png

rsvg-convert -w 16 -h 16 favicon.svg -o /tmp/f16.png
rsvg-convert -w 32 -h 32 favicon.svg -o /tmp/f32.png
rsvg-convert -w 48 -h 48 favicon.svg -o /tmp/f48.png
magick /tmp/f16.png /tmp/f32.png /tmp/f48.png favicon.ico
```

Needs `librsvg` and `imagemagick`. A favicon generator (below) does the same
job in a browser if you would rather not install them.

### The files, and what each is for

| File | Used by |
|---|---|
| `favicon.svg` | Modern browsers. Preferred, and scales to any size |
| `favicon.ico` | Older browsers; also requested directly at `/favicon.ico` |
| `apple-touch-icon.png` | iOS home screen, 180×180 |
| `icon-192.png`, `icon-512.png` | Android / PWA, referenced by the manifest |
| `site.webmanifest` | App name and theme colour when installed |

If you change the accent colour, update `theme_color` in `site.webmanifest`
to match — it tints the browser chrome on mobile.

### Then

```bash
git add public && git commit -m "favicon: new mark" && git push
```

Browsers cache favicons aggressively. Force a refresh with `Ctrl+Shift+R`, or
open `https://vinilabs.cc/favicon.svg` directly to confirm the new one is live.

### Designing at 16×16

A favicon is mostly seen at 16 pixels. Detail disappears completely at that
size, so the usual advice: one letter or one simple shape, high contrast,
no thin strokes, no gradients, and no text beyond a single character. Design
it small first and check it scales up — not the other way round.
