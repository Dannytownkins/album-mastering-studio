# Album Mastering Studio Implementation Plan

Last updated: 2026-05-12

This is the execution map for the current Codex/Tauri/Python repo. Read `docs/PRODUCT.md` first. `PRODUCT.md` is the product canon; this file is the living implementation plan.

Do not treat this as a promise that the current architecture is permanent. The plan starts from the existing repo because it already has working engine, Tauri, sidecar, reports, and smoke-test proof. It also includes early architecture research and engine modernization gates so the product is not trapped inside the first implementation.

## Current Strategic Direction

Build a top-tier private desktop mastering app around two modes:

1. Track Master.
2. Album Master.

Track Master ships first as the core vertical slice, but Album Master is a required near-term path because the user's personal project needs full-album mastering. Track Master is the first proof of the shared foundation, not the final destination.

The research-backed product shape is a fast lane for quick analysis/audition/export, backed by a deeper lane where mastering stages, measurements, warnings, and eventually module-level controls can be inspected. Stability still wins over breadth: do not add advanced research features until the current Track Master and Album Master foundations are trustworthy.

The product must support real-time or near-real-time audition before Track Master can be called release-candidate. Non-real-time preview rendering is allowed only as temporary scaffolding while the real-time path is being built and proven.

## Non-Negotiable Product Gates

Track Master cannot be considered top-tier until it has:

- Drag/drop audio import.
- Analyze.
- Safe Universal settings.
- Large waveform.
- Waveform zoom.
- Region selection.
- Loop selected region.
- Original/Mastered toggle at the same playhead.
- Optional Volume Match, off by default.
- Functional preset tiles.
- Functional Intensity macro.
- Functional Low/Mid/High EQ.
- Whole-track mastered preview.
- Stale preview state when controls change.
- Real-time or near-real-time audition for basic ear-facing controls.
- One obvious Export Master action.
- Advisory post-render quality checks.
- Non-overwriting output.
- Autosave.
- Undo/redo for non-destructive state.

Album Master cannot be considered top-tier until it has:

- Track ordering.
- Analyze.
- Global album intent plus per-track adaptation.
- Track Roles / Story step after analysis.
- Editable role/character decisions.
- Individual masters.
- Continuous album WAV by default.
- Preserved source boundaries by default.
- Gap/crossfade/boundary primitives.
- Generated transitions off by default.
- Cue/split data when appropriate.
- Album dashboard/report.
- Album-level quality checks.

## Workstream Overview

1. Current repo stabilization and docs.
2. Competitive and architecture research spike.
3. Rust/Tauri typed app foundation.
4. Track Master frontend rebuild.
5. Playback, waveform, and A/B foundation.
6. Real-time audition spike and engine decision record.
7. Track Master export and quality checks.
8. Presets, custom settings, autosave, undo.
9. Album Master workflow.
10. Transition primitives.
11. DSP audit and engine modernization.
12. Real-audio fixture testing and listening loop.
13. Installer/release hardening.

These streams can overlap, but every phase must end with a no-victory-lap check against `docs/PRODUCT.md`.

## Phase 0: Canon And Repo Baseline

Goal: make sure every agent starts from the same product reality.

Tasks:

- Keep `docs/PRODUCT.md` as the canonical product record.
- Keep this file as the living execution plan.
- Keep `docs/progress.md` as detailed session evidence.
- Update `docs/codex-active-handoff.md` before handoff or compaction when current work is mid-flight.
- Confirm current repo commands still run before large refactors.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-plan-baseline-smoke
cd desktop
npm run build
npm run test:integration
```

No-victory-lap check:

- Product canon exists.
- Implementation plan exists.
- Known untracked/private research files are not accidentally deleted.

## Phase 1: Competitive And Architecture Research Spike

Goal: do not guess the app shell or audio engine path.

This phase runs in parallel with early Track Master prototyping. It should not freeze all product work.

Compare:

- Tauri UI plus Rust native audio engine.
- Tauri UI plus Python/offline engine plus Rust real-time preview.
- JUCE/native app.
- Rust native UI/audio stack.
- Hybrid route where Tauri remains UI and audio/DSP engine becomes native underneath.

Benchmark products:

- Waves Online Mastering: A/B, Volume Match, Add Reference, simple mastering controls.
- iZotope Ozone: assistant-driven mastering, preset/product language, metering.
- Steinberg WaveLab: professional montage, loudness, DDP/export discipline.
- LANDR/eMastered/BandLab: one-click expectations and quick export path.
- Sonible, Mastering The Mix, YouLean, ADPTR Metric AB, Matchering, CloudBounce, Masterchannel, RoEx, and Bakuage: metering, assistant, reference, limiter, album, and open technical reference patterns.

Primary new research input:

- `docs/most-recent-mastering-app-research.md`

Use this research to classify product patterns as table stakes, differentiators, later-stage ideas, or claims needing verification. Do not treat the full research dossier as an automatic backlog.

Research questions:

- What does each product do that validates our desired workflow?
- What should remain private-reference-only if this ever goes public?
- What app shell best supports serious low-latency audio audition?
- Can Tauri plus native Rust audio meet the latency and fidelity bar?
- Does JUCE materially simplify real-time audio, DSP, waveform, and export parity?
- What architecture minimizes rewrite risk while maximizing audio seriousness?
- Which research-backed product patterns are table stakes, which are differentiators, and which are later-stage distractions?

Deliverable:

- `docs/ARCHITECTURE_SPIKE.md`

It must include:

- Options compared.
- Evidence gathered.
- Latency observations.
- Build/package implications.
- Audio quality implications.
- Recommendation.
- Risks.
- What decision remains reversible.

No-victory-lap check:

- The recommendation is evidence-based.
- It does not choose Tauri forever by inertia.
- It does not choose native/JUCE just because it sounds serious.

## Phase 2: Rust/Tauri App Foundation

Goal: make the backend talk in product concepts, not raw CLI arrays.

Current Rust is a useful bridge but too generic. Refactor toward typed commands while preserving working behavior.

Desired modules/responsibilities:

- `engine`: wraps engine commands and sidecar process execution.
- `jobs`: analyze/render job queue, progress, cancel.
- `files`: import validation, source metadata, path safety.
- `project`: autosave, project files, recent sessions.
- `settings`: user presets and settings chains.
- `audio`: playback cache, A/B preview assets, waveform prep.
- `exports`: output versioning and quality-check orchestration.

Typed commands to introduce:

- `analyze_tracks`
- `render_track_preview`
- `render_track_master`
- `render_album_master`
- `prepare_source_playback`
- `prepare_master_playback`
- `prepare_ab_preview`
- `prepare_waveform`
- `run_export_checks`
- `save_project`
- `autosave_session`
- `load_recent_session`
- `save_user_preset`
- `list_user_presets`
- `open_output`

Rules:

- Do not duplicate DSP in Rust just to move code.
- Do move app state, file safety, job control, and playback infrastructure into Rust where it helps.
- Keep the frontend insulated from raw CLI argument construction.

Verification:

- Existing integration tests still pass or are replaced with equivalent typed-command tests.
- Analyze and render still work through the app.
- Cancel/progress still work.
- Dev fallback and release sidecar behavior still work unless intentionally changed with evidence.

## Phase 3: Track Master UI Rebuild

Goal: build the reference-inspired Track Master workstation.

Agents may fully replace the current `desktop/src/App.tsx` structure if that better serves the spec. Preserve useful logic, not the current layout.

Required screen structure:

- Left imported songs rail.
- Main waveform/audition area.
- Play/pause.
- Loop.
- Original/Mastered toggle.
- Optional Volume Match toggle, off by default.
- Preset tile row.
- Intensity control.
- Low/Mid/High EQ.
- Update Preview or live state indicator.
- Export Master button.
- Advanced section collapsed by default.

Initial simple controls:

- Universal.
- Clarity.
- Tape.
- Spatial.
- Oomph.
- Warmth.
- Punch.
- Loud/Energy if needed.

State behavior:

- Import adds tracks quickly.
- Analyze computes values and safe universal settings.
- Export is enabled after analysis.
- Changing controls marks mastered preview stale unless real-time audition is live and export-faithful.
- The UI must not play an old master as if it reflects current controls.

Temporary scaffolding:

- Whole-track preview rendering may be used before real-time audition is solved.
- Region selection can initially control playback/loop while preview remains whole-track.

Verification:

- Drag/drop works.
- Analyze works.
- Whole-track preview works.
- Original/Mastered same-position toggle works.
- Volume Match exists and defaults off.
- Changing a control marks preview stale.
- Export creates a non-overwriting output.

Current packaged coverage:

- 2026-05-12 added `npm run test:tauri-track-preview-ui`.
- 2026-05-12 enabled Tauri `app.security.assetProtocol` for local user/temp media locations after the A/B smoke proved prepared playback files existed but WebView audio could not load them.
- 2026-05-12 updated the WebView playback-position range to seek on `input` and update visible position immediately.
- 2026-05-12 updated region-loop playback state so Loop start and boundary jumps update visible transport position immediately.
- 2026-05-12 added a packaged Live Preview diagnostic that verifies the Web Audio chain is running and receives Low, Mid, High, and Width changes under 150 ms, plus Intensity changes under 500 ms.
- 2026-05-12 added CDP mouse-drag verification for the playback-position range.
- 2026-05-12 extended the packaged Track Preview smoke to render a second Python preview after the stale state and compare it against a deterministic Web Audio first-control model covering Low, Mid, High, Width, and Intensity.
- 2026-05-12 extended the release-backed real-song performance smoke to render a second first-control Track Master pass from `Lay the Money on the Desk (1).mp3` and compare the Python output against a deterministic `web-audio-first-control-model` generated from the real playback-cache WAV.
- 2026-05-12 added `desktop/src/livePreviewConfig.json` so the Tauri Web Audio chain and deterministic comparison helper read the same first-control model constants.
- 2026-05-12 tightened the preview-parity label so missing/stale exact renders show `Render required`, rendered-preview Live Preview shows `Approx audition`, and non-live rendered preview stays labeled render-faithful.
- 2026-05-12 fixed Track Master multi-export receipts so batch exports aggregate every independent rendered track before running quality checks.
- 2026-05-12 fixed Track Master Codec QC so track-only exports generate per-track AAC/Opus previews, batch receipts report `4 codec preview path(s) exist` for two exported tracks, and `npm run test:tauri-release-track-codec-qc` verifies the packaged release EXE path.
- 2026-05-12 added `npm run test:tauri-real-song-codec-qc` and verified the provided MP3 through the packaged Track Master path with `Codec QC` passing as `2 codec preview path(s) exist`.
- 2026-05-12 added a selected-track `Codec Previews` audition rail and extended `npm run test:tauri-release-track-codec-qc` to verify AAC preview WebView handoff plus native playback start/stop.
- 2026-05-12 added `Codec preview checked` to the Listening Pass panel and verified the autosaved `codecPreviewAudition` state in packaged session-safety and Codec QC smokes.
- 2026-05-12 added Album Master codec-preview artifact buttons and `npm run test:tauri-release-album-codec-qc`; packaged evidence verifies `Album AAC 256k` WebView handoff, native playback start/stop, persisted `codecPreviewAudition`, and two existing album codec-preview outputs.
- 2026-05-12 added `npm run test:tauri-real-song-album-codec-qc` and verified `Lay the Money on the Desk (1).mp3` through the packaged Album Master path as three derived clips with `Codec QC` passing as `2 codec preview path(s) exist`.
- 2026-05-12 added a `Save Receipt` action to the Listening Pass panel; packaged evidence verifies `listening-review.json` is written beside the current render with not-approved status, checklist state, export checks, codec previews, and human-approval caveats.
- The release EXE smoke restores a two-track Track Master session, selects Track 2, verifies visible reorder controls move Track 2 into slot 1, clicks visible `Update Preview`, and verifies a one-track preview manifest, dashboard, mastered WAV, playback-cache preparation, WebView local audio load, transport range seek, pixel-level transport seek drag, `Master ready` state, same-position A/B Original/Mastered switching, waveform region creation, region Loop behavior, Volume Match gain behavior, Live Preview control latency for Low/Mid/High/Width/Intensity, `Approx audition` after live audition is armed, stale `No master` plus `Render required` after live control changes, second preview render, export-vs-live comparison fields (`same_engine: false`, `preview_parity: "approximate"`, `export_faithful_preview_required: true`), and a two-track Track Master batch export receipt (`2 rendered track path(s) exist`).
- Evidence: `test-output/tauri-track-preview-ui-smoke/tauri-track-preview-ui-smoke.json`.
- Remaining Phase 3/4 gaps: actual export-engine parity implementation for live audition and human listening approval.
- 2026-05-12 added a separate `listeningApproved` autosaved session flag and an `Approved after listening` control.
- The Listening Pass checklist remains a six-item activity trail; approval is stored separately so progress cannot be mistaken for human approval.
- Render-affecting edits clear `listeningApproved`.
- Evidence: `test-output/tauri-listening-approval-ui-smoke/tauri-webview-ui-smoke.json`.
- 2026-05-12 broad WebView UI smoke now verifies `previewParityStatus: "Render required"` when Live Preview is armed before any exact rendered master is selected.
- Evidence: `test-output/tauri-webview-ui-smoke/tauri-webview-ui-smoke.json`.
- 2026-05-12 true multi-source Album Master automated evidence passed with three distinct local WAV sources supplied through `AMS_REAL_SONG_ALBUM_PATHS`.
- Release performance evidence: `test-output/tauri-real-song-album-performance-multisong-3source/tauri-real-song-album-performance-smoke.json`.
- UI/native playback evidence: `test-output/tauri-real-song-album-ui-multisong-3source/tauri-real-song-album-ui-smoke.json`.
- Evidence values include `sourceMode: "multi-song"`, `distinctSourceCount: 3`, `renderTrackCount: 3`, `renderInterludeCount: 2`, passing export checks, `manifestTrackCount: 3`, `manifestInterludeCount: 2`, and 12 seconds of native album WAV stability with no stream errors or warnings.
- Remaining human-listening gap: the app can now capture approval, but no actual user listening pass has been recorded.
- Remaining multi-source caveat: the true multi-source run still uses 10-second excerpts from each source, not a full-song human listening pass.
- 2026-05-12 full-source multi-song Album Master automated evidence passed with the same three distinct WAV sources using `AMS_REAL_SONG_ALBUM_CLIP_SECONDS=999`.
- Full-source release performance evidence: `test-output/tauri-real-song-album-performance-multisong-fullsource/tauri-real-song-album-performance-smoke.json`.
- Full-source UI/native playback evidence: `test-output/tauri-real-song-album-ui-multisong-fullsource/tauri-real-song-album-ui-smoke.json`.
- Full-source evidence values include `analysisDurationsSeconds: [118.56, 116.00, 148.56]`, `renderTrackCount: 3`, `renderInterludeCount: 2`, passing export checks, `manifestTrackCount: 3`, `manifestInterludeCount: 2`, an album sequence duration of about `387.54s`, and 30 seconds of native album WAV stability with no stream errors or warnings.
- Remaining full-source caveat: this is still automated verification, not human listening approval or musical approval of the generated transitions.
- 2026-05-12 `Update Preview` was tightened into an immediate export-engine audition handoff: after the Python-rendered preview completes, the app prepares and plays the rendered master in the transport.
- The preview-parity label now follows the active playback path rather than the armed Live Preview toggle: source playback with Web Audio remains `Approx audition`, stale/missing exact renders remain `Render required`, and Python-rendered master playback shows `Render-faithful preview`.
- Packaged Track Preview evidence: `test-output/tauri-track-preview-ui-smoke/tauri-track-preview-ui-smoke.json`.
- Broad WebView UI evidence: `test-output/tauri-update-preview-handoff-ui-smoke/tauri-webview-ui-smoke.json`.
- Evidence values include `previewParityAfterLivePreview: "Approx audition"`, `previewParityAfterControlChange: "Render required"`, `previewParityAfterUpdatePreview: "Render-faithful preview"`, `exportEngineAuditionPath == parityPreviewMasterPath`, `exportEngineAuditionEngine: "python-render-track-master"`, and the existing negative comparison `same_engine: false`.
- Remaining Live Preview caveat: this makes the Python-engine audition one click closer, but Web Audio Live Preview is still approximate and not export-engine parity.
- 2026-05-12 added bounded Python-engine `Render Region` audition for selected waveform regions or a playhead window.
- Tauri command `render_track_region_preview` trims the source with FFmpeg into `region-source.wav`, points a one-track project at that clip, disables transitions/album WAV/codec preview, then calls the existing Python `render-project` flow through `render_project_product`.
- Packaged Track Preview evidence: `test-output/tauri-track-preview-ui-smoke/tauri-track-preview-ui-smoke.json`.
- Broad WebView UI evidence: `test-output/tauri-region-preview-ui-smoke/tauri-webview-ui-smoke.json`.
- Evidence values include `regionPreviewParity: "Render-faithful region"`, `regionPreviewSourcePath` ending in `region-source.wav`, `regionPreviewManifest.track_count: 1`, `regionPreviewManifest.interlude_count: 0`, `regionEngineAuditionEngine: "python-render-track-region-preview"`, `regionEngineAuditionStartSeconds: 1`, and `regionEngineAuditionDurationSeconds: 1.1949685534591197`.
- Remaining region-preview caveat: this is faster bounded export-engine audition, not true real-time export-engine DSP.
- 2026-05-12 added release-backed real-song region-preview turnaround smoke: `npm run test:tauri-real-song-region-preview`.
- Real-song region preview evidence: `test-output/tauri-real-song-region-preview-smoke/tauri-real-song-region-preview-smoke.json`.
- Evidence values include source validation `ok`, source duration `186.31997916666663s`, region start `65.21199270833331s`, region duration `12s`, `renderDurationMs: 8476.3`, rendered region duration `12s`, clipped source `region-source.wav`, passing export checks, playback cache prep `27.9ms`, and a 3-second native playback probe with `played_output_frames: 144000`, `callback_count: 300`, no stream errors, and no warnings.
- Remaining real-song caveat: this is one automated real-MP3 timing/probe pass, not human listening approval or real-time live DSP.
- 2026-05-12 added release-backed visible UI coverage for the real-song Track Master `Render Region` path: `npm run test:tauri-real-song-region-ui`.
- The visible region readout now falls back to selected-track analysis duration when transport audio is not loaded, so analyzed tracks show real region times before playback starts.
- Real-song region UI evidence: `test-output/tauri-real-song-region-ui-smoke/tauri-real-song-region-ui-smoke.json`.
- Evidence values include `regionReadoutAfterDrag: "01:05 - 01:17 (00:12)"`, `regionPreviewParity: "Render-faithful region"`, `regionEngineAuditionEngine: "python-render-track-region-preview"`, start `65.03621914308174s`, duration `12.011193625524115s`, rendered duration `12.011s`, `manifest.track_count: 1`, `manifest.interlude_count: 0`, clipped source `region-source.wav`, existing manifest/dashboard/source/master artifacts, and a 12.011s transport duration.
- Remaining real-song UI caveat: this proves the visible release UI can render and audition a bounded region from one real MP3; it is still render-first and not human listening approval.
- 2026-05-12 tightened the same real-song region UI smoke so it starts from an unanalyzed Track Master session and clicks the visible `Analyze` button before `Render Region`.
- Evidence values now include `initialAnalysisStatus: "Needs analysis"`, `analysisStatusAfterAnalyze: "Analyzed"`, visible Source LUFS/Peak text, waveform readiness, `Export Master` enabled after analysis, `Render Region` disabled before analysis and enabled after analysis, then the same render-faithful region handoff.
- The smoke fails fast if source validation blocks or Analyze fails.
- Remaining Analyze -> Render Region caveat: this is still automated UI evidence against one real MP3, not human listening approval or true real-time export-engine DSP.
- 2026-05-12 extended the real-song region UI smoke to cover stale-state behavior after a tuning change.
- Evidence values include first region parity `Render-faithful region`, `Low` changed to `+0.50 dB`, stale parity `Render required`, transport reset to `Player idle`, `Render Region` enabled again, a second new Python-engine region master path, final parity `Render-faithful region`, and the same 12.011s bounded region duration.
- Remaining region stale/re-render caveat: this proves stale protection and re-render handoff for bounded region audition; it is still render-first automation, not true live export-engine DSP or human listening approval.
- 2026-05-12 changed the visible Track Master `Render Region` path to pass `auditionOnly: true` into the Tauri region-preview command.
- Audition-only region preview still renders audio through Python `render-project`, but skips `score-render` and `export-dashboard` so the UI loop does not spend time generating reports for throwaway region checks.
- Full Track Master renders, Album Master renders, and the direct/default region-preview backend command still use the default scored/dashboard path.
- Evidence values now include real-song UI region `dashboardExists: false` and `dashboardSkippedForAudition: true`, direct backend region-preview `dashboardExists: true`, and Track Preview UI `regionPreviewDashboardExists: false` while `previewDashboardExists: true`.
- Remaining fast-region caveat: this is a faster render-first audition loop, not true real-time export-engine DSP parity.
- 2026-05-12 `Update Preview` now records the source audition cue point in the preview artifact and `window.__AMS_EXPORT_ENGINE_AUDITION__`, and the `Render-faithful preview` tooltip discloses the Python export-engine cue time.
- Packaged Track Preview evidence now verifies the Python-rendered master resumes at the captured cue point (`1.664367s` expected and actual), then switching back to `Original` with Live Preview armed returns to active Web Audio audition and `Approx audition`.
- The same smoke now asserts the export-vs-live comparison is materially different: `exportDiffersFromLiveMaterially: true`, `export_minus_live_lufs_proxy: 11.580809727845596`, and `rms_difference_dbfs: -18.377686540787774`.
- Remaining cue-preserving audition caveat: this improves handoff honesty and preserves the audition point, but Web Audio Live Preview is still approximate and not shared export-engine DSP.
- 2026-05-12 extended the packaged Track Preview smoke so the first-control Live Preview set is covered beyond Low.
- Evidence values include `liveControlResults: [Low, Mid, High, Width, Intensity]`, max lightweight latency `1.5 ms`, `liveControlUnder150ms: true`, `liveIntensityUnder500ms: true`, and final live snapshot values `bass: 0.5`, `mid: -0.25`, `high: 0.35`, `width: 1.36`, and `drive: 0.4`.
- Remaining multi-control caveat: this proves responsive Web Audio control updates and stale render honesty, but Web Audio Live Preview is still approximate and not shared export-engine DSP.
- 2026-05-12 updated the deterministic export-vs-live comparison from a Low-only model to `web-audio-first-control-model`.
- Evidence values include `modeled_controls: [Low, Mid, High, Width, Intensity]`, `modeled_width: 1.36`, `modeled_drive: 0.4`, tuning `{ bassDb: 0.5, midDb: -0.25, highDb: 0.35, width: 0.2, intensity: 0.4 }`, and `live_model_path: test-output\tauri-track-preview-ui-smoke\live-preview-first-control-model.wav`.
- Remaining first-control model caveat: this makes the comparison align with the current live controls, but it remains negative parity evidence rather than shared/export-engine DSP.
- 2026-05-12 added real-song first-control export-vs-live evidence to `npm run test:tauri-real-song-performance`.
- Original evidence values before later calibration included `analysisDurationSeconds: 186.31997916666663`, `firstControlRenderDurationMs: 27192.7`, `realSongExportVsLiveComparison.exportDiffersFromLiveMaterially: true`, `export_minus_live_lufs_proxy: 3.919839091548681`, `rms_difference_dbfs: -25.193622894439955`, `compared_frames: 8943359`, and `live_model_path: test-output\tauri-real-song-performance-smoke\real-song-live-preview-first-control-model.wav`.
- Remaining real-song comparison caveat: this is automated evidence against one provided MP3 rather than shared/export-engine DSP or human listening approval.
- 2026-05-12 rebuilt the release EXE after moving the Web Audio constants into `desktop/src/livePreviewConfig.json`, then reran Track Preview and real-song performance smokes against the rebuilt app.
- 2026-05-12 aligned the shared Web Audio model constants closer to Python export intent: low shelf `105 Hz`, presence `3.2 kHz`, air `9.8 kHz`, and a lighter hard-knee Intensity curve.
- Current aligned evidence keeps the synthetic Track Preview mismatch visible (`exportDiffersFromLiveMaterially: true`, `export_minus_live_lufs_proxy: 9.08023618964403`) while the provided real MP3 now lands below the material-mismatch flag (`exportDiffersFromLiveMaterially: false`, `export_minus_live_lufs_proxy: 0.714872039163112`).
- 2026-05-12 added an engine-owned `live_preview_contract()` plus `album-master preview-contract --json`, and a unit regression now compares `desktop/src/livePreviewConfig.json` against that Python contract.
- 2026-05-12 updated the broad Tauri WebView runtime smoke to consume the shared live preview config instead of its older hardcoded Web Audio constants.
- 2026-05-12 added Tauri `live_preview_contract` and visible audition-row chips for the engine-owned boundary: `Live model: Low, Mid, High, Width, Intensity` and `Render-only: tone, highpass, low-mid, brightness, warmth, transients, LUFS, limiter, codec`.
- 2026-05-12 added a packaged-runtime drift guard: the frontend compares the loaded Python contract against the bundled Web Audio config and exposes `livePreviewContractDrift: []` in both broad UI and packaged Track Preview smoke evidence.
- 2026-05-12 added `render_live_preview_model()` and `album-master preview-model`, then updated the shared smoke helper so export-vs-live evidence renders the deterministic first-control model through the Python engine instead of JS-only DSP logic.
- 2026-05-12 added Tauri `render_live_preview_model` and packaged Track Preview smoke coverage proving the release WebView can invoke the bundled sidecar model renderer and receive `output_exists: true`, `modeled_width: 1.36`, `modeled_drive: 0.4`, and `frame_count: 192000`.
- Current engine-owned model evidence includes Track Preview `modeled_width: 1.36`, `modeled_drive: 0.4`, `export_minus_live_lufs_proxy: 9.080398089816866`, plus real-song `export_minus_live_lufs_proxy: 0.7150013134906779` against `Lay the Money on the Desk (1).mp3`.
- 2026-05-12 added a Tauri/Rust offline `render_native_live_preview_model` oracle and packaged smoke coverage comparing it against the Python sidecar model from the same prepared PCM playback-cache source. Evidence: 192000 compared frames at 48000 Hz, `rms_difference_dbfs: -101.14268111252326`, `max_abs_difference: 1.5288591384887695e-05`, matching tuning, and nine render-only export stages.
- 2026-05-12 wired visible `Native Play` to use the Rust model when source Live Preview is active. Packaged smoke clicks the real button and verifies `Native Live Preview playing`, `Rust model: 1.36 width, 0.40 intensity`, a 192000-frame model output, and clean stop before export.
- 2026-05-12 added a visible Project path field with direct `.ams.json` Load/Save fallback plus explicit Save As. Packaged project persistence smoke verifies direct path save, direct path load after a deliberate title mutation, and a two-track render/export-check from the loaded project.
- 2026-05-12 added visible Track Master reference playback. Packaged Track Preview smoke now seeds a reference path, clicks the visible `Reference` button, and verifies `Reference playback` parity plus unprocessed-comparison copy before continuing through A/B, region preview, Live Preview, native playback, and batch export.
- 2026-05-12 fixed Track Master `Update Preview` dashboard handoff. The packaged Track Preview smoke now verifies the generated preview dashboard appears in the embedded dashboard pane and that `Open HTML` is enabled after preview render.
- Remaining shared-definition caveat: this prevents UI/test constant drift, improves calibration, and makes the temporary Web Audio boundary visible, but it is still not shared/export-engine DSP or human listening approval. The contract explicitly lists unmodeled export stages.
- 2026-05-12 extended the real-song region UI smoke so active source Live Preview before `Render Region` is explicitly replaced by Python region playback.
- Evidence values include `livePreviewActiveBeforeRegion: true`, pre-render parity `Render required` with warn state because no exact master exists yet, `liveSnapshotBeforeRegion.active: true`, post-region `Render-faithful region`, `liveSnapshotAfterFirstRegion.active: false`, `regionPreviewParityWarnAfterFirstRegion: false`, and `regionPlaybackReplacedLivePreview: true`.
- Remaining live-to-region caveat: this proves the visible region-render path replaces active Web Audio source audition with exact Python region playback, but Web Audio Live Preview is still approximate and not shared export-engine DSP.
- 2026-05-12 added bounded native Track Preview audition. `album-master preview-model`, Tauri `render_live_preview_model`, and Tauri `render_native_live_preview_model` now accept start/duration windows; Track Master exposes a visible `Native Preview` action that renders the selected region or playhead window through the Rust first-control model and plays it through native Windows audio.
- Evidence: `test-output/tauri-track-preview-ui-smoke/tauri-track-preview-ui-smoke.json`.
- Evidence values include `boundedNativePreviewButtonEnabledBefore: true`, `boundedNativePreviewStarted: true`, `boundedNativePreviewStopped: true`, `native_engine: "rust-native-live-preview-model"`, `source_start_seconds: 1`, `duration_seconds: 1.195`, `frame_count: 57360`, and `Native Live Preview playing`.
- Remaining native-preview caveat: this is bounded first-control model audition, not continuous native DSP or full export-chain parity. `Update Preview`, `Render Region`, and `Export Master` remain the release-faithful Python paths.
- 2026-05-12 added a Recent Renders rail. Completed Track Preview, Region Preview, Track Export, Album Export, and Album Masters runs record local artifact entries with Play, Dashboard, and Open actions, and the list persists in autosave.
- Evidence: `test-output/tauri-track-preview-ui-smoke/tauri-track-preview-ui-smoke.json`.
- Evidence values include `renderHistoryCardCount: 4`, `renderHistoryIncludesTrackPreview: true`, `renderHistoryIncludesRegionPreview: true`, `renderHistoryIncludesTrackExport: true`, `renderHistoryDashboardLoaded: true`, and `persistedRenderHistoryCount: 3`.
- Remaining render-history caveat: this is a lightweight recent-artifact rail, not a searchable project library or permanent catalog.

No-victory-lap check:

- A pretty screen is not enough.
- Preset tiles must actually affect audio or be clearly disabled.
- A/B must preserve playhead.
- Stale state must be visible and honest.

## Phase 4: Playback, Waveform, A/B

Goal: make listening reliable enough for musical decisions.

Required:

- Waveform rendering for source and mastered audio.
- Zoom.
- Seek.
- Region selection.
- Region loop.
- Original/Mastered toggle.
- Volume Match optional/off by default.
- Playhead preservation.
- No source file mutation.

Acceptance:

- User can select a chorus, loop it, toggle Original/Mastered, and judge what the app did.
- User can move around the song without exporting.
- Playback controls are responsive and visually obvious.

Native audio requirement:

- Investigate native audio playback/control early.
- Browser audio is allowed for scaffolding but must not be assumed final.
- Serious real-time audition probably needs a native audio layer.

Playback stabilization requirement:

- Measure click-to-playing latency, not just whether audio eventually starts.
- Record cache hit vs cache miss behavior for `prepare_playback_file`.
- Instrument frontend audio events: `loadstart`, `loadedmetadata`, `canplay`, `canplaythrough`, `play`, `playing`, `pause`, and `error`.
- Capture `audio.readyState`, `networkState`, `duration`, `currentTime`, file URL, source path, playback cache path, and any `audio.play()` promise rejection.
- A smoke test is insufficient if manual playback feels frozen or delayed.

2026-05-12 packaged playback start evidence baseline:

- Added playback-cache hit/miss and prepare timing through `prepare_playback_file_info` without changing the existing `prepare_playback_file` string contract.
- Added `window.__AMS_PLAYBACK_EVIDENCE__` for browser transport starts and `window.__AMS_NATIVE_PLAYBACK_EVIDENCE__` for native playback starts.
- The Track Preview UI smoke now asserts timing/event evidence for Mastered, Reference, Original/Mastered A/B switches, and native Live Preview start.
- Evidence: `test-output/tauri-track-preview-ui-smoke/tauri-track-preview-ui-smoke.json`.
- Evidence values include `playbackStartedVisible: true`, `masteredPlaybackEvidenceHasTimings: true`, `masteredPlaybackEvidenceHasPlaying: true`, `referencePlaybackEvidenceHasTimings: true`, `abSourcePlaybackEvidenceHasPlaying: true`, `abMasterPlaybackEvidenceHasPlaying: true`, `abOriginalPlaybackEvidenceHasPlaying: true`, and `nativePlaybackEvidenceHasInvokeTiming: true`.
- Sample measured values from that run: mastered playback `click_to_playing_ms: 316.6`, cached A/B source `click_to_playing_ms: 30.1`, and native Live Preview `invoke_elapsed_ms: 12.3`.

2026-05-12 real-song Native A/B playback evidence baseline:

- Extended the visible real-song Native A/B smoke to assert `window.__AMS_NATIVE_PLAYBACK_EVIDENCE__` for the `native-ab-loop` path.
- The visible `Native A/B` action now records source/master playback-cache hits plus client-side prepare timing and Rust native invoke timing.
- Evidence: `test-output/tauri-real-song-native-ui-smoke/tauri-real-song-native-ui-smoke.json`.
- Evidence values from `Lay the Money on the Desk (1).mp3`: `prepare_client_elapsed_ms: 194.1`, `invoke_elapsed_ms: 56.7`, `source_cache_hit: true`, `master_cache_hit: false`, `active: true`.
- Remaining caveat: this makes real-song Native A/B startup measurable, but it is still automated UI evidence, not human listening approval or full export-chain live DSP parity.

## Phase 5: Real-Time Audition Spike

Goal: prove the app can support responsive controls by ear.

This is mandatory for final Track Master release quality.

Targets:

- Gain, lightweight EQ, width, and Volume Match changes audible in under about 150 ms.
- Heavier macro changes audible in under about 500 ms.
- No obvious clicks, zipper noise, glitches, or unstable playback.
- Preview and export must match in audible intent.

Spike approaches:

- Rust native audio plus DSP subset.
- Web Audio only as a baseline comparison, not assumed final.
- Python process/service if it can meet latency.
- JUCE/native proof if Tauri path struggles.
- Hybrid engine where offline export and realtime preview share the same DSP definitions.

Controls to prove first:

- Gain.
- 3-band EQ.
- Width.
- Volume Match.
- Basic intensity subset.

Research-backed design constraints:

- Keep assistant analysis, target matching, and heavy render work off the audio/playback path.
- Smooth all live control changes to avoid zipper noise.
- Treat Web Audio as a useful comparison baseline, but prove whether it can meet the user's ear-facing latency expectations on real local audio.
- If limiter, saturation, or linear-phase behavior cannot be live safely, expose them as render-faithful preview stages until a native path exists.

Then continue toward:

- Full Intensity macro.
- Preset parity.
- Advanced controls.

Deliverable:

- `docs/ENGINE_DECISION_RECORD.md`

It must include:

- Latency measurements.
- CPU/memory observations.
- Fidelity/export parity risks.
- Packaging implications.
- Recommendation: continue Python sidecar, add Rust audio layer, migrate DSP, use JUCE/native, or other.
- What is temporary vs final.

No-victory-lap check:

- Basic real-time controls are a milestone, not the finish line.
- Agents may not stop after one slider works.
- Non-real-time preview is temporary scaffolding, not final quality.

## Phase 6: Track Master Export And Quality Checks

Goal: make export safe, obvious, and honest.

Required:

- One obvious Export Master action.
- Non-overwriting output folder/file.
- Post-render checks.
- Advisory warnings.
- Export Anyway when technically possible.
- Report or compact receipt.
- Open output action.

Quality checks:

- True-peak/ceiling risk.
- Clipping risk.
- Extremely loud/flat warning.
- Codec preview risk when enabled.
- Non-finite analysis guard.
- Source/master sanity comparisons.
- Dither misuse risk.
- Stereo correlation/mono-fold risk when width is changed.
- Dynamic-range risk using LRA/PSR-style metrics when available.

Delivery presets:

- Streaming Universal: about `-14 LUFS integrated`, `-1 dBTP`.
- Apple/Sound Check: about `-16 LUFS`, `-1 dBTP`.
- Broadcast/EBU R128: about `-23 LUFS`, `-1 dBTP`.
- Club/Beatport: about `-7 to -9 LUFS`, `-1 dBTP`, with explicit loudness/dynamics warnings.
- CD/album loud master: about `-11 to -9 LUFS`, with lossless-oriented ceiling options such as `-0.3 dBTP`.
- Custom: user-controlled target LUFS and ceiling.

Quality language:

- Plain-language.
- No scare warning for MP3/lossy format alone.
- Warn based on measured problems.

Verification:

- Export does not alter source file.
- Export does not overwrite prior render.
- Risky settings produce advisory checks.
- Normal settings can pass quietly.

## Phase 7: Presets, Settings, Autosave, Undo

Goal: make experimentation safe and reusable.

Required:

- Custom user presets/settings chains.
- Shared presets with mode-specific fields.
- Autosave session state.
- Explicit Save Project.
- Undo/redo for non-destructive state.

Undo/redo coverage:

- Presets.
- Intensity.
- EQ.
- Advanced tuning.
- Track order.
- Album roles.
- Transition settings.
- Metadata.

Shortcuts:

- Ctrl+Z undo.
- Ctrl+Shift+Z redo.

No-victory-lap check:

- Rendered files do not need undo.
- Source files are never changed.
- Autosave must not corrupt explicit project files.

2026-05-12 packaged persistence baseline:

- Added `npm run test:tauri-project-persistence`.
- The smoke launches the release EXE, restores a two-track Album Master session with a known `.ams.json` path, clicks the visible `Save` button, reads the saved project back, and renders that saved project through the Python engine sidecar.
- Passing evidence:
  - saved project: `test-output/tauri-project-persistence-smoke/saved-album.ams.json`
  - render evidence: `test-output/tauri-project-persistence-smoke/rendered-from-saved-project/manifest.json`
  - export checks status: `pass`
  - render warnings: `0`
- Remaining gap: OS file-picker Open and Save-As dialog flows are not automated.

2026-05-12 packaged session-safety baseline:

- Added `npm run test:tauri-release-session-safety`.
- The smoke launches the release EXE, restores a two-track Track Master autosave, verifies Undo/Redo through a Universal -> Clarity preset round trip, saves a user preset, persists listening approval, then changes Low to `+0.50 dB` and verifies listening approval is cleared and persisted as not approved.
- Evidence: `test-output/tauri-release-session-safety-smoke/tauri-release-session-safety-smoke.json`.
- Evidence values include `afterUndoPreset: "Universal"`, `afterRedoPreset: "Clarity"`, `persistedPresetName: "Session Safety Chain"`, `persistedListeningApprovedAfterChecks: true`, `persistedListeningApprovedAfterDirtyChange: false`, and `persistedBassAfterDirtyChange: 0.5`.
- Remaining gap: this is release-package state safety evidence, not human listening approval or render-history/library work.

2026-05-12 packaged listening receipt baseline:

- Added visible `Save Receipt` in the Listening Pass panel and Tauri command `write_listening_receipt`.
- The receipt is written as `listening-review.json` beside the current render only when the render is current.
- Extended the receipt with `audition_context` so a saved listening decision records the exact audition path: preview parity/note, current transport label/kind/path, A/B side, Volume Match, Live Preview contract details, contract drift, native playback state, and native Live Preview model metadata when present.
- Evidence: `test-output/tauri-release-album-codec-qc-smoke/tauri-release-album-codec-qc-smoke.json`.
- Evidence values include `listeningReceiptExists: true`, `listeningReceipt.status: "not-approved"`, `listeningReceipt.checklist.codecPreviewAudition: true`, `listeningReceipt.export_checks.status: "pass"`, two codec-preview entries, `audition_context.preview_parity: "Codec preview audition"`, `audition_context.transport_label: "Album AAC 256k"`, and `audition_context.live_preview.contract_preview_parity: "approximate"`.
- Remaining gap: this creates a durable artifact for a listening decision; it does not create the human decision itself.

2026-05-12 packaged Album Master state baseline:

- Added `npm run test:tauri-release-album-state`.
- The smoke launches the release EXE, restores a two-track Album Master autosave, verifies Undo/Redo for album title, generated transitions, boundary style, boundary seconds, selected-track role override, and selected-track preset override, then verifies the redone state persists through `load_recent_session`.
- Evidence: `test-output/tauri-release-album-state-smoke/tauri-release-album-state-smoke.json`.
- Evidence values include album title `Release Album State -> Release Album Redone`, transitions `false -> true`, boundary `direct -> crossfade`, boundary seconds `2.0 s -> 4.5 s`, track role `auto -> heavy_djent`, and track preset `auto -> bright-air`.
- Remaining gap: this is state-safety evidence only; it does not render or listen to album audio.

2026-05-12 packaged Album Plan Review baseline:

- Added Python `plan-project` and Tauri `plan_album_project` so Album Master can request the engine's album arc/story/role/transition plan before rendering audio.
- Added a visible `Review Album Plan` action and `Engine plan ready` status inside `Album Story / Roles`.
- The plan review uses the same local analysis, character inference, album arc, transition/boundary, album story, and decision-log logic as the render path.
- Evidence: `test-output/tauri-release-album-state-smoke/tauri-release-album-state-smoke.json`.
- Evidence values include `albumPlanButtonEnabledBefore: true`, `albumPlanReadyVisible: true`, `albumPlanLogReady: true`, and `albumPlanStatusText: "Engine plan ready - Release Album State - 2 tracks"`.
- Remaining gap: this is pre-render planning visibility, not human listening approval or final render/export proof.

## Phase 8: Album Master Near-Term Path

Goal: build the user's required album workflow on the Track Master foundation.

Required:

- Album Master mode.
- Track reorder.
- Analyze sequence.
- Track Roles / Story step.
- Global album intent.
- Per-track adaptation.
- Editable roles/overrides.
- Export Album.
- Individual masters.
- Continuous album WAV by default.
- Preserve original boundaries by default.
- Album dashboard/report.

Track Roles / Story:

- Skippable.
- Visibly reviewable.
- Humble language: likely role, not magical detection.
- Important for wildly varied albums.

No-victory-lap check:

- Album Master is not batch Track Master with a different button.
- It must show sequence/story awareness.
- It must preserve distinct track identities.

2026-05-12 packaged Album Master Codec QC baseline:

- Added `npm run test:tauri-release-album-codec-qc`.
- The smoke launches the release EXE, restores a two-track Album Master autosave with `Codec QC` enabled, renders the album, verifies the receipt, clicks the album-level `AAC 256k` artifact button, verifies the transport label `Album AAC 256k`, starts and stops native playback, persists the `Codec preview checked` listening item, and checks the manifest codec-preview files.
- Evidence: `test-output/tauri-release-album-codec-qc-smoke/tauri-release-album-codec-qc-smoke.json`.
- Evidence values include `albumCodecButtonCount: 2`, `codecPreviewOutputsExist: true`, and `codecPreviewCodecs: ["AAC 256k", "Opus 192k"]`.
- Remaining gap: this is automated auditionability evidence only; album and codec-preview sound still need human listening approval.

2026-05-12 packaged real-song Album Master Codec QC baseline:

- Added `npm run test:tauri-real-song-album-codec-qc`.
- The smoke uses `AMS_REAL_SONG_PATH`, derives three album clips from `Lay the Money on the Desk (1).mp3`, renders Album Master with generated transitions and `Codec QC` enabled, and checks manifest codec-preview outputs plus the export receipt.
- Evidence: `test-output/tauri-real-song-album-codec-qc-smoke/tauri-real-song-album-performance-smoke.json`.
- Evidence values include `sourceMode: "single-song-derived-clips"`, `renderTrackCount: 3`, `renderInterludeCount: 2`, `manifestCodecPreviewFlag: true`, `codecPreviewOutputsExist: true`, and `codecPreviewCodecs: ["AAC 256k", "Opus 192k"]`.
- Remaining gap: this is one real lossy source split into clips, not a true multi-song album or a human listening approval.

2026-05-12 packaged Album Master Boundary Preview baseline:

- Added a visible `Preview Boundary` action in Album Master mode for the selected track and its next neighbor.
- Added Tauri `render_album_boundary_preview`, which writes a temporary `.ams.json` and calls the existing Python `preview-transition` sidecar command instead of duplicating DSP in Rust.
- Updated the Python preview path so generated-off boundary previews include the same bounded `gap`, `fade`, `ring-out`, and `crossfade` treatment as full album WAV assembly.
- Evidence: `test-output/tauri-release-album-state-smoke/tauri-release-album-state-smoke.json`.
- Evidence values include `boundaryPreviewButtonEnabledBefore: true`, `boundaryPreviewReadyVisible: true`, `boundaryPreviewPathExists: true`, `boundaryPreviewProjectExists: true`, `boundaryPreviewTransportLabel: "Boundary 1 to 2 Preview"`, and `boundaryPreviewHistoryVisible: true`.
- Remaining gap: this is bounded adjacent-boundary audition, not a full album render or human listening approval.

2026-05-12 packaged preview-honesty baseline:

- The visible preview parity pill now follows active transport context for render artifacts, so boundary previews are not mislabeled as generic transitions or render-required state.
- Boundary preview playback shows `Bounded boundary preview`, with tooltip copy that it is Python-rendered from adjacent track tails/heads and is not full-album approval.
- Evidence:
  - `test-output/tauri-release-album-state-smoke/tauri-release-album-state-smoke.json`
  - `test-output/tauri-track-preview-ui-smoke/tauri-track-preview-ui-smoke.json`
- Evidence values include `boundaryPreviewParity: "Bounded boundary preview"`, `boundaryPreviewParityWarn: false`, `regionPreviewParity: "Render-faithful region"`, `previewParityAfterControlChange: "Render required"`, `previewParityAfterUpdatePreview: "Render-faithful preview"`, and `previewParityAfterReturnToLiveSource: "Approx audition"`.
- Remaining gap: this is copy and state clarity only; it does not make Live Preview export-chain faithful or replace human listening.

2026-05-12 packaged Album Export history and codec parity baseline:

- The packaged Album Master Codec QC smoke now verifies a completed Album Export appears in Recent Renders with enabled Play and Dashboard actions.
- The smoke clicks the Recent Renders Play action, verifies album playback handoff, and waits for autosaved `renderHistory` to persist an `album-export` entry.
- The same smoke verifies Album WAV parity copy as `Render-faithful album` and Album AAC parity copy as `Codec preview audition`.
- Evidence: `test-output/tauri-release-album-codec-qc-smoke/tauri-release-album-codec-qc-smoke.json`.
- Evidence values include `albumExportHistoryVisible: true`, `albumExportHistoryDashboardEnabled: true`, `albumExportHistoryPlayEnabled: true`, `albumExportHistoryPlaybackReady: true`, `persistedAlbumExportHistory: true`, `albumWavParity: "Render-faithful album"`, and `codecPreviewParity: "Codec preview audition"`.
- Remaining gap: this proves local artifact history and labels, not human approval of the album or codec sound.

## Phase 9: Transition Primitives

Goal: provide reliable album boundary tools before generated musical transitions.

Default:

- Generated transitions off.
- Preserve source boundaries.

Implement primitives:

- Timed gaps.
- Direct boundaries.
- Equal-power crossfades.
- Fade out/in.
- Ring-out.
- Reverse swell only if it sounds useful.

Current coverage:

- 2026-05-12 Python boundary regressions cover `direct`, `gap`, `fade`, `ring-out`, and `crossfade` with generated transitions disabled.
- 2026-05-12 Tauri runtime smoke renders `gap`, `fade`, `ring-out`, and `crossfade` through `render_album_master` with generated transitions disabled.
- `fade` is intentionally represented as a manifest boundary with track-only cue points because it fades adjacent edges without inserting a separate boundary chunk.
- 2026-05-12 WebView UI smoke proves the `Boundary` selector can choose every non-direct primitive and that Boundary Seconds updates.

Generated interludes:

- Optional later.
- Must not be default until genuinely good.
- Should not be marketed as core quality until listening tests support it.

## Phase 10: DSP Audit And Modernization

Goal: improve actual mastering quality, not just UI.

Audit:

- LUFS measurement.
- True-peak detection.
- Limiter design.
- EQ/filter phase behavior.
- Compression behavior.
- Saturation.
- Stereo processing.
- Dither.
- SRC.
- Codec preview.
- Preset mappings.

Use research:

- `audio-mastering-technical-research.md`
- `deep-research-report.md`
- `mastering-settings-reference.md`
- `compass_artifact_wf-...markdown.md`
- `docs/research-implementation-notes.md`
- `docs/most-recent-mastering-app-research.md`

Research-backed DSP target chain:

1. Input gain / level staging.
2. Corrective EQ.
3. Resonance or dynamic spectral control.
4. Multiband dynamics.
5. Tonal EQ.
6. Mid/Side processing.
7. Saturation / tape / exciter.
8. Stereo imaging.
9. True-peak limiter / maximizer.
10. Export-only dither when reducing bit depth.

Module priorities:

- BS.1770-style integrated, short-term, and momentary loudness.
- True-peak estimation via oversampling.
- Minimum-phase EQ as the default first-layer control.
- Linear-phase EQ only after latency/pre-ringing/offline-render behavior is understood.
- Safe stereo width with low-band protection and correlation/mono warnings.
- Transparent look-ahead limiter with quality modes and render/offline oversampling.
- TPDF dither for word-length reduction, disabled for 24-bit or float exports unless explicitly needed.
- Codec/normalization preview as a later differentiator after playback, limiting, metering, and export are stable.

DSP verification checklist:

- Loudness agrees with a BS.1770 reference implementation within documented tolerance.
- True peak agrees with an upsampled reference meter within documented tolerance.
- Bypass/null tests pass for linear modules where applicable.
- Multiband crossover recombination is near-null when no gain changes are applied.
- Fast automation produces no zippering.
- Silence and near-silence do not create denormal CPU spikes.
- Nonlinear blocks do not create uncontrolled aliasing at high drive.
- Offline render matches live preview where modes are intended to be identical.
- Dither appears only when reducing word length and does not double-apply.

Modernization rule:

- Rewrite/migrate DSP when evidence shows better sound, speed, reliability, real-time behavior, or maintainability.
- Do not rewrite only because native code seems prestigious.

## Phase 11: Private Real-Audio Fixtures

Goal: test on music that matters.

Create ignored folder:

```text
private-audio-fixtures/
```

Suggested files:

- One clean full mix.
- One rough/problem track.
- One acoustic/quiet track.
- One heavy/dense track.
- One bass-heavy track if available.
- Two or three adjacent album tracks.
- Eventually the full target album.

Add:

```text
private-audio-fixtures/manifest.json
```

Manifest should describe:

- File path.
- Purpose.
- Safe for quick automated tests: true/false.
- Safe for slow full render tests: true/false.
- Listening notes.
- Known problem areas.

Rules:

- Do not commit private/copyrighted audio.
- Do not snapshot rendered audio into git.
- Automated local tests may use fixtures.
- Manual listening remains required.

## Phase 12: Performance Budgets

Goal: measure rather than guess.

Initial rough targets:

- App launch feels prompt.
- Import does not block UI.
- Analyze progress is visible.
- Waveform appears quickly enough to keep trust.
- First playback start after clicking Original/Mastered is measured and explained.
- Cached playback starts promptly enough to use by ear.
- First-time transcode/cache delay is visible and labeled when unavoidable.
- Lightweight real-time controls respond under about 150 ms.
- Heavier macro controls respond under about 500 ms.
- Preview/export shows progress and can be canceled when safe.
- 8-track album export gives meaningful progress.

Agents must establish baselines on the actual machine and refine these budgets with evidence.

2026-05-12 packaged release baseline:

- Added `npm run test:tauri-performance`.
- Added `npm run test:tauri-real-song-performance`.
- Added `npm run test:tauri-real-song-album-performance`.
- Current local synthetic 8-track baseline:
  - launch to Tauri invoke ready: `628.4 ms`
  - source validation, 8 tracks: `255 ms`
  - analysis, 8 tracks, 128 waveform bins: `2636.4 ms`
  - album render, 8 tracks, continuous WAV, no generated transitions: `9745.3 ms`
- Current local real-song Track Master baseline using `Lay the Money on the Desk (1).mp3` outside the repo:
  - source duration: `186.31997916666663` seconds
  - launch to Tauri invoke ready: `424.9 ms`
  - source validation: `71.8 ms`
  - analysis, 256 waveform bins: `5035.6 ms`
  - playback-cache preparation: `1.9 ms`
  - Track Master render: `29610.6 ms`
  - export checks: `1.9 ms`
- Current local real-song-derived Album Master baseline using three 10-second clips from `Lay the Money on the Desk (1).mp3` outside the repo:
  - launch to Tauri invoke ready: `650.7 ms`
  - source validation, 3 clips: `107.1 ms`
  - analysis, 3 clips, 256 waveform bins: `2838 ms`
  - Album Master render, continuous WAV, 2 generated transitions: `15166.3 ms`
  - export checks: `3.5 ms`
- 2026-05-12 real-song Album Master smokes now support `AMS_REAL_SONG_ALBUM_PATHS` for true multi-song input:
  - accepts a JSON array or Windows path-delimited list of local song paths
  - validates two to eight paths, at least two distinct files, and file existence before rendering
  - preserves the existing `AMS_REAL_SONG_PATH` single-song fallback
  - records `sourceMode`, `sourcePaths`, `distinctSourceCount`, and per-clip source metadata in evidence JSON
- Latest verification still used the single-MP3 fallback because no second distinct song path was available:
  - packaged evidence: `test-output/tauri-real-song-album-performance-multisource-ready/tauri-real-song-album-performance-smoke.json`
  - visible UI evidence: `test-output/tauri-real-song-album-ui-multisource-ready/tauri-real-song-album-ui-smoke.json`
  - both recorded `sourceMode: single-song-derived-clips` and `distinctSourceCount: 1`
- Evidence:
  - `test-output/tauri-release-performance-smoke/tauri-release-performance-smoke.json`
  - `test-output/tauri-real-song-performance-smoke/tauri-real-song-performance-smoke.json`
  - `test-output/tauri-real-song-album-performance-smoke/tauri-real-song-album-performance-smoke.json`

## Phase 13: Release And Installer Hardening

Goal: make the app usable outside the repo.

Required:

- Installed/release build launches.
- No user-managed Python required unless architecture changes explicitly.
- FFmpeg/FFprobe or replacement audio tooling available to the app.
- Sensible default render folder.
- Open output/report works.
- App handles missing/corrupt files gracefully.
- Sidecar/startup overhead measured.

2026-05-12 release-readiness trace runner:

- Added `scripts/release-readiness.ps1`.
- Added `cd desktop; npm run verify:release`.
- The runner creates `test-output\release-readiness-<commit>-<timestamp>\release-readiness.json` plus per-step logs for the release gate sequence.
- Default gates include Python compile/unit/CLI smoke, desktop build/integration, Tauri release build, sidecar startup, release launch, Track Preview UI, Album state, Album/Track Codec QC, session safety, project persistence, and `git diff --check`.
- Real-song Track/Album and installer smokes are opt-in with `-RealSongPath` and `-IncludeInstallerSmokes`.
- This runner supports the final-release blocker, but does not close it until run from the commit being evaluated.

2026-05-12 current-commit release-readiness trace:

- Latest full trace for commit `8376e38` is `test-output\release-readiness-8376e38-full\release-readiness.json`.
- Command shape: `scripts\release-readiness.ps1 -RealSongPath "C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3" -IncludeInstallerSmokes -OutputRoot "test-output\release-readiness-8376e38-full"`.
- Result: 21 passed, 0 failed, 0 skipped, with `dirty_before: []` and `dirty_after: []`.
- Remaining release-quality blockers are human listening approval, export-chain/live-preview parity, and native OS Open/Save-As dialog automation.

## Public Release Risk Notes

The app is private for now. Do not slow private development with public-product anxiety.

If it ever ships publicly, revisit:

- Branding.
- UX similarity to commercial products.
- Copied assets or icons.
- Claims about mastering quality.
- Metering/certification claims.
- Third-party library licenses.
- Codec/tool redistribution rights.
- Use of private research text.
- Handling copyrighted audio fixtures.

## Agent Completion Rules

Every meaningful implementation pass must end with:

- What changed.
- What was verified.
- What failed.
- What remains partial.
- What should happen next.
- Whether `docs/PRODUCT.md` still matches the work.

Update locations:

- `docs/progress.md`: detailed evidence and session notes.
- `docs/IMPLEMENTATION_PLAN.md`: concise phase status changes or plan changes.
- `docs/PRODUCT.md`: only after human-approved product canon changes.
- `docs/PRIVATE_AUDIO_FIXTURES.md`: fixture convention for real-audio tests.
- `docs/PARALLEL_BUILD_NOTES.md`: independence rules if the Claude build is active in parallel.

No phase is complete just because something visually resembles the goal. It must satisfy the relevant product behavior and verification gates.

## Codex Long-Running Goal Loop

When using Codex `/goal` or goal-like long-running work, give Codex a sharp objective and point it to the canon before it starts.

Recommended setup prompt shape:

```text
Read docs/PRODUCT.md, docs/IMPLEMENTATION_PLAN.md, AGENTS.md, docs/progress.md, and docs/codex-active-handoff.md.
Work on one verified slice of <phase name>.
Use the research docs listed in docs/IMPLEMENTATION_PLAN.md when DSP, preset, metering, delivery, or quality-check decisions are involved.
Use private-audio-fixtures/manifest.json if available for real-audio tests, but never commit private audio.
Stop only after updating docs/progress.md with what changed, verification, failures, and next work.
Do not update docs/PRODUCT.md unless the human explicitly changes product direction.
```

Good Codex goal candidates:

- Build Track Master waveform/A-B slice.
- Implement typed Rust analyze/render commands.
- Run native audio audition spike and write an engine decision record.
- Add private fixture manifest support.
- Implement post-render quality checks.

Bad Codex goal candidates:

- "Make the app good."
- "Finish mastering."
- "Rewrite the engine" without acceptance criteria.
- Anything that requires subjective listening but provides no fixture or evaluation notes.

Use `/goal` as an execution loop for a clear verified slice, not as a substitute for product planning.

## Immediate Next Questions For Humans

These are not blockers for creating the plan, but they should be answered before or during early execution:

1. Which architecture spike candidates should be tested first: Tauri+Rust audio, JUCE, or both immediately?
2. What real audio fixtures will be provided first?
3. What is the minimum Track Master feature set required before Album Master begins?
4. Should the current repo remain the Codex path while the new Claude build repo starts from zero?
5. How often should long-running agents update progress: every phase, every day, or every meaningful verified slice?
