# TOCK

A 5-minute, nearly wordless 3D animated short.

**Logline:** A boy who misses his late grandfather finds a broken clockwork firefly in the old man's telescope case. Once it's fixed, the tiny machine gets an entire city to turn off its lights so the boy can see the stars one more time.

**Theme:** grief turning back into wonder.

## Cast (locked looks)
- **Arun** — 9-year-old boy, messy black hair, big brown eyes, light brown skin, oversized navy pajamas with small yellow rocket prints, bare feet, about 130 cm tall *(voice: soft, young, whispery; one line only)*
- **Grandpa** — elderly man seen only in a framed photograph: warm smile, white moustache, grey flat cap, brown tweed jacket, one arm raised pointing up at a starry night sky *(voice: none (photo only))*
- **Tock** — thumb-sized clockwork firefly about 4 cm long (fits on a boy's fingertip), polished brass body, two thin glass wings, round glowing amber glass belly-light, small visible gear and winding key in its back, tiny round lens eyes *(voice: no words; soft clicks and ticks)*

## Files
- `script.md`: the screenplay.
- `shot-list.md`: all 61 shots with framing, duration and prompts.
- `board-export.json`: the board's data in its export format. The worker reads it directly: `node worker/src/cli.js plan --board films/tock/board-export.json`.

The live production board (https://claude.ai/artifact/Tv99XQ9Yj8J9gC5uAtszcN) is the source of truth; this folder is a snapshot taken 2026-09-30. Keyframes, takes and purchases live on the board and aren't included.

## Production notes
- Style: stylized 3D animated feature film, soft global illumination, subsurface skin shading, expressive oversized eyes, rounded shapes, cinematic depth of field, night-time palette of deep blues with warm amber accents
- Only one spoken line (7-02, "Goodnight, Grandpa."), so the voice stage needs a single ElevenLabs voice for Arun.
- The girl in the yellow hoodie (5-04, 5-05) is described in those prompts only, not in the cast.
- 7-05 (title card) is made in the edit, not generated.
- Suggested first test: keyframes and draft takes for 3-06 and 3-07 (Tock lights up and looks at Arun).
