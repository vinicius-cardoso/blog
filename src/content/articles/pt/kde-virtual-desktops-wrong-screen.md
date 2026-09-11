---
title: "O KDE estava trocando de desktop na tela errada"
description: "O script embutido do KWin escolhe o monitor primário pela posição, não pela flag de primário. Num notebook com monitor externo, isso inverte os dois."
pubDate: 2026-09-11
lang: "pt"
translationOf: "kde-virtual-desktops-wrong-screen"
tags: ["kde", "linux", "kwin"]
---

Eu tinha um notebook com um monitor LG externo, o KDE configurado exatamente
como a documentação manda, e mesmo assim o comportamento errado. O LG estava
marcado como tela primária. O script do KWin *Virtual Desktops Only on Primary*
estava ativado. Apertar o atalho de troca de desktop continuava mexendo na tela
do **notebook** e deixava o LG parado — exatamente o contrário.

Eu já tinha redefinido o monitor primário mais vezes do que gostaria de
admitir. Nunca resolveu, e agora sei por quê: o script nunca lê essa
configuração.

## A opção que parece que deveria funcionar

O KDE distribui, no `kdeplasma-addons`, um script chamado *Virtual Desktops
Only on Primary*. Você marca em **Configurações do Sistema → Scripts do KWin**
e os desktops virtuais deveriam afetar só a tela primária; o que está nas
outras telas fica onde está.

A configuração parecia toda certa:

```bash
$ xrandr --query | grep -w primary
HDMI-1 connected primary 2560x1080+1920+0

$ kscreen-doctor -o | grep -E "Output:|priority"
Output: 66 eDP-1
	priority 2
Output: 67 HDMI-1
	priority 1
```

`priority 1` é a primária. As duas ferramentas concordam que é o LG. O próprio
relatório de suporte do KWin concorda também:

```
Screens
=======
Screen 0:
---------
Name: HDMI-1
```

Três fontes independentes, uma resposta: **HDMI-1 é a primária**. E ainda
assim.

## Perguntando ao script o que ele enxerga

Arquivo de configuração descreve intenção. Eu queria saber no que o script
realmente acreditava em tempo de execução, que é outra pergunta.

Um script do KWin pode imprimir com `console.info`, mas nesta máquina o KWin
não escreve nada no journal — ele tinha sido iniciado com `--replace` fora do
systemd, então a saída ia para um socket que eu não conseguia ler. As
notificações acabaram sendo o canal confiável: o script manda uma pelo D-Bus,
com o `dbus-monitor` já rodando para capturar.

```javascript
var names = workspace.screenOrder.map(function (s) { return s.name; }).join("|");
var msg = "ORDER[" + names + "] FIRST[" + workspace.screenOrder[0].name + "]" +
          " ACTIVE[" + workspace.activeScreen.name + "]";

callDBus("org.freedesktop.Notifications", "/org/freedesktop/Notifications",
         "org.freedesktop.Notifications", "Notify",
         "probe", 0, "", "KWINPROBE", msg, [], {}, 3000);
```

Suba o listener **primeiro**, depois carregue e rode o script:

```bash
( timeout 8 dbus-monitor "interface='org.freedesktop.Notifications',member='Notify'" > /tmp/mon.txt & )
sleep 1
qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript /tmp/probe.js probe
qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.start
sleep 3
grep -a -o "ORDER\[[^]]*\] FIRST\[[^]]*\] ACTIVE\[[^]]*\]" /tmp/mon.txt
```

A resposta:

```
ORDER[eDP-1|HDMI-1]  FIRST[eDP-1]  ACTIVE[HDMI-1]
```

Achamos.

## O bug

O script original decide qual tela proteger logo na primeira linha de trabalho
de verdade:

```javascript
let primaryScreen = workspace.screenOrder[0];
```

**Na API de scripting do KWin, o `screenOrder` é ordenado pela posição do
output, não pela flag de primário.** O painel do meu notebook fica em x=0 e o
LG em x=1920, então `screenOrder[0]` é sempre o `eDP-1` — o embutido — não
importa o que o xrandr, o kscreen ou as Configurações do Sistema digam sobre
qual monitor é o primário.

Ou seja: o script estava fazendo o trabalho dele perfeitamente. Estava
protegendo a tela que ele acreditava ser a primária, e essa tela era o
notebook. O LG continuava trocando porque o script tinha os dois invertidos.

Isso também explica por que redefinir o monitor primário nunca resolvia nada.
A flag existe e é real, e outras partes do KDE a respeitam — este script
simplesmente não a consulta.

Há um segundo bug, menor, no mesmo arquivo:

```javascript
let onCurrentDesktop = desktops.includes(workspace.currentDesktop);
let windowIsRelevant = onCurrentDesktop || window.onAllDesktops;
if (!windowIsRelevant) {
    return;
}
```

Uma janela que não está no desktop atual nem já é fixa é ignorada por completo.
Janelas "presas" em algum outro desktop nunca são corrigidas, então mesmo com
as telas identificadas certo o resultado vai se degradando com o tempo.

E a tela primária é capturada **uma única vez**, no carregamento. Plugue o
monitor depois do login e o script continua apontando para o que estava lá
antes.

## A correção

Em vez de remendar um arquivo em `/usr/share` que a próxima atualização do
`kdeplasma-addons` sobrescreveria, escrevi uma versão corrigida em
`~/.local/share`, onde nenhum gerenciador de pacotes encosta.

Crie `~/.local/share/kwin/scripts/vdonlyprimaryfix/metadata.json`:

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

E o `contents/code/main.js` ao lado:

```javascript
// O monitor externo, pela identidade estável do EDID.
const PRIMARY_MANUFACTURER = "LG Electronics";
const PRIMARY_SERIAL = "0x00044676";

function isInternal(screen) {
    return screen.name.indexOf("eDP") === 0 || screen.name.indexOf("LVDS") === 0;
}

function primaryScreen() {
    const screens = workspace.screenOrder;

    // Preferência: o monitor externo conhecido.
    for (let i = 0; i < screens.length; i++) {
        if (screens[i].manufacturer === PRIMARY_MANUFACTURER &&
            screens[i].serialNumber === PRIMARY_SERIAL) {
            return screens[i];
        }
    }

    // Fallback: qualquer saída externa, a mais larga primeiro.
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

    // Só o painel do notebook conectado: comporta-se como o KDE padrão.
    if (primary === null || workspace.screenOrder.length < 2) {
        return;
    }

    // Sem filtro de relevância: janelas presas num desktop invisível também
    // são corrigidas.
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

Quatro diferenças em relação ao original, cada uma resolvendo algo específico:

1. **A tela primária é encontrada por identidade**, não por posição. Os valores
   do seu monitor saem da mesma sonda usada acima — acrescente `s.manufacturer`
   e `s.serialNumber` à notificação para lê-los.
2. **O fallback é "a saída não-interna mais larga"**, então continua
   funcionando se o monitor for trocado ou se o EDID mudar.
3. **Sem filtro de relevância**, então janelas paradas em outro desktop também
   são corrigidas.
4. **Inerte com uma tela só.** Quando apenas o painel do notebook está
   conectado, `screenOrder.length < 2` e nada é fixado — os desktops virtuais
   funcionam normalmente, que é o que se quer na rua.

Ative o novo e desative o quebrado:

```bash
kwriteconfig6 --file kwinrc --group Plugins \
  --key virtualdesktopsonlyonprimaryEnabled false
kwriteconfig6 --file kwinrc --group Plugins \
  --key vdonlyprimaryfixEnabled true
```

## A outra metade do problema

Lendo a configuração encontrei uma segunda causa, independente, do mesmo
sintoma:

```ini
[Desktops]
perOutputVirtualDesktops=true

[Windows]
PerOutputVirtualDesktops=true
```

Isso dá a **cada saída o seu próprio desktop atual**. É um recurso legítimo,
mas produz o mesmo sintoma por outro caminho, e briga com o script. Desligando:

```bash
kwriteconfig6 --file kwinrc --group Desktops --key perOutputVirtualDesktops false
kwriteconfig6 --file kwinrc --group Windows --key PerOutputVirtualDesktops false
```

## Fazendo sobreviver a um reboot

Carregar um script pelo D-Bus dura até o KWin reiniciar. Para persistir, uma
entrada de autostart pequena reaplica no login — e depois de um hotplug de
monitor, já que ela espera o serviço de scripting do KWin responder:

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
Exec=/home/voce/.local/bin/vd-only-primary-reapply.sh
X-KDE-autostart-phase=2
Terminal=false
NoDisplay=true
```

## Verificando sem se enganar

Foi aqui que quase cantei vitória cedo demais. A checagem óbvia é a propriedade
X11 `_NET_WM_DESKTOP`, onde `4294967295` significa "em todos os desktops":

```bash
xprop -id <janela> _NET_WM_DESKTOP
```

Funciona, mas duas coisas te enganam. **O X conta a partir de 0 e o KWin a
partir de 1**, então o desktop 1 do KWin aparece como `0` no `xprop` — o que
parece um bug e não é. E `xdotool --onlyvisible` *não* testa se a janela está
no desktop atual; o KWin mantém as janelas mapeadas, então ele as reporta como
visíveis de qualquer jeito.

Pergunte direto ao KWin:

```javascript
workspace.windowList().forEach(function (w) {
    if (!w.normalWindow) return;
    var ds = w.desktops.map(function (d) { return d.x11DesktopNumber; }).join("+");
    out.push(w.caption.substring(0, 18) + "@" + w.output.name +
             " all=" + w.onAllDesktops + " ds=[" + ds + "]");
});
```

O que finalmente deu:

```
CUR=1
Google Tradutor@eDP-1      all=true   ds=[]
Chat - Brave@HDMI-1        all=false  ds=[1]
~ : herdr — Konsole@HDMI-1 all=false  ds=[1]
DEV-2184 - Visual @HDMI-1  all=false  ds=[1]
career — Dolphin@HDMI-1    all=false  ds=[1]
```

`all=true` no painel do notebook: fixo, imune à troca. `all=false` com número
de desktop real em tudo que está no LG: desktops virtuais de verdade. É o
comportamento que eu queria, e alternar entre os desktops 1, 3 e 4 deixou o
notebook fixo todas as vezes.

## Duas coisas que valem saber

Enquanto mexia no `kglobalshortcutsrc` descobri que o atalho que eu vinha
xingando não era o que eu pensava. Não existia binding de `Ctrl+Alt+Seta`
nenhum — a troca de desktop aqui é **`Meta+Ctrl+Seta`**, mais `Ctrl+F1`–`F4`:

```bash
grep -i "Switch One Desktop" ~/.config/kglobalshortcutsrc
```

Vale conferir antes de culpar qualquer outra coisa.

A segunda: uma atualização do `kdeplasma-addons` pode reativar o script
original. Se o sintoma voltar, é a primeira coisa a checar:

```bash
kreadconfig6 --file kwinrc --group Plugins \
  --key virtualdesktopsonlyonprimaryEnabled     # tem que ser false

qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.isScriptLoaded vdonlyprimaryfix
```

## O que eu levei disso

A configuração estava certa. O monitor estava certo. O script estava certo,
para uma definição de "primária" que ninguém fora daquele arquivo usa.

Configuração descreve o que você pediu; ela não conta o que o programa
concluiu. A correção levou dez minutos depois que parei de reler arquivos de
configuração e gastei o esforço em fazer o código dizer em voz alta qual tela
ele tinha escolhido. Quando um programa faz algo inexplicável, a pergunta mais
rápida geralmente não é "o que eu configurei?", e sim "o que ele acha que eu
configurei?".
