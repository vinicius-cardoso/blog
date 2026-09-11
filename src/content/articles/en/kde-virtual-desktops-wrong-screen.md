---
title: "KDE was switching desktops on the wrong screen"
description: "The built-in KWin script picks the primary monitor by position, not by the primary flag. On a laptop with an external display, that inverts the two."
pubDate: 2026-09-11
lang: "en"
translationOf: "kde-virtual-desktops-wrong-screen"
tags: ["kde", "linux", "kwin"]
---

I had a laptop with an external LG monitor, KDE set up exactly the way the
documentation says, and the wrong behaviour anyway. The LG was marked as the
primary screen. The KWin script *Virtual Desktops Only on Primary* was enabled.
Pressing the desktop-switch shortcut still moved the **laptop** panel and left
the LG alone — precisely backwards.

I had re-set the primary monitor more times than I care to admit. It never
helped, and now I know why: the script never reads that setting.

## The setting that looks like it should work

KDE ships a script in `kdeplasma-addons` called *Virtual Desktops Only on
Primary*. Tick it in **System Settings → KWin Scripts** and virtual desktops
are supposed to affect only the primary screen; everything on the other screens
stays put.

The configuration all looked right:

```bash
$ xrandr --query | grep -w primary
HDMI-1 connected primary 2560x1080+1920+0

$ kscreen-doctor -o | grep -E "Output:|priority"
Output: 66 eDP-1
	priority 2
Output: 67 HDMI-1
	priority 1
```

`priority 1` is the primary. Both tools agree the LG is it. KWin's own support
information agrees too:

```
Screens
=======
Screen 0:
---------
Name: HDMI-1
```

Three independent sources, one answer: **HDMI-1 is primary**. And yet.

## Asking the script what it sees

Configuration files describe intent. I wanted to know what the script actually
believed at runtime, which is a different question.

A KWin script can print with `console.info`, but on this machine KWin logs
nothing to the journal — it had been started with `--replace` outside systemd,
so its output went to a socket I could not read. Notifications turned out to be
the reliable side channel: have the script send one over D-Bus, with
`dbus-monitor` already running to catch it.

```javascript
var names = workspace.screenOrder.map(function (s) { return s.name; }).join("|");
var msg = "ORDER[" + names + "] FIRST[" + workspace.screenOrder[0].name + "]" +
          " ACTIVE[" + workspace.activeScreen.name + "]";

callDBus("org.freedesktop.Notifications", "/org/freedesktop/Notifications",
         "org.freedesktop.Notifications", "Notify",
         "probe", 0, "", "KWINPROBE", msg, [], {}, 3000);
```

Start the listener **first**, then load and run the script:

```bash
( timeout 8 dbus-monitor "interface='org.freedesktop.Notifications',member='Notify'" > /tmp/mon.txt & )
sleep 1
qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript /tmp/probe.js probe
qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.start
sleep 3
grep -a -o "ORDER\[[^]]*\] FIRST\[[^]]*\] ACTIVE\[[^]]*\]" /tmp/mon.txt
```

The answer:

```
ORDER[eDP-1|HDMI-1]  FIRST[eDP-1]  ACTIVE[HDMI-1]
```

There it is.

## The bug

The stock script decides which screen to protect on its very first line of
real work:

```javascript
let primaryScreen = workspace.screenOrder[0];
```

**In the KWin scripting API, `screenOrder` is sorted by output position, not by
the primary flag.** My laptop panel sits at x=0 and the LG at x=1920, so
`screenOrder[0]` is always `eDP-1` — the built-in — no matter what xrandr,
kscreen or System Settings say about which monitor is primary.

So the script was doing its job perfectly. It was protecting the screen it
believed was primary, and that screen was the laptop. The LG kept switching
because the script had them backwards.

This also explains why setting the primary monitor again never fixed anything.
That flag is real, and other parts of KDE honour it — this script simply does
not consult it.

There is a second, smaller bug in the same file:

```javascript
let onCurrentDesktop = desktops.includes(workspace.currentDesktop);
let windowIsRelevant = onCurrentDesktop || window.onAllDesktops;
if (!windowIsRelevant) {
    return;
}
```

A window that is neither on the current desktop nor already sticky gets skipped
entirely. Windows stranded on some other desktop are therefore never corrected,
so even with the screens identified correctly the result drifts over time.

And the primary screen is captured **once**, at load. Plug the monitor in after
login and the script is still pointing at whatever was there before.

## The fix

Rather than patch a file in `/usr/share` that the next `kdeplasma-addons`
update would overwrite, I wrote a corrected version under `~/.local/share`,
where no package manager will touch it.

Create `~/.local/share/kwin/scripts/vdonlyprimaryfix/metadata.json`:

```json
{
    "KPackageStructure": "KWin/Script",
    "KPlugin": {
        "Description": "Virtual desktops affect only the external monitor (corrected)",
        "Icon": "preferences-system-windows-script-test",
        "Id": "vdonlyprimaryfix",
        "License": "LGPL-2.1-or-later",
        "Name": "Virtual Desktops Only on Primary (Fixed)"
    },
    "X-Plasma-API": "javascript"
}
```

And `contents/code/main.js` beside it:

```javascript
// The external monitor, by stable EDID identity.
const PRIMARY_MANUFACTURER = "LG Electronics";
const PRIMARY_SERIAL = "0x00044676";

function isInternal(screen) {
    return screen.name.indexOf("eDP") === 0 || screen.name.indexOf("LVDS") === 0;
}

function primaryScreen() {
    const screens = workspace.screenOrder;

    // Preferred: the known external monitor.
    for (let i = 0; i < screens.length; i++) {
        if (screens[i].manufacturer === PRIMARY_MANUFACTURER &&
            screens[i].serialNumber === PRIMARY_SERIAL) {
            return screens[i];
        }
    }

    // Fallback: any external output, widest first.
    let best = null;
    for (let i = 0; i < screens.length; i++) {
        if (isInternal(screens[i])) continue;
        if (best === null || screens[i].geometry.width > best.geometry.width) {
            best = screens[i];
        }
    }
    return best;
}

const windowMap = new Map();

function connectWindow(window) {
    if (windowMap.has(window)) return;
    windowMap.set(window, true);
    window.outputChanged.connect(() => processWindow(window));
    window.closed.connect(() => windowMap.delete(window));
}

function processWindow(window) {
    if (!window.normalWindow || !window.moveableAcrossScreens) return;
    connectWindow(window);

    const primary = primaryScreen();

    // Only the laptop panel is connected: behave like stock KDE.
    if (primary === null || workspace.screenOrder.length < 2) {
        return;
    }

    // No relevance filter: windows stranded on a non-visible desktop are
    // corrected too.
    window.onAllDesktops = (window.output !== primary);
}

function processAllWindows() {
    workspace.windowList().forEach((window) => {
        if (!window.normalWindow) return;
        processWindow(window);
    });
}

function main() {
    processAllWindows();
    workspace.screensChanged.connect(processAllWindows);
    workspace.screenOrderChanged.connect(processAllWindows);
    workspace.currentDesktopChanged.connect(processAllWindows);
    workspace.windowAdded.connect((window) => processWindow(window));
}

main();
```

Four differences from the original, each fixing something specific:

1. **The primary screen is found by identity**, not by position. Your monitor's
   values come from the same probe used above — add `s.manufacturer` and
   `s.serialNumber` to the notification to read them.
2. **The fallback is "widest non-internal output"**, so this keeps working if
   the monitor is replaced or its EDID changes.
3. **No relevance filter**, so windows parked on another desktop are corrected
   too.
4. **Inert with a single screen.** When only the laptop panel is connected,
   `screenOrder.length < 2` and nothing is forced sticky — virtual desktops
   behave normally, which is what you want on the road.

Enable it, and disable the broken one:

```bash
kwriteconfig6 --file kwinrc --group Plugins \
  --key virtualdesktopsonlyonprimaryEnabled false
kwriteconfig6 --file kwinrc --group Plugins \
  --key vdonlyprimaryfixEnabled true
```

## The other half of the problem

While reading the configuration I found a second, independent cause of the same
complaint:

```ini
[Desktops]
perOutputVirtualDesktops=true

[Windows]
PerOutputVirtualDesktops=true
```

This gives **each output its own current desktop**. It is a reasonable feature,
but it produces the same symptom from a different direction, and it fights the
script. Off:

```bash
kwriteconfig6 --file kwinrc --group Desktops --key perOutputVirtualDesktops false
kwriteconfig6 --file kwinrc --group Windows --key PerOutputVirtualDesktops false
```

## Making it survive a reboot

Loading a script over D-Bus lasts until KWin restarts. For it to persist, a
small autostart entry re-applies it at login — and after a monitor hotplug,
since it waits for KWin's scripting service to answer:

`~/.local/bin/vd-only-primary-reapply.sh`

```bash
#!/bin/bash
SCRIPT="$HOME/.local/share/kwin/scripts/vdonlyprimaryfix/contents/code/main.js"
[ -f "$SCRIPT" ] || exit 0
for _ in $(seq 1 30); do
    qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.start >/dev/null 2>&1 && break
    sleep 2
done
qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript virtualdesktopsonlyonprimary >/dev/null 2>&1
qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript vdonlyprimaryfix >/dev/null 2>&1
qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "$SCRIPT" vdonlyprimaryfix >/dev/null 2>&1
qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.start >/dev/null 2>&1
```

`~/.config/autostart/vd-only-primary.desktop`

```ini
[Desktop Entry]
Type=Application
Name=Virtual Desktops Only on Primary (fix)
Exec=/home/you/.local/bin/vd-only-primary-reapply.sh
X-KDE-autostart-phase=2
Terminal=false
NoDisplay=true
```

## Verifying it, without fooling yourself

This is where I nearly declared victory too early. The obvious check is the X11
property `_NET_WM_DESKTOP`, where `4294967295` means "on all desktops":

```bash
xprop -id <window> _NET_WM_DESKTOP
```

It works, but two things will mislead you. **X is 0-indexed and KWin is
1-indexed**, so KWin's desktop 1 reads as `0` in `xprop` — which looks like a
bug and is not. And `xdotool --onlyvisible` is *not* a test of whether a window
is on the current desktop; KWin keeps windows mapped, so it reports them
visible regardless.

Ask KWin directly instead:

```javascript
workspace.windowList().forEach(function (w) {
    if (!w.normalWindow) return;
    var ds = w.desktops.map(function (d) { return d.x11DesktopNumber; }).join("+");
    out.push(w.caption.substring(0, 18) + "@" + w.output.name +
             " all=" + w.onAllDesktops + " ds=[" + ds + "]");
});
```

Which gave, finally:

```
CUR=1
Google Tradutor@eDP-1      all=true   ds=[]
Chat - Brave@HDMI-1        all=false  ds=[1]
~ : herdr — Konsole@HDMI-1 all=false  ds=[1]
DEV-2184 - Visual @HDMI-1  all=false  ds=[1]
career — Dolphin@HDMI-1    all=false  ds=[1]
```

`all=true` on the laptop panel: pinned, immune to switching. `all=false` with a
real desktop number on everything on the LG: genuine virtual desktops. That is
the behaviour I wanted, and switching across desktops 1, 3 and 4 left the
laptop pinned every time.

## Two things worth knowing

While I was in `kglobalshortcutsrc` I discovered the shortcut I had been
cursing at was not the one I thought. There was no `Ctrl+Alt+Arrow` binding at
all — desktop switching here is **`Meta+Ctrl+Arrow`**, plus `Ctrl+F1`–`F4`:

```bash
grep -i "Switch One Desktop" ~/.config/kglobalshortcutsrc
```

Worth checking before blaming anything else.

The second: a `kdeplasma-addons` update can re-enable the stock script. If the
symptom ever comes back, that is the first thing to check:

```bash
kreadconfig6 --file kwinrc --group Plugins \
  --key virtualdesktopsonlyonprimaryEnabled     # must be false

qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.isScriptLoaded vdonlyprimaryfix
```

## What I took away

The setting was right. The monitor was right. The script was right, for a
definition of "primary" that nobody outside that one file uses.

Configuration describes what you asked for; it does not tell you what a program
concluded. The fix took ten minutes once I stopped re-reading config files and
spent the effort on making the code say out loud which screen it had picked. If
a program is doing something inexplicable, the fastest question is usually not
"what did I set?" but "what does it think I set?"
