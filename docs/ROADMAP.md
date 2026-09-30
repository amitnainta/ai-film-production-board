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

- [ ] `config/pipeline.json` loader and provider interface (`generateImage`, `generateVideo`, `generateSpeech`)
- [ ] Keyframe provider: Flux or Google Imagen (Midjourney has no official public API)
- [ ] Video provider: Kling 3.0 image-to-video; Seedance 2.0 and Veo 3.1 as alternates
- [ ] Voice provider: ElevenLabs per-character voices; lip-sync step
- [ ] Job selection from board state; results uploaded to the asset store; actual cost logged
- [ ] Budget guard: stop before exceeding remaining budget or credits
- [ ] Mode switch per stage in the Pipeline tab (manual / automated)

## Stage 3 — Assembly and delivery

- [ ] ffmpeg rough cut with dialogue and music in shot order
- [ ] Timeline export for DaVinci Resolve (EDL or FCPXML) with clips in place
- [ ] Delivery checklist: resolution, loudness, captions, credits
