---
title: "GRUB updated itself. My PC booted the other copy."
description: "A routine GRUB upgrade left me at grub rescue four days later. The update worked; the firmware was just booting a second GRUB that nothing ever updates."
pubDate: 2026-11-03
lang: "en"
translationOf: "grub-rescue-stale-fallback-bootloader"
tags: ["linux", "grub", "uefi", "boot"]
---

This morning my desktop didn't boot. No logo, no menu, just this:

```
grub rescue>
```

I hadn't touched the bootloader. I hadn't installed another OS. The last thing
I did on that machine was shut it down normally the day before. I fixed it from
my phone with a live USB, and only afterwards went back to find out what had
actually happened. The answer turned out to be more interesting than "an update
broke GRUB", because the update didn't break anything. It worked perfectly. On
a file the firmware wasn't using.

## Getting it to boot again

The error GRUB printed meant its core image and its modules came from different
versions. You can't fix that from the rescue prompt: it only has `ls`, `set` and
`insmod`, and even `reboot` is a module that won't load for the same reason. So:
hard power-off, boot a live USB, chroot, reinstall GRUB.

I started with an Ubuntu live USB, got bored waiting for it, and switched to a
BigLinux one. BigLinux is Manjaro-based, so it ships `manjaro-chroot`, which is
supposed to find your installed system and mount everything for you:

```
$ sudo manjaro-chroot -a
ERROR: No Linux partitions detected!
```

It doesn't understand btrfs subvolumes. My root is the `@` subvolume on
`nvme0n1p2`, and the top level of that partition doesn't look like a Linux
system at all. By hand, it's five lines:

```bash
sudo mount -o subvol=@ /dev/nvme0n1p2 /mnt
sudo mount /dev/nvme0n1p1 /mnt/boot/efi
for d in dev proc sys run; do sudo mount --rbind /$d /mnt/$d; done
sudo chroot /mnt
```

Then, inside the chroot:

```bash
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=biglinux
grub-install --target=x86_64-efi --efi-directory=/boot/efi --removable
grub-mkconfig -o /boot/grub/grub.cfg
```

The second `grub-install` is the one that matters, though at the time I ran it
as a "can't hurt" extra. Remember it.

## The update was four days old

Back on a working system, the first stop was the pacman log. GRUB had been
upgraded, but not yesterday:

```
[2026-10-30T16:17:55-0300] [ALPM] upgraded grub (2:2.14-1 -> 2:2.16-3.1)
```

Four days earlier. And the machine had booted fine since then. Or had it?

```
$ journalctl --list-boots
IDX BOOT ID   FIRST ENTRY                  LAST ENTRY
 -1 40dc031e  Tue 2026-10-27 15:35:05 -03  Mon 2026-11-02 07:56:13 -03
  0 d08e5462  Tue 2026-11-03 10:06:05 -03  ...
```

No, it hadn't. That boot started on the 27th and ran until the 2nd. The upgrade
happened in the middle of it. This morning was the **first** boot after the
upgrade. Nothing changed four days later; the bomb was armed on the 30th and I
simply hadn't stepped on it.

## The update did its job

BigLinux doesn't just upgrade the `grub` package and leave the old bootloader
in place. It ships a hook, `98-install-grub.hook`, that runs `install-grub`
after every upgrade, so the bootloader and its modules move together. The log
shows it worked:

```
[ALPM] running '98-install-grub.hook'...
[ALPM-SCRIPTLET] Grub will be installed on: EFI
[ALPM-SCRIPTLET] Installing for x86_64-efi platform.
[ALPM-SCRIPTLET] Installation finished. No error reported.
```

And then, a few lines further down, the whole story in three lines that I never
read:

```
[ALPM-SCRIPTLET] Warning: GRUB bootloader at '/boot/efi/EFI/BigLinux' was updated.
[ALPM-SCRIPTLET] Your booted entry 'UEFI OS' is not the same as 'BigLinux'.
[ALPM-SCRIPTLET] This may be a rescue ISO, but if not check your EFI boot priority.
```

## Two GRUBs in one partition

The EFI partition had two copies of GRUB, and `efibootmgr` shows which boot
entry points at which:

```
Boot0001* BigLinux   HD(1,GPT,...)/\EFI\BIGLINUX\GRUBX64.EFI
Boot000D* UEFI OS    HD(1,GPT,...)/\EFI\BOOT\BOOTX64.EFI
```

`EFI/BigLinux/grubx64.efi` is the "real" one, registered under the distro's
name. `EFI/boot/bootx64.efi` is the **fallback path**: the file UEFI firmware
loads when it has no boot entries at all, or when it decides to use the
generic "UEFI OS" entry it builds for itself. Installers write it so a disk
still boots if the NVRAM entries get wiped.

The firmware was booting through **UEFI OS**, which means the fallback copy. I don't
know when that started. It might have been a BIOS reset, or the firmware might have
reordered entries on its own. It didn't matter until now, because both files were
the same GRUB 2.14.

Here is what the upgrade on the 30th actually did:

| File | Before | After |
|---|---|---|
| `EFI/BigLinux/grubx64.efi` | 2.14 | **2.16** |
| `/boot/grub/x86_64-efi/*.mod` | 2.14 | **2.16** |
| `EFI/boot/bootx64.efi` | 2.14 | 2.14 |

`install-grub` updates the named copy and the shared modules. It never touches
the fallback. So on the next boot, a 2.14 core image loaded modules from
`/boot/grub` that were built for 2.16. Their internal symbols didn't match, and
GRUB gave up and dropped to `grub rescue>`.

That's why the `--removable` line in the fix was the important one. It
rewrote `EFI/boot/bootx64.efi`. Without it, I would have reinstalled the copy
the firmware wasn't using and rebooted straight back into the rescue prompt.

## Making it not happen again

After the fix, the two files are identical:

```
3c803b7c...e40a  /boot/efi/EFI/BigLinux/grubx64.efi
3c803b7c...e40a  /boot/efi/EFI/boot/bootx64.efi
```

That also shows that copying one over the other is safe. `grub-install` builds
the same image either way; the core finds `/boot/grub` by the partition's UUID,
not by where the `.efi` file sits.

So the prevention is a pacman hook that does exactly that copy after every GRUB
upgrade, in `/etc/pacman.d/hooks/99-grub-fallback-sync.hook`:

```ini
[Trigger]
Operation = Install
Operation = Upgrade
Type = Package
Target = grub

[Action]
Description = Syncing UEFI fallback bootloader with EFI/BigLinux/grubx64.efi...
When = PostTransaction
Exec = /bin/sh -c 'src=/boot/efi/EFI/BigLinux/grubx64.efi; dst=/boot/efi/EFI/boot/bootx64.efi; if [ -f "$src" ] && [ -d "${dst%/*}" ] && ! cmp -s "$src" "$dst"; then cp "$src" "$dst" && echo "Updated $dst"; fi'
```

The filename sets the order. Pacman runs hooks alphabetically, so `99-grub-…`
lands after BigLinux's `98-install-grub` and before `99-update-grub`. It only
copies when the files differ, so most of the time it does nothing.

I also deleted a leftover `ubuntu` boot entry from an install that no longer
exists. It didn't cause this, but it was one more entry the firmware could have
picked first.

## What I'm taking from this

The system told me. Pacman printed a warning that said, almost word for word,
"you are booting a different GRUB from the one I just updated", and it scrolled
past in the middle of a 560-package upgrade.

The more general lesson is that "the bootloader" on a UEFI machine isn't one file.
There's the copy registered under your distro's name and the fallback copy. Any
tool that updates one of them, and any firmware that silently switches between
them, can leave you with a GRUB that's half one version and half another. If
your machine ever lands on `grub rescue>` after an update you know succeeded,
check which entry it actually boots before you reinstall anything.
