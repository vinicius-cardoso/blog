---
title: "O GRUB se atualizou. Meu PC bootou a outra cópia."
description: "Um upgrade rotineiro do GRUB me deixou no grub rescue quatro dias depois. A atualização funcionou; o firmware é que estava bootando um segundo GRUB que nada atualiza."
pubDate: 2026-11-03
lang: "pt"
translationOf: "grub-rescue-stale-fallback-bootloader"
tags: ["linux", "grub", "uefi", "boot"]
---

Hoje de manhã meu desktop não ligou. Sem logo, sem menu, só isto:

```
grub rescue>
```

Eu não tinha mexido no bootloader. Não tinha instalado outro sistema. A última
coisa que fiz naquela máquina foi desligá-la normalmente no dia anterior.
Consertei pelo celular, com um live USB, e só depois voltei para descobrir o
que tinha acontecido de verdade. A resposta foi mais interessante que "uma
atualização quebrou o GRUB", porque a atualização não quebrou nada. Ela
funcionou perfeitamente, num arquivo que o firmware não estava usando.

## Fazendo bootar de novo

O erro que o GRUB mostrou queria dizer que a imagem principal e os módulos
vinham de versões diferentes. Não dá para resolver isso pelo prompt de rescue:
ele só tem `ls`, `set` e `insmod`, e até o `reboot` é um módulo que não carrega
pelo mesmo motivo. Então: desligar no botão, bootar um live USB, fazer chroot,
reinstalar o GRUB.

Comecei com um live USB do Ubuntu, cansei de esperar e troquei por um do
BigLinux. O BigLinux é baseado no Manjaro, então vem com o `manjaro-chroot`, que
deveria achar o sistema instalado e montar tudo sozinho:

```
$ sudo manjaro-chroot -a
ERROR: No Linux partitions detected!
```

Ele não entende subvolumes de btrfs. Minha raiz é o subvolume `@` em
`nvme0n1p2`, e o nível de cima dessa partição não parece um sistema Linux. Na
mão são cinco linhas:

```bash
sudo mount -o subvol=@ /dev/nvme0n1p2 /mnt
sudo mount /dev/nvme0n1p1 /mnt/boot/efi
for d in dev proc sys run; do sudo mount --rbind /$d /mnt/$d; done
sudo chroot /mnt
```

E, dentro do chroot:

```bash
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=biglinux
grub-install --target=x86_64-efi --efi-directory=/boot/efi --removable
grub-mkconfig -o /boot/grub/grub.cfg
```

O segundo `grub-install` é o que importa, mesmo que na hora eu tenha rodado só
como um "mal não faz". Guarde ele.

## A atualização tinha quatro dias

De volta num sistema funcionando, a primeira parada foi o log do pacman. O GRUB
tinha sido atualizado, mas não ontem:

```
[2026-10-30T16:17:55-0300] [ALPM] upgraded grub (2:2.14-1 -> 2:2.16-3.1)
```

Quatro dias antes. E a máquina tinha bootado normalmente desde então. Será?

```
$ journalctl --list-boots
IDX BOOT ID   FIRST ENTRY                  LAST ENTRY
 -1 40dc031e  Tue 2026-10-27 15:35:05 -03  Mon 2026-11-02 07:56:13 -03
  0 d08e5462  Tue 2026-11-03 10:06:05 -03  ...
```

Não tinha. Aquele boot começou no dia 27 e foi até o dia 2. O upgrade aconteceu
no meio dele. Hoje de manhã foi o **primeiro** boot depois do upgrade. Nada
mudou quatro dias depois; a bomba foi armada no dia 30 e eu só não tinha pisado
nela ainda.

## A atualização fez o trabalho dela

O BigLinux não só atualiza o pacote `grub` e deixa o bootloader antigo no lugar.
Ele traz um hook, o `98-install-grub.hook`, que roda o `install-grub` depois de
todo upgrade, para o bootloader e os módulos andarem juntos. O log mostra que
funcionou:

```
[ALPM] running '98-install-grub.hook'...
[ALPM-SCRIPTLET] Grub will be installed on: EFI
[ALPM-SCRIPTLET] Installing for x86_64-efi platform.
[ALPM-SCRIPTLET] Installation finished. No error reported.
```

E, umas linhas abaixo, a história inteira em três linhas que eu nunca li:

```
[ALPM-SCRIPTLET] Warning: GRUB bootloader at '/boot/efi/EFI/BigLinux' was updated.
[ALPM-SCRIPTLET] Your booted entry 'UEFI OS' is not the same as 'BigLinux'.
[ALPM-SCRIPTLET] This may be a rescue ISO, but if not check your EFI boot priority.
```

## Dois GRUBs na mesma partição

A partição EFI tinha duas cópias do GRUB, e o `efibootmgr` mostra qual entrada
de boot aponta para qual:

```
Boot0001* BigLinux   HD(1,GPT,...)/\EFI\BIGLINUX\GRUBX64.EFI
Boot000D* UEFI OS    HD(1,GPT,...)/\EFI\BOOT\BOOTX64.EFI
```

O `EFI/BigLinux/grubx64.efi` é o "de verdade", registrado com o nome da distro.
O `EFI/boot/bootx64.efi` é o **caminho de fallback**: o arquivo que o firmware
UEFI carrega quando não tem nenhuma entrada de boot, ou quando decide usar a
entrada genérica "UEFI OS" que ele mesmo cria. Os instaladores gravam esse
arquivo para o disco continuar bootando se as entradas da NVRAM sumirem.

O firmware estava bootando pela **UEFI OS**, ou seja, pela cópia de fallback.
Não sei quando isso começou. Pode ter sido um reset da BIOS, ou o firmware
reordenando as entradas por conta própria. Não fazia diferença até agora,
porque os dois arquivos eram o mesmo GRUB 2.14.

Isto é o que o upgrade do dia 30 fez de fato:

| Arquivo | Antes | Depois |
|---|---|---|
| `EFI/BigLinux/grubx64.efi` | 2.14 | **2.16** |
| `/boot/grub/x86_64-efi/*.mod` | 2.14 | **2.16** |
| `EFI/boot/bootx64.efi` | 2.14 | 2.14 |

O `install-grub` atualiza a cópia com nome e os módulos compartilhados. Ele
nunca toca no fallback. Então, no boot seguinte, uma imagem 2.14 carregou
módulos de `/boot/grub` compilados para a 2.16. Os símbolos internos não
batiam, e o GRUB desistiu e caiu no `grub rescue>`.

Por isso a linha com `--removable` era a importante no conserto. Ela
reescreveu o `EFI/boot/bootx64.efi`. Sem ela, eu teria reinstalado a cópia que
o firmware não usava e reiniciado direto de volta no prompt de rescue.

## Para não acontecer de novo

Depois do conserto, os dois arquivos são idênticos:

```
3c803b7c...e40a  /boot/efi/EFI/BigLinux/grubx64.efi
3c803b7c...e40a  /boot/efi/EFI/boot/bootx64.efi
```

Isso também mostra que copiar um por cima do outro é seguro. O `grub-install`
gera a mesma imagem nos dois casos; a imagem acha o `/boot/grub` pelo UUID da
partição, não pelo lugar onde o `.efi` está.

Então a prevenção é um hook do pacman que faz exatamente essa cópia depois de
todo upgrade do GRUB, em `/etc/pacman.d/hooks/99-grub-fallback-sync.hook`:

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

O nome do arquivo define a ordem. O pacman roda os hooks em ordem alfabética,
então `99-grub-…` cai depois do `98-install-grub` do BigLinux e antes do
`99-update-grub`. Ele só copia quando os arquivos são diferentes, então na
maior parte das vezes não faz nada.

Também apaguei uma entrada de boot `ubuntu` que sobrou de uma instalação que
não existe mais. Ela não causou o problema, mas era mais uma entrada que o
firmware podia escolher primeiro.

## O que eu levo disso

O sistema me avisou. O pacman mostrou um aviso que dizia, quase com essas
palavras, "você está bootando um GRUB diferente do que eu acabei de atualizar",
e ele passou batido no meio de um upgrade de 560 pacotes.

A lição mais geral é que "o bootloader" numa máquina UEFI não é um arquivo só.
Existe a cópia registrada com o nome da sua distro e existe a cópia de
fallback. Qualquer ferramenta que atualiza uma delas, e qualquer firmware que
troca de uma para a outra em silêncio, pode te deixar com um GRUB metade de uma
versão e metade de outra. Se sua máquina cair no `grub rescue>` depois de uma
atualização que você sabe que deu certo, confira por qual entrada ela realmente
dá boot antes de reinstalar qualquer coisa.
