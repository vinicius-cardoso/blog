---
title: "I put Claude inside my Echo Dot"
description: "Soldering three wires to a locked speaker, a U-Boot signature bug, a 26 GB build, and the one-line config error that made me read the device's own log — how my Echo Dot 5 stopped answering to Amazon and started answering to Claude."
pubDate: 2026-11-25
lang: "en"
translationOf: "claude-inside-my-echo-dot"
series: "echo-claude"
part: 1
heroImage: "/echo-claude/hero-building.jpg"
tags: ["hardware", "home-assistant", "ai", "reverse-engineering", "linux"]
---

I have an Echo Dot on my desk, paired to my laptop over Bluetooth as a speaker.
One night I asked the obvious question: Alexa is fine, but Claude answers *so*
much better. What if I could talk to the hardware I already own, but have Claude
be the thing that answers? Not an app, not a phone — the speaker itself.

This is the whole story: what worked, what didn't, the errors I pasted at 2 AM,
and the one-line misconfiguration that nearly beat me at the finish. It ends
with me saying "Alexa, what is quantum entanglement" to a device that no longer
contains a single line of Amazon's assistant, and a female voice answering back.

## First, a reality check

My first instinct was wrong, and it's worth saying so. I thought the Bluetooth
link was the way in — intercept the audio, slot Claude into the middle. It
isn't. The Bluetooth connection is **audio only**: it carries sound to the
speaker and nothing else. The microphones, the wake word, and all the traffic to
Amazon run over Wi-Fi, encrypted, trusted only by Amazon's servers. There's
nothing to quietly intercept there.

The only real way to make the device run my code is to **replace the firmware**.
And that only works on some models. So the first question was: which Echo do I
even have?

The Bluetooth name said `Echo Dot-H31`. That `H31` turned out to be a red
herring — it's a per-device pairing label Amazon slaps on the Bluetooth name, not
a model code. Two Echoes of completely different generations can both show up as
`-H31`. The real answer was on the bottom of the device:

```
Model No. C2N6L4
```

That's the **Echo Dot 5th generation (2022)**, codename `cannoli`, running a
MediaTek chip. And here's where I almost gave up: the 5th gen is *newer*
hardware with secure boot and signed firmware. Every "root your Echo" project I
found stopped at the 3rd gen. I told myself it was a dead end.

Then I found [echo-dot-assist](https://github.com/Gamer92000/echo-dot-assist),
and it had a `cannoli` target. It was real. My exact model. Documented end to
end. The catch, in the README's own words: *"This is the one model with no
guided setup yet: you solder three wires, build the image bundle yourself and run
the installer. The recovery build alone downloads a 26 GB source tree."*

Fine. Let's solder.

## The unlock, in one paragraph

Before the soldering, the part that makes the whole thing possible. The 5th gen
verifies its bootloader with a signature, so you can't just flash your own.
The exploit is **CVE-2026-46728**: U-Boot's signature check reads an unsigned
"hashed-nodes" hint from the very image it's verifying. The builder weaponizes
it — it moves the real boot node into an archive, repoints the signature's hint
at the archive copy, and swaps in a fully patched payload. The signed byte
stream never changes, so **Amazon's own signature verifies over a patched
U-Boot**. That's the door.

## Soldering to pads that don't want to be found

The Echo Dot's USB-C port is power only — no data lines. The data pads are a
3×3 matrix of tiny gold test points hidden in a recess behind the rubber foot on
the base. You peel the foot off (it comes off by hand), undo four T8 Torx
screws, and there it is:

![The Echo Dot 5 board, rubber foot removed, showing the test-pad matrix near the FLEX SIDE label](/echo-claude/board-pads.jpg)

Three wires: GND to the centre pad, D− straight below it, D+ the corner pad to
the left. The red +5 V wire stays **disconnected** — the Dot runs on its own
15 V adapter, and the USB carries data and ground only. That one rule is what
keeps the board alive.

![Three wires soldered to the pad matrix, +5 V left unconnected](/echo-claude/soldered-pads.jpg)

The moment of truth isn't the soldering — it's whether the PC sees anything.
USB into the laptop, hold the action button, plug in the 15 V adapter, and:

```
$ fastboot devices
G0922H0735040H31	 Android Fastboot
```

There it is. The wiring works. That serial would key every step that followed.

![The Echo opened on the cutting mat, wires soldered, light ring glowing, the build log on the monitor behind it](/echo-claude/echo-working.jpg)

## The 26 GB build (and a scare)

The install needs three things built from source: a TWRP recovery, the port's
update bundle, and the OS bundle. The recovery is the big one — it syncs a
**26 GB** Android source tree and compiles for hours. On a 15 GB-RAM laptop I
ran it at `JOBS=3` to avoid an out-of-memory kill, and watched it crawl:

```
[ 22% 2392/10767] target thumb C++: recovery <= bootable/recovery/twrp.cpp
...
[100% 10767/10767] ----- Making compressed recovery ramdisk ------
#### build completed successfully (06:44 (mm:ss)) ####
```

Before that finished, though, the build threw a wall of red that stopped my
heart for a second:

```
_ssl.c:2198:27: error: passing argument 1 of 'SSL_CTX_new' makes pointer from
  integer without a cast [-Wint-conversion]
_ssl.c:2202:27: error: implicit declaration of function 'SSLv3_method'
```

It looks like the build is dying. It isn't. The recovery build compiles its own
**Python 2.7.18 (from 2020)** against my system's **OpenSSL 4.1**, and Python
2.7's `_ssl` module uses OpenSSL APIs that were removed years ago. Those modules
are optional — Python skips them and builds the interpreter anyway, and the build
only ever needed `import zlib` to work. A scare, not a failure. The lesson I keep
relearning: read what the error *is*, not what it looks like.

## "Unsupported firmware prerequisite: tee1"

With everything built, I powered the Dot into fastboot and ran the unlock. It
got a long way — backed up slot A, installed TWRP into slot B — and then stopped
cold:

```
ERROR: Unsupported firmware prerequisite: tee1; cannoli-upgrade brings a 2022
unit up to 8349
```

This one I'd been warned about. My Dot shipped in 2022 on firmware older than the
build (`8349`) the whole port is pinned against, and one of its protected
partitions didn't match. The fix is a documented detour: unpack the pinned stock
firmware, run `cannoli-upgrade` to bring those partitions up to 8349, then rerun
the install. There's a one-way step buried in it — the first boot of the new
firmware burns an **anti-rollback eFuse**, permanent, the same one any Amazon
update would burn. You type `yes` and mean it.

```
✅ Writing and verifying tee1
✅ Writing and verifying tee2
✅ Prerequisites upgraded
```

Then the real install, again, and this time the line I wanted:

```
✅ Cannoli rooted on slot A; hold Volume Up at power-on for TWRP
```

I unplugged it, plugged it back in with no button held, and watched the light
ring come up and settle. Amber. On the port, amber means "installed, waiting to
be adopted by Home Assistant." The device had booted my firmware. Amazon's
assistant was gone.

## An aside: the robot kept getting interrupted

A small, strange part of the experience. I did this with Claude Code driving the
terminal next to me, and a safety classifier kept cutting its responses off
mid-sentence — it pattern-matched "modifying a locked device" and tripped,
without understanding that it was *my own* Echo and an open-source project. Every
time a response got withheld, we just carried on. It's a blunt filter, not a
judgment, but it's a funny thing to run into while you're literally holding a
soldering iron over your own hardware.

## Home Assistant, and Claude as the brain

The port turns the Echo into a **Home Assistant voice satellite** — the mics,
wake word and speaker stay, but it answers to *your* Home Assistant instead of
Amazon. I didn't have Home Assistant yet, so I ran it in Docker on the laptop,
switched the whole UI to English, and the Echo showed up on its own over
Bluetooth:

![Home Assistant discovering the Echo Dot over Bluetooth](/echo-claude/ha-bluetooth.png)

From there it's a pipeline: **speech-to-text → a conversation agent → text-to-speech.**
I wired local [Whisper](https://github.com/rhasspy/wyoming-whisper) for the ears
and [Piper](https://github.com/rhasspy/wyoming-piper) for the voice, both running
offline in Docker. The brain is the **Anthropic integration** — Claude — pointed
at by the pipeline's conversation agent. In a text test it answered immediately.
Everything was green.

## The bug that read like success

Then I said the wake word, and nothing happened. The ring flashed red and went
dark. No answer.

The Home Assistant logs showed the pipeline starting and finishing in **one
millisecond**, with no audio ever captured:

```
Running pipeline 1 from stt to tts
Initialized microVAD
Pipeline finished
Requested pipeline abort
```

I chased this for a while — restarted the Echo, checked the mic wasn't muted,
verified Whisper had its model, confirmed the network ports. All green, all
fine, still no audio. The breakthrough was remembering the device has its *own*
log. I opened adb over Wi-Fi and read what the Echo itself was saying:

```
wake: ALEXA type=2  level -45.2 dBFS over noise -80.0 dBFS
state: idle -> listening
(private) pipeline error: validation-error the pipeline does not support
  speech-to-text
state: listening -> idle
```

There it was, in one line: **"the pipeline does not support speech-to-text."**
The Echo heard me perfectly — great audio levels. It was Home Assistant that
refused the run, because the pipeline the Echo was actually using had *no STT
engine attached*. The hassmic satellite exposes two assistant slots, and the
primary one was still pointed at the default pipeline, which had speech-to-text
set to "None." I'd configured Claude on the wrong slot.

One `select.select_option` to point the primary slot at my Claude pipeline, and:

I said "Alexa, what is quantum entanglement," the ring went blue and stayed
blue, it thought for a second, and a voice read back the answer. It worked.

## One more thing: the voice was ugly

The first voice to come out was `en_GB/alan` at *low* quality — a flat, robotic
male voice. Not what I wanted at all. I swapped the Piper container to
`en_US-amy-medium` and matched the pipeline's TTS voice to it. Now it answers in
a clear, warm female voice. Small change, completely different feeling.

## What it is now

An Echo Dot 5 that:

- runs open-source firmware, with Amazon's assistant completely gone
- is a Home Assistant voice satellite on my own network
- hears me with local Whisper, answers in a local Piper voice
- and thinks with **Claude**

Nothing leaves my network except the Claude API calls. The mics, the wake word,
the speech-to-text, the voice — all local.

## What I took away from it

The hardware wasn't the hard part. Soldering three wires and reading a serial
number felt like the "real" work, but the board was alive on the first try.
What actually ate the hours were the moments where something *looked* like one
thing and was another: a wall of `_ssl` errors that was really an optional module
being skipped; a pipeline "finishing successfully" in a millisecond that was
really an empty-audio abort; a red light ring that meant "configuration error,"
not "muted mic."

Every one of those was solved the same way — stop trusting the symptom, find the
log closest to the thing that's failing, and read what it actually says. The
Echo's own `boot.log`, four layers down from the UI I'd been staring at, had the
answer in plain English the whole time. It usually does.
