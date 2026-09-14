---
title: "Meu zram era maior que minha RAM"
description: "Abaixar o volume travava a máquina inteira, enquanto um filme rodava liso. A causa eram 22,9 GB de swap comprimida morando dentro de 15 GB de memória."
pubDate: 2026-09-14
lang: "pt"
translationOf: "zram-sized-larger-than-ram"
tags: ["linux", "memoria", "zram", "performance"]
---

Meu notebook vivia travando em coisas triviais. Não em compilação, não em build
de Docker — em coisas como clicar num menu. O caso que finalmente me fez
investigar: assisti a um filme inteiro no SMPlayer sem um engasgo, aí fui mexer
no controle de volume e a máquina inteira congelou.

Essa combinação é invertida. Trabalho pesado ia bem; mudar o volume era fatal.
Fosse o que fosse, não era "o computador está lento".

## Medir o travamento em vez de adivinhar

`free -h` e `top` não servem aqui, porque quando você consegue ler a tela o
travamento já passou. O que você quer é PSI — pressure stall information, em
`/proc/pressure/`:

```
$ cat /proc/pressure/memory
some avg10=0.00 avg60=0.00 avg300=0.17 total=2034355
full avg10=0.00 avg60=0.00 avg300=0.17 total=2017374
```

As médias distraem. O que importa é o `total=`: microssegundos acumulados que as
tarefas passaram travadas. Amostre num timer e o delta entre duas amostras diz
qual fração do tempo real a máquina passou congelada. `full` significa que
*todas* as tarefas estavam travadas — isso é um freeze, por definição.

Deixei um coletor amostrando a cada 20 segundos e voltei a trabalhar. Em 95
minutos ele registrou isto:

```
11:27:08  avail=2.96Gi  swap=2.69Gi
11:48:05  avail=3.20Gi  swap=2.69Gi
12:19:54  avail=3.77Gi  swap=3.38Gi
12:51:43  avail=3.19Gi  swap=4.31Gi
13:02:20  avail=4.15Gi  swap=4.45Gi
```

A swap subiu de 2,69 para 4,45 GB e nunca voltou. Enquanto isso a RAM disponível
ficou parada. Mesmo depois que o maior processo da máquina — 1,37 GB — saiu, a
swap *aumentou*.

Isso não é vazamento de um programa. A memória estava indo para algum lugar e
não voltava.

## Para onde ela estava indo

```
$ cat /proc/swaps
Filename          Type        Size      Used      Priority
/dev/zram1        partition   5998412   1151552   32767
/dev/zram2        partition   5998412   1153096   32767
/dev/zram3        partition   5998412   1141140   32767
/dev/zram4        partition   5998412   1125820   32767
/swapfile/1       file        524284    0         -2
```

Quatro dispositivos zram, 6,14 GB cada. Isso dá **22,9 GB de swap numa máquina
com 15,25 GB de RAM**.

Esse é o bug inteiro, e vale ser preciso sobre por que é um bug. zram não é
disco. É um dispositivo de bloco comprimido que vive *na RAM*. Mandar uma página
para o zram comprime e mantém ela na memória — mais barato que ir até o NVMe, que
é exatamente por que a ideia é boa no geral.

Mas dimensionar em 150% da RAM inverte a lógica. O kernel passa a acreditar que
tem 38 GB de memória para distribuir. Não tem. Cada página que ele "libera"
mandando para swap continua ocupando RAM, só que comprimida. O pool compete com
a própria memória que existe para aliviar, e o sistema se acomoda num equilíbrio
onde uma fatia crescente da sua RAM guarda uma cópia comprimida da sua RAM.

O meu veio do padrão da distro:

```
$ grep zram_size /usr/share/systemd-swap/swap-default.conf
## zram_size=150%    # Virtual disksize (% of RAM). Larger = more data in RAM
```

Eu também tinha colocado `vm.swappiness = 100` meses antes, com um comentário no
arquivo explicando que swappiness alta aproveita bem o zram rápido. O raciocínio
é válido — mas só se o zram estiver dimensionado com juízo. Em 150% ele apenas
alimentava a espiral mais rápido.

## Por que o controle de volume, e não o filme

Essa é a parte que explica o sintoma, e demorei para enxergar.

Tocar um filme é sequencial e previsível. As páginas que ele toca o tempo todo
continuam residentes; tudo que ele *não* toca é empurrado para o zram —
incluindo as partes do PipeWire, dos widgets Qt e dos assets do tema que ninguém
precisou nas últimas duas horas. O playback fica liso o tempo inteiro.

Aí você clica no volume. Isso exige um round-trip imediato justamente por essas
páginas frias, e descomprimir exige RAM livre — que é a única coisa que não tem.
Áudio roda numa thread de tempo real com prazo rígido. Quando ela perde o prazo,
não degrada com elegância; leva o desktop junto.

Então a regra numa máquina nesse estado é invertida: trabalho pesado e
sequencial é a coisa *mais segura* que você pode fazer. Ações pequenas e
interativas é que matam.

## A correção

Duas linhas. `/etc/systemd/swap.conf`:

```ini
zram_size=50%
zram_alg=zstd
```

e `/etc/sysctl.d/99-performance-tuning.conf`:

```ini
vm.swappiness = 70
```

50% da RAM é o dimensionamento convencional, e o pool continua expandindo sob
demanda quando há pressão real — ele só não reivindica de antemão mais memória
do que a máquina fisicamente tem.

Vale mencionar uma armadilha. Reiniciar o `systemd-swap` força tudo que está no
zram de volta para a RAM real, e eu tinha 3,96 GB de dados descomprimidos lá
contra 4,11 GB disponíveis. Essa margem é fina demais; teria matado alguma coisa
por OOM. Então criei um swapfile temporário em disco antes, como rede de
segurança.

No btrfs isso tem seu próprio detalhe:

```
$ sudo swapon /var/tmp/temp.swap
swapon: /var/tmp/temp.swap: swapon failed: Invalid argument

$ sudo dmesg | tail -1
BTRFS warning (device dm-0): swapfile must not be copy-on-write
```

Swapfile no btrfs precisa de `chattr +C` no arquivo vazio, *antes* de escrever
qualquer dado nele:

```bash
sudo truncate -s 0 /var/tmp/temp.swap
sudo chattr +C /var/tmp/temp.swap
sudo dd if=/dev/zero of=/var/tmp/temp.swap bs=1M count=8192
sudo chmod 600 /var/tmp/temp.swap
sudo mkswap /var/tmp/temp.swap && sudo swapon -p 1 /var/tmp/temp.swap
```

`fallocate` não serve — ele produz um layout de extents que a swap rejeita.

## O resultado

O total de swap caiu de 22,9 GB para 7,6 GB, e o uso despencou:

```
antes:  swap usada 4,57 Gi   pressão de memória subindo a manhã toda
depois: swap usada 0,21 Gi   pressão de memória ~0%
```

O mesmo clipe 1080p que usei como controle agora toca com 1,51% de stall de
memória e 408 ms de stall de I/O num teste de 20 segundos.

O `MemAvailable` agora mostra um número *menor* — 1,69 GB em vez de 4,15 GB — e
isso parece alarmante até você perceber que é justamente o ponto. Aquele dado
está em RAM real em vez de comprimido dentro de uma RAM que também era contada
como livre. O número anterior contava duas vezes.

## O que eu faria diferente

Passei a primeira parte disso convencido de que era problema de vídeo, porque os
travamentos aconteciam perto do VLC e do SMPlayer. Não era. A decodificação por
hardware funcionou perfeitamente o tempo todo — confirmei tocando um clipe e
vendo a pressão de memória se mexer um microssegundo.

Os players eram vítimas, não causas. O que os fazia parecer culpados é que eles
consomem memória suficiente para empurrar o sistema além do limite, e são o app
que você por acaso está tocando quando ele vira.

A lição que levo: quando um sintoma aponta para um aplicativo, meça o aplicativo
direto antes de acreditar. Um playback controlado de 20 segundos teria inocentado
o VLC nos primeiros cinco minutos. E quando uma ação *pequena* trava uma máquina
que aguenta as *grandes* numa boa, pare de olhar para o aplicativo — essa
assimetria é assinatura de reclaim de memória, e aponta para a ideia que o kernel
tem de quanta memória ele possui.
