---
title: "Static where it can be, dynamic where it must be"
description: "Why the public pages compile to plain HTML and only the admin page runs a process."
pubDate: 2026-08-31
lang: "en"
translationOf: "oci-blog-part-2"
series: "oci-blog"
part: 2
tags: ["infra", "astro"]
---

With memory freed up, every option fit. That made the decision harder, not
easier — "it runs" stopped being the filter.

## The question that settled it

What does a blog's public page actually need at request time?

Nothing. The content does not change between visitors. There is no
personalisation, no session, no query. Rendering it on demand means doing the
same work repeatedly and paying for a runtime to do it.

So the public site compiles to static HTML at build time, and the server does
nothing but hand over files.

## Where dynamic behaviour is genuinely needed

Exactly one place: the admin page where I write. That does need a process —
something to accept a form, write a file, and trigger a rebuild.

That process is small and deliberately boring. It does one job, holds almost
no memory, and if it crashes the public site is entirely unaffected, because
the public site is just files on disk.

## The shape that falls out

- **Build** happens on my laptop, where memory is not scarce.
- **The server** holds static files plus one small binary.
- **A crash in the admin** cannot take the blog offline.

That last point is the one I care about most. The failure modes are separate,
which is worth more than any framework feature.
