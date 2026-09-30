---
name: render-sync
description: Run the render worker against the live production board — pull queued shots and keyframes from the board, show the cost plan, render after the user approves, then upload results back as keyframes, takes and dialogue files. Use when the user asks to render, process the queue, or sync the board.
---

# Render sync

The board lives at https://claude.ai/artifact/Tv99XQ9Yj8J9gC5uAtszcN. The worker (`worker/`) cannot reach the board directly, so you move data both ways with the `ArtifactData` and `Artifact` tools. All paths below are relative to the repo root.

## 1. Pull board state

Clear `renders/board/`, then read each collection into it with `ArtifactData` `list` and `out_dir: renders/board` (page with `query.cursor` until done): `shots`, `takes`, `characters`, `spend`. Read `settings/film` and `script/main` with `get` and the same `out_dir`. The worker reads this dump directory as is.

Note each document's `version`; every write in step 5 pins `if_version`.

## 2. Pull keyframe inputs

For each shot whose `renderQueue.video` is set and that has a `keyframeAsset`, fetch the asset with `Artifact` `read`, `url` = the board, `path` = the asset id, `out_dir: renders/inputs`. The worker finds inputs by asset id.

## 3. Plan and get approval

```
node worker/src/cli.js doctor
node worker/src/cli.js plan
```

`config/pipeline.json` must exist (copy `config/pipeline.example.json`). Show the user the plan: jobs, estimated cost, held and skipped items. **Do not run paid jobs until the user explicitly approves this plan.** Mock-only runs need no approval.

## 4. Render

```
node worker/src/cli.js run --confirm
```

Results are listed in `renders/results.json`. Report failures with their error text.

## 5. Push results to the board

Skip files marked `"mock": true`; they are rehearsal output. For each succeeded result:

- **keyframes:** upload the first image with `Artifact` (`url` = the board, `asset: true`, `file_paths`). Update the shot: `keyframeAsset` = new asset id; `status` = `keyframe` if it was `script`. Mention extra variants to the user; they stay in `renders/`.
- **video:** upload the MP4 (20 MB limit; tell the user if a file is larger). Create a `takes` document `{shotId, asset, kind, credits, createdAt, fileName, provider, taskId}`. Update the shot: `takes` + 1, `credits` + result credits, `selectedTake` = new take id if it had none, `status` = `animating` if it was `script` or `keyframe`.
- **voice:** audio can't go in the board's asset store. Set the shot's `dialogueFile` to the file's path under `renders/`.

Then remove each succeeded job's key from the shot's `renderQueue` (set `renderQueue` to null when empty). For failed jobs, leave the queue entry and set `renderError` to the error text. Clear `renderError` on shots whose jobs all succeeded. Use one `ArtifactData` `batch` per group of up to 50 writes.

## 6. Report

Tell the user what rendered, what failed and why, and the estimated spend of the run. Provider charges go to their provider account; they log top-ups as purchases on the Budget tab.
