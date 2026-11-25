---
title: "Coloquei o Claude dentro da minha Echo Dot"
description: "Soldar três fios num alto-falante trancado, um bug de assinatura no U-Boot, um build de 26 GB e o erro de configuração de uma linha que me obrigou a ler o log do próprio aparelho — como minha Echo Dot 5 parou de responder à Amazon e passou a responder ao Claude."
pubDate: 2026-11-25
lang: "pt"
translationOf: "claude-inside-my-echo-dot"
series: "echo-claude"
part: 1
heroImage: "/echo-claude/hero-building.jpg"
tags: ["hardware", "home-assistant", "ia", "engenharia-reversa", "linux"]
---

Tenho uma Echo Dot na mesa, pareada ao notebook por Bluetooth como caixa de som.
Numa noite fiz a pergunta óbvia: a Alexa é ok, mas o Claude responde *muito*
melhor. E se eu pudesse falar com o hardware que já tenho, mas fazer o Claude ser
quem responde? Não um app, não o celular — o próprio alto-falante.

Esta é a história inteira: o que funcionou, o que não funcionou, os erros que
colei às 2 da manhã, e o erro de configuração de uma linha que quase me venceu na
reta final. Ela termina comigo dizendo "Alexa, o que é emaranhamento quântico"
para um aparelho que não contém mais uma única linha do assistente da Amazon, e
uma voz feminina respondendo.

## Primeiro, um balde de água fria

Meu primeiro palpite estava errado, e vale dizer isso. Achei que o Bluetooth era
a porta de entrada — interceptar o áudio, encaixar o Claude no meio. Não é. A
conexão Bluetooth é **só áudio**: ela leva som para o alto-falante e nada mais.
Os microfones, a wake word e todo o tráfego para a Amazon correm por Wi-Fi,
criptografados, confiados só nos servidores da Amazon. Não há nada ali para
interceptar discretamente.

O único jeito real de fazer o aparelho rodar meu código é **substituir o
firmware**. E isso só funciona em alguns modelos. Então a primeira pergunta era:
qual Echo eu tenho, afinal?

O nome Bluetooth dizia `Echo Dot-H31`. Esse `H31` acabou sendo uma pista falsa —
é um rótulo de pareamento que a Amazon coloca no nome Bluetooth por aparelho, não
um código de modelo. Duas Echoes de gerações completamente diferentes podem
aparecer as duas como `-H31`. A resposta de verdade estava embaixo do aparelho:

```
Model No. C2N6L4
```

Essa é a **Echo Dot 5ª geração (2022)**, codinome `cannoli`, rodando um chip
MediaTek. E foi aqui que quase desisti: a 5ª geração é hardware *mais novo*, com
secure boot e firmware assinado. Todo projeto de "rootear a Echo" que achei
parava na 3ª geração. Convenci a mim mesmo de que era um beco sem saída.

Aí achei o [echo-dot-assist](https://github.com/Gamer92000/echo-dot-assist), e
ele tinha um alvo `cannoli`. Era real. Meu modelo exato. Documentado de ponta a
ponta. O porém, nas palavras do próprio README: *"Este é o único modelo ainda sem
setup guiado: você solda três fios, monta o bundle de imagem você mesmo e roda o
instalador. Só o build da recovery baixa uma árvore de código de 26 GB."*

Beleza. Vamos soldar.

## O unlock, em um parágrafo

Antes da solda, a parte que torna tudo possível. A 5ª geração verifica seu
bootloader com uma assinatura, então você não pode simplesmente gravar o seu.
O exploit é a **CVE-2026-46728**: a checagem de assinatura do U-Boot lê uma dica
"hashed-nodes" não assinada da própria imagem que está verificando. O builder a
transforma em arma — move o nó de boot real para um arquivo, aponta a dica da
assinatura para a cópia arquivada, e troca por um payload totalmente modificado.
O fluxo de bytes assinado nunca muda, então **a própria assinatura da Amazon
valida sobre um U-Boot modificado**. Essa é a porta.

## Soldando em pads que não querem ser achados

A porta USB-C da Echo Dot é só energia — sem linhas de dados. Os pads de dados
são uma matriz 3×3 de minúsculos pontos de teste dourados escondidos numa
reentrância atrás do pé de borracha na base. Você descola o pé (sai com a mão),
solta quatro parafusos Torx T8, e lá está:

![A placa da Echo Dot 5, com o pé de borracha removido, mostrando a matriz de pads perto do texto FLEX SIDE](/echo-claude/board-pads.jpg)

Três fios: GND no pad central, D− logo abaixo dele, D+ no pad de canto à
esquerda. O fio vermelho de +5 V fica **desconectado** — a Dot roda no próprio
adaptador de 15 V, e o USB carrega só dados e terra. Essa única regra é o que
mantém a placa viva.

![Três fios soldados na matriz de pads, +5 V deixado sem conexão](/echo-claude/soldered-pads.jpg)

O momento da verdade não é a solda — é se o PC vê alguma coisa. USB no notebook,
segurar o botão de ação, plugar o adaptador de 15 V, e:

```
$ fastboot devices
G0922H0735040H31	 Android Fastboot
```

Lá está. A ligação funciona. Esse serial seria a chave de cada passo seguinte.

![A Echo aberta na base de corte, fios soldados, anel de luz aceso, o log do build no monitor atrás](/echo-claude/echo-working.jpg)

## O build de 26 GB (e um susto)

A instalação precisa de três coisas compiladas do código: uma recovery TWRP, o
bundle de atualização do port, e o bundle do SO. A recovery é a grande — ela
sincroniza uma árvore de código Android de **26 GB** e compila por horas. Num
notebook de 15 GB de RAM rodei com `JOBS=3` para evitar um kill por falta de
memória, e vi arrastar:

```
[ 22% 2392/10767] target thumb C++: recovery <= bootable/recovery/twrp.cpp
...
[100% 10767/10767] ----- Making compressed recovery ramdisk ------
#### build completed successfully (06:44 (mm:ss)) ####
```

Antes de terminar, porém, o build cuspiu uma parede de vermelho que parou meu
coração por um segundo:

```
_ssl.c:2198:27: error: passing argument 1 of 'SSL_CTX_new' makes pointer from
  integer without a cast [-Wint-conversion]
_ssl.c:2202:27: error: implicit declaration of function 'SSLv3_method'
```

Parece que o build está morrendo. Não está. O build da recovery compila o próprio
**Python 2.7.18 (de 2020)** contra o **OpenSSL 4.1** do meu sistema, e o módulo
`_ssl` do Python 2.7 usa APIs do OpenSSL que foram removidas anos atrás. Esses
módulos são opcionais — o Python pula eles e compila o interpretador mesmo assim,
e o build só precisava que o `import zlib` funcionasse. Um susto, não um erro. A
lição que eu sempre reaprendo: leia o que o erro *é*, não o que ele parece.

## "Unsupported firmware prerequisite: tee1"

Com tudo compilado, coloquei a Dot em fastboot e rodei o unlock. Foi longe —
fez backup do slot A, instalou a TWRP no slot B — e aí parou seco:

```
ERROR: Unsupported firmware prerequisite: tee1; cannoli-upgrade brings a 2022
unit up to 8349
```

Desse eu tinha sido avisado. Minha Dot saiu de fábrica em 2022 com firmware mais
antigo que o build (`8349`) contra o qual todo o port é fixado, e uma das
partições protegidas não batia. O conserto é um desvio documentado: desempacotar
o firmware de fábrica fixado, rodar `cannoli-upgrade` para subir essas partições
para o 8349, e refazer a instalação. Tem um passo sem volta enterrado ali — o
primeiro boot do firmware novo queima um **eFuse anti-rollback**, permanente, o
mesmo que qualquer atualização da Amazon queimaria. Você digita `yes` e tem
certeza.

```
✅ Writing and verifying tee1
✅ Writing and verifying tee2
✅ Prerequisites upgraded
```

Então a instalação de verdade, de novo, e dessa vez a linha que eu queria:

```
✅ Cannoli rooted on slot A; hold Volume Up at power-on for TWRP
```

Desliguei, religuei sem segurar botão nenhum, e vi o anel de luz subir e
estabilizar. Âmbar. No port, âmbar significa "instalado, esperando ser adotado
pelo Home Assistant." O aparelho tinha dado boot no meu firmware. O assistente da
Amazon tinha ido embora.

## Um aparte: o robô vivia sendo interrompido

Uma parte pequena e estranha da experiência. Fiz isso com o Claude Code dirigindo
o terminal ao meu lado, e um classificador de segurança vivia cortando as
respostas dele no meio da frase — ele dava match em "modificando um aparelho
trancado" e disparava, sem entender que era a *minha própria* Echo e um projeto
open-source. Toda vez que uma resposta era retida, a gente só seguia. É um filtro
tosco, não um julgamento, mas é engraçado esbarrar nisso enquanto você está
literalmente com um ferro de solda na mão sobre o seu próprio hardware.

## Home Assistant, e o Claude como cérebro

O port transforma a Echo num **satélite de voz do Home Assistant** — os
microfones, a wake word e o alto-falante ficam, mas ela responde ao *seu* Home
Assistant em vez da Amazon. Eu ainda não tinha Home Assistant, então rodei ele em
Docker no notebook, mudei a interface toda para inglês, e a Echo apareceu sozinha
pelo Bluetooth:

![O Home Assistant descobrindo a Echo Dot pelo Bluetooth](/echo-claude/ha-bluetooth.png)

Daí em diante é um pipeline: **fala-para-texto → um agente de conversa → texto-para-fala.**
Liguei o [Whisper](https://github.com/rhasspy/wyoming-whisper) local para os
ouvidos e o [Piper](https://github.com/rhasspy/wyoming-piper) para a voz, os dois
rodando offline em Docker. O cérebro é a **integração Anthropic** — o Claude —
apontada pelo agente de conversa do pipeline. Num teste por texto ele respondeu
na hora. Estava tudo verde.

## O bug que parecia sucesso

Aí eu disse a wake word, e nada aconteceu. O anel piscou vermelho e apagou.
Sem resposta.

Os logs do Home Assistant mostravam o pipeline começando e terminando em **um
milissegundo**, sem áudio nenhum capturado:

```
Running pipeline 1 from stt to tts
Initialized microVAD
Pipeline finished
Requested pipeline abort
```

Persegui isso por um tempo — reiniciei a Echo, conferi que o mic não estava
mutado, verifiquei que o Whisper tinha o modelo, confirmei as portas de rede.
Tudo verde, tudo certo, e ainda sem áudio. O estalo foi lembrar que o aparelho
tem o *próprio* log. Abri o adb por Wi-Fi e li o que a própria Echo estava
dizendo:

```
wake: ALEXA type=2  level -45.2 dBFS over noise -80.0 dBFS
state: idle -> listening
(private) pipeline error: validation-error the pipeline does not support
  speech-to-text
state: listening -> idle
```

Lá estava, em uma linha: **"the pipeline does not support speech-to-text."** A
Echo me ouviu perfeitamente — ótimos níveis de áudio. Era o Home Assistant que
recusava a execução, porque o pipeline que a Echo de fato usava não tinha *nenhum
motor de STT ligado*. O satélite hassmic expõe dois slots de assistente, e o
primário ainda estava apontado para o pipeline padrão, que tinha fala-para-texto
em "None." Eu tinha configurado o Claude no slot errado.

Um `select.select_option` para apontar o slot primário para o meu pipeline do
Claude, e:

Eu disse "Alexa, o que é emaranhamento quântico," o anel ficou azul e continuou
azul, ele pensou por um segundo, e uma voz leu a resposta de volta. Funcionou.

## Mais uma coisa: a voz estava horrível

A primeira voz que saiu foi `en_GB/alan` em qualidade *low* — uma voz masculina
chapada e robótica. Nada do que eu queria. Troquei o container do Piper para
`en_US-amy-medium` e casei a voz de TTS do pipeline com ela. Agora ela responde
numa voz feminina clara e acolhedora. Mudança pequena, sensação completamente
diferente.

## O que é agora

Uma Echo Dot 5 que:

- roda firmware open-source, com o assistente da Amazon totalmente fora
- é um satélite de voz do Home Assistant na minha própria rede
- me ouve com Whisper local, responde numa voz local do Piper
- e pensa com o **Claude**

Nada sai da minha rede além das chamadas à API do Claude. Os microfones, a wake
word, o fala-para-texto, a voz — tudo local.

## O que eu tirei disso

O hardware não foi a parte difícil. Soldar três fios e ler um número de série
parecia o trabalho "de verdade", mas a placa estava viva na primeira tentativa.
O que de fato comeu as horas foram os momentos em que algo *parecia* uma coisa e
era outra: uma parede de erros `_ssl` que era só um módulo opcional sendo pulado;
um pipeline "terminando com sucesso" num milissegundo que era na verdade um abort
por áudio vazio; um anel de luz vermelho que significava "erro de configuração",
não "mic mutado".

Cada um deles foi resolvido do mesmo jeito — parar de confiar no sintoma, achar o
log mais próximo da coisa que está falhando, e ler o que ele de fato diz. O
`boot.log` da própria Echo, quatro camadas abaixo da interface que eu ficava
encarando, tinha a resposta em inglês claro o tempo todo. Quase sempre tem.
