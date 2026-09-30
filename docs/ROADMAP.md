# Roadmap

## Stage 1 — Production board (done)

- [x] Shot list with status pipeline, filters and per-shot editor
- [x] Take logging with credit costs; budget plan vs. spent; purchase log
- [x] Script editor and cast bible with locked looks
- [x] Script → shot breakdown with Claude (review before adding)
- [x] "Suggest prompts" with Claude per shot; copy prompts with cast looks and style
- [x] Keyframe and video take uploads; choose the take for the cut
- [x] Rough-cut player (video takes, keyframe stills, slate cards)
- [x] Pipeline tab: tool per stage; export board JSON and shot list CSV

## Stage 2 — Render worker

- [x] `config/pipeline.json` loader and provider interface (`generateImage`, `generateVideo`, `generateSpeech`)
- [x] Kling provider: keyframe images and image-to-video (JWT or API-key auth, task polling)
- [x] ElevenLabs provider: per-character voices
- [x] Mock provider for rehearsal runs
- [x] Job selection from the board's render queue; results manifest; render-sync skill uploads results
- [x] Budget guard: hold jobs that would exceed the budget limit
- [x] Mode switch per stage in the Pipeline tab; render queue in the shot editor
- [ ] First live run against Kling and ElevenLabs (needs keys and network access to the provider hosts)
- [ ] More providers: Flux or Google Imagen keyframes, Seedance 2.0 and Veo 3.1 video
- [ ] Lip-sync stage

## Stage 3 — Assembly and delivery

- [ ] ffmpeg rough cut with dialogue and music in shot order
- [ ] Timeline export for DaVinci Resolve (EDL or FCPXML) with clips in place
- [ ] Delivery checklist: resolution, loudness, captions, credits
