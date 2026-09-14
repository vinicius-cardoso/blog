---
title: "My zram was bigger than my RAM"
description: "Turning the volume down froze the whole machine, while a full movie played fine. The cause was 22.9 GB of compressed swap living inside 15 GB of memory."
pubDate: 2026-09-14
lang: "en"
translationOf: "zram-sized-larger-than-ram"
tags: ["linux", "memory", "zram", "performance"]
---

My laptop kept freezing on trivial things. Not on compiles, not on Docker
builds — on things like clicking a menu. The one that finally made me
investigate: I watched an entire movie in SMPlayer without a single stutter,
then reached for the volume slider and the whole machine locked up.

That combination is backwards. Heavy work was fine; a volume change was fatal.
Whatever was wrong, it was not "the computer is too slow."

## Measuring the freeze instead of guessing

`free -h` and `top` are useless here, because by the time you can read them the
freeze is over. What you want is PSI — pressure stall information, in
`/proc/pressure/`:

```
$ cat /proc/pressure/memory
some avg10=0.00 avg60=0.00 avg300=0.17 total=2034355
full avg10=0.00 avg60=0.00 avg300=0.17 total=2017374
```

The averages are a distraction. `total=` is what matters: cumulative
microseconds that tasks spent stalled. Sample it on a timer and the delta
between two samples tells you what fraction of wall-clock time the machine
spent frozen. `full` means *every* task was stalled — that is a freeze, by
definition.

I left a collector sampling every 20 seconds and went back to work. Over 95
minutes it recorded this:

```
11:27:08  avail=2.96Gi  swap=2.69Gi
11:48:05  avail=3.20Gi  swap=2.69Gi
12:19:54  avail=3.77Gi  swap=3.38Gi
12:51:43  avail=3.19Gi  swap=4.31Gi
13:02:20  avail=4.15Gi  swap=4.45Gi
```

Swap climbed 2.69 → 4.45 GB and never came back down. Meanwhile available RAM
stayed flat. Even after the largest process on the machine — 1.37 GB — exited,
swap went *up*.

That is not a leak in one program. Memory was going somewhere and not coming
back.

## Where it was going

```
$ cat /proc/swaps
Filename          Type        Size      Used      Priority
/dev/zram1        partition   5998412   1151552   32767
/dev/zram2        partition   5998412   1153096   32767
/dev/zram3        partition   5998412   1141140   32767
/dev/zram4        partition   5998412   1125820   32767
/swapfile/1       file        524284    0         -2
```

Four zram devices, 6.14 GB each. That is **22.9 GB of swap on a machine with
15.25 GB of RAM**.

This is the whole bug, and it is worth being precise about why it is a bug.
zram is not disk. It is a compressed block device that lives *in RAM*. Swapping
a page to zram compresses it and keeps it in memory — cheaper than going to the
NVMe, which is exactly why it is a good idea in general.

But sizing it at 150% of RAM inverts the logic. The kernel now believes it has
38 GB of memory to hand out. It does not. Every page it "frees" by swapping is
still occupying RAM, just compressed. The pool competes with the very memory it
exists to relieve, and the system settles into an equilibrium where a growing
share of your RAM is storing a compressed copy of your RAM.

Mine came from the distro default:

```
$ grep zram_size /usr/share/systemd-swap/swap-default.conf
## zram_size=150%    # Virtual disksize (% of RAM). Larger = more data in RAM
```

I had also set `vm.swappiness = 100` myself, months earlier, with a comment in
the file explaining that high swappiness makes good use of fast zram. That
reasoning is sound — but only if zram is sized sanely. At 150% it just fed the
spiral faster.

## Why the volume slider, and not the movie

This is the part that explains the symptom, and it took me a while to see it.

Playing a movie is sequential and predictable. The pages it touches constantly
stay resident; everything it *doesn't* touch gets pushed into zram — including
the parts of PipeWire, the Qt widgets and the theme assets that nothing has
needed for two hours. Playback stays smooth the entire time.

Then you click the volume control. That demands an immediate round trip through
exactly those cold pages, and decompressing them requires free RAM — which is
the one thing there isn't any of. Audio runs on a real-time thread with a hard
deadline. When it misses, it does not degrade gracefully; it takes the desktop
down with it.

So the rule on a machine in this state is inverted: heavy sequential work is the
*safest* thing you can do. Small interactive actions are what kill it.

## The fix

Two lines. `/etc/systemd/swap.conf`:

```ini
zram_size=50%
zram_alg=zstd
```

and `/etc/sysctl.d/99-performance-tuning.conf`:

```ini
vm.swappiness = 70
```

50% of RAM is the conventional sizing, and the pool still expands on demand
under real pressure — it just no longer pre-claims more memory than the machine
physically has.

One trap worth mentioning. Restarting `systemd-swap` forces everything in zram
back into real RAM, and I had 3.96 GB of uncompressed data sitting in there
against 4.11 GB available. That margin is too thin; it would have OOM-killed
something. So I added a temporary disk swapfile first as a safety net.

On btrfs that has its own catch:

```
$ sudo swapon /var/tmp/temp.swap
swapon: /var/tmp/temp.swap: swapon failed: Invalid argument

$ sudo dmesg | tail -1
BTRFS warning (device dm-0): swapfile must not be copy-on-write
```

btrfs swapfiles need `chattr +C` on the empty file, *before* you write any data
into it:

```bash
sudo truncate -s 0 /var/tmp/temp.swap
sudo chattr +C /var/tmp/temp.swap
sudo dd if=/dev/zero of=/var/tmp/temp.swap bs=1M count=8192
sudo chmod 600 /var/tmp/temp.swap
sudo mkswap /var/tmp/temp.swap && sudo swapon -p 1 /var/tmp/temp.swap
```

`fallocate` will not do — it produces an extent layout swap rejects.

## The result

Swap total dropped from 22.9 GB to 7.6 GB, and usage collapsed:

```
before:  swap used 4.57 Gi   memory pressure climbing all morning
after:   swap used 0.21 Gi   memory pressure ~0%
```

The same 1080p clip that I used as a control now plays with 1.51% memory stall
and 408 ms of I/O stall across a 20-second run.

`MemAvailable` reads *lower* now — 1.69 GB instead of 4.15 GB — and that looks
alarming until you realise it is the point. That data is in real RAM instead of
being compressed inside RAM that was also being counted as free. The earlier
number was double-counting.

## What I would do differently

I spent the first part of this convinced it was a video problem, because the
freezes happened around VLC and SMPlayer. It wasn't. Hardware decode was
working perfectly the entire time — I confirmed it by playing a clip and
watching memory pressure move by a single microsecond.

The media players were victims, not causes. What made them look guilty is that
they are memory-hungry enough to push the system over the edge, and they are
the app you happen to be touching when it tips.

The lesson I am taking: when a symptom points at an application, measure the
application directly before believing it. One 20-second controlled playback
would have cleared VLC in the first five minutes. And when a *small* action
freezes a machine that handles *large* ones fine, stop looking at the
application entirely — that asymmetry is a memory-reclaim signature, and it
points at the kernel's idea of how much memory it has.
