---
title: "Reading the machine before writing any code"
description: "Before choosing a stack I checked what the server could actually take. The answer changed the plan."
pubDate: 2026-08-31
lang: "en"
translationOf: "oci-blog-part-1"
series: "oci-blog"
part: 1
tags: ["infra", "oci"]
---

The tempting order is to pick a framework first and discover the constraints
later. I did it the other way round, and it saved me from a stack that would
not have survived its first week.

## What the box actually had

The server is an Oracle Cloud free-tier instance. On paper that is 1 GB of
RAM. In practice, after the operating system and the services already running
on it, there was rather less:

```
              total  used  free  available
Mem:           956M  615M   97M       193M
Swap:            0B    0B    0B
```

193 MB available and **no swap at all**. Two other services were already
living there: a FastAPI app holding 22% of memory, and a small bot holding
another 9%.

## Why that ruled things out

A server-rendered Node application typically wants somewhere between 150 and
250 MB resident. With 193 MB free and no swap, that is not a tight fit — it is
an out-of-memory kill waiting to happen, and the kernel does not politely pick
the process you would have chosen. It would likely have taken one of the
existing services down with it.

The lesson I keep relearning: *measure the target before designing for it*.

## What I changed

Two things, before writing a line of application code:

1. **Stopped a service that did not need to run continuously.** The FastAPI
   app is used occasionally, not constantly. Disabling it from boot — while
   leaving it installed and startable on demand — returned about 210 MB.
2. **Added swap.** Not as a substitute for real memory, but so that an
   unexpected spike degrades into slowness instead of a kill.

Available memory went from 193 MB to over 400 MB. Only then did the stack
question become interesting rather than constrained.
