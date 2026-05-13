# Goal Coverage Audit

Last updated: 2026-05-13

Active goal:

```text
Rebuild Album Mastering Studio from the existing repo, starting with a verified Track Master-first Tauri desktop surface while preserving the Python engine contract, Album Master path, docs/progress handoff trail, and local/offline workflow.
```

This audit is a handoff guard, not a completion claim. Keep it current when the work crosses a major evidence boundary or when a compaction handoff would otherwise force the next agent to rebuild state from long logs.

## Current Goal Status

Status: active, not complete.

Operating state: resumed as of 2026-05-13. The current-commit full release trace at `e619318` has passed, but the active goal remains open until the remaining listening, preview-scope, and native-dialog blockers are resolved or explicitly accepted.

The current repo has strong automated evidence for the Track Master-first Tauri surface, Python engine contract, Album Master path, packaged Windows flow, and a current-commit release trace. The remaining blockers are quality gates that cannot be honestly closed by documentation alone:

- Human listening approval has not been recorded.
- Live Preview remains an explicit Web Audio approximation for continuous control updates; the visible native path now has a bounded rendered Rust-model audition path, but not continuous native DSP or full export-chain parity.
- OS file-picker Open and Save-As dialog flows remain unautomated. Open Project now starts from the current project path or output folder, and direct path-based project Load/Save is covered as a deterministic fallback, but this is still not native dialog automation coverage.

## Coverage Map

| Goal area | Current evidence | Status |
| --- | --- | --- |
| Start from existing repo | Work continues in `src/album_mastering_studio`, `desktop/`, and the existing `.ams.json` workflow. | Covered |
| Track Master-first Tauri surface | Packaged Track Preview smoke covers mode, two-track rail, visible reorder controls, preview render, waveform region, loop, seek, A/B, Volume Match, Live Preview first controls, stale state, Update Preview, Render Region, and batch export receipt. | Covered with caveats |
| Python engine contract | `album-master preview-contract --json`, `live_preview_contract()`, and unit regression keep `desktop/src/livePreviewConfig.json` aligned with engine-owned control definitions. | Covered |
| Album Master path | Automated release evidence covers multi-source and full-source Album Master render, transitions, album WAV, dashboard, export checks, and native album playback stability. | Covered with listening caveat |
| Docs/progress handoff trail | `docs/progress.md`, `docs/codex-active-handoff.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/ENGINE_DECISION_RECORD.md` record current evidence and known gaps. | Covered |
| Local/offline workflow | Python sidecar, FFmpeg/FFprobe resources, Tauri release build, local render/check/report flow, and direct `.ams.json` path Load/Save remain the core path. | Covered |
| Release package | Current-commit full release-readiness trace at `e619318` rebuilt the sidecar, release EXE, MSI, and NSIS bundles and passed release, real-song, true headless native output probe, Native A/B UI/audio, installer, and diff gates. | Covered with listening/dialog caveats |

## Prompt-To-Artifact Audit

This matrix maps the active goal wording to concrete repo artifacts. It is intended to prevent a future compaction or handoff from treating a broad phrase as complete without evidence.

| Goal phrase | Artifact or command evidence | Still not proven by this artifact |
| --- | --- | --- |
| Rebuild from the existing repo | Continued work in `src/album_mastering_studio`, `desktop/`, `tests/`, and docs; no replacement repo or DSP port. | Subjective product quality. |
| Track Master-first Tauri desktop surface | `desktop/src/App.tsx`, `desktop/src-tauri/src/lib.rs`, `desktop/tests/tauri-track-preview-ui-smoke.mjs`, and packaged evidence under `test-output/tauri-track-preview-ui-smoke/`. | Human listening approval of the resulting sound. |
| Preserve the Python engine contract | `src/album_mastering_studio/cli.py`, `pipeline.py`, `mastering.py`, preview-contract/model commands, `tests/test_pipeline.py`, and `desktop/tests/cli-contract.test.mjs`. | A DAW-grade real-time DSP engine. |
| Preserve the Album Master path | `desktop/tests/tauri-release-album-state-smoke.mjs`, `desktop/tests/tauri-release-album-codec-qc-smoke.mjs`, real-song Album Master smokes, boundary-preview coverage, and dashboard/export artifacts. | True multi-song human listening approval unless the user supplies and reviews a multi-song set. |
| Preserve docs/progress handoff trail | `docs/progress.md`, `docs/codex-active-handoff.md`, `docs/IMPLEMENTATION_PLAN.md`, and this audit. | The docs are evidence pointers, not proof by themselves. |
| Preserve local/offline workflow | Tauri sidecar packaging, bundled FFmpeg/FFprobe resources, `npm run tauri:build`, local `.ams.json` project files, and offline render/report commands. | External platform release-meter certification. |
| Make release readiness reproducible | `scripts/release-readiness.ps1` and `cd desktop; npm run verify:release` run the current release gate sequence and write a JSON trace plus per-step logs under `test-output/`; `test-output\release-readiness-e619318-full\release-readiness.json` is the current trace. | A fresh trace is required after any later code, package, or smoke-test change. |

## Latest Evidence Anchors

- 2026-05-13 Project Open dialog default path hardening: `desktop/src/App.tsx` now opens the native project picker from `projectPath || settings.outputDir || repoRoot`. Targeted packaged project persistence smoke passed, and a follow-up full release trace at `e619318` passed all 23 gates with zero failures and zero skips from clean commit `e61931867a633a37669e61a7eab7cc92f7e6fcf6`. Native dialog automation was attempted but not promoted: Save As could create the default project file, while Open selection remained unreliable, so the native OS dialog blocker remains open.
- 2026-05-13 Current-commit full release readiness trace at `d8d88e6`: `test-output\release-readiness-d8d88e6-full\release-readiness.json` passed all 23 gates with zero failures and zero skips from clean commit `d8d88e6d852694c32f447e406a4b9b969522e0a3`, including Python compile/unit/CLI smoke, desktop build/integration, true headless native output probe, Tauri release build, sidecar startup, packaged launch, Track Preview UI, Album state, Album/Track Codec QC, session safety, project persistence, real-song Track/Region/Native UI/Album smokes using `Lay the Money on the Desk (1).mp3`, NSIS installed-app smoke, MSI package smoke, and `git diff --check`. Dirty proof in the trace is `dirty_before: []` and `dirty_after: []`. Windows Application logs showed no Album Mastering Studio Application Error, Application Hang, or WER entries during the checked window.
- 2026-05-12 Expanded full release readiness trace at `2ada649`: `test-output\release-readiness-2ada649-expanded\release-readiness.json` passed all 23 gates with zero failures and zero skips from clean commit `2ada64921ae786055df5a249bfa13315bc00fbd4`, including Python compile/unit/CLI smoke, desktop build/integration, true headless native output probe, Tauri release build, sidecar startup, packaged launch, Track Preview UI, Album state, Album/Track Codec QC, session safety, project persistence, real-song Track/Region/Native A/B/Album smokes using `Lay the Money on the Desk (1).mp3`, NSIS installed-app smoke, MSI package smoke, and `git diff --check`. Operator note: this full trace is not headless; it includes app/audio/installer smokes. Only `native-audio-headless-probe` is a no-playback native audio check.
- 2026-05-12 Full release readiness trace at `8376e38`: `test-output\release-readiness-8376e38-full\release-readiness.json` passed all 21 gates with zero failures and zero skips from clean commit `8376e38750494e23eddf2d7dcab91998ca6fb65b`, including Python compile/unit/CLI smoke, desktop build/integration, Tauri release build, sidecar startup, packaged launch, Track Preview UI, Album state, Album/Track Codec QC, session safety, project persistence, real-song Track/Region/Album smokes using `Lay the Money on the Desk (1).mp3`, NSIS installed-app smoke, MSI package smoke, and `git diff --check`.
- 2026-05-12 True headless native output probe: Rust `native_audio_probe_reports_default_output_device_without_playback` passed without launching Tauri or starting playback, writing `test-output\native-audio-headless-probe\native-audio-probe.json` with CPAL/WASAPI default output `Headphones (HyperX Cloud Alpha Wireless)`.
- 2026-05-12 Release-readiness runner expansion: `tauri-real-song-native-ui` is now part of the `-RealSongPath` gate set so future traces cover visible real-song Native A/B startup evidence.
- 2026-05-12 Real-song Native A/B playback evidence: visible Track Master `Native A/B` now records source/master cache-hit state, client-side prepare timing, and Rust native invoke timing; the real-song UI smoke passed with `prepare_client_elapsed_ms: 194.1`, `invoke_elapsed_ms: 56.7`, `source_cache_hit: true`, and `master_cache_hit: false`.
- 2026-05-12 Full release readiness trace at `f1c4cff`: `test-output\release-readiness-f1c4cff-full-20260512-182456\release-readiness.json` passed all 21 gates with zero failures and zero skips, including Python compile/unit/CLI smoke, desktop build/integration, Tauri release build, sidecar startup, packaged launch, Track Preview UI, Album state, Album/Track Codec QC with Listening Handoff Packet assertions, session safety, project persistence, real-song Track/Region/Album smokes using `Lay the Money on the Desk (1).mp3`, NSIS installed-app smoke, MSI package smoke, and `git diff --check`.
- 2026-05-12 Listening Handoff Packet: added `Save Listening Packet`, Tauri `write_listening_packet`, and packaged Album Codec QC evidence that `listening-handoff.json` and `.html` are written beside the render, include codec preview paths, include human-approval caveats, and preserve `approved: false`.
- 2026-05-12 Full release readiness trace at `15b5d0e`: `test-output\release-readiness-15b5d0e-full-20260512-175810\release-readiness.json` passed all 21 gates with zero failures and zero skips. This is retained as a baseline; `8376e38` is the current-commit trace.
- 2026-05-12 Real-song Album playback gate fix: the real-song Album UI/playback smoke now self-launches the packaged release EXE by default and passes against `Lay the Money on the Desk (1).mp3`; app render revision stamps now use a synchronous session revision ref so immediate role/control edit plus render is not incorrectly marked stale.
- 2026-05-12 Release readiness trace runner: added `scripts/release-readiness.ps1` and `desktop` script `npm run verify:release`. The runner records per-step logs and `release-readiness.json` for Python compile/unit/CLI smoke, desktop build/integration, Tauri release build, sidecar startup, packaged release launch, Track Preview UI, Album state, Album/Track Codec QC, session safety, project persistence, optional real-song smokes, optional installer smokes, and `git diff --check`.
- 2026-05-12 Album Codec and history evidence: packaged Album Master Codec QC smoke verifies Album Export appears in Recent Renders with enabled Play/Dashboard actions, Recent Renders Play hands off to album playback, `renderHistory` persists an `album-export` entry, Album WAV shows `Render-faithful album`, and Album AAC shows `Codec preview audition` with no warning state.
- 2026-05-12 Preview honesty labels: packaged Album Master state smoke verifies boundary preview playback shows `Bounded boundary preview`, tooltip copy mentions adjacent track tails/heads and not full-album approval, and the pill is not in warn state. Packaged Track Preview UI smoke still verifies `Render-faithful region`, `Render required` after stale Live Preview control edits, `Render-faithful preview`, cue-time tooltip text, and `Approx audition` after returning to source Live Preview.
- 2026-05-12 Album Master Boundary Preview: packaged Album Master state smoke verifies visible `Preview Boundary`, generates a bounded adjacent-track WAV through the Python `preview-transition` sidecar path, confirms preview/project files exist, verifies transport label `Boundary 1 to 2 Preview`, and records a Recent Renders `Boundary Preview` entry. Python unit coverage verifies disabled `gap`, `fade`, `ring-out`, and `crossfade` boundary primitives in preview output.
- 2026-05-12 Recent Renders rail: packaged Track Preview UI smoke verifies completed Track Preview, Region Preview, and Track Export runs appear in a local Recent Renders rail, dashboard reload from history works, and at least three render-history entries persist through autosave.
- 2026-05-12 Bounded native Track Preview: packaged Track Preview UI smoke verifies visible `Native Preview` renders the selected waveform region through `rust-native-live-preview-model`, plays it through native audio, and stops cleanly with metadata start `1s`, duration `1.195s`, and `57360` frames.
- 2026-05-12 Listening receipt audition context: packaged Album Master Codec QC smoke verifies `listening-review.json` records the judged audition path, including `Codec preview audition`, `Album AAC 256k`, `transport_kind: codec`, Live Preview contract parity `approximate`, modeled controls including `Low`, and native playback status `ready`.
- 2026-05-12 Listening receipt artifact: packaged Album Master Codec QC smoke verifies the visible `Save Receipt` action writes `listening-review.json` beside the render with `status: "not-approved"`, codec-preview checklist state, export checks, codec preview entries, render paths, and caveats that automation is not human approval.
- 2026-05-12 real-song Album Master Codec QC: packaged release EXE smoke verifies `Lay the Money on the Desk (1).mp3` can be split into three album clips, rendered as Album Master with two generated transitions, and checked with album-level AAC/Opus codec previews passing `Codec QC` as `2 codec preview path(s) exist`.
- 2026-05-12 Album Master Codec Preview audition: packaged release EXE smoke verifies Album Master exposes album-level AAC/Opus codec preview buttons, selects `Album AAC 256k`, starts/stops native playback, persists `listeningChecklist.codecPreviewAudition`, and writes manifest codec previews that exist on disk.
- 2026-05-12 Codec Preview Listening Pass item: packaged session-safety and Track Master Codec QC smokes verify `listeningChecklist.codecPreviewAudition` persists, including a Codec QC smoke note that codec previews were audited while human sound approval remains required.
- 2026-05-12 Track Master Codec Preview audition rail: packaged release EXE smoke verifies the visible selected-track `Codec Previews` rail, two AAC/Opus buttons, WebView playback handoff for `Codec QC Fixture 1 - AAC 256k`, and native playback start/stop for the prepared codec preview.
- 2026-05-12 real-song Track Master Codec QC: packaged release EXE smoke verifies the supplied MP3 `Lay the Money on the Desk (1).mp3` imports, analyzes at 186.32 seconds, renders a Track Master, passes export checks, and creates two codec previews with `Codec QC` passing as `2 codec preview path(s) exist`.
- 2026-05-12 Track Master Codec QC receipt: packaged release EXE smoke verifies a two-track Track Master export with `Codec QC` enabled shows `4 codec preview path(s) exist`, writes two per-track manifests with `codec_preview: true`, and creates two AAC plus two Opus codec preview files that exist on disk.
- 2026-05-12 Track Preview dashboard handoff: packaged Track Preview smoke verifies `Update Preview` populates the embedded dashboard pane, exposes an `asset.localhost` dashboard iframe, and enables visible `Open HTML`.
- 2026-05-12 Album Master state safety: packaged release EXE smoke verifies Undo/Redo for album title, generated transitions, boundary style/seconds, selected-track role, and selected-track preset, then confirms the redone Album Master state persists through autosave.
- 2026-05-12 visible reference playback: packaged Track Preview smoke seeds a reference track, clicks the visible `Reference` button, and verifies `Reference playback`, transport label `01_track_preview_fixture - Reference`, and unprocessed comparison copy before continuing the full Track Master smoke.
- 2026-05-12 release session safety: packaged release EXE smoke restores a two-track Track Master autosave, verifies Undo/Redo through Universal -> Clarity, saves a user preset, persists listening approval, then changes Low to `+0.50 dB` and verifies listening approval is cleared and persisted as not approved.
- 2026-05-12 direct Project path persistence: packaged project persistence smoke saves a `.ams.json` copy through the visible Project path field, mutates the album title, loads the original project path back, verifies the title is restored, then renders and export-checks the loaded project.
- 2026-05-12 visible track reorder controls: packaged Track Preview smoke clicks Move Up on Track 2, verifies the order changes from `[Preview Fixture 1, Preview Fixture 2]` to `[Preview Fixture 2, Preview Fixture 1]`, verifies the moved track remains selected as `Track 1`, then continues through preview and batch export checks.
- 2026-05-12 native Live Preview playback handoff: packaged Track Preview smoke clicks visible `Native Play` with source Live Preview active and verifies `Native Live Preview playing`, `Rust model: 1.36 width, 0.40 intensity`, a 192000-frame Rust model output, and clean stop.
- 2026-05-12 native Live Preview model oracle: packaged Track Preview smoke prepares one source through `prepare_playback_file`, renders both the Python sidecar model and Rust native offline model from that source, and compares 192000 frames at 48000 Hz with `rms_difference_dbfs: -101.14268111252326` and `max_abs_difference: 1.5288591384887695e-05`.
- 2026-05-12 native playback probe for the Live Preview model: packaged Track Preview smoke prepares the Tauri-rendered model WAV for playback and probes it through native audio with zero stream errors.
- 2026-05-12 Tauri-side Live Preview model bridge: added a release WebView command path that invokes the bundled sidecar `preview-model` and verifies the output WAV/metadata in the packaged Track Preview smoke.
- 2026-05-12 engine-owned deterministic Live Preview model: added `render_live_preview_model()` and `album-master preview-model`, then moved smoke comparison evidence off JS-only DSP logic.
- Commit `80ef3c3`: guarded runtime Live Preview contract drift and verified `livePreviewContractDrift: []` in broad UI and packaged Track Preview smokes.
- Commit `82c1941`: surfaced the engine-owned Live Preview contract in Track Master.
- Commit `c363ee7`: added the Python preview contract command and unit regression.
- Commit `d908f2c`: aligned the shared Web Audio first-control model closer to export intent while keeping approximation visible.
- Prior 2026-05-12 loops: verified Track Master real-song region render, Update Preview handoff, listening approval persistence surface, true multi-source Album Master, full-source Album Master, release packaging, and native playback smokes.

## Completion Blockers

Do not mark the active goal complete until these are resolved or explicitly waived by the user:

1. A real human listening pass is run and recorded in the app or handoff notes, including whether Track Master and Album Master outputs are musically acceptable.
2. Live Preview either becomes shared/export-engine faithful for the basic ear-facing controls or remains clearly scoped as an approximation with release-candidate wording explicitly accepted.
3. Native OS Open and Save-As dialogs are automated, manually verified, or explicitly waived. Direct path-based project Load/Save is covered, but that is not native dialog coverage.

Closed for current commit:

- Current final release loop for commit `e619318` passed with real-song, true headless native output probe, Native UI/audio, and installer gates enabled.

## Next Unattended Slices

Best next slices when the user is not actively listening:

1. After any code, packaging, or smoke-test change, rerun `cd desktop; npm run verify:release -- -RealSongPath "C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3"` and add `-IncludeInstallerSmokes` when intentionally validating installers.
2. Automate packaged Open plus explicit Save As coverage only if a reliable Windows dialog automation route is found; keep the blocker documented while native OS dialogs remain too flaky to drive unattended.
3. Add narrower release smoke coverage for any unverified UI evidence that is currently only documented.
4. Keep tightening the product honesty surface: every preview path should state whether it is Web Audio approximation, Rust first-control native preview, Python render-faithful preview, codec preview, or album/transition render output.

Best next slice when the user is present:

1. Run Track Master on `C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3`, listen through Live Preview, Update Preview, Render Region, and Export Master, then record the listening result.
2. Run Album Master with real source material, listen through the continuous album WAV and boundaries, then record approval or concrete problems.
