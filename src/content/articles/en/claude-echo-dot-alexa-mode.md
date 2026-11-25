---
title: "Teaching my Claude Echo Dot to shut up and play music"
description: "The Echo answered questions, but asking for a song got a polite refusal, then a narrated confirmation over the music. Five wrong layers later it plays Spotify silently, obeys my phone, and forgets me between requests."
pubDate: 2026-11-25
lang: "en"
translationOf: "claude-echo-dot-alexa-mode"
series: "echo-claude"
part: 2
tags: ["home-assistant", "ai", "spotify", "linux"]
---

At the end of [part 1](/blog/claude-inside-my-echo-dot) my Echo Dot 5 had
Amazon's firmware ripped out and Claude answering through Home Assistant. It
could explain quantum entanglement. What it couldn't do was the one thing I
actually use a smart speaker for. "Alexa, play Ice Melt by Crumb" got me this,
read aloud in a female voice:

```
I can't play "Ice Melt" by Crumb. I can't start songs on the Echo Dot. You can
say "Alexa, play Ice Melt by Crumb" to the Echo, or use the Alexa app.
```

Claude telling me to ask Alexa, on a device that no longer has Alexa on it.

When it finally did play music, it narrated: *"Ice Melt by Crumb is now
playing, and the volume is set to 50 percent"*, talking over the song it had
just started. And if I asked something two minutes later, it would bring up
what I'd asked before.

I wanted the opposite: obey, stay quiet, be fast, forget me. It turned out
that "music doesn't work" wasn't one bug. It was five different layers each
failing in its own way, and the first one I blamed was the wrong one.

## The tool was there; Claude picked the wrong speaker

My first theory was that Claude simply had no way to start a song, only
pause/skip/volume tools. The Home Assistant debug log said otherwise. The
tools were right there in the list:

```
Tools: [..., <MediaSearchTool - media_player__search_media>,
             <MediaPlayTool - media_player__play_media>, ...]
```

And Claude used them:

```
Tool call: media_player__search_media({'search_query': 'Get Lucky Daft Punk',
  'player_name': 'Echo Dot 5 09483f Media Player'})
Tool response: ToolResult(data={'error': 'MatchFailedError', 'error_text':
  "No entities supported the required features (given name 'Echo Dot 5 09483f
  Media Player', domains media_player, features 4194816)"}, error=True)
```

The Echo shows up in Home Assistant **twice**: once as the ESPHome media
player the firmware exposes, and once as the Music Assistant player that
actually talks to Spotify. Both were exposed to the voice assistant, with
almost the same name. Claude picked the ESPHome one, which can play a URL but
can't *search*, got an error, and gave up. After that the refusal sat in the
conversation history, and it kept repeating it.

The fix was to unexpose the ESPHome player. Claude can only see the one that
works now.

## The obvious fix that Home Assistant deliberately blocks

The plan everyone suggests is to let Home Assistant's own local intent handle
"play X" (it has one, `HassMediaSearchAndPlay`, with Music Assistant behind
it), and keep the LLM for questions. My pipeline even had "prefer handling
commands locally" switched on. It still never ran locally, and reading the
source showed why:

```python
def _async_local_fallback_intent_filter(result: RecognizeResult) -> bool:
    """Filter out intents that are not local fallback."""
    return result.intent.name in (
        intent.INTENT_GET_STATE,
        media_player.INTENT_MEDIA_SEARCH_AND_PLAY,
    )
```

When the conversation agent is an LLM with device control, Home Assistant
**filters the search-and-play intent out on purpose**, expecting the LLM to
handle it. So as long as Claude can control the house, "prefer local" can't
help with music.

What *does* run before the agent, every time, is a **sentence trigger**: an
automation that fires on a spoken pattern. The pipeline checks those first:

```python
# Sentence triggers override conversation agent
if (trigger_response_text := await conversation.async_handle_sentence_triggers(
        self.host.hass, user_input, chat_log)) is not None:
```

So I wrote one: `play {query}` → search Music Assistant → play the result on
the Echo. Deterministic, local, and no guessing by an LLM.

## Spotify wasn't even logged in

First test of the new trigger. It fired correctly and parsed "get lucky daft
punk", and then:

```
Error for call_service at pos 2: Could not resolve ['get lucky daft punk'] to
playable media item
```

Music Assistant said the same thing three times in its own log: `No playable
items found`. Spotify had worked the night before. Further up the log, from when
the laptop booted:

```
Error loading provider(instance) spotify--...: Cannot connect to host
accounts.spotify.com:443 ssl:default [Could not contact DNS servers]
```

Music Assistant's container started before the Wi-Fi had DNS, failed to log in
to Spotify, and **never tried again**. Every search after that came back empty.
`docker restart music-assistant` and:

```
Successfully logged in to Spotify as ...
Loaded music provider Spotify
```

"Play Get Lucky by Daft Punk" went straight to the Echo. That bug will come
back on any boot where the network is slow, so now I know what that symptom
means.

## A detour into Portuguese (and back)

Separately, Whisper kept mangling song names into things like "ice melt by
cramp". I'm Brazilian and speak English with an accent, so I
tried switching the whole pipeline to Portuguese ("toca Get Lucky do Daft
Punk"). To test without talking to the speaker every time, I had Piper speak a
phrase and fed the audio straight into Whisper over the Wyoming protocol:

```
'Toca Get Lucky do Daft Punk'   -> ' Toca Get Look do Daft Punk.'
```

Whisper takes an `--initial-prompt`, a bit of text that biases the decoder
toward the vocabulary and phrasing you expect. With a prompt of a few example
commands:

```
'Toca Get Lucky do Daft Punk'             -> ' Toca Get Lucky do Daft Punk.'
'Coloca o álbum Random Access Memories'   -> ' Coloca o álbum Random Access Memories.'
```

It worked. But Piper has no female Brazilian voice, the male one sounded
terrible, and I reverted the whole thing to English shortly after. The
initial prompt stayed, translated into English. (Portuguese came back later,
done properly: see below.)

## "Alexa, play" doesn't match "play"

Back in English, I asked for "Ice Melt by Crumb at 50% volume". The song
played, and Claude announced it. My sentence trigger hadn't fired, and the
pipeline's debug view showed why:

```
Speech-to-text   2.97s   Alexa, play Ice Melt from Crump in 50% sound.
Natural language 6.08s   conversation.claude_conversation
                         Processed locally: false
Text-to-speech           Ice Melt by Crumb is now playing, and the volume is
                         set to 50 percent.
```

The wake word is detected on the device, but the audio sent to Whisper still
contains it, so the transcript starts with **"Alexa,"**. My pattern was
`play {query}`, and "alexa play ice melt…" isn't that. So it fell through to
Claude, which did three tool calls, took six seconds, and read me a sentence.

The same debug view gave me the full cost of a single command:

| Stage | Time |
|---|---|
| Listening (until it decides I stopped talking) | 7–14 s |
| Speech-to-text | ~3 s |
| Claude | ~6 s |
| Reading the reply aloud | on top of that |

## Making it obey in silence

Every pattern now starts with `[hey] [alexa]` (optional words), and the
automation ends with an empty response:

```yaml
triggers:
  - trigger: conversation
    command:
      - "[hey] [alexa] (play|put on|start playing) {query}"
actions:
  # ... parse, search, play ...
  - set_conversation_response: ""
```

The empty string matters. The pipeline only runs text-to-speech if there's
something to say:

```python
if all_targets_in_satellite_area or tts_input.strip():
    current_stage = PipelineStage.TTS
else:
    # Skip TTS
    current_stage = PipelineStage.END
```

No text, no TTS, no voice. The Echo just does it. It only speaks when the
search comes back empty ("I couldn't find X").

The template parses what Alexa users actually say: "at 50%", "at volume 5"
(Alexa's 0–10 scale, so 50%), "the album X", "the playlist X", "songs by X".
A second automation handles stop, pause, resume, next, previous, "volume 3",
louder, quieter, mute. All local, all silent.

Two traps I fell into while writing them:

**Home Assistant fires every trigger that matches, not the best one.** The
code collects them all (`matched_triggers[trigger_intent_name] = result`).
"Play the next song" matches both `play {query}` and a "next" pattern, so it
would search Spotify for "the next song" *and* skip. So no control command
starts with "play"; the play automation recognises "play next/previous/music"
itself and routes them.

**`\b` in a Jinja string is a backspace.** My regex to strip "at 50 percent
volume" out of the song name used `\b` for a word boundary. Jinja unescapes
string literals, so it became `\x08` and silently never matched: the search
was for "ice melt crumb at 50 percent volume". I replaced it with explicit
`\s+` groups.

## Claude: smaller, no thinking, short leash

Claude is now only for questions and odd requests, so it doesn't need to be
the big model. I switched the integration from Sonnet 5.5 to **Haiku 5.5**,
turned **thinking off**, capped replies at 300 tokens, and rewrote the
prompt: one short sentence, no follow-up questions, no offers of more help,
and an empty reply after carrying out an action. "What is the capital of
Australia?" now gets back exactly:

```
Canberra.
```

## Whisper: the model was the bottleneck, not the threads

The laptop has 16 cores and Whisper was using 4, so I assumed threads were the
problem. I benchmarked on a spare port with the same Piper-spoken commands,
so production didn't notice:

| Model | Per command | Transcripts |
|---|---|---|
| medium-int8, 4 threads, beam 5 (what I had) | ~3.3 s | all correct |
| medium-int8, 12 threads, beam 1 | ~3.6–4.7 s | all correct |
| distil-medium.en | ~3.3 s | mostly empty |
| **small.en, 12 threads, beam 1** | **~1.7 s** | **all correct** |
| turbo (large-v3-turbo) | ~6–8 s | all correct |

More threads made medium *slower*. The time was nearly constant regardless of
how long the audio was, because Whisper pads every input to a 30-second window
and the encoder size dominates. A smaller English-only model halved it:
`small.en` came in at 1.2–1.4 s once it was in production. One caveat I can't fully
check: a synthetic voice has no accent, so if my real "Crumb" turns into
"Crump" too often, medium is one flag away.

Then the listening time. The Echo's firmware has an "end of speech detection"
setting, on `Default`. Switching it to `Aggressive` stops it waiting so long
after I finish talking.

## Forgetting me on purpose

The "looking back at previous answers" came from Home Assistant's chat
sessions. A satellite reuses the same conversation for 5 minutes, so Claude
saw my last few requests. There's no setting for it; it's a module constant:

```python
CONVERSATION_TIMEOUT = timedelta(minutes=5)
```

The cleanup reads that constant at run time, so a ten-line custom integration
can shorten it:

```python
async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Shorten the chat-session timeout."""
    seconds = config.get(DOMAIN, {}).get(CONF_SECONDS, 10)
    chat_session.CONVERSATION_TIMEOUT = timedelta(seconds=seconds)
    return True
```

With `fresh_voice_session:` in `configuration.yaml`, every "Alexa" starts
clean. Follow-up questions within the same exchange still work, because a
session in use is never cleaned up.

## "Next" had nowhere to go

Playing a single song puts a single song in the queue. "Alexa, next song"
fired, Music Assistant looked for the next item, found none, and quietly did
nothing. A real Alexa keeps going with similar music.

Music Assistant has a `radio_mode` for exactly that, so I turned it on. "Play
Get Lucky" then took eight seconds and started with Red Hot Chili Peppers:

```
Fetching tracks to play for playlist Get Lucky Endless Mix
```

Radio mode replaces the request with a mix *seeded* by it. The version that
works plays the exact song first. Then a separate automation, fired by an
event so the voice command doesn't wait 8 seconds for it, appends the radio
mix **behind** it with `enqueue: add`. Ice Melt started within a second at
30%, and "next song" moved on to The Strokes.

A small moment of humility in the middle of this: I watched the volume drop
from 0.5 to 0.1 in four even steps right after it was set, and started
hunting for the bug. There wasn't one. I was pressing the volume button on the
Echo because it was loud. The device page's activity log listed every
`volume_down` press.

## My phone couldn't change the song

Last one. When I changed the song in the Spotify app on my phone, the Echo
ignored it and kept playing its own queue. Music Assistant plays Spotify
through its own engine, and the phone had no way to steer it.

A real Echo appears in the Spotify app's device list through **Spotify
Connect**. Music Assistant ships a plugin for that, built on Spotify's official
headless client. Setup needs you to accept Spotify's terms and paste your own
API key, which I did myself. It loaded, but nothing showed up on the phone,
and there was no daemon running. The plugin's **Connected players** list was
empty, so it had nothing to expose. Selecting the Echo there:

```
Started Spotify Connect background daemon [Spotify Connect/Echo Dot 5 09483f]
Spotify Connect session inactive for Echo Dot 5 09483f | Music Assistant
```

"Echo Dot 5 09483f | Music Assistant" appeared in the Spotify app, and songs
picked on the phone now play on the Echo. According to the plugin's README, the
player's own controls are proxied back to Spotify, so "Alexa, pause" should keep
working while the phone is in control.

## Portuguese, without touching English

Once English worked, I wanted Portuguese back, with one condition: it couldn't
make English worse. That ruled out the obvious approach. Letting Whisper
auto-detect the language needs a multilingual model, and the English-only
`small.en` was exactly what made English fast. And the Echo can't tell the two
apart by wake word either, because the firmware only offers one:

```
select.echo_dot_5_09483f_wake_word   options: ['no_wake_word', 'Alexa']
```

So Portuguese became a **second, separate pipeline** that the Echo switches to
by voice. Nothing in the English chain was edited: same Whisper container,
same Claude agent, same automations. Portuguese got its own copy of each:

| Piece | English (unchanged) | Portuguese (new) |
|---|---|---|
| Whisper | `small.en`, port 10300 | `medium-int8`, `pt`, port 10301 |
| Claude agent | "Claude conversation" | "Claude PT", Portuguese prompt |
| Voice | Piper `en_US-amy-medium` | Google Translate, `pt-br` |
| Commands | "play / stop / next…" | "toca / pausa / próxima…" |

The switch itself is one more sentence trigger, flipping the Echo's assistant
setting:

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

The setting lives on the Echo, so it stays in whichever language I left it,
even after a restart.

Choosing the Portuguese Whisper got the same benchmark treatment, on the spare
port, with Piper's Brazilian voice reading the commands:

| Model | Per command | What went wrong |
|---|---|---|
| small (multilingual), beam 1 | ~1.4 s | `'Próxima música' -> ' Pausa a música.'` |
| **medium-int8, beam 1** | **~3.3 s** | only the English song title |
| medium-int8, beam 5 | ~4.5 s | nothing better, just slower |

The small model was fast and dangerous: it turned "next song" into "pause the
music". "Pausa a música" was one of the examples in my own initial prompt, so
the prompt most likely pulled it there. A speaker that pauses when you ask for
the next song is worse than a slow one, so Portuguese pays 3.3 s per command
and English keeps its 1.3 s.

The voice was the other problem. Piper only has male Brazilian voices, and I'd
already rejected one. Home Assistant's Google Translate integration has a
female `pt-br` voice, so Portuguese uses that. The trade-off: it's cloud, not
local. Since commands are silent anyway, I mostly hear it on answers.

One small UI trap: I created the pipeline in storage with language `pt-BR`,
and the settings dialog flagged it as "Unknown item". Its list only offers
"Portuguese" (`pt`). The Brazilian part comes from the speech-to-text and voice
settings, not from the pipeline language.

Typed into Assist, the whole loop worked: "Alexa, speak Portuguese" →
"Okay, Portuguese."; "toca Ice Melt do Crumb no volume 4" played it at 40%;
"próxima música" skipped to a similar song; "fala inglês" switched back. And
the English tests I ran before and after gave the same results.

## Where it ended up

| | Before | After |
|---|---|---|
| "Play X" | Claude guesses, refuses or narrates | local trigger, silent |
| Volume, skip, pause | ~6 s through Claude, spoken reply | instant, silent |
| Speech-to-text | ~3 s | ~1.2–1.4 s |
| Questions | Sonnet with thinking, chatty | Haiku, one sentence |
| Memory | 5 minutes of history | fresh every time |
| After the song | silence | similar music, "next" works |
| Spotify app | can't reach the Echo | Echo is a Connect device |
| Language | English only | English, or Portuguese on request |

## What I'm taking from this

Every one of these looked like "the AI isn't smart enough", and none of them
was. Claude refused because I'd shown it two speakers with almost the same
name, and it picked the wrong one. Music failed because a container started
before DNS. The trigger missed because of one word I didn't expect in the
transcript. "Next" did nothing because the queue was empty. Even the volume
bug was my own thumb.

The tools that found them were boring ones: the debug log that lists the
actual tool calls, the pipeline debug view with per-stage timings, a benchmark
on a spare port, and reading Home Assistant's source when the docs said one
thing and the behaviour said another. Before blaming the model, read what it
actually received.
