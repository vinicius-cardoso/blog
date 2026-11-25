---
title: "Ensinei minha Echo Dot com Claude a ficar quieta e tocar música"
description: "A Echo respondia perguntas, mas pedir uma música rendia uma recusa educada, depois uma confirmação narrada por cima da música. Cinco camadas erradas depois, ela toca Spotify em silêncio, obedece o celular e me esquece entre um pedido e outro."
pubDate: 2026-11-25
lang: "pt"
translationOf: "claude-echo-dot-alexa-mode"
series: "echo-claude"
part: 2
tags: ["home-assistant", "ia", "spotify", "linux"]
---

No fim da [parte 1](/pt/blog/claude-inside-my-echo-dot) minha Echo Dot 5 estava
sem o firmware da Amazon e com o Claude respondendo pelo Home Assistant. Ela
explicava emaranhamento quântico. O que ela não fazia era a única coisa para a
qual eu realmente uso uma caixa inteligente. "Alexa, play Ice Melt by Crumb" me
rendeu isto, lido em voz alta por uma voz feminina:

```
I can't play "Ice Melt" by Crumb. I can't start songs on the Echo Dot. You can
say "Alexa, play Ice Melt by Crumb" to the Echo, or use the Alexa app.
```

O Claude me mandando pedir pra Alexa, num aparelho que não tem mais Alexa.

Quando finalmente tocou música, veio narrando: *"Ice Melt by Crumb is now
playing, and the volume is set to 50 percent"*, falando por cima da música que
tinha acabado de começar. E se eu perguntasse alguma coisa dois minutos depois,
ela puxava o que eu tinha pedido antes.

Eu queria o contrário: obedecer, ficar quieta, ser rápida, me esquecer. No fim,
"música não funciona" não era um bug só. Eram cinco camadas diferentes, cada
uma falhando do seu jeito, e a primeira em que botei a culpa era a errada.

## A ferramenta estava lá; o Claude escolheu a caixa errada

Minha primeira teoria era que o Claude simplesmente não tinha como começar uma
música, só ferramentas de pausar/pular/volume. O log de debug do Home Assistant
dizia outra coisa. As ferramentas estavam ali na lista:

```
Tools: [..., <MediaSearchTool - media_player__search_media>,
             <MediaPlayTool - media_player__play_media>, ...]
```

E o Claude usou:

```
Tool call: media_player__search_media({'search_query': 'Get Lucky Daft Punk',
  'player_name': 'Echo Dot 5 09483f Media Player'})
Tool response: ToolResult(data={'error': 'MatchFailedError', 'error_text':
  "No entities supported the required features (given name 'Echo Dot 5 09483f
  Media Player', domains media_player, features 4194816)"}, error=True)
```

A Echo aparece no Home Assistant **duas vezes**: uma como o media player ESPHome
que o firmware expõe, outra como o player do Music Assistant, que é quem
realmente fala com o Spotify. Os dois estavam expostos ao assistente de voz,
com nomes quase iguais. O Claude pegou o do ESPHome, que toca uma URL mas não
sabe *buscar*, levou um erro e desistiu. Depois disso a recusa ficou no
histórico da conversa, e ele continuou repetindo.

A correção foi tirar a exposição do player ESPHome. Agora o Claude só enxerga o
que funciona.

## A correção óbvia que o Home Assistant bloqueia de propósito

O plano que todo mundo sugere é deixar o intent local do próprio Home Assistant
cuidar do "play X" (ele tem um, o `HassMediaSearchAndPlay`, com o Music
Assistant por trás) e manter o LLM para perguntas. Meu pipeline até estava com
"preferir comandos locais" ligado. Mesmo assim nunca rodava local, e ler o
código mostrou o porquê:

```python
def _async_local_fallback_intent_filter(result: RecognizeResult) -> bool:
    """Filter out intents that are not local fallback."""
    return result.intent.name in (
        intent.INTENT_GET_STATE,
        media_player.INTENT_MEDIA_SEARCH_AND_PLAY,
    )
```

Quando o agente de conversa é um LLM com controle dos dispositivos, o Home
Assistant **filtra o intent de buscar-e-tocar de propósito**, esperando que o
LLM cuide disso. Então, enquanto o Claude controlar a casa, o "preferir local"
não ajuda em nada com música.

O que *roda* antes do agente, sempre, é um **sentence trigger**: uma automação
disparada por uma frase falada. O pipeline confere esses primeiro:

```python
# Sentence triggers override conversation agent
if (trigger_response_text := await conversation.async_handle_sentence_triggers(
        self.host.hass, user_input, chat_log)) is not None:
```

Então escrevi um: `play {query}` → busca no Music Assistant → toca o resultado
na Echo. Determinístico, local, sem LLM chutando.

## O Spotify nem estava logado

Primeiro teste do trigger novo. Ele disparou certinho e entendeu "get lucky
daft punk", e aí:

```
Error for call_service at pos 2: Could not resolve ['get lucky daft punk'] to
playable media item
```

O Music Assistant disse a mesma coisa três vezes no próprio log: `No playable
items found`. O Spotify tinha funcionado na noite anterior. Subindo no log, lá
do boot do notebook:

```
Error loading provider(instance) spotify--...: Cannot connect to host
accounts.spotify.com:443 ssl:default [Could not contact DNS servers]
```

O container do Music Assistant subiu antes de o Wi-Fi ter DNS, não conseguiu
logar no Spotify e **nunca tentou de novo**. Toda busca depois disso voltava
vazia. Um `docker restart music-assistant` e:

```
Successfully logged in to Spotify as ...
Loaded music provider Spotify
```

"Play Get Lucky by Daft Punk" foi direto para a Echo. Esse bug volta em
qualquer boot em que a rede demore, então agora eu sei o que esse sintoma
significa.

## Um desvio pelo português (e a volta)

Em paralelo, o Whisper vivia estropiando nomes de música, virando coisas como
"ice melt by cramp". Sou brasileiro e falo inglês com sotaque, então tentei
passar o pipeline inteiro para português ("toca Get Lucky do Daft Punk"). Para
testar sem ficar falando com a caixa toda hora, botei o Piper para falar uma
frase e mandei o áudio direto para o Whisper pelo protocolo Wyoming:

```
'Toca Get Lucky do Daft Punk'   -> ' Toca Get Look do Daft Punk.'
```

O Whisper aceita um `--initial-prompt`, um texto que puxa o decodificador para
o vocabulário e o jeito de falar que você espera. Com um prompt de alguns
comandos de exemplo:

```
'Toca Get Lucky do Daft Punk'             -> ' Toca Get Lucky do Daft Punk.'
'Coloca o álbum Random Access Memories'   -> ' Coloca o álbum Random Access Memories.'
```

Funcionou. Só que o Piper não tem voz feminina em português do Brasil, a
masculina ficou horrível, e voltei tudo para inglês pouco depois. O initial
prompt ficou, traduzido para inglês. (O português voltou depois, do jeito
certo: veja mais abaixo.)

## "Alexa, play" não bate com "play"

De volta ao inglês, pedi "Ice Melt by Crumb at 50% volume". A música tocou, e o
Claude anunciou. Meu sentence trigger não tinha disparado, e a tela de debug do
pipeline mostrou o motivo:

```
Speech-to-text   2.97s   Alexa, play Ice Melt from Crump in 50% sound.
Natural language 6.08s   conversation.claude_conversation
                         Processed locally: false
Text-to-speech           Ice Melt by Crumb is now playing, and the volume is
                         set to 50 percent.
```

A wake word é detectada no aparelho, mas o áudio que vai para o Whisper ainda
contém ela, então a transcrição começa com **"Alexa,"**. Meu padrão era
`play {query}`, e "alexa play ice melt…" não é isso. Caiu no Claude, que fez
três chamadas de ferramenta, levou seis segundos e leu uma frase para mim.

A mesma tela de debug deu o custo completo de um único comando:

| Etapa | Tempo |
|---|---|
| Ouvindo (até decidir que parei de falar) | 7–14 s |
| Speech-to-text | ~3 s |
| Claude | ~6 s |
| Ler a resposta em voz alta | em cima disso |

## Fazendo ela obedecer em silêncio

Todo padrão agora começa com `[hey] [alexa]` (palavras opcionais), e a automação
termina com uma resposta vazia:

```yaml
triggers:
  - trigger: conversation
    command:
      - "[hey] [alexa] (play|put on|start playing) {query}"
actions:
  # ... parse, search, play ...
  - set_conversation_response: ""
```

A string vazia é o pulo do gato. O pipeline só roda text-to-speech se tiver
alguma coisa para falar:

```python
if all_targets_in_satellite_area or tts_input.strip():
    current_stage = PipelineStage.TTS
else:
    # Skip TTS
    current_stage = PipelineStage.END
```

Sem texto, sem TTS, sem voz. A Echo só faz. Ela só fala quando a busca volta
vazia ("I couldn't find X").

O template entende o que usuário de Alexa realmente fala: "at 50%", "at volume
5" (a escala de 0 a 10 da Alexa, então 50%), "the album X", "the playlist X",
"songs by X". Uma segunda automação cuida de stop, pause, resume, next,
previous, "volume 3", louder, quieter, mute. Tudo local, tudo em silêncio.

Duas armadilhas em que caí escrevendo isso:

**O Home Assistant dispara todos os triggers que batem, não o melhor.** O
código junta todos (`matched_triggers[trigger_intent_name] = result`). "Play
the next song" bate com `play {query}` *e* com um padrão de "next", então ia
buscar "the next song" no Spotify *e* pular. Por isso nenhum comando de
controle começa com "play"; a automação de tocar reconhece "play
next/previous/music" sozinha e redireciona.

**`\b` numa string Jinja é um backspace.** Minha regex para tirar "at 50 percent
volume" do nome da música usava `\b` como limite de palavra. O Jinja desfaz os
escapes das strings, então virou `\x08` e simplesmente nunca batia: a busca ia
como "ice melt crumb at 50 percent volume". Troquei por grupos `\s+` explícitos.

## Claude: menor, sem pensar, rédea curta

Agora o Claude é só para perguntas e pedidos estranhos, então não precisa ser o
modelo grande. Troquei a integração do Sonnet 5.5 para o **Haiku 5.5**,
**desliguei o thinking**, limitei as respostas a 300 tokens e reescrevi o
prompt: uma frase curta, sem perguntas de volta, sem oferecer mais ajuda, e
resposta vazia depois de executar uma ação. "What is the capital of
Australia?" agora devolve exatamente:

```
Canberra.
```

## Whisper: o gargalo era o modelo, não as threads

O notebook tem 16 núcleos e o Whisper usava 4, então achei que o problema eram
as threads. Fiz um benchmark numa porta separada, com os mesmos comandos falados
pelo Piper, para a produção nem perceber:

| Modelo | Por comando | Transcrições |
|---|---|---|
| medium-int8, 4 threads, beam 5 (o que eu tinha) | ~3.3 s | todas certas |
| medium-int8, 12 threads, beam 1 | ~3.6–4.7 s | todas certas |
| distil-medium.en | ~3.3 s | quase todas vazias |
| **small.en, 12 threads, beam 1** | **~1.7 s** | **todas certas** |
| turbo (large-v3-turbo) | ~6–8 s | todas certas |

Mais threads deixaram o medium *mais lento*. O tempo era quase constante,
independente do tamanho do áudio, porque o Whisper completa toda entrada até uma
janela de 30 segundos e o tamanho do encoder é o que pesa. Um modelo menor, só
de inglês, cortou pela metade: o `small.en` ficou em 1.2–1.4 s depois de ir
para produção. Uma ressalva que não consigo verificar direito: voz sintética não
tem sotaque, então se o meu "Crumb" de verdade virar "Crump" demais, o medium
está a uma flag de distância.

Depois, o tempo ouvindo. O firmware da Echo tem uma opção de "detecção de fim
de fala", que estava em `Default`. Trocar para `Aggressive` faz ela parar de
esperar tanto depois que eu termino de falar.

## Me esquecendo de propósito

O "puxar respostas anteriores" vinha das sessões de chat do Home Assistant. Um
satélite reaproveita a mesma conversa por 5 minutos, então o Claude via meus
últimos pedidos. Não existe opção para isso; é uma constante do módulo:

```python
CONVERSATION_TIMEOUT = timedelta(minutes=5)
```

A limpeza lê essa constante em tempo de execução, então uma integração
customizada de dez linhas consegue encurtar:

```python
async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Shorten the chat-session timeout."""
    seconds = config.get(DOMAIN, {}).get(CONF_SECONDS, 10)
    chat_session.CONVERSATION_TIMEOUT = timedelta(seconds=seconds)
    return True
```

Com `fresh_voice_session:` no `configuration.yaml`, todo "Alexa" começa do
zero. Pergunta de acompanhamento dentro da mesma troca continua funcionando,
porque uma sessão em uso nunca é limpa.

## O "next" não tinha para onde ir

Tocar uma música só coloca uma música só na fila. "Alexa, next song" disparava,
o Music Assistant procurava o próximo item, não achava nenhum e não fazia nada,
calado. Uma Alexa de verdade continua com músicas parecidas.

O Music Assistant tem um `radio_mode` exatamente para isso, então liguei. "Play
Get Lucky" aí levou oito segundos e começou com Red Hot Chili Peppers:

```
Fetching tracks to play for playlist Get Lucky Endless Mix
```

O radio mode troca o pedido por um mix *a partir* dele. A versão que funciona
toca a música exata primeiro. Depois, uma automação separada, disparada por um
evento para o comando de voz não esperar os 8 segundos, adiciona o mix de rádio
**atrás** dela com `enqueue: add`. Ice Melt começou em menos de um segundo, em
30%, e "next song" passou para The Strokes.

Um momento de humildade no meio disso: vi o volume cair de 0.5 para 0.1 em
quatro degraus iguais logo depois de ser ajustado e fui caçar o bug. Não tinha
bug. Era eu apertando o botão de volume da Echo porque estava alto. O log de
atividade da página do aparelho listava cada `volume_down`.

## O celular não conseguia trocar a música

O último. Quando eu trocava a música no app do Spotify no celular, a Echo
ignorava e seguia a própria fila. O Music Assistant toca o Spotify pelo próprio
motor, e o celular não tinha como mandar nele.

Uma Echo de verdade aparece na lista de dispositivos do app do Spotify pelo
**Spotify Connect**. O Music Assistant vem com um plugin para isso, em cima do
cliente headless oficial do Spotify. A configuração pede para aceitar os termos
do Spotify e colar sua própria API key, o que eu mesmo fiz. Ele carregou, mas
nada apareceu no celular, e não tinha daemon nenhum rodando. A lista
**Connected players** do plugin estava vazia, então ele não tinha nada para
expor. Selecionando a Echo ali:

```
Started Spotify Connect background daemon [Spotify Connect/Echo Dot 5 09483f]
Spotify Connect session inactive for Echo Dot 5 09483f | Music Assistant
```

"Echo Dot 5 09483f | Music Assistant" apareceu no app do Spotify, e as músicas
escolhidas no celular agora tocam na Echo. Segundo o README do plugin, os
controles do player são repassados de volta ao Spotify, então "Alexa, pause"
deve continuar funcionando enquanto o celular está no comando.

## Português, sem mexer no inglês

Com o inglês funcionando, eu quis o português de volta, com uma condição: não
podia piorar o inglês. Isso descartou o caminho óbvio. Deixar o Whisper
detectar o idioma sozinho exige um modelo multilíngue, e o `small.en`, só de
inglês, era justamente o que deixou o inglês rápido. E a Echo também não
consegue separar os dois pela wake word, porque o firmware só oferece uma:

```
select.echo_dot_5_09483f_wake_word   options: ['no_wake_word', 'Alexa']
```

Então o português virou um **segundo pipeline, separado**, para o qual a Echo
troca por voz. Nada da cadeia em inglês foi editado: mesmo container do
Whisper, mesmo agente do Claude, mesmas automações. O português ganhou uma
cópia própria de cada peça:

| Peça | Inglês (intocado) | Português (novo) |
|---|---|---|
| Whisper | `small.en`, porta 10300 | `medium-int8`, `pt`, porta 10301 |
| Agente do Claude | "Claude conversation" | "Claude PT", prompt em português |
| Voz | Piper `en_US-amy-medium` | Google Translate, `pt-br` |
| Comandos | "play / stop / next…" | "toca / pausa / próxima…" |

A troca em si é só mais um sentence trigger, que muda a configuração de
assistente da Echo:

```yaml
- trigger: conversation
  id: pt
  command:
    - "[hey] [alexa] (speak|talk|switch to|change to|change language to|use) portuguese [please]"
# ...and "[ei] [alexa] (fala|fale|muda para|troca para) inglês" for the way back
actions:
  - action: select.select_option
    target: { entity_id: select.echo_dot_5_09483f_assistente }
    data: { option: "{{ 'Claude PT' if trigger.id == 'pt' else 'Claude' }}" }
```

A configuração fica gravada na Echo, então ela continua no idioma em que eu a
deixei, mesmo depois de reiniciar.

A escolha do Whisper em português passou pelo mesmo benchmark, na porta
separada, com a voz brasileira do Piper lendo os comandos:

| Modelo | Por comando | O que deu errado |
|---|---|---|
| small (multilíngue), beam 1 | ~1.4 s | `'Próxima música' -> ' Pausa a música.'` |
| **medium-int8, beam 1** | **~3.3 s** | só o nome da música em inglês |
| medium-int8, beam 5 | ~4.5 s | nada melhor, só mais lento |

O modelo small era rápido e perigoso: transformou "próxima música" em "pausa a
música". "Pausa a música" era um dos exemplos do meu próprio initial prompt,
então o mais provável é que o prompt tenha puxado ele para lá. Uma caixa que
pausa quando você pede a próxima música é pior do que uma lenta, então o
português paga 3.3 s por comando e o inglês continua com 1.3 s.

A voz era o outro problema. O Piper só tem vozes masculinas em português do
Brasil, e eu já tinha rejeitado uma. A integração Google Translate do Home
Assistant tem uma voz feminina `pt-br`, então o português usa ela. O preço: é
nuvem, não local. Como os comandos são silenciosos, eu ouço ela mais nas
respostas.

Uma pegadinha pequena na interface: criei o pipeline direto no storage com
idioma `pt-BR`, e a tela de configurações marcou como "Unknown item". A lista
dela só oferece "Portuguese" (`pt`). A parte brasileira vem das configurações de
speech-to-text e de voz, não do idioma do pipeline.

Digitando no Assist, o ciclo inteiro funcionou: "Alexa, speak Portuguese" →
"Okay, Portuguese."; "toca Ice Melt do Crumb no volume 4" tocou em 40%;
"próxima música" pulou para uma música parecida; "fala inglês" voltou. E os
testes em inglês que rodei antes e depois deram os mesmos resultados.

## Como ficou

| | Antes | Depois |
|---|---|---|
| "Play X" | Claude chuta, recusa ou narra | trigger local, em silêncio |
| Volume, pular, pausar | ~6 s pelo Claude, com resposta falada | na hora, em silêncio |
| Speech-to-text | ~3 s | ~1.2–1.4 s |
| Perguntas | Sonnet com thinking, falante | Haiku, uma frase |
| Memória | 5 minutos de histórico | do zero toda vez |
| Depois da música | silêncio | músicas parecidas, "next" funciona |
| App do Spotify | não alcança a Echo | Echo é um dispositivo Connect |
| Idioma | só inglês | inglês, ou português quando eu peço |

## O que levo disso

Cada um desses parecia "a IA não é esperta o suficiente", e nenhum era. O Claude
recusou porque eu mostrei duas caixas com quase o mesmo nome, e ele escolheu a
errada. A música falhou porque um container subiu antes do DNS. O trigger errou
por causa de uma palavra que eu não esperava na transcrição. O "next" não fazia
nada porque a fila estava vazia. Até o bug do volume era o meu dedo.

As ferramentas que acharam tudo isso foram as chatas: o log de debug que lista
as chamadas de ferramenta de verdade, a tela de debug do pipeline com o tempo de
cada etapa, um benchmark numa porta separada, e ler o código do Home Assistant
quando a documentação dizia uma coisa e o comportamento dizia outra. Antes de
culpar o modelo, leia o que ele realmente recebeu.
