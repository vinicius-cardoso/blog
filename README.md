# blog

Personal blog — bilingual (EN / pt-BR), light and dark themes, and articles
that can be grouped into series and read either part-by-part or as one
continuous page.

The public site is **static HTML**: no server-side rendering, no Node process
in production. A small admin service (see `admin/`) is the only thing that runs
continuously, and it is reachable over Tailscale only.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Site | [Astro](https://astro.build) 7, static output | Public pages never change per visitor, so they compile to files |
| Content | Markdown + frontmatter, in this repo | Version history for free; the writing is not trapped in a database |
| Admin | Small Go binary (planned) | ~12 MB resident; a crash cannot take the blog down |
| Server | Caddy on a 1 GB OCI instance | Automatic HTTPS, replaces nginx + certbot |

Node is a **build tool**, not a runtime. It runs where the build happens, not
on the server.

## Local development

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # writes dist/
npm run preview    # serve dist/ locally
```

Drafts (`draft: true`) are visible in `dev` and excluded from `build`.

## Content

```
src/content/
  articles/
    en/my-article.md
    pt/my-article.md
  series/
    en/my-series.md      # series title + blurb
    pt/my-series.md
```

### Article frontmatter

```yaml
---
title: "Reading the machine before writing any code"
description: "One or two lines; used in listings, RSS and social cards."
pubDate: 2026-08-31
lang: "en"                    # en | pt
translationOf: "my-article"   # bare id of the twin in the other language
series: "oci-blog"            # optional — bare id of a file in series/
part: 1                       # required if `series` is set
tags: ["infra"]
draft: false
---
```

`series` and `part` must be set together; the schema rejects one without the
other. Series ids are bare (`oci-blog`), not language-prefixed — the language
comes from the directory.

### How series work

A series is not a special article type; it is a field on ordinary articles.
That single field produces:

- one collapsed entry on the main list, instead of one row per part
- a series index at `/series/<id>`
- a continuous read at `/series/<id>/all` — every part on one page, with a
  progress bar and a floating index
- prev/next and a "Part 2 of 4" rail inside each individual part

### Translations

Articles are paired by `translationOf`, so the language switch keeps the
reader on the same article — and on the same *part* of a series. Either side
may carry the field. When a translation does not exist yet, the switch falls
back rather than 404ing, which matters because articles are usually written in
one language first.

## Routes

```
/                       article list (EN)
/pt                     article list (pt-BR)
/about  ·  /pt/sobre
/blog/<slug>            single article
/series/<id>            series index
/series/<id>/all        continuous read
/rss.xml  ·  /rss.pt.xml
```

## Theming

Tokens live in `src/styles/tokens.css`. The palette is "Warm Ink" and the type
pairing is Fraunces + Public Sans.

Light is defined on bare `:root`; dark is declared twice on purpose — once
under `prefers-color-scheme` (so the OS setting is respected by default) and
once under `[data-theme="dark"]` (so an explicit toggle wins). A small inline
script in `Base.astro` applies the stored choice **before first paint**, so
dark-theme readers never see a white flash.

Every colour pair meets WCAG AA in both themes.

## Deploying

See `deploy/README.md`. In short: build locally, rsync `dist/` to the server,
and let Caddy serve it. Nothing is built on the server.
