# Codex Active Handoff

Last updated: 2026-05-12

## Current Goal Loop

Codex goal is active:

```text
Rebuild Album Mastering Studio from the existing repo, starting with a verified Track Master-first Tauri desktop surface while preserving the Python engine contract, Album Master path, docs/progress handoff trail, and local/offline workflow.
```

Compaction rule for this rebuild:

1. Read `docs/PRODUCT.md`, `docs/IMPLEMENTATION_PLAN.md`, `AGENTS.md`, this handoff, and `docs/progress.md`.
2. Continue one verified vertical slice at a time.
3. Leave code, verification output, and `docs/progress.md` evidence before handing off.
4. Do not update `docs/PRODUCT.md` unless the user explicitly changes product direction.

## Latest Codex Pass: Native Live Preview Playback Handoff

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/GOAL_AUDIT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Wired the visible `Native Play` transport button so active source Live Preview routes through the Rust offline first-control model before native file playback starts.
- The app renders from the prepared playback-cache source with current Low/Mid/High/Width/Intensity settings, starts native playback from the modeled WAV, and exposes `window.__AMS_NATIVE_LIVE_PREVIEW_AUDITION__` for smoke evidence.
- Extended the packaged Track Preview smoke to click `Native Play` while Live Preview is active, verify the Rust model output, verify the UI says `Native Live Preview playing`, then stop native playback before export checks.
- This is still rendered-before-playback native modeled audition, not continuously updating native DSP.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
python -m compileall -q src tests
cd desktop
npm run build
npm run test:integration
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
cd ..
git diff --check
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - `nativeLivePreviewStarted: true`
  - `nativeLivePreviewStopped: true`
  - `nativeLivePreviewSourceExists: true`
  - `nativeLivePreviewOutputExists: true`
  - `nativeLivePreviewStatusWhilePlaying: Native Live Preview playing`
  - `nativeLivePreviewModelStatus: Rust model: 1.36 width, 0.40 intensity`
  - `nativeLivePreviewStatusLabel: Native file: Preview Fixture 2 - Original - Native Live Preview`
  - `nativeLivePreviewActivationMs: 617.8999999761581`
  - native `live_preview_engine: web-audio-first-control-model`
  - native `native_engine: rust-native-live-preview-model`
  - native `modeled_width: 1.36`
  - native `modeled_drive: 0.4`
  - native `frame_count: 192000`
  - native `sample_rate: 48000`
  - native `output_exists: true`

Remaining gap:

- Native playback now has a visible modeled handoff for active source Live Preview, but it is not continuously updating native DSP. Human listening approval and OS file-picker Open/Save-As automation remain open.

Next useful slice:

- Follow the read-only scout recommendation: automate packaged Open plus explicit Save As coverage if reliable Windows dialog automation is available.
- If the user is present, run and record a real listening pass.

## Previous Codex Pass: Native Live Preview Model Oracle

Date: 2026-05-12

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/tests/live-preview-model.mjs`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/GOAL_AUDIT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added a Tauri/Rust `render_native_live_preview_model` command for an offline native implementation of the current engine-owned first-control Live Preview model.
- The native command reads a prepared PCM playback-cache WAV, applies Low/Mid/High/Width/Intensity with the same model constants, writes a local WAV, and returns metadata parallel to the Python oracle.
- Extended the packaged Track Preview smoke so the release WebView prepares one source through `prepare_playback_file`, renders both the Python sidecar model and native Rust model from that prepared source, and compares the two WAV outputs.
- This remains an oracle/parity proof only; it is not wired into the visible playback path.

Verification already run:

```powershell
node --check .\desktop\tests\live-preview-model.mjs
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop\src-tauri
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"; cargo check
cd ..\..
python -m compileall -q src tests
python -m unittest tests.test_pipeline.PipelineTest.test_live_preview_model_renders_engine_owned_reference tests.test_pipeline.PipelineTest.test_cli_preview_model_writes_reference_wav
cd desktop
npm run build
npm run test:integration
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
cd ..
git diff --check
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - prepared source exists: `true`
  - Python model source is prepared source: `true`
  - native model source is prepared source: `true`
  - native `live_preview_engine: web-audio-first-control-model`
  - native `native_engine: rust-native-live-preview-model`
  - native `modeled_width: 1.36`
  - native `modeled_drive: 0.4`
  - native `frame_count: 192000`
  - native render-only stage count: `9`
  - comparison `sample_rate: 48000`
  - comparison `compared_frames: 192000`
  - comparison `rms_difference_dbfs: -101.14268111252326`
  - comparison `max_abs_difference: 1.5288591384887695e-05`
  - comparison `candidate_minus_reference_lufs_proxy: -1.2013914020059246e-05`

Remaining gap:

- This is native offline model parity evidence for one packaged synthetic smoke. The visible Live Preview path is still Web Audio approximate, and no human listening pass has been recorded.

Next useful slice:

- Use this native oracle as the measured target for a guarded native/shared playback experiment, or close remaining release smoke gaps around OS file-picker Open/Save-As.
- If the user is present, run and record a real listening pass.

## Previous Codex Pass: Live Preview Model Native Playback Probe

Date: 2026-05-12

Changed files in this pass:

- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/GOAL_AUDIT.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Extended the packaged Track Preview smoke so the Tauri-rendered Live Preview model WAV is prepared through `prepare_playback_file`.
- The smoke now runs `native_playback_file_probe` against that playback cache for 500 ms.
- This keeps the feature out of the visible playback path while proving the model output can cross the release app's native playback boundary.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run test:tauri-track-preview-ui
cd ..
git diff --check
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - `tauriLivePreviewModelPlaybackCacheExists: true`
  - native model probe `source_sample_rate: 48000`
  - native model probe `source_total_frames: 192000`
  - native model probe `requested_duration_ms: 500`
  - native model probe `queued_output_frames: 24000`
  - native model probe `played_output_frames: 24000`
  - native model probe `callback_count: 50`
  - native model probe `stream_errors: []`
  - native model probe `warnings: []`

Remaining gap:

- This is native playback compatibility evidence for the deterministic model WAV. It is not native/shared live DSP and not a human listening pass.

Next useful slice:

- Use the Tauri-accessible model as the oracle for a native/shared live DSP parity step.
- If the user is present, run and record a real listening pass.

## Previous Codex Pass: Tauri Live Preview Model Bridge

Date: 2026-05-12

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/GOAL_AUDIT.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Added a Tauri `render_live_preview_model` command next to `live_preview_contract`.
- The command calls the Python sidecar `preview-model`, validates source/output behavior, parses the returned JSON, and verifies the model WAV exists.
- Extended the packaged Track Preview smoke so the release WebView invokes the new command against the second fixture track.
- The smoke verifies the command returns the expected engine model id, modeled controls, normalized tuning, width, drive, sample rate, frame count, and output existence.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop\src-tauri
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"; cargo check
cd ..
npm run build
npm run test:integration
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
cd ..
python -m compileall -q src tests
python -m unittest tests.test_pipeline.PipelineTest.test_live_preview_model_renders_engine_owned_reference tests.test_pipeline.PipelineTest.test_cli_preview_model_writes_reference_wav
git diff --check
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - `tauriLivePreviewModelPathExists: true`
  - `live_preview_engine: web-audio-first-control-model`
  - `modeled_controls: [Low, Mid, High, Width, Intensity]`
  - `modeled_width: 1.36`
  - `modeled_drive: 0.4`
  - `output_exists: true`
  - `frame_count: 192000`
  - `sample_rate: 48000`

Remaining gap:

- This is a packaged command bridge for the deterministic reference model. It is still not export-engine-faithful real-time Live Preview and not a human listening pass.

Next useful slice:

- Use this Tauri-accessible model as the oracle for the next native/shared live DSP parity step.
- If the user is present, run and record a real listening pass.

## Previous Codex Pass: Engine-Owned Live Preview Model

Date: 2026-05-12

Changed files in this pass:

- `src/album_mastering_studio/mastering.py`
- `src/album_mastering_studio/cli.py`
- `tests/test_pipeline.py`
- `desktop/tests/live-preview-model.mjs`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `docs/GOAL_AUDIT.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Added `render_live_preview_model()` as the Python engine-owned deterministic renderer for the current temporary Live Preview first-control model.
- Added `album-master preview-model` to render that model to a local WAV and emit scriptable metadata.
- Kept the model scoped to evidence/reference output; it is not wired as the real-time user-facing audio path.
- Replaced the shared JS smoke helper's embedded DSP copy with a call to the Python CLI, then kept JS only for comparison metrics.
- Updated the broad WebView runtime smoke to use the shared helper instead of a second embedded DSP model.
- Added Python unit/CLI coverage for finite output, same shape, modeled controls, modeled width/drive, and CLI WAV writing.

Verification already run:

```powershell
python -m album_mastering_studio.cli preview-contract --json
python -m unittest tests.test_pipeline.PipelineTest.test_live_preview_config_matches_engine_contract tests.test_pipeline.PipelineTest.test_live_preview_model_renders_engine_owned_reference tests.test_pipeline.PipelineTest.test_cli_preview_model_writes_reference_wav
node --check .\desktop\tests\live-preview-model.mjs
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
node --check .\desktop\tests\tauri-webview-runtime-smoke.mjs
node --check .\desktop\tests\tauri-real-song-performance-smoke.mjs
python -m compileall -q src tests
python -m unittest discover -s tests
cd desktop
npm run build
npm run test:integration
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
cd ..
desktop\src-tauri\resources\engine\album-master-engine.exe preview-model --help
cd desktop
npm run test:tauri-track-preview-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-performance
cd ..
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- `test-output\tauri-real-song-performance-smoke\tauri-real-song-performance-smoke.json`
- Relevant fields:
  - Track Preview `modeled_width: 1.36`
  - Track Preview `modeled_drive: 0.4`
  - Track Preview `export_minus_live_lufs_proxy: 9.080398089816866`
  - Track Preview `rms_difference_dbfs: -19.535890177713174`
  - Real song `modeled_width: 1.36`
  - Real song `modeled_drive: 0.4`
  - Real song `export_minus_live_lufs_proxy: 0.7150013134906779`
  - Real song `rms_difference_dbfs: -29.536255941454645`

Remaining gap:

- This makes the comparison reference engine-owned, but Live Preview is still approximate Web Audio in the UI. It does not close export-engine live DSP parity or human listening approval.

Next useful slice:

- Use the engine-owned model as the reference target for the next native/shared live DSP parity step.
- If the user is present, run and record a real listening pass.

## Previous Codex Pass: Goal Coverage Audit

Date: 2026-05-12

Changed files in this pass:

- `docs/GOAL_AUDIT.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added a goal-level coverage audit so compactions and agent loops have one short source for what is verified, what is still blocked, and what should happen next.
- The audit explicitly keeps the active goal marked active, not complete.
- It maps the current evidence for Track Master, the Python engine contract, Album Master, docs/progress handoff, local/offline packaging, and release build coverage.
- It records the hard blockers: no recorded human listening approval, Live Preview is still approximate rather than shared/export-engine faithful DSP, and OS file-picker Open/Save-As flows are not automated.
- The read-only agent scout identified the next best unattended code slice: add an engine-owned deterministic first-control Live Preview model renderer so evidence stops depending on JS-only DSP logic.

Verification already run:

```powershell
git diff --check
rg -n "Status: active, not complete|Completion Blockers|Next Unattended Slices" docs\GOAL_AUDIT.md
```

Remaining gap:

- This is a handoff and audit slice, not a product feature. Continue one verified vertical slice at a time.

Next useful slice:

- If the user is present, run and record a real listening pass.
- If working unattended, implement the engine-owned deterministic Live Preview model renderer, then continue shared/native live DSP parity or add reliable coverage for a still-unautomated release workflow such as project Open/Save-As.

## Previous Codex Pass: Live Preview Contract Drift Guard

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Added a frontend runtime guard that compares the loaded Python engine Live Preview contract against the bundled Web Audio config.
- The guard normalizes engine-only fields out of the comparison and exposes `window.__AMS_LIVE_PREVIEW_CONTRACT_DRIFT__`.
- The visible `Contract drift` chip only appears when a mismatch exists.
- Extended both the broad WebView UI smoke and packaged Track Preview UI smoke to assert no drift in the current build.

Verification already run:

```powershell
npm run build
node --check .\desktop\tests\tauri-webview-ui-smoke.mjs
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
python -m compileall -q src tests
cd desktop
npm run test:tauri-ui
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
cd ..
```

Evidence:

- `test-output\tauri-webview-ui-smoke\tauri-webview-ui-smoke.json`
- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - Broad UI `livePreviewContractDrift: []`
  - Broad UI `livePreviewContractDriftVisible: false`
  - Track Preview `livePreviewContractDrift: []`
  - Track Preview `livePreviewContractDriftVisible: false`
  - Track Preview `previewParityAfterLivePreview: Approx audition`

Remaining gap:

- This catches packaged contract/config drift. It still is not export-engine-faithful live DSP or human listening approval.

Next useful slice:

- Continue toward shared/native live DSP parity if working unattended.
- If the user is present, run and record a listening pass.

## Previous Codex Pass: Visible Live Preview Contract

Date: 2026-05-12

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Added a Tauri `live_preview_contract` command that calls the Python sidecar's `preview-contract --json` command.
- Loaded that contract during app startup and exposed it on `window.__AMS_LIVE_PREVIEW_CONTRACT__` for smoke/debug evidence.
- Added visible audition-row chips that state the modeled Live Preview controls and the render-only export stages.
- Extended the broad WebView UI smoke and packaged Track Preview UI smoke to assert the command/window contract and visible chips.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-webview-ui-smoke.mjs
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
python -m compileall -q src tests
cd desktop
npm run build
npm run test:integration
npm run test:tauri-ui
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
cd ..
```

Evidence:

- `test-output\tauri-webview-ui-smoke\tauri-webview-ui-smoke.json`
- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - Broad UI `livePreviewContractModelId: web-audio-first-control-model`
  - Broad UI `livePreviewModeledStatus: Live model: Low, Mid, High, Width, Intensity`
  - Broad UI `livePreviewRenderOnlyStatus: Render-only: tone, highpass, low-mid, brightness, warmth, transients, LUFS, limiter, codec`
  - Track Preview `livePreviewContractModelId: web-audio-first-control-model`
  - Track Preview `livePreviewContractWindowControls: [Low, Mid, High, Width, Intensity]`
  - Track Preview `previewParityAfterLivePreview: Approx audition`

Remaining gap:

- The user can now see what Live Preview models and what still needs rendered preview/export. This still is not export-engine-faithful live DSP or human listening approval.

Next useful slice:

- Continue toward shared/native live DSP parity if working unattended.
- If the user is present, run and record a listening pass using the visible contract chips to guide expectations.

## Previous Codex Pass: Engine-Owned Live Preview Contract

Date: 2026-05-12

Changed files in this pass:

- `src/album_mastering_studio/mastering.py`
- `src/album_mastering_studio/cli.py`
- `tests/test_pipeline.py`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Added `live_preview_contract()` as the Python engine-owned contract for the temporary Web Audio first-control audition model.
- Added `album-master preview-contract --json` for scriptable contract inspection.
- Moved the Python mastering EQ/compressor values used by the contract into named constants and reused them inside the mastering chain.
- Added a unit regression that compares `desktop/src/livePreviewConfig.json` against the engine contract.
- Updated the broad WebView runtime smoke so its deterministic export-vs-live model reads the shared JSON config instead of stale hardcoded Web Audio constants.

Verification already run:

```powershell
python -m album_mastering_studio.cli preview-contract --json
python -m unittest tests.test_pipeline.PipelineTest.test_live_preview_config_matches_engine_contract
python -m compileall -q src tests
python -m unittest discover -s tests
cd desktop
npm run build
npm run test:integration
npm run test:tauri-webview
cd ..
```

Evidence:

- `test-output\tauri-webview-runtime-smoke\tauri-webview-runtime-smoke.json`
- Relevant fields:
  - Runtime `exportVsLiveComparison.live_preview_engine: web-audio-first-control-model`
  - Runtime `exportVsLiveComparison.modeled_controls: [Low, Mid, High, Width, Intensity]`
  - Runtime `exportVsLiveComparison.modeled_width: 1.324`
  - Runtime `exportVsLiveComparison.modeled_drive: 0.35`
  - Runtime `exportVsLiveComparison.export_minus_live_lufs_proxy: 2.49416759863309`
  - Runtime `exportVsLiveComparison.rms_difference_dbfs: -26.9677132943239`
  - Runtime `exportVsLiveComparison.compared_frames: 64800`

Remaining gap:

- The contract prevents silent drift and lists unmodeled export stages. It does not make Web Audio Live Preview export-engine faithful.

Next useful slice:

- Use the new contract in frontend diagnostics or release smokes so the visible app can show which controls are modeled and which export stages remain render-only.
- Continue toward shared/native live DSP parity if working unattended; if the user is present, run and record a listening pass.

## Previous Codex Pass: Export-Intent-Aligned Live Preview Config

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/livePreviewConfig.json`
- `desktop/tests/live-preview-model.mjs`
- `desktop/tests/tauri-real-song-performance-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Tuned the shared Web Audio first-control config toward Python export-engine intent: low shelf `105 Hz`, presence `3.2 kHz`, air `9.8 kHz`, and a lighter hard-knee intensity curve.
- Hardened the deterministic comparison helper for the new `kneeDb: 0` config.
- Updated the real-song performance smoke so `exportDiffersFromLiveMaterially` is recorded as evidence instead of required to remain true after calibration.
- Reran the release-backed synthetic Track Preview and real-song performance smokes against the rebuilt EXE.

Verification already run:

```powershell
node --check .\desktop\tests\live-preview-model.mjs
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
node --check .\desktop\tests\tauri-real-song-performance-smoke.mjs
cd desktop
npm run test:tauri-track-preview-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-performance
cd ..
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- `test-output\tauri-real-song-performance-smoke\tauri-real-song-performance-smoke.json`
- Relevant fields:
  - Track Preview `exportVsLiveComparison.exportDiffersFromLiveMaterially: true`
  - Track Preview `exportVsLiveComparison.export_minus_live_lufs_proxy: 9.08023618964403`
  - Track Preview `exportVsLiveComparison.rms_difference_dbfs: -19.5359668627911`
  - Track Preview `exportVsLiveComparison.exportAndLiveLoudnessDeltaDifference: 5.46180002967552`
  - Real song `realSongExportVsLiveComparison.exportDiffersFromLiveMaterially: false`
  - Real song `realSongExportVsLiveComparison.export_minus_live_lufs_proxy: 0.714872039163112`
  - Real song `realSongExportVsLiveComparison.rms_difference_dbfs: -29.5362869826173`
  - Real song `realSongExportVsLiveComparison.exportAndLiveLoudnessDeltaDifference: 0.714872039163112`
  - Real song `realSongExportVsLiveComparison.compared_frames: 8943359`

Remaining gap:

- This is better calibration for the temporary Web Audio model. It still is not shared/export-engine DSP and still needs human listening approval.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and record whether the aligned live preview feels directionally useful.
- If working unattended, continue toward shared/native live DSP parity so preview and export consume the same intent model.

## Previous Codex Pass: Shared Live Preview Definition

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/livePreviewConfig.json`
- `desktop/src/App.tsx`
- `desktop/tests/live-preview-model.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Added `desktop/src/livePreviewConfig.json` as the shared definition point for the current Web Audio first-control audition model.
- Updated the Tauri frontend to read Live Preview filter frequencies, width mapping, compressor curve, and smoothing from the JSON config.
- Updated the deterministic smoke-test comparator to read the same config before generating the Python Web Audio-style model.
- Rebuilt the Tauri release executable and reran the synthetic Track Preview and real-song performance smokes against the rebuilt EXE.

Verification already run:

```powershell
node --check .\desktop\tests\live-preview-model.mjs
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
node --check .\desktop\tests\tauri-real-song-performance-smoke.mjs
cd desktop
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-performance
cd ..
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- `test-output\tauri-real-song-performance-smoke\tauri-real-song-performance-smoke.json`
- Relevant fields:
  - Track Preview `liveControlUnder150ms: true`
  - Track Preview `liveIntensityUnder500ms: true`
  - Track Preview `exportVsLiveComparison.live_preview_engine: web-audio-first-control-model`
  - Track Preview `exportVsLiveComparison.exportDiffersFromLiveMaterially: true`
  - Real song `realSongExportVsLiveComparison.live_preview_engine: web-audio-first-control-model`
  - Real song `realSongExportVsLiveComparison.exportDiffersFromLiveMaterially: true`
  - Real song `realSongExportVsLiveComparison.exportDominatesLiveLoudnessDelta: false`
  - Real song `realSongExportVsLiveComparison.exportAndLiveLoudnessDeltaDifference: 3.919839091548681`
  - Real song `realSongExportVsLiveComparison.compared_frames: 8943359`

Remaining gap:

- This reduces drift between the running UI and comparison evidence. It does not make Web Audio Live Preview export-engine faithful or record human listening approval.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward true export-engine live audition parity, especially a native/shared-DSP spike that uses the same intent model as offline export.

## Previous Codex Pass: Shared First-Control Live Model Helper

Date: 2026-05-12

Changed files in this pass:

- `desktop/tests/live-preview-model.mjs`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `desktop/tests/tauri-real-song-performance-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Extracted the deterministic `web-audio-first-control-model` comparator into a shared smoke-test helper.
- Updated the synthetic Track Preview smoke and the real-song performance smoke to use the same first-control tuning and comparison logic.
- The helper reports both direct material mismatch and `exportDominatesLiveLoudnessDelta`, because the synthetic fixture and real MP3 mismatch in different directions.

Verification already run:

```powershell
node --check .\desktop\tests\live-preview-model.mjs
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
node --check .\desktop\tests\tauri-real-song-performance-smoke.mjs
cd desktop
npm run test:tauri-track-preview-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-performance
cd ..
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- `test-output\tauri-real-song-performance-smoke\tauri-real-song-performance-smoke.json`
- Relevant fields:
  - Track Preview `exportVsLiveComparison.exportDiffersFromLiveMaterially: true`
  - Track Preview `exportVsLiveComparison.exportDominatesLiveLoudnessDelta: true`
  - Track Preview `exportVsLiveComparison.exportAndLiveLoudnessDeltaDifference: 2.9612264914739566`
  - Real song `realSongExportVsLiveComparison.exportDiffersFromLiveMaterially: true`
  - Real song `realSongExportVsLiveComparison.exportDominatesLiveLoudnessDelta: false`
  - Real song `realSongExportVsLiveComparison.exportAndLiveLoudnessDeltaDifference: 3.919839091548681`
  - Real song `realSongExportVsLiveComparison.compared_frames: 8943359`

Remaining gap:

- This keeps the automated evidence paths consistent. It does not make Web Audio Live Preview export-engine faithful or record human listening approval.

## Previous Codex Pass: Real-Song First-Control Export Vs Live Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/tests/tauri-real-song-performance-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Extended the release-backed real-song performance smoke to add first-control export-vs-live comparison evidence against `Lay the Money on the Desk (1).mp3`.
- The smoke keeps its existing baseline path: validate source, analyze, prepare playback cache, render a baseline Track Master output, run export checks, and capture a screenshot.
- It now also renders a second Track Master output with the first-control tuning set, then compares that Python-rendered output against a deterministic `web-audio-first-control-model` generated from the real playback-cache WAV.
- The real-song material-mismatch assertion is direct rather than directional, because on this track the live model changes loudness more than the Python master.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-real-song-performance-smoke.mjs
cd desktop
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-performance
cd ..
```

Evidence:

- `test-output\tauri-real-song-performance-smoke\tauri-real-song-performance-smoke.json`
- Relevant fields:
  - `analysisDurationSeconds: 186.31997916666663`
  - `firstControlRenderDurationMs: 27192.7`
  - `realSongExportVsLiveComparison.live_preview_engine: web-audio-first-control-model`
  - `realSongExportVsLiveComparison.modeled_controls: [Low, Mid, High, Width, Intensity]`
  - `realSongExportVsLiveComparison.tuning: { bassDb: 0.5, midDb: -0.25, highDb: 0.35, width: 0.2, intensity: 0.4 }`
  - `realSongExportVsLiveComparison.exportDiffersFromLiveMaterially: true`
  - `realSongExportVsLiveComparison.export_minus_live_lufs_proxy: 3.919839091548681`
  - `realSongExportVsLiveComparison.rms_difference_dbfs: -25.193622894439955`
  - `realSongExportVsLiveComparison.exportLoudnessDeltaVsSource: 3.546476951229728`
  - `realSongExportVsLiveComparison.liveLoudnessDeltaVsSource: 7.466316042778409`
  - `realSongExportVsLiveComparison.exportAndLiveLoudnessDeltaDifference: 3.919839091548681`
  - `realSongExportVsLiveComparison.compared_frames: 8943359`
  - `realSongExportVsLiveComparison.live_model_path: test-output\tauri-real-song-performance-smoke\real-song-live-preview-first-control-model.wav`

Remaining gap:

- This adds real-user-audio evidence for the current first-control mismatch. Web Audio Live Preview remains approximate, not shared/export-engine DSP parity, and no human listening approval has been recorded.

## Previous Codex Pass: First-Control Export Vs Live Model Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Updated the packaged Track Preview export-vs-live comparison so the deterministic live model covers the same first-control set the smoke now exercises.
- The model now applies Low shelf, Mid peaking EQ, High shelf, mid/side Width, and a basic Intensity compressor curve before comparing against the Python-rendered master.
- The evidence remains explicitly negative parity evidence: `same_engine: false`, `preview_parity: "approximate"`, and `export_faithful_preview_required: true`.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run test:tauri-track-preview-ui
cd ..
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - `exportVsLiveComparison.live_preview_engine: web-audio-first-control-model`
  - `exportVsLiveComparison.modeled_controls: [Low, Mid, High, Width, Intensity]`
  - `exportVsLiveComparison.modeled_width: 1.36`
  - `exportVsLiveComparison.modeled_drive: 0.4`
  - `exportVsLiveComparison.tuning: { bassDb: 0.5, midDb: -0.25, highDb: 0.35, width: 0.2, intensity: 0.4 }`
  - `exportVsLiveComparison.exportDiffersFromLiveMaterially: true`
  - `exportVsLiveComparison.export_minus_live_lufs_proxy: 11.580809727845596`
  - `exportVsLiveComparison.rms_difference_dbfs: -18.377686540787774`
  - `exportVsLiveComparison.exportLoudnessDeltaVsSource: 7.271018109659776`
  - `exportVsLiveComparison.liveLoudnessDeltaVsSource: 4.30979161818582`
  - `exportVsLiveComparison.live_model_path: test-output\tauri-track-preview-ui-smoke\live-preview-first-control-model.wav`

Remaining gap:

- The automated comparison now matches the first-control Live Preview surface, but it still proves mismatch rather than shared/export-engine DSP parity.

## Previous Codex Pass: Multi-Control Live Preview Response Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Extended the release-backed Track Preview UI smoke so Live Preview verifies the Phase 5 first-control set instead of only the Low slider.
- The smoke now opens Advanced controls when needed and proves `Low`, `Mid`, `High`, and `Width` update the running Web Audio snapshot inside the 150 ms lightweight-control budget.
- The same run verifies `Intensity` updates the live drive snapshot inside the 500 ms macro-control budget.
- Existing honesty checks still run after the live changes: the exact render goes stale, the parity badge becomes `Render required`, and `Update Preview` hands back to `python-render-track-master`.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run test:tauri-track-preview-ui
cd ..
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - `liveControlResults`: `Low`, `Mid`, `High`, `Width`, `Intensity`
  - `Low latencyMs: 1.5`
  - `Mid latencyMs: 1.399999976158142`
  - `High latencyMs: 0.9000000357627869`
  - `Width latencyMs: 0.699999988079071`
  - `Intensity latencyMs: 0.5`
  - `liveControlUnder150ms: true`
  - `liveIntensityUnder500ms: true`
  - `liveSnapshotAfterControls.bass: 0.5`
  - `liveSnapshotAfterControls.mid: -0.25`
  - `liveSnapshotAfterControls.high: 0.35`
  - `liveSnapshotAfterControls.width: 1.36`
  - `liveSnapshotAfterControls.drive: 0.4`
  - `previewParityAfterControlChange: Render required`
  - `previewParityAfterUpdatePreview: Render-faithful preview`
  - `exportEngineAuditionEngine: python-render-track-master`

Remaining gap:

- This proves the current Web Audio audition responds quickly across the first-control set and keeps stale exact renders honest. Web Audio Live Preview remains approximate and not export-engine parity.

## Previous Codex Pass: Live Source To Engine Region Replacement Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/tests/tauri-real-song-region-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Extended the release-backed real-song region UI smoke so it clicks `Original`, arms `Live Preview`, and verifies the Web Audio source audition is active before the first visible `Render Region` click.
- The smoke records that, before any exact master exists, active Live Preview still correctly leaves the parity badge at `Render required`.
- After `Render Region`, the smoke verifies Python region playback replaces the active Web Audio path: the transport shows `Engine Region`, `window.__AMS_REGION_ENGINE_AUDITION__` reports `python-render-track-region-preview`, Live Preview becomes armed/inactive, and the parity badge is non-warn `Render-faithful region`.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-real-song-region-ui-smoke.mjs
cd desktop
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_REGION_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-ui-smoke'
$env:AMS_REAL_SONG_REGION_SECONDS='12'
npm run test:tauri-real-song-region-ui
cd ..
```

Evidence:

- `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
- Relevant fields:
  - `sourcePlaybackReadyBeforeRegion: true`
  - `livePreviewActiveBeforeRegion: true`
  - `livePreviewParityBeforeRegion: Render required`
  - `livePreviewParityWarnBeforeRegion: true`
  - `livePreviewStatusBeforeRegion: Live Preview active ~10 ms`
  - `liveSnapshotBeforeRegion.active: true`
  - `transportLabelBeforeRegion: Lay the Money on the Desk - Original`
  - `firstRegionPreviewParity: Render-faithful region`
  - `livePreviewDeactivatedAfterFirstRegion: true`
  - `livePreviewStatusAfterFirstRegion: Live Preview armed ~10 ms`
  - `liveSnapshotAfterFirstRegion.active: false`
  - `regionPreviewParityWarnAfterFirstRegion: false`
  - `regionPreviewDidNotRemainApprox: true`
  - `regionPlaybackReplacedLivePreview: true`
  - `regionEngineAuditionEngine: python-render-track-region-preview`
  - `regionEngineAuditionStartSeconds: 65.0362191430817`
  - `regionEngineAuditionDurationSeconds: 12.0111936255241`
  - `dashboardSkippedForAudition: true`

Remaining gap:

- This proves the visible region-render path replaces active Web Audio source audition with exact Python region playback. Web Audio Live Preview remains approximate and not export-engine parity.

## Previous Codex Pass: Cue-Preserving Exact/Approx Audition Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Updated `Update Preview` to record the source audition cue point in the preview artifact and in `window.__AMS_EXPORT_ENGINE_AUDITION__`.
- The `Render-faithful preview` status tooltip now discloses that the rendered preview used the Python export engine and was cued at the captured source time.
- Extended the release-backed Track Preview UI smoke to verify that after `Update Preview` hands the transport to a Python-rendered master, Live Preview is only armed, the cue point is preserved, and the parity badge says `Render-faithful preview`.
- The smoke then switches back to `Original` and verifies Live Preview becomes active again, the Web Audio snapshot is active, and the parity badge returns to `Approx audition`.
- The export-vs-live comparison now asserts a material measured difference, so the test no longer accepts merely finite proxy metrics.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
npm run test:tauri-ui
cd ..
```

Verification note:

- `npm run test:tauri-ui` was attempted after the tooltip copy change, but it requires a running Tauri dev WebView on CDP port `9222`; no dev WebView was running, so the harness stopped before reaching the app.

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - `previewParityAfterUpdatePreview: Render-faithful preview`
  - `exportEngineAuditionEngine: python-render-track-master`
  - `exportEngineAuditionTransportIncludesMastered: true`
  - `exportAuditionExpectedStartSeconds: 1.664367`
  - `exportEngineAuditionStartSeconds: 1.664367`
  - `exportEngineAuditionCurrentTimeSeconds: 1.664367`
  - `exportEngineAuditionSourceDurationSeconds: 4`
  - `previewParityTitleAfterUpdatePreview: Rendered preview used the Python export engine and was cued at 00:01.`
  - `livePreviewStatusAfterUpdatePreview: Live Preview armed ~10 ms`
  - `approximateLiveSourceReady: true`
  - `previewParityAfterReturnToLiveSource: Approx audition`
  - `livePreviewStatusAfterReturnToSource: Live Preview active ~10 ms`
  - `liveSnapshotAfterReturnToSource.active: true`
  - `exportVsLiveComparison.exportDiffersFromLiveMaterially: true`
  - `exportVsLiveComparison.export_minus_live_lufs_proxy: 7.20928073777454`
  - `exportVsLiveComparison.rms_difference_dbfs: -20.8393990077294`
  - `exportVsLiveComparison.exportLoudnessDeltaVsSource: 7.2706778159778`
  - `exportVsLiveComparison.liveLoudnessDeltaVsSource: 0.0613970782032673`

Remaining gap:

- This proves the UI cues and labels the rendered-master and live-source playback paths correctly after switching. Web Audio Live Preview is still approximate and not export-engine parity.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward true export-engine live audition parity, especially a native/shared-DSP spike or a deeper engine-decision record.

## Previous Codex Pass: Fast Region Audition-Only Render

Date: 2026-05-12

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/tests/tauri-real-song-region-ui-smoke.mjs`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added optional `auditionOnly` handling to `render_track_region_preview`.
- The visible Track Master `Render Region` button now sends `auditionOnly: true`, keeping Python `render-project` audio rendering while skipping `score-render` and `export-dashboard` for the audition path.
- Full Track Master renders, Album Master renders, and the direct/default region-preview backend path still use the default full render options with score/dashboard generation.
- Extended the real-song region UI smoke and synthetic Track Preview UI smoke to assert that region audition skips `dashboard.html`, while whole-track preview still creates its dashboard.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-real-song-region-ui-smoke.mjs
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_REGION_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-ui-smoke'
$env:AMS_REAL_SONG_REGION_SECONDS='12'
npm run test:tauri-real-song-region-ui
$env:AMS_TAURI_REAL_SONG_REGION_PREVIEW_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-preview-smoke'
npm run test:tauri-real-song-region-preview
npm run test:tauri-track-preview-ui
cd ..
```

Evidence:

- `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
- `test-output\tauri-real-song-region-preview-smoke\tauri-real-song-region-preview-smoke.json`
- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Relevant fields:
  - real-song UI region audition: `dashboardExists: false`, `dashboardSkippedForAudition: true`
  - real-song UI stale state: `regionParityAfterLowChange: Render required`
  - real-song UI final parity: `secondRegionPreviewParity: Render-faithful region`
  - real-song UI engine: `regionEngineAuditionEngine: python-render-track-region-preview`
  - real-song UI timing: start `65.0362191430817s`, duration `12.0111936255241s`, rendered duration `12.011s`
  - direct backend region-preview default: `dashboardExists: true`, `manifestExists: true`, `regionSourceExists: true`, `regionMasterExists: true`, `regionEngine: python-render-track-region-preview`
  - Track Preview UI: `regionPreviewDashboardExists: false`, `regionPreviewDashboardSkippedForAudition: true`, `previewDashboardExists: true`, `previewParityAfterUpdatePreview: Render-faithful preview`, `exportEngineAuditionEngine: python-render-track-master`

Remaining gap:

- Region audition is faster because report/scoring work is skipped, but it remains render-first through the Python export engine. True real-time export-engine DSP parity and human listening approval remain open.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward true export-engine live audition parity or another performance pass on the real-song region path.

## Previous Codex Pass: Real-Song Region Stale/Re-Render UI Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/tests/tauri-real-song-region-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Extended the release-backed real-song region UI smoke to cover stale-state behavior after a tuning change.
- After the first visible `Render Region` pass, the smoke moves the visible `Low` control to `+0.50 dB`.
- The smoke verifies the old region audition is invalidated as `Render required`, the transport returns to `Player idle`, and `Render Region` is enabled again.
- The smoke then clicks `Render Region` a second time and verifies a new Python-engine region master path replaces the previous one.
- The second-render wait uses `window.__AMS_REGION_ENGINE_AUDITION__.path` changing instead of counting log matches, because render stdout can push older log lines out of the visible log tail.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-real-song-region-ui-smoke.mjs
cd desktop
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_REGION_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-ui-smoke'
$env:AMS_REAL_SONG_REGION_SECONDS='12'
npm run test:tauri-real-song-region-ui
cd ..
```

Evidence:

- `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
- Relevant fields:
  - `firstRegionPreviewParity: Render-faithful region`
  - `lowControlOutput: +0.50 dB`
  - `regionInvalidatedAfterLowChange: true`
  - `regionParityAfterLowChange: Render required`
  - `transportLabelAfterLowChange: Player idle`
  - `renderRegionEnabledAfterLowChange: true`
  - `secondRegionButtonEnabledBeforeClick: true`
  - `secondRegionRenderStarted: true`
  - `secondRegionPreviewReadyVisible: true`
  - `secondRegionPreviewMasterPath` differs from `firstRegionPreviewMasterPath`
  - `secondRegionPreviewParity: Render-faithful region`
  - `secondAudioLoadedRegion: true`
  - `regionEngineAuditionEngine: python-render-track-region-preview`
  - `regionEngineAuditionStartSeconds: 65.03621914308174`
  - `regionEngineAuditionDurationSeconds: 12.011193625524115`
  - `regionRenderedDurationSeconds: 12.011`
  - `manifest.track_count: 1`
  - `manifest.interlude_count: 0`

Remaining gap:

- This strengthens stale-state protection for bounded region audition. It is still render-first automation, not true live export-engine DSP or human listening approval.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward reducing region-preview turnaround or deeper export-engine live audition parity.

## Previous Codex Pass: Real-Song Analyze-To-Render Region UI Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/tests/tauri-real-song-region-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Tightened the release-backed real-song region UI smoke so it starts from an unanalyzed Track Master session.
- The smoke now uses FFprobe only to choose a deterministic 12-second waveform drag target.
- The smoke no longer computes analysis through a direct `analyze_tracks` invoke before seeding the app.
- The visible UI path now confirms `Needs analysis`, clicks `Analyze`, waits for Source LUFS/Peak and waveform readiness, confirms `Render Region` becomes enabled, drags the waveform region, clicks `Render Region`, and verifies the Python-engine region handoff.
- The Analyze wait fails fast if source validation blocks or Analyze fails, instead of burning the full smoke timeout.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-real-song-region-ui-smoke.mjs
cd desktop
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_REGION_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-ui-smoke'
$env:AMS_REAL_SONG_REGION_SECONDS='12'
npm run test:tauri-real-song-region-ui
cd ..
```

Evidence:

- `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
- Relevant fields:
  - `initialAnalysisStatus: Needs analysis`
  - `analyzeButtonEnabled: true`
  - `renderRegionDisabledBeforeAnalyze: true`
  - `analysisCompletedVisible: true`
  - `analysisStatusAfterAnalyze: Analyzed`
  - `sourceLufsText: Source LUFS-12.4 LUFS`
  - `sourcePeakText: Source Peak-0.4 dBFS`
  - `waveformEnabledAfterAnalyze: true`
  - `exportEnabledAfterAnalyze: true`
  - `renderRegionEnabledAfterAnalyze: true`
  - `regionReadoutAfterDrag: 01:05 - 01:17 (00:12)`
  - `regionPreviewParity: Render-faithful region`
  - `regionEngineAuditionEngine: python-render-track-region-preview`
  - `regionRenderedDurationSeconds: 12.011`
  - `manifestExists: true`
  - `dashboardExists: true`
  - `regionSourceExists: true`
  - `regionMasterExists: true`
  - `screenshotExists: true`

Remaining gap:

- This is still automated UI evidence against one real MP3. It is not human listening approval or true real-time export-engine DSP.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward reducing region-preview turnaround or deeper export-engine live audition parity.

## Previous Codex Pass: Real-Song Render Region UI Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/package.json`
- `desktop/tests/tauri-real-song-region-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added release-backed real-song UI coverage for the visible Track Master `Render Region` path.
- Added package script `npm run test:tauri-real-song-region-ui`.
- Fixed the visible region readout for analyzed tracks before transport audio is loaded. Region times now use `selectedTrack.analysis.duration_seconds` as the timeline fallback instead of rendering `00:00 - 00:00`.
- The smoke backs up/restores the user's autosave, launches the release EXE, seeds Track Master with analyzed real-song data, drags a waveform region in the real UI, clicks the visible `Render Region` button, waits for the Python-engine region render, reads the generated manifest/dashboard, and verifies the transport is handed to `Engine Region`.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-real-song-region-ui-smoke.mjs
cd desktop
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_REGION_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-ui-smoke'
$env:AMS_REAL_SONG_REGION_SECONDS='12'
npm run test:tauri-real-song-region-ui
cd ..
```

Evidence:

- `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
- Relevant fields:
  - `title: Lay the Money on the Desk`
  - `waveformBins: 256`
  - `analysisDurationSeconds: 186.31997916666663`
  - `analysisIntegratedLufs: -12.444218262030333`
  - `analysisTruePeakDbfs: -0.4290349634996211`
  - `regionReadoutAfterDrag: 01:05 - 01:17 (00:12)`
  - `regionPreviewParity: Render-faithful region`
  - `regionEngineAuditionEngine: python-render-track-region-preview`
  - `regionEngineAuditionStartSeconds: 65.03621914308174`
  - `regionEngineAuditionDurationSeconds: 12.011193625524115`
  - `regionEngineAuditionTransportIncludesRegion: true`
  - `regionRenderedDurationSeconds: 12.011`
  - `manifest.track_count: 1`
  - `manifest.interlude_count: 0`
  - `regionSourcePath` ends with `region-source.wav`
  - `manifestExists: true`
  - `dashboardExists: true`
  - `regionSourceExists: true`
  - `regionMasterExists: true`
  - `transportDurationSeconds: 12.011`
  - `screenshotExists: true`

Remaining gap:

- This is one visible release UI smoke against one real MP3. It is still render-first, not true real-time export-engine DSP.
- It is not a human listening pass or musical approval.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward reducing region-preview turnaround or deeper export-engine live audition parity.

## Previous Codex Pass: Real-Song Region Preview Turnaround

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-real-song-region-preview-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added release-backed real-song smoke coverage for bounded Python-engine region previews.
- Added package script `npm run test:tauri-real-song-region-preview`.
- The smoke requires `AMS_REAL_SONG_PATH`; no private source path is committed in code.
- The smoke launches the release EXE, validates/analyzes the provided song, renders a bounded 12-second region through `render_track_region_preview`, verifies the render manifest points at the clipped `region-source.wav`, prepares playback, and runs a short native playback probe on the prepared mastered region.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-real-song-region-preview-smoke.mjs
cd desktop
npm run build
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_REGION_PREVIEW_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-preview-smoke'
$env:AMS_REAL_SONG_REGION_SECONDS='12'
npm run test:tauri-real-song-region-preview
cd ..
```

Evidence:

- `test-output\tauri-real-song-region-preview-smoke\tauri-real-song-region-preview-smoke.json`
- Relevant fields:
  - `sourceValidationStatus: ok`
  - `analysisDurationSeconds: 186.31997916666663`
  - `analysisIntegratedLufs: -12.444218262030333`
  - `analysisTruePeakDbfs: -0.4290349634996211`
  - `regionStartSeconds: 65.21199270833331`
  - `regionDurationSeconds: 12`
  - `regionEngine: python-render-track-region-preview`
  - `renderDurationMs: 8476.3`
  - `regionRenderedDurationSeconds: 12`
  - `regionSourcePath` ends with `region-source.wav`
  - `regionSourceExists: true`
  - `regionMasterExists: true`
  - `exportChecks.status: pass`
  - `playbackCacheDurationMs: 27.9`
  - `nativePlaybackProbe.requested_duration_ms: 3000`
  - `nativePlaybackProbe.played_output_frames: 144000`
  - `nativePlaybackProbe.callback_count: 300`
  - `nativePlaybackProbe.stream_errors: []`
  - `nativePlaybackProbe.warnings: []`

Remaining gap:

- This is one real-song automated timing/probe pass. It is still render-first, not true real-time export-engine DSP.
- It is not a human listening pass or musical approval.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward reducing region-preview turnaround or adding a real-song UI smoke that clicks `Render Region` visibly.

## Previous Codex Pass: Bounded Python-Engine Region Preview

Date: 2026-05-12

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added Tauri command `render_track_region_preview`.
- The command trims the selected source window with FFmpeg into `region-source.wav`, mutates a one-track project to point at that clipped source, disables transitions/album WAV/codec preview for the bounded audition, then calls the existing `render_project_product` path.
- Added a visible Track Master `Render Region` button.
- `Render Region` uses the selected waveform region when present, otherwise a bounded playhead window.
- The rendered region is immediately prepared in the transport as `Engine Region`.
- The parity label shows `Render-faithful region` while the bounded Python-rendered region is active.
- Full-track `Update Preview` remains the render-faithful whole-track path; Web Audio `Live Preview` remains the approximate fast path.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run build
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
& "$env:USERPROFILE\.cargo\bin\cargo.exe" fmt
cd ..
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
$env:TAURI_CDP_PORT='9353'
$env:AMS_TAURI_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-region-preview-ui-smoke'
# launched npm run tauri:dev in a hidden background process with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9353, then ran:
npm run test:tauri-ui
cd ..
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- `test-output\tauri-region-preview-ui-smoke\tauri-webview-ui-smoke.json`
- Relevant fields:
  - `regionPreviewReadyVisible: true`
  - `regionPreviewMasterExists: true`
  - `regionPreviewManifestExists: true`
  - `regionPreviewSourceExists: true`
  - `regionPreviewSourcePath` ends with `region-source.wav`
  - `regionPreviewManifest.track_count: 1`
  - `regionPreviewManifest.interlude_count: 0`
  - `regionPreviewParity: Render-faithful region`
  - `regionEngineAuditionEngine: python-render-track-region-preview`
  - `regionEngineAuditionStartSeconds: 1`
  - `regionEngineAuditionDurationSeconds: 1.1949685534591197`
  - `regionEngineAuditionTransportIncludesRegion: true`
  - `previewParityAfterLivePreview: Approx audition`
  - `previewParityAfterUpdatePreview: Render-faithful preview`

Remaining gap:

- This is a bounded render-first audition path, not true real-time export-engine DSP.
- Web Audio `Live Preview` is still approximate and should remain labeled that way.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward faster region-render turnaround evidence on real audio or deeper export-engine live audition parity.

## Previous Codex Pass: Update Preview Export-Engine Audition Handoff

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Kept `Live Preview` as the fast Web Audio audition path, but stopped using the armed Live Preview toggle as the parity label source.
- The preview-parity label now follows the active playback path:
  - source playback with Web Audio Live Preview active: `Approx audition`
  - missing/stale rendered master: `Render required`
  - Python-rendered master playback: `Render-faithful preview`
- The visible `Update Preview` button now immediately prepares and plays the Python-rendered master after the render completes.
- If the source had a current playhead or selected region, the mastered preview is cued to that position or region start where possible.
- The packaged Track Preview smoke now proves both facts at once:
  - Live Preview remains approximate and not same-engine parity.
  - Update Preview hands the user to the Python-rendered master for the current settings.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
$env:TAURI_CDP_PORT='9352'
$env:AMS_TAURI_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-update-preview-handoff-ui-smoke'
# launched npm run tauri:dev in a hidden background process with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9352, then ran:
npm run test:tauri-ui
cd ..
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- `test-output\tauri-update-preview-handoff-ui-smoke\tauri-webview-ui-smoke.json`
- Relevant fields:
  - `previewParityAfterLivePreview: Approx audition`
  - `previewParityAfterControlChange: Render required`
  - `parityMasterStatusAfterRender: Master ready`
  - `previewParityAfterUpdatePreview: Render-faithful preview`
  - `exportEngineAuditionPath == parityPreviewMasterPath`
  - `exportEngineAuditionEngine: python-render-track-master`
  - `exportEngineAuditionTransportIncludesMastered: true`
  - `exportVsLiveComparison.same_engine: false`
  - `exportVsLiveComparison.preview_parity: approximate`
  - `exportVsLiveComparison.export_faithful_preview_required: true`

Remaining gap:

- Web Audio Live Preview is still approximate and still not export-engine parity.
- This slice makes the export-engine audition immediate after `Update Preview`; it does not make every live knob movement render-equivalent in real time.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward faster bounded Python-engine previews or actual export-engine live audition parity.

## Previous Codex Pass: Full-Source Multi-Song Album Master Verification

Date: 2026-05-12

Changed files in this pass:

- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Extended the multi-source Album Master evidence from 10-second excerpts to full source songs.
- Reused the same three distinct local WAV source files through `AMS_REAL_SONG_ALBUM_PATHS`; no private source paths were committed into repo code.
- Set `AMS_REAL_SONG_ALBUM_CLIP_SECONDS=999`, which let FFmpeg take each full source because all three songs are shorter than that limit.
- Verified the release-backed Album Master performance path with:
  - `sourceMode: multi-song`
  - `distinctSourceCount: 3`
  - analyzed durations of about `118.56s`, `116.00s`, and `148.56s`
  - 3 source validations
  - 3 analyses
  - 3 rendered masters
  - 2 generated interludes
  - continuous album WAV, cue JSON, cue sheet, manifest, and dashboard artifacts
  - passing export checks
- Verified the Tauri UI/native path with:
  - Album Master restored as `3 / 8 tracks`
  - Track Roles / Story visible before render
  - role override persisted into the render
  - album WAV playback prepared
  - native file start/pause/seek/resume/stop
  - rendered album sequence duration of about `387.54s`
  - 30 seconds of bounded native album WAV playback stability with no stream errors or warnings

Verification already run:

```powershell
cd desktop
$env:AMS_REAL_SONG_ALBUM_PATHS='<JSON array of three local WAV paths>'
$env:AMS_REAL_SONG_ALBUM_CLIP_SECONDS='999'
$env:AMS_TAURI_REAL_SONG_ALBUM_PERFORMANCE_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-album-performance-multisong-fullsource'
npm run test:tauri-real-song-album-performance

$env:TAURI_CDP_PORT='9351'
$env:AMS_TAURI_REAL_SONG_ALBUM_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-album-ui-multisong-fullsource'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='30'
# launched npm run tauri:dev in a hidden background process with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9351, then ran:
npm run test:tauri-real-song-album-ui
cd ..
```

Evidence:

- `test-output\tauri-real-song-album-performance-multisong-fullsource\tauri-real-song-album-performance-smoke.json`
- `test-output\tauri-real-song-album-ui-multisong-fullsource\tauri-real-song-album-ui-smoke.json`
- Relevant fields:
  - `sourceMode: multi-song`
  - `distinctSourceCount: 3`
  - `analysisDurationsSeconds: [118.56, 116.00, 148.56]`
  - `renderTrackCount: 3`
  - `renderInterludeCount: 2`
  - `exportChecks.status: pass`
  - `manifestTrackCount: 3`
  - `manifestInterludeCount: 2`
  - `albumPlaybackStability.source_duration_ms: 387543.9375`
  - `albumPlaybackStability.requested_duration_ms: 30000`
  - `albumPlaybackStability.played_output_frames: 1440000`
  - `albumPlaybackStability.callback_count: 3000`
  - `albumPlaybackStability.stream_errors: []`
  - `albumPlaybackStability.warnings: []`

Remaining gap:

- This is full-source multi-song automated Album Master evidence, but it is still automated verification.
- It is not a human listening pass or musical approval of the generated transitions.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward actual export-engine live audition parity.

## Previous Codex Pass: True Multi-Source Album Master Verification

Date: 2026-05-12

Changed files in this pass:

- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Ran the existing multi-source Album Master smoke harness with three distinct local WAV source files instead of one song split into multiple clips.
- Passed the source paths through `AMS_REAL_SONG_ALBUM_PATHS`; no private source paths were committed into repo code.
- Verified the release-backed Album Master performance path with:
  - `sourceMode: multi-song`
  - `distinctSourceCount: 3`
  - 3 source validations
  - 3 analyses
  - 3 rendered masters
  - 2 generated interludes
  - continuous album WAV, cue JSON, cue sheet, manifest, and dashboard artifacts
  - passing export checks
- Verified the Tauri UI/native path with:
  - Album Master restored as `3 / 8 tracks`
  - Track Roles / Story visible before render
  - role override persisted into the render
  - album WAV playback prepared
  - native file start/pause/seek/resume/stop
  - 12 seconds of bounded native album WAV playback stability with no stream errors or warnings

Verification already run:

```powershell
cd desktop
$env:AMS_REAL_SONG_ALBUM_PATHS='<JSON array of three local WAV paths>'
$env:AMS_REAL_SONG_ALBUM_CLIP_SECONDS='10'
$env:AMS_TAURI_REAL_SONG_ALBUM_PERFORMANCE_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-album-performance-multisong-3source'
npm run test:tauri-real-song-album-performance

$env:TAURI_CDP_PORT='9350'
$env:AMS_TAURI_REAL_SONG_ALBUM_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-album-ui-multisong-3source'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='12'
# launched npm run tauri:dev in a hidden background process with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9350, then ran:
npm run test:tauri-real-song-album-ui
cd ..
```

Evidence:

- `test-output\tauri-real-song-album-performance-multisong-3source\tauri-real-song-album-performance-smoke.json`
- `test-output\tauri-real-song-album-ui-multisong-3source\tauri-real-song-album-ui-smoke.json`
- Relevant fields:
  - `sourceMode: multi-song`
  - `distinctSourceCount: 3`
  - `renderTrackCount: 3`
  - `renderInterludeCount: 2`
  - `exportChecks.status: pass`
  - `manifestTrackCount: 3`
  - `manifestInterludeCount: 2`
  - `albumPlaybackStability.requested_duration_ms: 12000`
  - `albumPlaybackStability.played_output_frames: 576000`
  - `albumPlaybackStability.stream_errors: []`
  - `albumPlaybackStability.warnings: []`

Remaining gap:

- This is true multi-source automated Album Master evidence, but it still uses 10-second excerpts and automated playback checks.
- It is not a full-song album listen and not human approval.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward actual export-engine live audition parity or a longer full-song Album Master playback stability run.

## Previous Codex Pass: Live Preview Render-Required Guardrail

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Tightened the Track Master preview-parity label so the user sees:
  - `Render required` when no exact rendered master is selected
  - `Approx audition` when Web Audio `Live Preview` is armed while a rendered preview exists
  - `Render-faithful preview` when a Python-engine rendered preview is selected and Live Preview is not armed
- Kept Live Preview honest as a Web Audio audition path, not an export-faithful render path.
- Updated the broad Tauri UI smoke so arming Live Preview before an exact rendered master now expects `Render required`.
- Extended the packaged Track Preview smoke so it verifies `Approx audition` after an exact preview render, then `Render required` after a Low EQ control change invalidates that preview.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-webview-ui-smoke.mjs
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
$env:TAURI_CDP_PORT='9349'
# launched npm run tauri:dev in a hidden background process with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9349, then ran:
npm run test:tauri-ui
cd ..
```

Evidence:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- `test-output\tauri-webview-ui-smoke\tauri-webview-ui-smoke.json`
- Relevant fields:
  - `previewParityStatus: Render required`
  - `previewParityAfterLivePreview: Approx audition`
  - `previewParityAfterControlChange: Render required`
  - `exportVsLiveComparison.preview_parity: approximate`
  - `exportVsLiveComparison.export_faithful_preview_required: true`

Remaining gap:

- The Web Audio Live Preview path is still approximate. This slice prevents the UI from implying render parity when the exact Python-engine preview is stale or missing.
- Render-faithful audition still requires clicking `Update Preview`.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward actual export-engine live audition parity or run a true multi-song Album Master smoke with two or more distinct real songs.

## Previous Codex Pass: Listening Approval Capture

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added explicit top-level autosaved session state:
  - `listeningApproved`
- Kept approval separate from `listeningChecklist`, so checklist progress remains a six-item activity trail rather than becoming approval math.
- Added an `Approved after listening` control to the `Listening Pass` panel.
- Added a visible approval status pill:
  - `Not approved`
  - `Approved`
  - `Approval stale`
- Render-affecting edits now clear `listeningApproved`.
- `Clear Listening Pass` clears both checklist fields and the approval flag.
- Extended the broad WebView UI smoke so it clicks the approval control, waits for autosave, and verifies `load_recent_session` persists `listeningApproved: true`.
- Used the agent loop for a read-only sidecar audit; it confirmed approval should be top-level session state rather than part of `listeningChecklist`.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-webview-ui-smoke.mjs
cd desktop
npm run build
$env:TAURI_CDP_PORT='9349'
$env:AMS_TAURI_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-listening-approval-ui-smoke'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9349'
# launched npm run tauri:dev in a hidden background process, then ran:
npm run test:tauri-ui
cd ..
git diff --check
```

Evidence:

- `test-output\tauri-listening-approval-ui-smoke\tauri-webview-ui-smoke.json`
- Relevant fields:
  - `listeningApprovalInitial: Not approved`
  - `listeningProgressAfterChecks: Listening Pass3/6Approved`
  - `listeningApprovalAfterChecks: Approved`
  - `persistedListeningApproved: true`
- `git diff --check` emitted only LF-to-CRLF working-copy warnings.

Remaining gap:

- This gives the user a durable place to record approval, but it is not itself a human listening pass.
- No actual user-approved listening pass has been recorded yet.

Next useful slice:

- If the user is present, run a real listening pass through Track Master and/or Album Master, then record `listeningApproved` with notes.
- If working unattended, continue toward export-faithful Live Preview parity because the current Web Audio live path is still marked approximate.

## Previous Codex Pass: Real-Song Album Multi-Source Harness

Date: 2026-05-12

Changed files in this pass:

- `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
- `desktop/tests/tauri-real-song-album-performance-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added `AMS_REAL_SONG_ALBUM_PATHS` support to both real-song Album Master smoke harnesses.
- The new env var accepts either a JSON array of local audio paths or a Windows path-delimited list such as `path1;path2;path3`.
- Multi-song input is validated before rendering:
  - at least two paths
  - at least two distinct files
  - no more than eight files
  - every file exists
- Preserved the existing `AMS_REAL_SONG_PATH` fallback, which derives three clips from one provided MP3.
- Added source provenance to smoke evidence:
  - `sourceMode`
  - `sourcePaths`
  - `distinctSourceCount`
  - per-clip source path/title details
- Made track/interlude assertions dynamic so the same harness can verify two to eight real songs.
- Kept seeded UI titles normalized as `Album Clip N`, so role override and story checks remain stable with arbitrary filenames.
- Used the agent loop for a read-only sidecar check; it recommended the same minimal resolver/fallback shape and no files were edited by the sidecar.

Verification already run:

```powershell
node --check .\desktop\tests\tauri-real-song-album-ui-smoke.mjs
node --check .\desktop\tests\tauri-real-song-album-performance-smoke.mjs
cd desktop
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_ALBUM_PERFORMANCE_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-album-performance-multisource-ready'
npm run test:tauri-real-song-album-performance
$env:TAURI_CDP_PORT='9347'
$env:AMS_TAURI_REAL_SONG_ALBUM_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-album-ui-multisource-ready'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='5'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9347'
# launched npm run tauri:dev in a hidden background process, then ran:
npm run test:tauri-real-song-album-playback
cd ..
git diff --check
```

Evidence:

- Packaged release evidence: `test-output\tauri-real-song-album-performance-multisource-ready\tauri-real-song-album-performance-smoke.json`
- Visible Album UI evidence: `test-output\tauri-real-song-album-ui-multisource-ready\tauri-real-song-album-ui-smoke.json`
- Both runs used the current one-song fallback and recorded:
  - `sourceMode: single-song-derived-clips`
  - `distinctSourceCount: 1`
  - three rendered tracks
  - two generated interludes
  - passing export checks
- Visible UI run also completed a five-second native album WAV playback probe with zero stream errors.
- `git diff --check` emitted only LF-to-CRLF working-copy warnings.

Remaining gap:

- No true multi-song Album Master pass has been run yet because only one real MP3 is available in the current fixture set.
- To close that gate, run either real-song Album smoke with `AMS_REAL_SONG_ALBUM_PATHS` set to two or more distinct local song paths.

Next useful slice:

- If more real songs are available, run the visible Album UI smoke in `multi-song` mode and record the rendered masters, album WAV, story/roles, export receipt, and playback evidence.
- If no more songs are available, continue toward export-faithful Live Preview or manual listening approval capture.

## Previous Codex Pass: Album Boundary Primitive Coverage

Date: 2026-05-12

Changed files in this pass:

- `tests/test_pipeline.py`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Expanded the generated-off Album Master boundary regression from `gap`/`crossfade` only to `gap`, `fade`, `ring-out`, and `crossfade`.
- Kept the existing DSP semantics explicit in tests:
  - `gap`, `ring-out`, and `crossfade` create discrete boundary cue chunks.
  - `fade` fades the outgoing tail and incoming head without inserting a separate cue chunk, so cue points remain `track,track` while the manifest sequence still records a boundary intent.
- Extended `desktop/tests/tauri-webview-ui-smoke.mjs` so the visible Album Master `Boundary` selector proves every non-direct primitive can be selected.
- Extended `desktop/tests/tauri-webview-runtime-smoke.mjs` so the Tauri `render_album_master` bridge renders all four non-direct boundary primitives with generated transitions disabled and records per-style evidence.
- Used the existing agent loop for a read-only sidecar audit; it confirmed the same minimal patch path and no files were edited by the sidecar.

Verification already run:

```powershell
python -m unittest tests.test_pipeline.PipelineTest.test_project_boundary_primitives_render_without_generated_interludes
node --check .\desktop\tests\tauri-webview-runtime-smoke.mjs
node --check .\desktop\tests\tauri-webview-ui-smoke.mjs
python -m compileall -q src tests
python -m unittest discover -s tests
cd desktop
npm run build
npm run test:integration
```

Live Tauri verification:

- First `tauri dev` launch attempt failed before the app opened because the hidden process PATH did not include `cargo`.
- Retried with `%USERPROFILE%\.cargo\bin` prepended to `PATH`.
- `npm run test:tauri-webview` passed with `TAURI_CDP_PORT=9340` and output root `test-output\tauri-boundary-primitives-runtime`.

Runtime evidence:

- `boundaryResults.gap`: `interludeCount: 0`, sequence `track,boundary,track`, cues `track,boundary,track`.
- `boundaryResults.fade`: `interludeCount: 0`, sequence `track,boundary,track`, cues `track,track`.
- `boundaryResults.ring-out`: `interludeCount: 0`, sequence `track,boundary,track`, cues `track,boundary,track`.
- `boundaryResults.crossfade`: `interludeCount: 0`, sequence `track,boundary,track`, cues `track,boundary,track`.
- All per-style album WAV paths existed and all manifests preserved `generated_transitions: false`.
- Evidence file: `test-output\tauri-boundary-primitives-runtime\tauri-webview-runtime-smoke.json`.

Next useful slice:

- Continue Album Master toward real multi-song workflow proof: use separate real songs, verify track ordering/story/roles, render individual masters plus continuous album WAV, and audition the album output instead of relying only on synthetic fixtures.

## Previous Codex Pass: Packaged Track Preview And A/B UI

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src/App.tsx`
- `desktop/tests/tauri-track-preview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added `npm run test:tauri-track-preview-ui`.
- Enabled Tauri's asset protocol for local user/temp media locations so `convertFileSrc` can load prepared playback WAVs and dashboards in the WebView.
- Updated the WebView transport seek control to expose `aria-label="Playback position"`, respond on `input`, and update React position state immediately inside `seek()`.
- Updated region-loop playback state so enabling a loop and crossing its end boundary keep visible transport position synchronized.
- Added a live-audition diagnostic snapshot on the Web Audio chain for packaged smoke verification.
- Added a CDP pointer-drag assertion for the playback-position range so WebView mouse input is verified.
- Added packaged export-vs-live comparison evidence: after Live Preview updates Low to +0.5 dB and marks the preview stale, the smoke clicks the visible `Update Preview` button again, renders a second Python preview, writes a deterministic Web Audio low-shelf model, and records the comparison as approximate rather than same-engine parity.
- Updated Track Master multi-export receipt handling so independent batch exports aggregate every rendered track into one quality-check manifest instead of showing only the last one-track receipt.
- Added a packaged release smoke for the visible Track Master preview workflow.
- The smoke launches the release EXE, restores a two-track Track Master autosave, selects Track 2, clicks the visible `Update Preview` button, waits for `Preview ready:`, prepares playback for the generated master, seeks the transport range to a nonzero time, verifies CDP mouse-drag seeking, starts the visible A/B compare pair, verifies playhead preservation across Original/Mastered switching, drags a waveform region, verifies Loop boundary behavior, checks Volume Match gain, enables Live Preview, verifies live Low control latency, then confirms the Low change makes the rendered preview stale.
- The first A/B attempt found a real package issue: local playback files existed, but WebView audio stayed at `duration=0` until `app.security.assetProtocol` was enabled and the release EXE was rebuilt.
- It verifies:
  - active app mode is `Track Master`
  - visible library count is `2 / 8 tracks`
  - selected heading is `Track 2`
  - preview render produces a one-track manifest, dashboard, and mastered WAV
  - visible master status becomes `Master ready`
  - the `Mastered` button becomes enabled after preview
  - playback cache preparation succeeds for the preview master
  - the WebView audio element loads prepared local media
  - the visible playback-position range seeks the WebView audio element
  - CDP mouse-drag input on the playback-position range changes the audio playhead
  - visible A/B Original/Mastered buttons preserve a nonzero playhead
  - waveform drag creates a region and enables Loop
  - crossing the selected region end returns playback to the region start
  - clearing the region disables Loop again
  - Volume Match defaults off, reduces mastered playback gain, and returns to unity when disabled
  - Live Preview creates a running Web Audio chain
  - Live Preview is labeled as approximate audition
  - a Low control change reaches the live chain under 150 ms
  - changing a control marks the preview stale with visible `No master`
  - the `Mastered` button disables after stale state is restored
  - the visible `Update Preview` button can render a second Low=+0.5 dB preview
  - export-vs-live comparison fields record `same_engine: false`, `preview_parity: "approximate"`, and `export_faithful_preview_required: true`
  - Track Master batch export shows a single quality receipt for both independent masters
  - the receipt reports `2 track(s), 0 transition(s), 0 warning(s)` and `2 rendered track path(s) exist`

Verification already run:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
cd desktop
node --check .\tests\tauri-track-preview-ui-smoke.mjs
npm run test:integration
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
cd ..
git diff --check
```

`git diff --check` emitted only LF-to-CRLF working-copy warnings.

Evidence output:

- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui.png`
- `test-output\tauri-track-preview-ui-smoke\preview-20260512-051105-563\manifest.json`
- `test-output\tauri-track-preview-ui-smoke\preview-20260512-051105-563\dashboard.html`
- `test-output\tauri-track-preview-ui-smoke\preview-20260512-051105-563\masters\01_preview-fixture-2_mastered.wav`
- `test-output\tauri-track-preview-ui-smoke\preview-20260512-051118-151\masters\01_preview-fixture-2_mastered.wav`
- `test-output\tauri-track-preview-ui-smoke\live-preview-low-model.wav`

Passing run details:

- active mode: `Track Master`
- track count label: `2 / 8 tracks`
- selected heading: `Track 2`
- preview ready visible: `true`
- master status after preview: `Master ready`
- mastered button enabled after preview: `true`
- playback ready visible: `true`
- A/B source ready visible: `true`
- A/B master ready visible: `true`
- A/B original ready visible: `true`
- A/B seek target: `1.8` seconds
- transport seek input visible: `true`
- transport seeked: `true`
- transport seek audio time: `1.8` seconds
- transport seek readout: `00:0100:04`
- A/B source time before switch: `1.8` seconds
- A/B master time after switch: `2.053668` seconds
- A/B source time after return: `2.310491` seconds
- A/B preserves position: `true`
- region created: `true`
- region readout after drag: `00:01 - 00:02 (00:01)`
- loop enabled after region: `true`
- loop active: `true`
- expected loop start: `1` second
- expected loop end: `2.2` seconds
- loop start after toggle: `1` second
- region loop returned to start: `true`
- region cleared: `true`
- loop disabled after clear: `true`
- Volume Match default off: `true`
- Volume Match active: `true`
- Volume Match volume before: `1`
- Volume Match volume after: `0.6310763123458518`
- Volume Match reduces master: `true`
- Volume Match volume after off: `1`
- Volume Match returns to unity: `true`
- Live Preview default off: `true`
- Live Preview button enabled: `true`
- Live Preview active: `true`
- Live Preview activation time: `317.69999998807907` ms
- Live Preview status: `Live Preview active ~10 ms`
- Live chain context state: `running`
- Live chain base latency: `10` ms
- Live preview parity label: `Approx audition`
- Live Low control latency: `1.300000011920929` ms
- Live Low control under 150 ms: `true`
- Live Low snapshot bass: `0.5`
- pixel seek drag target fraction: `0.72`
- pixel seek drag start time: `0.72` seconds
- pixel seek drag target time: `2.88` seconds
- pixel seek drag audio time: `2.92` seconds
- pixel seek drag input value: `2.92`
- pixel seek drag readout: `00:0200:04`
- pixel seek drag changed position: `true`
- pixel seek drag hit target: `true`
- master status after control change: `No master`
- mastered button enabled after control change: `false`
- parity preview button enabled before render: `true`
- parity preview ready visible: `true`
- parity master status after render: `Master ready`
- export-vs-live offline engine: `python-render-track-master`
- export-vs-live live model: `web-audio-low-shelf-model`
- export-vs-live same engine: `false`
- export-vs-live preview parity: `approximate`
- export-vs-live export-faithful preview required: `true`
- export-vs-live tuning: `{ "bassDb": 0.5 }`
- export-vs-live compared frames: `192000`
- export minus live LUFS proxy: `7.209280737774536`
- export-vs-live RMS difference: `-20.839399007729398` dBFS
- preview manifest track count: `1`
- preview manifest interlude count: `0`
- preview manifest warnings: `0`
- Track Master batch export button enabled before export: `true`
- Track Master batch receipt visible: `true`
- Track Master batch receipt text: `Export checks passed2 track(s), 0 transition(s), 0 warning(s)Manifest2 sequence item(s)Track outputs2 rendered track path(s) existMeter valuesRendered track LUFS and peak values are finite.Album WAVNot requested for this render.Codec QCNot requested for this render.Advisory warningsNo render warnings emitted.`
- Track Master batch receipt includes `2 track(s), 0 transition(s)`: `true`
- Track Master batch receipt includes stale single-track summary: `false`
- Track Master batch receipt includes `Track outputs`: `true`
- Track Master batch receipt includes `2 rendered track path(s) exist`: `true`

Honest gaps after this pass:

- Live Preview remains an approximate Web Audio audition path. The packaged smoke now measures the mismatch; it does not implement export-engine parity.
- Human listening approval is still incomplete.
- This is a synthetic packaged UI proof, not a real-song listening approval.

## Previous Codex Pass: Packaged Project Persistence

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-project-persistence-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added `npm run test:tauri-project-persistence`.
- Added a packaged release smoke for the editable `.ams.json` workflow.
- The smoke launches the release EXE, restores a two-track Album Master autosave with a known `saved-album.ams.json` path, clicks the real visible `Save` button, reads the saved project back, and renders that saved project through the Python engine sidecar.
- It verifies:
  - active app mode is `Album Master`
  - visible library count is `2 / 8 tracks`
  - `Saved project:` appears in the app log
  - saved project metadata/settings/tracks serialize correctly
  - saved project has `album_wav: true`, `generated_transitions: false`, and `gap` boundary settings
  - render-from-saved-project produces track masters, `album_sequence.wav`, dashboard, and manifest
  - export checks pass with zero render warnings

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-project-persistence-smoke.mjs
npm run build
npm run test:tauri-project-persistence
```

Evidence output:

- `test-output\tauri-project-persistence-smoke\tauri-project-persistence-smoke.json`
- `test-output\tauri-project-persistence-smoke\tauri-project-persistence.png`
- `test-output\tauri-project-persistence-smoke\saved-album.ams.json`
- `test-output\tauri-project-persistence-smoke\rendered-from-saved-project\manifest.json`
- `test-output\tauri-project-persistence-smoke\rendered-from-saved-project\dashboard.html`
- `test-output\tauri-project-persistence-smoke\rendered-from-saved-project\album_sequence.wav`

Passing run details:

- active mode: `Album Master`
- track count label: `2 / 8 tracks`
- save log visible: `true`
- saved project album title: `Persistence Smoke Album`
- saved project artist: `Persistence Artist`
- render track count: `2`
- render transition count: `0`
- export checks status: `pass`
- render warnings: `0`

Honest gaps after this pass:

- This proves the no-dialog Save path when `projectPath` is already known.
- OS file-picker Open and Save-As dialog flows are still not automated.
- This is a synthetic-fixture persistence contract test, not a real-song listening pass.

## Latest Codex Pass: Real-Song Album Release Performance

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-real-song-album-performance-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added `npm run test:tauri-real-song-album-performance`.
- Added a packaged release smoke that requires `AMS_REAL_SONG_PATH`, derives three short WAV clips from the local MP3 under ignored `test-output`, and measures the Album Master path with generated transitions.
- The smoke launches the release EXE and measures:
  - launch to Tauri invoke readiness
  - source validation for three real-song-derived clips
  - three-track analysis with 256 waveform bins
  - Album Master render with continuous album WAV enabled
  - two generated transitions enabled
  - export checks
- The smoke verifies the mastered track WAVs, interlude WAVs, album WAV, cue JSON, cue sheet, dashboard, and manifest files exist.

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-real-song-album-performance-smoke.mjs
npm run build
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-album-performance
```

Measured on this machine with `Lay the Money on the Desk (1).mp3`:

- source file size: `4277626`
- derived clip duration: `10` seconds each
- launch to WebView target: `334.9 ms`
- launch to Tauri invoke ready: `650.7 ms`
- source validation, 3 clips: `107.1 ms`
- analysis, 3 clips, 256 waveform bins: `2838 ms`
- Album Master render, 3 clips, continuous WAV, 2 generated transitions: `15166.3 ms`
- export checks: `3.5 ms`
- analysis integrated LUFS: `-14.63480972550632`, `-13.279312462352271`, `-12.643379579007972`
- album integrated LUFS: `-14.165509497251968`
- expected playback gain: `0.166 dB`
- export checks status: `pass`
- render warnings: `0`

Evidence output:

- `test-output\tauri-real-song-album-performance-smoke\tauri-real-song-album-performance-smoke.json`
- `test-output\tauri-real-song-album-performance-smoke\tauri-real-song-album-performance.png`
- `test-output\tauri-real-song-album-performance-smoke\album-master-real-song\manifest.json`
- `test-output\tauri-real-song-album-performance-smoke\album-master-real-song\dashboard.html`
- `test-output\tauri-real-song-album-performance-smoke\album-master-real-song\album_sequence.wav`
- `test-output\tauri-real-song-album-performance-smoke\album-master-real-song\album_sequence.cue`
- `test-output\tauri-real-song-album-performance-smoke\album-master-real-song\album_sequence.cue.json`

Honest gaps after this pass:

- This is one real-song-derived Album Master baseline, not broad real-audio performance coverage.
- The smoke verifies artifact creation and checks, not manual listening quality.
- The source MP3 remains outside the repo and must stay uncommitted.

## Latest Codex Pass: Real-Song Release Performance

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-real-song-performance-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added `npm run test:tauri-real-song-performance`.
- Added a packaged release smoke that requires `AMS_REAL_SONG_PATH` and measures a real local source without hardcoding private audio into the repo.
- The smoke launches the release EXE and measures:
  - launch to Tauri invoke readiness
  - source validation
  - full-song analysis with 256 waveform bins
  - playback-cache preparation
  - full Track Master render
  - export checks
- The smoke verifies the playback cache WAV, mastered WAV, dashboard, and manifest files exist.

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-real-song-performance-smoke.mjs
npm run build
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-performance
cd ..
python -m compileall -q src tests
cd desktop
npm run test:integration
npm run build
cd ..
git diff --check
```

Measured on this machine with `Lay the Money on the Desk (1).mp3`:

- source file size: `4277626`
- analyzed duration: `186.31997916666663` seconds
- launch to WebView target: `334.3 ms`
- launch to Tauri invoke ready: `424.9 ms`
- source validation: `71.8 ms`
- analysis, 256 waveform bins: `5035.6 ms`
- playback-cache preparation: `1.9 ms`
- Track Master render: `29610.6 ms`
- export checks: `1.9 ms`
- integrated loudness: `-12.444218262030333 LUFS`
- true peak proxy: `-0.4290349634996211 dBFS`
- export checks status: `pass`
- render warnings: `0`
- Python compileall passed after doc updates.
- Desktop CLI contract integration test passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Evidence output:

- `test-output\tauri-real-song-performance-smoke\tauri-real-song-performance-smoke.json`
- `test-output\tauri-real-song-performance-smoke\tauri-real-song-performance.png`
- `test-output\tauri-real-song-performance-smoke\track-master-real-song\manifest.json`
- `test-output\tauri-real-song-performance-smoke\track-master-real-song\dashboard.html`
- `test-output\tauri-real-song-performance-smoke\track-master-real-song\masters\01_lay-the-money-on-the-desk-1_mastered.wav`

Honest gaps after this pass:

- This is one real-song baseline, not broad real-audio performance coverage.
- The source MP3 remains outside the repo and must stay uncommitted.

## Latest Codex Pass: Release Performance Baseline

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-release-performance-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `docs/IMPLEMENTATION_PLAN.md`

What changed:

- Added `npm run test:tauri-performance`.
- Added a packaged release performance smoke that launches the current release EXE and measures:
  - launch to WebView CDP target
  - launch to Tauri invoke readiness
  - native audio probe
  - 8-track source validation
  - 8-track analysis with 128 waveform bins
  - 8-track Album Master render with continuous album WAV enabled and generated transitions disabled
  - export checks
- The smoke verifies actual output files for the album WAV, dashboard, and manifest.

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-release-performance-smoke.mjs
npm run build
npm run test:tauri-performance
cd ..
python -m compileall -q src tests
cd desktop
npm run test:integration
npm run build
cd ..
git diff --check
```

Measured on this machine in this pass:

- launch to WebView target: `331.9 ms`
- launch to Tauri invoke ready: `628.4 ms`
- native audio probe: `97.7 ms`
- source validation, 8 tracks: `255 ms`
- analysis, 8 tracks, 128 waveform bins: `2636.4 ms`
- album render, 8 tracks, continuous WAV, no generated transitions: `9745.3 ms`
- export checks: `4.4 ms`
- source validation statuses: eight `ok`
- analysis count: `8`
- render track count: `8`
- render interlude count: `0`
- export checks status: `warn` only because every generated fixture triggers the existing dense-source limiter-pressure advisory
- Python compileall passed after doc updates.
- Desktop CLI contract integration test passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Evidence output:

- `test-output\tauri-release-performance-smoke\tauri-release-performance-smoke.json`
- `test-output\tauri-release-performance-smoke\tauri-release-performance.png`
- `test-output\tauri-release-performance-smoke\album-master-performance\manifest.json`
- `test-output\tauri-release-performance-smoke\album-master-performance\dashboard.html`
- `test-output\tauri-release-performance-smoke\album-master-performance\album_sequence.wav`

Honest gaps after this pass:

- These are local synthetic-fixture measurements, not stable product budgets.
- Representative real-song timing still needs separate measurement.

## Latest Codex Pass: Source Repair Panel

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-release-launch-smoke.mjs`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added a focused source-repair panel in the left rail.
- The panel appears only when one or more tracks have a non-`ok` source health state.
- Each source issue now shows a status chip, friendly detail, `Replace`, and `Remove`.
- Added `Recheck` for current source issues.
- Preserved `sourceStatus` through `snapshotTrack` so source health survives autosave/session restore.
- Updated the WebView UI smoke seed/assertions for source-repair visibility and recheck.
- Extended the packaged release smoke to seed a temporary corrupt-source session, reload the packaged app, verify the repair panel, remove the bad source, and restore the previous recent-session file.

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-release-launch-smoke.mjs
node --check .\tests\tauri-webview-ui-smoke.mjs
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-release
npm run test:tauri-sidecar-startup
cd ..
python -m compileall -q src tests
cd desktop
npm run test:integration
npm run build
cd ..
git diff --check
```

Results:

- Desktop TypeScript/Vite build passed.
- Tauri release package build passed with the repair panel included.
- Release smoke passed through the rebuilt packaged app.
- The first packaged smoke attempt found that `snapshotTrack` was dropping `sourceStatus`; fixed by preserving it in the snapshot path.
- Release smoke source repair evidence:
  - repair panel visible before action: `true`
  - issue count before action: `1`
  - status text: `Unreadable source`
  - issue count after `Remove`: `0`
  - track count after `Remove`: `1`
- Release smoke restored the prior recent-session file after seeding the temporary source-repair session.
- Restored session still points at the prior `Lay the Money on the Desk Album UI Smoke` state.
- Python compileall passed.
- Desktop CLI contract integration test passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- Evidence output:
  - `test-output\tauri-release-launch-smoke\tauri-release-launch-smoke.json`
  - `test-output\tauri-release-launch-smoke\tauri-release-launch.png`

Latest rebuilt package artifacts:

- release EXE: `9805824`
- NSIS setup EXE: `149842681`
- MSI: `177704960`
- engine sidecar: `53809409`

Latest sidecar startup measurements:

- cold `--help`: `2188.5 ms`
- warm `--help`: `2039.1 ms`
- direct `analyze`: `3108.2 ms`

Honest gaps after this pass:

- The packaged release smoke verifies `Remove`; `Replace` still requires a manual file-dialog check or a future dialog-mocking harness.

## Latest Codex Pass: Safe Output/Report Open

Date: 2026-05-12

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/tests/tauri-release-launch-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Hardened `open_path` so it refuses missing paths before spawning Explorer/open/xdg-open.
- Added a React `openLocalPath` helper so output/report buttons log success or failure instead of leaving unhandled invoke promises.
- Wired the helper into:
  - top-bar output folder
  - selected track output folder
  - dashboard HTML
- Extended the release launch smoke to assert a missing path returns a clean `Cannot open missing path` error.

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-release-launch-smoke.mjs
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-release
npm run test:tauri-sidecar-startup
cd ..
python -m compileall -q src tests
cd desktop
npm run test:integration
npm run build
cd ..
git diff --check
```

Results:

- Tauri release package build passed after the `open_path` Rust change.
- Release smoke passed through the rebuilt packaged app.
- Missing open-path error:
  - `Cannot open missing path: C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-release-launch-smoke\inputs\03_missing_fixture.wav`
- Track Master render still passed in the same release smoke.
- No release app process remained after the smoke.
- Python compileall passed after the doc updates.
- Desktop CLI contract integration test passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Latest rebuilt package artifacts:

- release EXE: `9805824`
- NSIS setup EXE: `149842681`
- MSI: `177704960`
- engine sidecar: `53809409`

Honest gaps after this pass:

- Automated smoke verifies the missing-path failure branch. It does not click a real Explorer window for a positive open because that would create OS UI side effects.

## Latest Codex Pass: Source Health / Missing-Corrupt Files

Date: 2026-05-12

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/src/types.ts`
- `desktop/tests/tauri-release-launch-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added the native Tauri command `validate_audio_sources`.
- The command checks source existence, supported extension/folder contents, and FFprobe readability using the bundled FFprobe path in release builds.
- Missing files return `status: "missing"` with a short re-add/remove instruction.
- Corrupt or unreadable files return `status: "unreadable"` with a friendly `detail` plus raw FFprobe text in `diagnostic`.
- The React `Analyze` action now runs this source preflight before calling the Python engine.
- If any selected source is blocked, the app stops analysis cleanly, updates track source-health chips, and logs the first actionable issue.
- The release launch smoke now verifies one readable WAV, one missing WAV path, and one corrupt MP3 fixture before rendering.

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-release-launch-smoke.mjs
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-release
npm run test:tauri-sidecar-startup
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests
cd desktop
npm run test:integration
npm run build
cd ..
git diff --check
```

Results:

- Tauri release package build passed after the Rust command change.
- Release smoke passed through the rebuilt packaged app.
- Source validation statuses:
  - readable WAV: `ok`
  - missing WAV path: `missing`
  - corrupt MP3 fixture: `unreadable`
- Corrupt-file user-facing detail:
  - `FFprobe could not read this audio source. The file may be corrupt or use an unsupported codec.`
- Raw FFprobe output is preserved in `diagnostic`.
- Track Master render still passed after the source-health preflight.
- Python compileall passed.
- Python unit tests passed: `17` tests.
- Desktop CLI contract integration test passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- Evidence output:
  - `test-output\tauri-release-launch-smoke\tauri-release-launch-smoke.json`
  - `test-output\tauri-release-launch-smoke\tauri-release-launch.png`

Latest rebuilt package artifacts:

- release EXE: `9805824`
- NSIS setup EXE: `149842681`
- MSI: `177704960`
- engine sidecar: `53809409`

Honest gaps after this pass:

- The UI has compact source-health chips, not a full source-repair panel.
- Real-world unreadable-codec coverage depends on local FFprobe diagnostics.

## Latest Codex Pass: Sidecar Startup Overhead Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-sidecar-startup-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `npm run test:tauri-sidecar-startup`.
- Added `desktop/tests/tauri-sidecar-startup-smoke.mjs`.
- The smoke runs the packaged PyInstaller sidecar directly from release resources and injects bundled FFmpeg/FFprobe into `PATH`.
- The smoke measures cold `--help`, warm `--help`, and one real `analyze` invocation against a generated WAV fixture.

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-sidecar-startup-smoke.mjs
npm run test:tauri-sidecar-startup
```

Results measured on this machine in this pass:

- engine sidecar:
  - `desktop\src-tauri\target\release\resources\engine\album-master-engine.exe`
  - size: `53809409`
- bundled FFmpeg:
  - size: `148234240`
- bundled FFprobe:
  - size: `148097536`
- cold `--help`: `2188.5 ms`
- warm `--help`: `2039.1 ms`
- direct `analyze`: `3108.2 ms`
- analyze result count: `1`
- waveform bins: `32`
- stderr bytes for all measured commands: `0`
- Evidence output:
  - `test-output\tauri-sidecar-startup-smoke\tauri-sidecar-startup-smoke.json`

Honest gaps after this pass:

- These timings are local machine measurements, not stable product budgets.
- PyInstaller onefile startup overhead remains measurable. If this feels slow in real use, compare PyInstaller onedir or a persistent sidecar engine process.

## Latest Codex Pass: MSI Package Payload Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-msi-package-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `npm run test:tauri-msi`.
- Added `desktop/tests/tauri-msi-package-smoke.mjs`.
- The generated WiX MSI is `perMachine`, so this smoke validates the package payload and launchability without requiring elevation or writing Program Files/HKLM install state.
- The smoke uses WiX `dark.exe` to extract and decompile the MSI:
  - `C:\Users\Daniel Kinsner\AppData\Local\tauri\WixTools314\dark.exe`
- The smoke parses the decompiled WiX XML, maps file-table payload names back to runtime names, and materializes:
  - `album-mastering-studio.exe`
  - `resources\engine\album-master-engine.exe`
  - `resources\ffmpeg\ffmpeg.exe`
  - `resources\ffmpeg\ffprobe.exe`
- It then runs the existing release launch smoke against the materialized MSI payload.
- A prior `msiexec /a` administrative-image attempt timed out and left an empty current-user app key; the key was removed before this passing smoke:
  - `HKCU\Software\album-mastering-studio\Album Mastering Studio`

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-msi-package-smoke.mjs
npm run test:tauri-msi
npm run build
npm run test:integration
cd ..
git diff --check
```

Results:

- MSI package payload smoke passed.
- MSI path:
  - `desktop\src-tauri\target\release\bundle\msi\Album Mastering Studio_0.1.0_x64_en-US.msi`
- MSI size: `177696768`.
- Extracted payload sizes:
  - app EXE: `9791488`
  - engine sidecar: `53810132`
  - FFmpeg: `148234240`
  - FFprobe: `148097536`
- Release launch smoke through the materialized MSI payload passed:
  - app text included `Album Mastering Studio`
  - analysis count: `1`
  - waveform bins: `32`
  - native audio host: `Wasapi`
  - rendered track count: `1`
  - track manifest/dashboard/WAV exist
  - export checks status: `warn`
  - required manifest, track-output, and meter checks passed
- Evidence output:
  - `test-output\tauri-msi-package-smoke\tauri-msi-package-smoke.json`
  - `test-output\tauri-msi-package-smoke\release-launch\tauri-release-launch-smoke.json`
  - `test-output\tauri-msi-package-smoke\release-launch\tauri-release-launch.png`

Cleanup and final checks:

- The MSI extraction image directory was removed after the smoke.
- The materialized app directory was removed after the smoke.
- No release app process remained running after the smoke.
- No Album Mastering Studio uninstall registry key existed under HKCU or HKLM after the smoke.
- No leftover `HKCU\Software\album-mastering-studio\Album Mastering Studio` key existed after the smoke.
- Port `9343` only had a transient `TIME_WAIT` socket after the smoke.
- Desktop TypeScript/Vite build passed after adding the MSI smoke.
- Desktop CLI contract integration test passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Honest gaps after this pass:

- A true elevated MSI install/uninstall smoke is still unverified.
- MSI upgrade behavior from an older installed version is still unverified.

## Latest Codex Pass: NSIS Installed-App Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-nsis-install-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `npm run test:tauri-nsis`.
- Added `desktop/tests/tauri-nsis-install-smoke.mjs`.
- The smoke installs the generated NSIS package as the current user, launches the installed app, renders through the packaged app path, then uninstalls and verifies cleanup.
- The generated NSIS installer uses the current-user default install path:
  - `C:\Users\Daniel Kinsner\AppData\Local\Album Mastering Studio`
- The smoke preflights that this install path and current-user registry keys do not already exist before installing.

Verification already run:

```powershell
cd desktop
node --check .\tests\tauri-nsis-install-smoke.mjs
npm run test:tauri-nsis
npm run build
npm run test:integration
cd ..
git diff --check
```

Results:

- NSIS installed-app smoke passed.
- Install command:
  - `Album Mastering Studio_0.1.0_x64-setup.exe /S /NS`
- Installed app smoke evidence:
  - installed EXE: `C:\Users\Daniel Kinsner\AppData\Local\Album Mastering Studio\album-mastering-studio.exe`
  - app text included `Album Mastering Studio`
  - analysis count: `1`
  - waveform bins: `32`
  - native audio host: `Wasapi`
  - rendered track count: `1`
  - track manifest/dashboard/WAV exist
  - export checks status: `warn`
  - required manifest, track-output, and meter checks passed
- Cleanup evidence:
  - install exit code: `0`
  - launch smoke exit code: `0`
  - uninstall exit code: `0`
  - installed EXE removed
  - install directory removed
  - `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Album Mastering Studio` absent after uninstall
  - `HKCU\Software\Album Mastering Studio` absent after uninstall
- Desktop TypeScript/Vite build passed after adding the NSIS smoke.
- Desktop CLI contract integration test passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- Evidence output:
  - `test-output\tauri-nsis-install-smoke\tauri-nsis-install-smoke.json`
  - `test-output\tauri-nsis-install-smoke\release-launch\tauri-release-launch-smoke.json`
  - `test-output\tauri-nsis-install-smoke\release-launch\tauri-release-launch.png`

Cleanup and final checks:

- No installed app folder remained after the smoke.
- No Album Mastering Studio current-user uninstall registry key remained after the smoke.
- No release app process remained running after the smoke.

Honest gaps after this pass:

- The MSI package still has not been installed and smoke-tested.
- Upgrade behavior from an older installed version is still unverified.

## Latest Codex Pass: Release Package Build / Launch Smoke

Date: 2026-05-12

Changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-release-launch-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

Generated release artifacts:

- `desktop/src-tauri/target/release/album-mastering-studio.exe`
  - size: `9791488`
  - last write: `2026-05-12 01:00:27`
- `desktop/src-tauri/target/release/bundle/nsis/Album Mastering Studio_0.1.0_x64-setup.exe`
  - size: `149834748`
  - last write: `2026-05-12 01:00:27`
- `desktop/src-tauri/target/release/bundle/msi/Album Mastering Studio_0.1.0_x64_en-US.msi`
  - size: `177696768`
  - last write: `2026-05-12 00:58:25`

Release resources confirmed:

- `desktop/src-tauri/target/release/resources/engine/album-master-engine.exe`
  - size: `53810132`
  - last write: `2026-05-12 00:57:28`
- `desktop/src-tauri/target/release/resources/ffmpeg/ffmpeg.exe`
- `desktop/src-tauri/target/release/resources/ffmpeg/ffprobe.exe`

What changed:

- Ran the documented Windows Tauri package build through Visual Studio Build Tools.
- Added `npm run test:tauri-release`.
- Added `desktop/tests/tauri-release-launch-smoke.mjs`, which:
  - launches the built release EXE
  - enables WebView CDP on port `9341`
  - verifies Tauri invoke availability
  - writes a synthetic WAV fixture
  - invokes `native_audio_probe`, `analyze_tracks`, `render_track_master`, and `run_export_checks`
  - asserts the generated manifest, dashboard, and track WAV exist

Verification already run:

```powershell
cd desktop
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
node --check .\tests\tauri-release-launch-smoke.mjs
npm run test:tauri-release
npm run build
npm run test:integration
cd ..
git diff --check
```

Results:

- Full Tauri package build passed.
- Release EXE, MSI, and NSIS bundles were produced.
- Release launch smoke passed:
  - app text included `Album Mastering Studio`
  - analysis count: `1`
  - waveform bins: `32`
  - rendered track count: `1`
  - track manifest/dashboard/WAV exist
  - native audio host: `Wasapi`
  - export checks status: `warn`
  - warning reason: synthetic fixture density triggered the existing limiter-pressure advisory
  - required output checks still passed
- Desktop TypeScript/Vite build passed after the release smoke was added.
- Desktop CLI contract integration test passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- Evidence output:
  - `test-output\tauri-release-launch-smoke\tauri-release-launch-smoke.json`
  - `test-output\tauri-release-launch-smoke\tauri-release-launch.png`

Cleanup and final checks:

- No release app process remained running after the smoke.
- Port `9341` only showed normal `TimeWait` cleanup immediately after process exit.

Honest gaps after this pass:

- The built MSI/NSIS installers were not installed onto this machine.
- This pass proves the release EXE and package resources launch and render through the sidecar; it does not prove installer upgrade/uninstall behavior.

## Latest Codex Pass: Sidecar Refresh / Boundary Package Smoke

Date: 2026-05-12

Changed files in this pass:

- `docs/progress.md`
- `docs/codex-active-handoff.md`

Generated resources refreshed by the normal sidecar build:

- `desktop/src-tauri/resources/engine/album-master-engine.exe`
- `desktop/src-tauri/resources/ffmpeg/ffmpeg.exe`
- `desktop/src-tauri/resources/ffmpeg/ffprobe.exe`

What changed:

- Rebuilt the bundled Python sidecar with the current source engine after the boundary primitive slice.
- Refreshed bundled FFmpeg/FFprobe resources through `desktop/scripts/prepare-sidecars.ps1`.
- Confirmed the rebuilt engine resource:
  - size: `53808973`
  - last write: `2026-05-12T00:30:21-07:00`
- Ran a direct sidecar render smoke with a generated two-track boundary project.

Verification already run:

```powershell
cd desktop
npm run build:sidecars
cd ..
.\desktop\src-tauri\resources\engine\album-master-engine.exe --help
.\desktop\src-tauri\resources\engine\album-master-engine.exe render-project .\test-output\sidecar-boundary-smoke\boundary.ams.json --output .\test-output\sidecar-boundary-smoke\render
cd desktop
npm run build
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..\..
python -m unittest tests.test_pipeline.PipelineTest.test_project_boundary_primitives_render_without_generated_interludes
```

Results:

- `npm run build:sidecars` passed.
- `album-master-engine.exe --help` returned the expected command list.
- Direct sidecar boundary smoke passed:
  - `AlbumSequenceExists: true`
  - `InterludeCount: 0`
  - `SequenceTypes: track,boundary,track`
  - `CueTypes: track,boundary,track`
  - `GeneratedTransitions: false`
  - `BoundaryStyle: gap`
  - `BoundaryDuration: 0.5`
- Desktop build passed.
- Rust `cargo check` passed.
- Focused Python boundary primitive regression passed.

Cleanup and final checks:

- No Tauri dev server was running for this pass.
- Ports `1420` and `9340` were clear at the start of the pass.
- The sidecar smoke output remains under ignored `test-output\sidecar-boundary-smoke`.

Honest gaps after this pass:

- Full installer packaging was not run.
- No release EXE launch smoke was run.
- Generated sidecar resources do not appear in `git status`, consistent with the repo's ignored generated artifact policy.

## Latest Codex Pass: Boundary Primitives / Dev Engine Source Loop

Date: 2026-05-12

Changed files in this pass:

- `src/album_mastering_studio/pipeline.py`
- `tests/test_pipeline.py`
- `desktop/src-tauri/src/lib.rs`
- `desktop/src/types.ts`
- `desktop/src/App.tsx`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added non-generated Album Master boundary primitives to the Python project/render contract:
  - `direct`
  - `gap`
  - `fade`
  - `ring-out`
  - `crossfade`
- Extended transition rows with `boundary_style` and `boundary_duration_seconds`.
- Generated interludes still use the existing `enabled: true` transition path.
- Boundary primitives run when generated interludes are disabled.
- Manifests now preserve boundary settings and add `sequence` entries of type `boundary` for non-direct primitives.
- Gap and crossfade boundaries produce cue chunks of type `boundary`.
- Disabled/generated-off transitions no longer apply album edge-treatment moves to individual masters.
- Added Tauri controls for `Boundary` and `Boundary Seconds`.
- User preset/settings-chain storage includes boundary fields.
- Fixed the Tauri dev engine loop:
  - debug/dev builds now prefer source Python
  - release builds still prefer bundled `album-master-engine.exe`
  - `ALBUM_MASTER_USE_SIDECAR=1` can force sidecar use in debug
  - `ALBUM_MASTER_ENGINE` remains the hard override

Verification already run:

```powershell
cd desktop
node --check tests/tauri-webview-runtime-smoke.mjs
node --check tests/tauri-webview-ui-smoke.mjs
node --check tests/tauri-real-song-album-ui-smoke.mjs
npm run build
cd ..
python -m unittest tests.test_pipeline.PipelineTest.test_disabled_project_transitions_preserve_direct_album_boundaries tests.test_pipeline.PipelineTest.test_project_boundary_primitives_render_without_generated_interludes
python -m compileall -q src tests
python -m unittest discover -s tests
cd desktop
npm run test:integration
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" fmt
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
```

Live Tauri verification already run:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9340'
npm run test:tauri-webview
npm run test:tauri-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='20'
npm run test:tauri-real-song-album-playback
```

Results:

- Static checks, desktop build, targeted boundary regressions, all Python unit tests, desktop integration, Rust format, and Rust check passed.
- First live runtime attempt failed because debug Tauri was using the stale frozen sidecar. After the Rust launcher fix, `npm run test:tauri-webview` passed.
- Runtime WebView boundary evidence:
  - `boundaryAlbumSequenceExists: true`
  - `boundaryInterludeCount: 0`
  - `boundarySequenceTypes: track,boundary,track`
  - `boundaryCueTypes: track,boundary,track`
  - `boundarySettings.generated_transitions: false`
  - `boundarySettings.default_boundary_style: gap`
  - `boundarySettings.default_boundary_duration: 0.5`
- Broad UI smoke evidence:
  - `generatedTransitionsDefaultOff: true`
  - `generatedTransitionsOptIn: true`
  - `boundaryDefaultDirect: true`
  - `boundaryGapSelected: true`
  - `boundaryDurationReadout: 3.0 s`
- Real-song Album Master smoke still passed with generated transitions explicitly enabled:
  - `manifestInterludeCount: 2`
  - export receipt status `pass`
  - 20-second native playback with `stream_errors: []`

Cleanup and final checks:

- Hidden Tauri/Vite/WebView processes were stopped.
- Ports `1420` and `9340` were confirmed clear.
- Temporary logs `test-output\tauri-dev-9340.out.log` and `test-output\tauri-dev-9340.err.log` were removed.

Honest gaps after this pass:

- Boundary controls are global album settings, not per-transition settings yet.
- Fade and ring-out are covered by engine code paths but not yet by a dedicated WebView render assertion.
- Human listening approval is still required for musical quality.
- Release sidecar was not rebuilt in this pass; debug Tauri now uses source Python so dev tests reflect current source, while release packaging still needs its normal `build:sidecars`/installer gate.

## Latest Codex Pass: Album Boundary Defaults / Transition Opt-In

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/types.ts`
- `desktop/src/App.tsx`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
- `tests/test_pipeline.py`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `transitionsEnabled` to the Tauri settings model.
- Default Album Master behavior now preserves direct boundaries; generated transitions are off until the user opts in.
- Added a visible Album Master `Generated transitions` checkbox.
- Save Project and Album render now write transition rows with `enabled: false` by default, plus `generated_transitions: false` in project settings.
- Project loading respects explicit `generated_transitions` and infers opt-in for older projects that already have enabled transition rows.
- Real-song Album Master smoke now opts into generated transitions explicitly, preserving the previous generated-interlude coverage.
- Added a Python regression test for all-disabled project transitions preserving direct album boundaries.

Verification already run:

```powershell
cd desktop
node --check tests/tauri-webview-ui-smoke.mjs
node --check tests/tauri-real-song-album-ui-smoke.mjs
npm run build
cd ..
python -m unittest tests.test_pipeline.PipelineTest.test_disabled_project_transitions_preserve_direct_album_boundaries
python -m compileall -q src tests
python -m unittest discover -s tests
cd desktop
npm run test:integration
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
```

Live Tauri verification already run:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9338'
npm run test:tauri-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='20'
npm run test:tauri-real-song-album-playback
```

Results:

- Static checks, desktop build, targeted Python boundary regression, all Python unit tests, desktop integration, and Rust check passed.
- `npm run test:tauri-ui` passed and includes:
  - `generatedTransitionsDefaultOff: true`
  - `generatedTransitionsOptIn: true`
- `npm run test:tauri-real-song-album-playback` passed with opt-in transitions and includes:
  - `generatedTransitionsEnabled: true`
  - `manifestInterludeCount: 2`
  - `sequenceInterludeCount: 2`
  - export receipt status: `pass`
  - 20-second native playback with `stream_errors: []`

Cleanup and final checks:

- Hidden Tauri/Vite/WebView processes were stopped.
- Ports `1420` and `9338` were confirmed clear.
- Temporary logs `test-output\tauri-dev-9338.out.log` and `test-output\tauri-dev-9338.err.log` were removed.

Honest gaps after this pass:

- Gap/crossfade/fade/ring-out primitive UI is still missing.
- Generated interludes remain available but still need human listening review before they can be treated as a quality default.
- The engine contract still defaults `create_project` transitions to enabled for CLI-created projects; the Tauri product path now stores and renders the safer default.

## Latest Codex Pass: Export Checks / Quality Receipt

Date: 2026-05-12

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added Rust/Tauri `run_export_checks`.
- The command takes a render manifest and returns a local/offline quality receipt with overall status, summary counts, per-check rows, and render warnings.
- Receipt checks cover manifest shape, rendered track outputs, finite meter values, Album WAV, Codec QC, and advisory warnings.
- Rendered track outputs, Album WAV, and codec-preview outputs must exist on disk for their checks to pass.
- The Tauri surface now runs export checks after Track Master export, Album Master export, and render-faithful Track preview.
- The `Quality Checks` panel now shows a current-render export receipt with per-check details.
- Stale/dirty paths clear the receipt when settings or track data changes.
- WebView runtime smoke now asserts the typed command contract for Track Master and Album Master manifests.
- Real-song Album Master UI smoke now asserts the visible receipt and verifies `Track outputs` and `Album WAV` pass on the MP3-derived album fixture.

Verification already run:

```powershell
cd desktop
node --check tests/tauri-webview-runtime-smoke.mjs
node --check tests/tauri-real-song-album-ui-smoke.mjs
npm run build
npm run test:integration
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..\..
python -m compileall -q src tests
python -m unittest discover -s tests
```

Live Tauri verification already run:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9337'
npm run test:tauri-webview
npm run test:tauri-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='20'
npm run test:tauri-real-song-album-playback
```

Results:

- Static checks, desktop build, Rust check, Python compile, Python unit tests, and desktop integration test passed.
- `npm run test:tauri-webview` passed and includes:
  - Track Master receipt: `warn`, `1 track(s), 0 transition(s), 1 warning(s)`
  - Album Master receipt: `warn`, `2 track(s), 1 transition(s), 2 warning(s)`
  - labels: `Manifest`, `Track outputs`, `Meter values`, `Album WAV`, `Codec QC`, `Advisory warnings`
- `npm run test:tauri-ui` passed after receipt UI/style changes.
- `npm run test:tauri-real-song-album-playback` passed and includes:
  - visible export receipt after render
  - real-song receipt status: `pass`
  - real-song summary: `3 track(s), 2 transition(s), 0 warning(s)`
  - `Track outputs`: `pass`
  - `Album WAV`: `pass`
  - 20-second native album playback: `played_output_frames: 960000`, `stream_errors: []`

Cleanup and final checks:

- Hidden Tauri/Vite/WebView processes were stopped.
- Ports `1420` and `9337` were confirmed clear.
- Temporary logs `test-output\tauri-dev-9337.out.log` and `test-output\tauri-dev-9337.err.log` were removed.

Honest gaps after this pass:

- The receipt is an artifact sanity check, not release-grade metering.
- Human listening approval is still required.
- The receipt is latest-render oriented; no render-history browser exists yet.
- Track Master multi-export still presents the latest manifest receipt rather than a full batch receipt.

## Latest Codex Pass: User Presets / Settings Chain

Date: 2026-05-12

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added local/offline Tauri commands:
  - `list_user_presets`
  - `save_user_preset`
- User presets live under `Documents\Album Mastering Studio\State\user-presets.json`.
- Presets store reusable mastering settings chains only, not output paths, source paths, artist metadata, or project names.
- Added a `User Presets` panel in the controls rail with name input, `Save`, saved preset selector, and `Apply`.
- Applying a preset uses the existing settings update path, so previews/renders become stale honestly.
- The broad UI smoke backs up and restores `user-presets.json` to avoid leaving test presets behind.

Verification already run:

```powershell
cd desktop
node --check tests/tauri-webview-ui-smoke.mjs
npm run build
npm run test:integration
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..\..
python -m compileall -q src tests
```

Live Tauri verification already run:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9336'
npm run test:tauri-ui
```

Results:

- `npm run test:tauri-ui` passed.
- Evidence included `userPresetSaved: true`, `userPresetApplied: true`, and `userPresetListCount: 1`.
- Existing UI smoke coverage still passed for Album Story / Roles, autosaved listening checklist, Live Preview, Native transport ready status, Volume Match, waveform region selection, and loop state.

Cleanup and final checks:

- `git diff --check` passed with only normal LF-to-CRLF warnings.
- Hidden Tauri/Vite/WebView processes were stopped.
- Ports `1420` and `9336` were confirmed clear.
- Temporary logs `test-output\tauri-dev-9336.out.log` and `test-output\tauri-dev-9336.err.log` were removed.

Honest gaps after this pass:

- No delete/rename/import/export preset UI yet.
- No render-history library yet.
- User presets do not sync across machines unless the state file is manually moved.
- Human listening approval and true multi-song testing still remain.

## Latest Codex Pass: Album Story / Roles Review

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/src/types.ts`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added an `Album Story / Roles` review block to the Album Master controls rail.
- It shows one card per track, with likely sequence role, likely/manual/rendered character, confidence/status, and rationale.
- Before render it uses humble analysis/position-based language so the user can review roles after analysis and before export.
- After a current render it uses manifest-backed `album_story`, per-track `character`, `arc.role`, and rationale data.
- Each card includes an `Override role` select that writes to the existing per-track `character` field, preserving the Python project/engine contract.

Verification already run:

```powershell
cd desktop
node --check tests/tauri-webview-ui-smoke.mjs
node --check tests/tauri-real-song-album-ui-smoke.mjs
npm run build
npm run test:integration
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..\..
python -m compileall -q src tests
```

Live Tauri verification already run:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9335'
npm run test:tauri-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='20'
npm run test:tauri-real-song-album-playback
```

Results:

- `npm run test:tauri-ui` passed and verifies the visible Album Story / Roles panel, 2 role cards, editable role override, and autosave persistence.
- `npm run test:tauri-real-song-album-playback` passed and verifies the story panel before render, 3 role cards, `Album Clip 2` override to `heavy_djent`, rendered manifest override preservation, non-empty manifest album story, and previous native Album WAV playback checks.
- Real-song album playback stability in that run: 20 seconds, `callback_count: 2000`, `played_output_frames: 960000`, `p95_callback_interval_ms: 10.616`, `max_callback_interval_ms: 10.985`, `stream_errors: []`, `warnings: []`.

Cleanup and final checks:

- `git diff --check` passed with only normal LF-to-CRLF warnings.
- Hidden Tauri/Vite/WebView processes were stopped.
- Ports `1420` and `9335` were confirmed clear.
- Temporary logs `test-output\tauri-dev-9335.out.log` and `test-output\tauri-dev-9335.err.log` were removed.

Honest gaps after this pass:

- The role preview is useful and reviewable, but it is not a robust genre classifier.
- Human listening approval has not happened.
- True multi-song album testing still needs separate real songs from the user.
- Native full-file playback is still pre-buffered playback-cache WAV transport, not a streaming native engine.

## Latest Codex Pass: Native Full-File Transport Slice

Date: 2026-05-12

Reason for immediate handoff update:

- The user warned the thread may hit rate limits.
- This section is written before the final long real-song Album UI smoke so another Codex instance can resume without guessing.

Changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `desktop/tests/tauri-real-song-native-ui-smoke.mjs`
- `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
- `docs/codex-active-handoff.md`
- `docs/progress.md`
- `docs/ENGINE_DECISION_RECORD.md`

What changed:

- Added Rust/Tauri `start_native_file_playback`.
- The new command takes a prepared playback WAV path, optional label, start time, and max duration, then starts a reusable native CPAL playback session.
- Reused the existing native session state for status, pause, seek, resume, stop, callback telemetry, warnings, and output-device reporting.
- Changed `read_pcm16_wav_segment` to accept an optional duration, while keeping probe and A/B callers bounded.
- Added a one-hour hard cap for full-file native playback buffering via `NATIVE_FILE_PLAYBACK_MAX_MS`.
- Added a visible `Native Play` / `Native Stop` button in the main transport for the current prepared transport item.
- Kept `Native A/B` as the bounded source/master comparison loop.
- Made pause/resume/status/seek copy generic enough for both native A/B and native file playback.
- Renamed the slider aria label to `Native playback position`.
- Extended runtime WebView smoke to invoke `start_native_file_playback`, pause it, seek it, resume it, and stop it.
- Updated the real-song native A/B UI smoke for the renamed native position slider.
- Extended the real-song Album UI smoke so it drives visible `Native Play`, pause/resume, seek, and stop for `album_sequence.wav`.

Verification already run in this slice:

```powershell
cd desktop
node --check tests/tauri-webview-runtime-smoke.mjs
node --check tests/tauri-real-song-album-ui-smoke.mjs
node --check tests/tauri-real-song-native-ui-smoke.mjs
npm run build
npm run test:integration
cd ..
python -m compileall -q src tests
cd desktop\src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
```

Results:

- Node syntax checks passed for the changed WebView smoke files.
- Rust `cargo check` passed after fixing two patching mistakes.
- Desktop TypeScript/Vite build passed.
- Desktop integration test passed.
- Python compile passed.

Live Tauri verification already run:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9334'
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
cd desktop
npm run tauri:dev
```

Then, against the live app:

```powershell
$env:TAURI_CDP_PORT='9334'
npm run test:tauri-webview
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-native-ui
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='20'
npm run test:tauri-real-song-album-playback
```

Results:

- `npm run test:tauri-webview` passed.
- Runtime smoke verified `start_native_file_playback` through the real Tauri WebView, including active status, pause, seek, resume, stop, stream error array, and warning array.
- `npm run test:tauri-real-song-native-ui` passed against the provided MP3.
- Track Master visible native A/B still works after the generic native slider rename.
- `npm run test:tauri-real-song-album-playback` passed against the provided MP3.
- Album Master visible native file transport verified `Native Play`, `Pause`, slider seek to 2.0s, `Resume`, `Native Stop`, and `Native transport ready` after stop.
- Album WAV native stability probe ran for 20 seconds with `callback_count: 2000`, `played_output_frames: 960000`, `p95_callback_interval_ms: 10.63`, `max_callback_interval_ms: 10.734`, `stream_errors: []`, and `warnings: []`.

Current live process state if this handoff is picked up mid-run:

- Vite dev server is listening on `127.0.0.1:1420`, owning process observed as `7856`.
- WebView2 CDP is listening on `127.0.0.1:9334`, owning process observed as `19216`.
- Tauri app process observed as `album-mastering-studio.exe`, process `46776`.
- Hidden dev logs are `test-output\tauri-dev-9334.out.log` and `test-output\tauri-dev-9334.err.log`.

Safe cleanup command after live smokes:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*album-mastering-studio*tauri*' -or $_.ProcessId -in @(46776,19216,7856,34964) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath test-output\tauri-dev-9334.out.log,test-output\tauri-dev-9334.err.log -Force -ErrorAction SilentlyContinue
```

Immediate next commands to run if continuing:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9334'
npm run test:tauri-ui
cd ..
git diff --check
```

Post-album-smoke update:

- `npm run test:tauri-ui` passed against the same live Tauri app on CDP port `9334`.
- This rechecked the broad UI smoke after adding the `Native Play` transport button.
- `git diff --check` passed with only normal LF-to-CRLF warnings.
- Hidden Tauri/Vite/WebView processes were stopped.
- Ports `1420` and `9334` were confirmed clear.
- Temporary logs `test-output\tauri-dev-9334.out.log` and `test-output\tauri-dev-9334.err.log` were removed.

Honest gaps after this slice:

- The new native full-file transport is pre-buffered playback-cache WAV playback, not a streaming native engine.
- Live Preview remains approximate Web Audio; rendered previews/exports remain the render-faithful Python-engine path.
- Real-song Album UI smoke with visible Native Play passed for the provided MP3-derived album fixture.
- Human listening approval has not happened.
- A true multi-song album has not been tested because only one real MP3 is currently available; the album smoke derives multiple clips from that one song.
- Full native transport cancel/streaming architecture remains future work.

## Latest Codex Pass: Track Master Rebuild Slice

Date: 2026-05-12

Changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/src/types.ts`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Rebuilt the Tauri frontend around a Track Master-first workstation.
- Added `Track Master` / `Album Master` mode switch.
- Track Master now has imported-track rail, large waveform area, zoom, drag region selection, selected-region loop, Original/Mastered A/B, optional Volume Match off by default, product preset tiles, Intensity, Low/Mid/High EQ, collapsed advanced controls, quality warnings, and independent multi-track export.
- Independent Track Master export renders each imported track as a separate one-track project under a timestamped `track-master-*` output root.
- Album Master remains reachable with album export, masters-only export, arc/transition controls, per-track role/preset overrides, continuous album playback, transition playback, and dashboard embedding.
- Frontend `Track` now stores mastered analysis, selected-track quality warnings, and last output folder metadata.
- CSS moved away from the earlier neon/dark shell toward a restrained hardware-console palette.

Verification run:

```powershell
cd desktop
npm run build
npm run test:integration
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-track-master-rebuild-smoke
```

Results:

- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track transition, and 8-track workflow.
- Vite dev server returned HTTP 200 on `http://127.0.0.1:1420`; no visual screenshot was captured because this shell did not expose `msedge` or `chrome` as a headless screenshot command.

Honest gaps after this pass:

- New Track Master UI needs a live Tauri/manual exercise on real or private fixture audio.
- Waveform drag selection and selected-region loop are implemented but not manually verified in the webview.
- Track preview still uses whole-track offline render through Python, not real-time DSP.
- Volume Match uses source/master LUFS values from available analysis/preview data and only changes playback volume.
- Autosave and undo/redo are still pending.
- Rust/Tauri commands are still generic CLI bridge calls, not typed product commands.
- Native audio/real-time audition spike has not started.

Recommended next slice:

1. Run the Tauri app on real/private fixture audio and exercise the new Track Master path end to end.
2. Then pick either typed Rust command foundation or native/real-time audition spike based on what feels weakest in real use.

## Latest Codex Pass: Autosave And Undo/Redo

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added Rust/Tauri `autosave_session` and `load_recent_session` commands.
- Recent sessions now write to:

```text
Documents\Album Mastering Studio\State\recent-session.json
```

- The frontend restores the recent session on startup when present.
- Added undo/redo history for non-destructive user state: mode, settings, presets, tuning, metadata, track edits, order, roles, album arc, and transition settings.
- Added Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, and toolbar Undo/Redo buttons.
- Undo/redo invalidates preview/render pointers; it restores the session state but does not delete rendered files.

Verification run:

```powershell
cd desktop
npm run build
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
npm run test:integration
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-autosave-undo-smoke
```

Results:

- Desktop TypeScript/Vite build passed.
- Rust/Tauri `cargo check` passed with the explicit local cargo path. Plain `cargo` was not on PATH in this shell.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track transition, and 8-track workflow.

Honest gaps after this pass:

- Autosave/undo/redo lack a dedicated UI automation test.
- Startup restore and keyboard shortcuts have not been manually exercised in a running Tauri webview.
- Render history/library remains future work; this only protects editable session state.

Recommended next slice now:

1. Manual Tauri run with fixture audio to exercise: startup restore, add/analyze, preset/tuning edits, Ctrl+Z/Ctrl+Shift+Z, preview, A/B, region loop, Track Master export, and Album Master export.
2. Then move to either typed Rust product commands or the native/real-time audition spike.

## Latest Codex Pass: Typed Product Commands

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/src/types.ts`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added typed Rust/Tauri commands for `analyze_tracks`, `render_track_master`, and `render_album_master`.
- Kept the Python CLI/sidecar as the engine contract, but moved project writing, render invocation, manifest loading, local scoring, and dashboard export behind typed product commands.
- Switched the primary frontend analysis, Track Master export, Album Master render, and preview render paths away from raw CLI argument arrays.
- Left generic `read_json`/`write_project` in place for project open/save.
- Left Rust `run_cli` in place as a fallback bridge, but it is not used by the primary frontend product flows.

Verification run:

```powershell
cd desktop
npm run build
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
npm run test:integration
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-typed-commands-smoke
```

Results:

- Desktop TypeScript/Vite build passed.
- Rust/Tauri `cargo check` passed with the explicit local cargo path.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track transition, and 8-track workflow.
- Smoke output folder: `test-output\codex-typed-commands-smoke`.
- Eight-track smoke warnings: 0.
- `git diff --check` passed. Git reported normal LF-to-CRLF working-copy warnings only.
- Browser visual sanity check initially caught a blank-screen crash when opening the Vite surface outside Tauri because `getCurrentWindow()` was called without Tauri runtime metadata.
- Fixed browser/dev preview by guarding Tauri-only window/drop-event hooks. The Tauri runtime path is preserved; browser preview now skips those hooks instead of crashing.
- Re-ran `npm run build`, `npm run test:integration`, and `git diff --check` after that fix.
- Vite dev server returned HTTP 200 on `http://127.0.0.1:1420`, and the in-app browser DOM/screenshot showed the Track Master shell rendering.

Honest gaps after this pass:

- No dedicated automated UI coverage yet for invoking the typed commands from an actual Tauri webview.
- Runtime invocation of the typed commands still needs a live Tauri/webview exercise on real or fixture audio.

Recommended next slice now:

1. Live Tauri/manual exercise on real or fixture audio: startup restore, add/analyze, preset/tuning edits, undo/redo, preview, A/B, region loop, Track Master export, and Album Master export.
2. Then continue into the native/real-time audition spike if the offline preview loop still feels too slow or indirect.

## Latest Codex Pass: Tauri WebView Runtime Smoke Harness

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Proved a live Tauri/WebView2 verification path using `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`.
- Added `npm run test:tauri-webview`, which connects to the running Tauri WebView through CDP, synthesizes local WAV fixtures, invokes Tauri commands from inside the actual WebView, and verifies generated artifacts.
- The smoke exercises:
  - `analyze_tracks`
  - `render_track_master`
  - `prepare_playback_file`
  - `render_album_master`
- The smoke validates analysis rows, waveform bins, Track Master manifest/dashboard/master WAV, playback-cache WAV, Album Master manifest/dashboard, `album_sequence.wav`, and a WebView screenshot.

How to run the live WebView smoke:

```powershell
cd desktop
cmd /c 'set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222" && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:dev'
```

In a second shell:

```powershell
cd desktop
npm run test:tauri-webview
```

Verification run:

```powershell
cd desktop
npm run test:tauri-webview
npm run build
npm run test:integration
cd ..
git diff --check
```

Results:

- `npm run test:tauri-webview` passed against the running Tauri WebView.
- Runtime smoke evidence: `test-output\tauri-webview-runtime-smoke\tauri-webview-runtime-smoke.json`.
- Tauri WebView screenshot: `test-output\tauri-webview-runtime-smoke\tauri-webview.png`.
- Desktop TypeScript/Vite build passed after adding the harness.
- Desktop CLI contract test passed after adding the harness.
- `git diff --check` passed. Git reported normal LF-to-CRLF working-copy warnings only.

Honest gaps after this pass:

- This is real Tauri/WebView command execution, but not full UI clicking through Add/Analyze/Export controls.
- The harness does not test file picker interactions.
- It verifies runtime command/artifact behavior, not subjective listening quality.
- Real-time or near-real-time audition remains unimplemented.

Recommended next slice now:

1. Add UI-level automation on top of the WebView CDP path where practical: button state, mode switch, preset control changes, stale preview state, undo/redo, region selection.
2. Then continue into the native/real-time audition spike and `docs/ENGINE_DECISION_RECORD.md`.

## Latest Codex Pass: Tauri WebView UI Smoke Harness

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `npm run test:tauri-ui`, a live Tauri/WebView UI smoke that connects over WebView2 CDP.
- The smoke temporarily seeds the app autosave with two synthetic analyzed tracks, backs up/restores `Documents\Album Mastering Studio\State\recent-session.json`, and verifies React UI behavior without using the native file picker.
- The smoke verifies initial Track Master mode, seeded track rail, preset tile state, undo/redo, Album Master mode switch, advanced controls, Volume Match, zoom readout, waveform drag region selection, loop enable/active state, clear-region behavior, and screenshot capture.

How to run the live UI smoke:

```powershell
cd desktop
cmd /c 'set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222" && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:dev'
```

In a second shell:

```powershell
cd desktop
npm run test:tauri-ui
```

Verification run:

```powershell
cd desktop
npm run test:tauri-ui
npm run test:tauri-webview
npm run build
npm run test:integration
cd ..
python -m compileall -q src tests
git diff --check
```

Results:

- `npm run test:tauri-ui` passed against the running Tauri WebView.
- UI smoke evidence: `test-output\tauri-webview-ui-smoke\tauri-webview-ui-smoke.json`.
- UI smoke screenshot: `test-output\tauri-webview-ui-smoke\tauri-webview-ui.png`.
- `npm run test:tauri-webview` still passed after adding the UI harness.
- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Python compile passed.
- `git diff --check` passed. Git reported normal LF-to-CRLF working-copy warnings only.
- The Tauri dev app and ports `1420` / `9222` were stopped after verification.

Honest gaps after this pass:

- Native file picker interactions are still not automated.
- Region creation is verified as UI state, but the smoke does not load audio metadata, so the region time readout remains `00:00 - 00:00`.
- Listening quality and real-time/near-real-time audition remain unverified and unimplemented.

Recommended next slice now:

1. Start `docs/ENGINE_DECISION_RECORD.md` with a real-time audition spike plan and baseline options.
2. Prototype the least risky near-real-time path for basic Track Master controls, or explicitly document why the next architectural route should be Rust native audio/JUCE instead of continuing browser audio.

## Latest Codex Pass: Real-Time Audition Baseline

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added a temporary Web Audio `Live Preview` baseline to Track Master source playback.
- The live path wires Low/Mid/High EQ, a simple mid/side width matrix, positive Intensity compression, and existing Volume Match playback gain.
- Added 15 ms parameter smoothing.
- Added a `Live Preview` button and status readout; the Tauri WebView reported about `10 ms` Web Audio context latency when armed in the smoke.
- Added `liveAudition` to autosaved/restored session state.
- Created `docs/ENGINE_DECISION_RECORD.md`, with the current recommendation to keep Python for offline render, keep Tauri as the shell, use Web Audio only as temporary scaffolding, and run a Rust native audio spike before release-candidate claims.
- Extended `npm run test:tauri-ui` to verify the `Live Preview` toggle in the actual Tauri WebView.

Verification run:

```powershell
cd desktop
npm run build
npm run test:tauri-ui
npm run test:integration
cd ..
python -m compileall -q src tests
```

Results:

- Desktop TypeScript/Vite build passed.
- `npm run test:tauri-ui` passed against the running Tauri WebView and verified `Live Preview armed ~10 ms`.
- Desktop CLI contract test passed.
- Python compile passed.

Honest gaps after this pass:

- Web Audio is not export-parity-safe with the Python offline mastering chain.
- No human listening pass yet.
- No long-running playback CPU/memory/jitter profiling yet.
- The Rust native audio spike remains necessary before Track Master can be called release-candidate.

Recommended next slice now:

1. Add a Rust native audio spike plan/prototype path under the engine decision record.
2. Measure sustained playback/control-change stability on real or longer fixture audio.
3. Decide whether browser audio remains only a helper or is removed once native audio exists.

## Latest Codex Pass: Native Audio Probe

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/Cargo.lock`
- `desktop/src-tauri/src/lib.rs`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `cpal` to the Tauri Rust layer.
- Added typed Tauri command `native_audio_probe`.
- The probe reports host, available hosts, default output device, default output config, supported output config ranges, fixed-buffer latency estimate when available, and warnings.
- Extended `npm run test:tauri-webview` so the live Tauri WebView runtime smoke invokes `native_audio_probe` before typed analyze/render commands.

Runtime evidence from this machine:

```json
{
  "host": "Wasapi",
  "available_hosts": ["Wasapi"],
  "default_output_device": "Speakers (Focusrite USB Audio)",
  "default_output_config": {
    "channels": 2,
    "sample_rate": 48000,
    "sample_format": "F32",
    "buffer_size": "default"
  },
  "estimated_default_buffer_ms": null
}
```

Verification run:

```powershell
cd desktop\src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..
npm run test:tauri-webview
npm run test:tauri-ui
npm run build
npm run test:integration
cd ..
python -m compileall -q src tests
git diff --check
```

Results:

- Rust/Tauri `cargo check` passed after adding `cpal`.
- `npm run test:tauri-webview` passed against the running Tauri WebView and captured native-audio probe evidence.
- `npm run test:tauri-ui` still passed.
- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Python compile passed.
- `git diff --check` passed. Git reported normal LF-to-CRLF working-copy warnings only.

Honest gaps after this pass:

- Rust can see the native output device, but no native stream has been opened yet.
- The default buffer is not fixed, so exact native latency must be measured during playback.
- No callback cadence, dropout, or CPU/memory measurement yet.
- No native source/master A/B playback yet.

This recommendation was completed in the following pass.

## Latest Codex Pass: Native Stream Cadence Probe And Real-Song Track Master Test

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added typed Tauri command `native_audio_stream_probe`.
- The command opens the default `cpal` output stream, writes silence for a bounded duration, records callback timestamps/frame counts, captures stream errors, and tears the stream down.
- Registered the command in the Tauri invoke handler.
- Extended `npm run test:tauri-webview` so the live Tauri WebView runtime smoke invokes both `native_audio_probe` and `native_audio_stream_probe` before typed analyze/render commands.

Native stream evidence from this machine:

```json
{
  "host": "Wasapi",
  "default_output_device": "Speakers (Focusrite USB Audio)",
  "default_output_config": {
    "channels": 2,
    "sample_rate": 48000,
    "sample_format": "F32",
    "buffer_size": "default"
  },
  "requested_duration_ms": 750,
  "elapsed_ms": 760.7625,
  "callback_count": 75,
  "total_frames": 36576,
  "observed_callback_frames": [480, 1056],
  "min_callback_interval_ms": 8.598,
  "avg_callback_interval_ms": 9.998351351351351,
  "p95_callback_interval_ms": 10.786,
  "max_callback_interval_ms": 11.151,
  "stream_errors": [],
  "warnings": []
}
```

Real-song Track Master test:

- User provided local fixture: `C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3`.
- Ran an ad hoc live Tauri WebView command-path test against it without hardcoding the path into the committed smoke harness.
- Invoked `analyze_tracks`, `render_track_master`, and `prepare_playback_file`.
- Output folder: `test-output\real-song-track-master`.
- Produced mastered WAV, manifest, scorecard, dashboard, project JSON, and playback-cache WAV.
- Result: 1 track, 0 interludes, 0 render warnings.
- Source analysis: `-12.44 LUFS`, `-0.43 dBFS` true-peak proxy.
- Render analysis: `-15.80 LUFS`, `-3.37 dBFS` true-peak proxy.
- Character inference: `acoustic_folk` at confidence `0.5463`.
- Local scorecard overall: `0.8462`.

Verification run:

```powershell
cd desktop\src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..
npm run test:tauri-webview
npm run test:tauri-ui
npm run build
npm run test:integration
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\native-stream-cadence-smoke
git diff --check
```

Results:

- Rust/Tauri `cargo check` passed.
- `npm run test:tauri-webview` passed and captured native stream cadence evidence.
- `npm run test:tauri-ui` passed.
- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders.
- Real-song Track Master command-path test passed.
- `git diff --check` passed before doc edits. Re-run it after any further doc changes.

Honest gaps after this pass:

- Native stream probe is silence-only; it is not native playback.
- No native decode, source/master toggle, region loop, or gain-matched A/B exists yet.
- No sustained native playback CPU/memory/dropout measurement yet.
- Web Audio `Live Preview` remains the only in-UI live audition path.

Recommended next slice now:

1. Build a native playback-cache reader/player path for the already-rendered browser-safe WAV files.
2. Add a Rust-side source/master toggle proof with bounded region playback, still behind a probe/test command if the UI wiring would slow the loop.
3. Measure callback cadence and stream errors while reading actual audio rather than silence.

The first and third items were completed in the following pass for cached WAV playback. Source/master A/B and region looping remain open.

## Latest Codex Pass: Native Playback Cache Probe

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added typed Tauri command `native_playback_file_probe`.
- The command reads a bounded segment from the existing playback-cache WAV created by `prepare_playback_file`.
- The accepted input format is intentionally narrow: RIFF/WAVE PCM 16-bit stereo 48 kHz, matching the FFmpeg-normalized cache boundary.
- It writes real samples to the default `cpal` output stream and reports callback cadence, queued/played frames, stream errors, and warnings.
- Extended `npm run test:tauri-webview` so the real WebView runtime smoke renders a Track Master fixture, creates a playback-cache WAV, then verifies native playback from that cache.

Native playback evidence from this machine:

```json
{
  "host": "Wasapi",
  "default_output_device": "Speakers (Focusrite USB Audio)",
  "default_output_config": {
    "channels": 2,
    "sample_rate": 48000,
    "sample_format": "F32",
    "buffer_size": "default"
  },
  "source_channels": 2,
  "source_sample_rate": 48000,
  "source_sample_format": "PCM_S16LE",
  "source_total_frames": 64800,
  "source_duration_ms": 1350,
  "requested_start_ms": 0,
  "requested_duration_ms": 500,
  "queued_source_frames": 24000,
  "queued_output_frames": 24000,
  "played_output_frames": 24000,
  "elapsed_ms": 506.4242,
  "callback_count": 50,
  "total_frames": 24576,
  "observed_callback_frames": [480, 1056],
  "min_callback_interval_ms": 8.922,
  "avg_callback_interval_ms": 10.020367346938777,
  "p95_callback_interval_ms": 10.821,
  "max_callback_interval_ms": 10.882,
  "stream_errors": [],
  "warnings": []
}
```

Verification run:

```powershell
cd desktop\src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..
npm run test:tauri-webview
npm run test:tauri-ui
npm run build
npm run test:integration
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\native-playback-cache-smoke
git diff --check
```

Results:

- Rust/Tauri `cargo check` passed.
- `npm run test:tauri-webview` passed and captured native cached-audio playback evidence.
- `npm run test:tauri-ui` passed.
- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders.
- `git diff --check` passed before doc edits. Re-run it after any further doc changes.

Honest gaps after this pass:

- Native playback is still a synchronous bounded probe, not a persistent transport.
- No native UI controls exist yet for source/master toggle, pause/seek, region loop, or gain-matched A/B.
- No sustained native playback CPU/memory/dropout measurement yet.
- Web Audio `Live Preview` remains the only in-UI live audition path.

Recommended next slice now:

1. Add a Rust-side native A/B probe that accepts source playback-cache path, mastered playback-cache path, start time, duration, and selected side.
2. Add loop-region behavior to that probe by replaying a short segment for a bounded total duration and recording callback/dropout evidence.
3. After the probe passes, decide whether to expose native transport controls in the Track Master UI or keep the Web Audio surface until live DSP parity is designed.

The first two items were completed in the following pass. The remaining decision is how to expose native transport in the UI without pretending it is live DSP parity.

## Latest Codex Pass: Native A/B Loop Probe

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added typed Tauri command `native_ab_loop_probe`.
- The command accepts source and mastered playback-cache WAV paths, reads the same bounded region from each, alternates source/master chunks for a bounded total duration, writes the looped buffer through `cpal`, and records callback/dropout evidence.
- Extended `npm run test:tauri-webview` so the real WebView runtime smoke prepares both source and mastered cache WAVs, then verifies native A/B loop playback.

Native A/B loop evidence from this machine:

```json
{
  "host": "Wasapi",
  "default_output_device": "Headphones (HyperX Cloud Alpha Wireless)",
  "default_output_config": {
    "channels": 2,
    "sample_rate": 48000,
    "sample_format": "F32",
    "buffer_size": "default"
  },
  "source_channels": 2,
  "source_sample_rate": 48000,
  "master_channels": 2,
  "master_sample_rate": 48000,
  "source_sample_format": "PCM_S16LE",
  "master_sample_format": "PCM_S16LE",
  "requested_start_ms": 0,
  "region_duration_ms": 200,
  "total_duration_ms": 800,
  "source_region_frames": 9600,
  "master_region_frames": 9600,
  "queued_output_frames": 38400,
  "played_output_frames": 38400,
  "side_switch_count": 3,
  "elapsed_ms": 810.7974999999999,
  "callback_count": 80,
  "total_frames": 38976,
  "observed_callback_frames": [480, 1056],
  "min_callback_interval_ms": 9.348,
  "avg_callback_interval_ms": 10.00354430379747,
  "p95_callback_interval_ms": 10.555,
  "max_callback_interval_ms": 10.61,
  "stream_errors": [],
  "warnings": []
}
```

Verification run:

```powershell
cd desktop\src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..
npm run test:tauri-webview
npm run test:tauri-ui
npm run build
npm run test:integration
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\native-ab-loop-smoke
git diff --check
```

Results:

- Rust/Tauri `cargo check` passed.
- `npm run test:tauri-webview` passed and captured native A/B loop playback evidence.
- `npm run test:tauri-ui` passed on immediate rerun after one preset-state miss in the smoke harness.
- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders.
- `git diff --check` passed before doc edits. Re-run it after any further doc changes.

Honest gaps after this pass:

- Native A/B playback is still a synchronous bounded probe, not a cancellable/persistent transport.
- No native UI controls exist yet for play/pause/seek/cancel.
- No sustained native playback CPU/memory/dropout measurement yet.
- Web Audio `Live Preview` remains the only in-UI live audition path.

Recommended next slice now:

1. Introduce a small native playback state manager in Rust for start/stop/status instead of one-shot blocking probe commands.
2. Wire one Track Master UI button behind that state manager as an experimental native audition path, while keeping Web Audio clearly labeled as the live DSP preview.
3. Add a longer stress smoke that loops cached source/master audio for several seconds and records callback errors plus process memory/CPU where practical.

The first two items were completed in the following pass. Longer stress playback remains open.

## Latest Codex Pass: Native Playback State Manager

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added Rust-managed native playback session state.
- Added typed Tauri commands `start_native_ab_loop_playback`, `native_playback_status`, and `stop_native_playback`.
- The start command prepares a bounded source/master A/B loop from playback-cache WAVs and returns immediately while native playback runs on a worker thread.
- The status command reports active state, elapsed time, queued/played frames, callback count, callback interval stats, stream errors, and warnings.
- The stop command requests shutdown, joins the worker, drops the stream, and returns final status.
- Added a Track Master `Native A/B` button that prepares cache files, starts native A/B playback, polls status, and stops playback on the next click.
- Kept Web Audio `Live Preview` as the live control-change preview. `Native A/B` is native transport proof, not export/live DSP parity.

Native managed playback evidence:

```json
{
  "nativeSessionStart": {
    "active": true,
    "queued_output_frames": 72000,
    "played_output_frames": 0,
    "stream_errors": [],
    "warnings": []
  },
  "nativeSessionRunning": {
    "active": true,
    "elapsed_ms": 304.52139999999997,
    "played_output_frames": 14976,
    "callback_count": 30,
    "avg_callback_interval_ms": 10.020551724137931,
    "p95_callback_interval_ms": 10.634,
    "stream_errors": [],
    "warnings": []
  },
  "nativeSessionStop": {
    "active": false,
    "played_output_frames": 14976,
    "stream_errors": [],
    "warnings": []
  }
}
```

Verification run:

```powershell
cd desktop\src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" fmt
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..
npm run build
npm run test:tauri-webview
npm run test:tauri-ui
npm run test:integration
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\native-playback-state-smoke
git diff --check
```

Results:

- Rust format/check passed.
- Desktop TypeScript/Vite build passed.
- `npm run test:tauri-webview` passed and captured native managed playback lifecycle evidence.
- `npm run test:tauri-ui` passed and verified the `Native A/B` UI control.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders.
- `git diff --check` passed before doc edits. Re-run it after any further doc changes.

Honest gaps after this pass:

- Native playback still does not expose pause/seek or a full transport timeline.
- Native playback stress evidence is short; no long-running CPU/memory/dropout profile yet.
- `Native A/B` plays cached source/master audio, but Web Audio remains the only live control-change audition path.
- Export-vs-live DSP parity is not claimed.

Recommended next slice now:

1. Add a longer native stress smoke for cached source/master A/B looping, ideally 8-15 seconds, with callback errors and basic process CPU/memory samples.
2. Decide whether to keep `Native A/B` as a bounded audition action or expand it into the main transport with pause/seek.
3. Run the real-song MP3 through the new `Native A/B` button path once the stress smoke is stable.

The first item was completed in the following pass. The real-song Native A/B button path remains the best next product-facing check.

## Latest Codex Pass: Native Playback Stress Smoke

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-native-stress-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `npm run test:tauri-native-stress`.
- Added a dedicated real-WebView stress harness that synthesizes a source file, renders a Track Master, prepares source/master playback-cache WAVs, starts an 8-second native A/B loop, polls native playback status, and samples the Tauri process with PowerShell `Get-Process`.
- Kept the stress test separate from `npm run test:tauri-webview` so normal runtime smoke remains fast.

Native stress evidence:

```json
{
  "finalStatus": {
    "active": false,
    "output_device": "Headphones (HyperX Cloud Alpha Wireless)",
    "elapsed_ms": 8345.341100000001,
    "queued_output_frames": 384000,
    "played_output_frames": 384000,
    "callback_count": 799,
    "avg_callback_interval_ms": 9.998706766917289,
    "p95_callback_interval_ms": 10.605,
    "max_callback_interval_ms": 10.808,
    "stream_errors": [],
    "warnings": []
  },
  "resourceSamples": {
    "count": 11,
    "cpu_delta_seconds": 0.234375,
    "working_set_delta_bytes": -2990080,
    "private_memory_delta_bytes": -3059712
  }
}
```

Verification run:

```powershell
cd desktop
npm run build
npm run test:tauri-native-stress
npm run test:tauri-webview
npm run test:tauri-ui
npm run test:integration
cd ..\desktop\src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" fmt
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..\..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\native-stress-harness-smoke
git diff --check
```

Results:

- Desktop TypeScript/Vite build passed.
- Native stress smoke passed and captured callback/resource evidence.
- Normal Tauri WebView runtime smoke passed when run serially. A prior parallel run with the UI smoke failed because the UI smoke reloads the WebView and destroyed the runtime smoke execution context.
- Tauri UI smoke passed.
- Desktop CLI contract test passed.
- Rust format/check passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders.
- `git diff --check` passed before doc edits. Re-run it after any further doc changes.

Honest gaps after this pass:

- Stress smoke is synthetic and 8 seconds, not real-song or full-album duration.
- No pause/seek native transport exists yet.
- No real user listening pass through the `Native A/B` button yet.
- Web Audio remains the live control-change preview path; native playback does not yet apply live tuning controls.

Recommended next slice now:

The recommended real-song `Native A/B` UI slice from this pass was completed in the following pass.

## Latest Codex Pass: Real-Song Native A/B UI Smoke

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-real-song-native-ui-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `npm run test:tauri-real-song-native-ui`.
- Added a real-WebView smoke that requires `AMS_REAL_SONG_PATH` instead of committing a private Downloads path.
- The smoke backs up/restores Track Master autosave, analyzes the provided MP3 through the Tauri bridge, seeds the UI with analysis/waveform data, clicks the visible `Native A/B` button, verifies active native playback status, clicks the same button again to stop, and writes screenshot/evidence artifacts.

Real-song native UI evidence:

```json
{
  "title": "Lay the Money on the Desk",
  "waveformBins": 256,
  "sourceLufs": -12.444218262030333,
  "sourceTruePeakDbfs": -0.4290349634996211,
  "nativeStatusTextAfterStart": "Native A/B 712 ms",
  "runningStatus": {
    "active": true,
    "label": "Native A/B 2000 ms region from 0.00s",
    "output_device": "Headphones (HyperX Cloud Alpha Wireless)",
    "queued_output_frames": 240000,
    "played_output_frames": 35136,
    "callback_count": 72,
    "avg_callback_interval_ms": 10.00046478873239,
    "p95_callback_interval_ms": 10.604,
    "max_callback_interval_ms": 10.753,
    "stream_errors": [],
    "warnings": []
  },
  "stoppedStatus": {
    "active": false,
    "stream_errors": [],
    "warnings": []
  }
}
```

Verification run:

```powershell
$env:AMS_REAL_SONG_PATH='<local MP3 path>'
cd desktop
npm run test:tauri-real-song-native-ui
npm run test:tauri-ui
npm run test:tauri-webview
npm run test:integration
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\real-song-native-ui-harness-smoke
cd desktop\src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" fmt
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..\..
npm run build
git diff --check
```

Results:

- Real-song native UI smoke passed against the provided MP3.
- Tauri UI smoke passed.
- Tauri WebView runtime smoke passed.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders.
- Rust format/check passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed before the final doc/handoff edit. Re-run it after any further doc changes.

Honest gaps after this pass:

- This is automated real-song UI coverage, not a human listening pass.
- Native playback still has bounded start/stop only in this pass; pause/seek transport is completed in the following pass.
- No full-album real-song audition or long-duration real-song playback stability profile has been run.
- Web Audio remains the live control-change preview path; native playback does not yet apply live tuning controls.

Recommended next slice now:

The bounded native pause/seek slice from this recommendation was completed in the following pass.

## Latest Codex Pass: Bounded Native A/B Pause/Seek Transport

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src-tauri/src/lib.rs`
- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `desktop/tests/tauri-real-song-native-ui-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added native playback status fields for `paused`, `position_seconds`, and `duration_seconds`.
- Added Tauri commands `pause_native_playback` and `seek_native_playback`.
- Changed the CPAL playback callback so pause outputs silence without advancing the queued audition cursor.
- Added visible Track Master controls for bounded native pause/resume and position seek while `Native A/B` is active.
- Added device/session/error status affordances around the active native audition.
- Extended the WebView runtime smoke to exercise `pause_native_playback` and `seek_native_playback` directly.
- Extended the real-song UI smoke to click visible pause/resume controls and move the visible native position slider.

Real-song native transport evidence:

```json
{
  "nativeStatusTextAfterStart": "Native A/B playing",
  "pausedStatus": {
    "active": true,
    "paused": true,
    "position_seconds": 0.822,
    "duration_seconds": 5,
    "played_output_frames": 39456,
    "stream_errors": [],
    "warnings": []
  },
  "seekTargetSeconds": 0.6,
  "seekedStatus": {
    "active": true,
    "paused": true,
    "position_seconds": 0.6,
    "played_output_frames": 28800,
    "stream_errors": [],
    "warnings": []
  },
  "resumedStatus": {
    "active": true,
    "paused": false,
    "position_seconds": 1.26,
    "played_output_frames": 60480,
    "stream_errors": [],
    "warnings": []
  }
}
```

Verification run:

```powershell
cd desktop
npm run build
npm run test:integration
npm run test:tauri-webview
npm run test:tauri-ui
$env:AMS_REAL_SONG_PATH='<local MP3 path>'
npm run test:tauri-real-song-native-ui
npm run test:tauri-native-stress
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" fmt
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..\..
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\native-transport-harness-smoke
git diff --check
```

Results:

- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Tauri WebView runtime smoke passed with direct pause/seek command coverage.
- Tauri UI smoke passed.
- Real-song native UI smoke passed against the provided MP3 with visible pause/resume/slider seek.
- Native stress smoke passed after the playback callback cursor/pause changes.
- Rust format/check passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders.
- `git diff --check` passed with normal LF-to-CRLF working-copy warnings only.

Honest gaps after this pass:

- Native pause/seek currently applies to the bounded source/master A/B audition buffer, not the main full-track/album transport.
- This is automated real-song UI coverage, not a human listening pass.
- No full-album real-song audition or long-duration real-song playback stability profile has been run.
- Web Audio remains the live control-change preview path; native playback does not yet apply live tuning controls.

Recommended next slice now:

1. Decide whether to extend native transport beyond bounded A/B into full-track and album playback, or keep full-track/album playback in the existing WebView audio player for this rebuild stage.
2. Run a real multi-song Album Master workflow if enough source files are available, then record render/listening evidence.
3. Add a manual listening checklist surface for Track Master and Album Master so automated evidence and human approval are both tracked.

The real-source Album Master UI evidence slice from this recommendation was completed in the following pass using three local excerpts from the one provided MP3.

## Latest Codex Pass: Real-Source Album Master UI Smoke

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/package.json`
- `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `npm run test:tauri-real-song-album-ui`.
- Added a real-WebView Album Master smoke that requires `AMS_REAL_SONG_PATH` instead of committing a private Downloads path.
- The smoke derives three local WAV excerpts from the provided MP3 under `test-output`, seeds Album Master mode, clicks visible `Analyze`, verifies visible LUFS and `Export Album` enablement, clicks visible `Export Album`, inspects the generated manifest/dashboard/album WAV, and prepares playback from the visible `Album WAV` and transition artifact buttons.

Real-source Album Master evidence:

```json
{
  "sourceTitle": "Lay the Money on the Desk",
  "initialMode": "Album Master",
  "seededTrackCount": "3 / 8 tracks",
  "analyzeButtonEnabled": true,
  "exportEnabledAfterAnalyze": true,
  "sourceLufsVisible": true,
  "renderComplete": true,
  "albumWavButtonEnabled": true,
  "albumPlaybackReady": true,
  "transitionPlaybackReady": true,
  "dashboardLoaded": true,
  "manifestTrackCount": 3,
  "manifestInterludeCount": 2,
  "sequenceTrackCount": 3,
  "sequenceInterludeCount": 2,
  "manifestWarnings": []
}
```

Verification run:

```powershell
node --check tests\tauri-real-song-album-ui-smoke.mjs
cd desktop
npm run build
$env:AMS_REAL_SONG_PATH='<local MP3 path>'
npm run test:tauri-real-song-album-ui
npm run test:tauri-ui
npm run test:integration
npm run test:tauri-webview
git diff --check
```

Results:

- Real-source Album Master UI smoke passed against three MP3-derived clips from the provided song.
- Tauri UI smoke passed.
- Desktop CLI contract test passed.
- Tauri WebView runtime smoke passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed with normal LF-to-CRLF working-copy warnings only.

Honest gaps after this pass:

- The Album Master real-source smoke uses three excerpts from one provided song, not three separate real songs.
- This is automated artifact/playback-prep coverage, not a human listening pass.
- No long-duration full-album playback stability profile has been run on real audio.
- Native pause/seek remains scoped to bounded Track Master A/B audition, not full-track or full-album playback.

Recommended next slice now:

1. Add a manual listening checklist surface for Track Master and Album Master so automated evidence and human approval are both tracked.
2. If the user provides more real songs, run the same Album Master smoke against true multi-song input rather than derived excerpts.
3. Decide whether native transport should expand to full-track/album playback or remain bounded A/B while WebView playback handles full artifacts.

The manual listening checklist surface from this recommendation was completed in the following pass. It records review state, but no real human approval has been recorded yet.

## Latest Codex Pass: Listening Checklist Surface

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added a persistent `Listening Pass` panel to the Tauri lower deck.
- Added checklist fields for original playback, mastered playback, native A/B, album WAV, transitions, dashboard review, and listening notes.
- Included the checklist in the autosaved session snapshot and undo/redo history.
- Kept checklist edits from marking renders stale because they document human review state rather than changing render settings.
- Extended the Tauri UI smoke to toggle checklist fields, enter notes, wait for autosave, and verify persistence through `load_recent_session`.

Listening checklist evidence:

```json
{
  "listeningInitial": true,
  "listeningProgressAfterChecks": "Listening Pass3/6",
  "persistedListening": {
    "albumSequence": false,
    "albumTransitions": false,
    "dashboardReviewed": true,
    "notes": "Checked track and dashboard in UI smoke.",
    "trackMaster": false,
    "trackNativeAb": true,
    "trackOriginal": true
  }
}
```

Verification run:

```powershell
cd desktop
npm run build
npm run test:tauri-ui
npm run test:integration
cd ..
git diff --check
```

Results:

- Desktop TypeScript/Vite build passed.
- Tauri UI smoke passed with listening checklist persistence evidence.
- Desktop CLI contract test passed.
- `git diff --check` passed with normal LF-to-CRLF working-copy warnings only.

Honest gaps after this pass:

- The checklist surface exists, but no actual human listening approval has been recorded.
- No true multi-song Album Master pass has been run with separate real songs.
- No long-duration full-album playback stability profile has been run on real audio.
- Native pause/seek remains scoped to bounded Track Master A/B audition, not full-track or full-album playback.

Recommended next slice now:

1. Run the app interactively for a human listening pass when the user is ready, and use the new `Listening Pass` panel to record approval/problems.
2. If the user provides more real songs, run the Album Master UI smoke against true multi-song input rather than derived excerpts.
3. Decide whether native transport should expand to full-track/album playback or remain bounded A/B while WebView playback handles full artifacts.

## Latest Codex Pass: Export Vs Live Preview Honesty

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`
- `desktop/tests/tauri-webview-ui-smoke.mjs`
- `desktop/tests/tauri-real-song-native-ui-smoke.mjs`
- `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added a visible `Approx audition` status when Web Audio `Live Preview` is armed, so the app does not imply live controls are export-faithful.
- Kept rendered preview/export as the render-faithful path.
- Extended the Tauri UI smoke to assert the approximate Live Preview status in the real WebView.
- Extended the Tauri runtime smoke to render a Track Master file through the Python engine, model the current Web Audio-style live path on the same source/settings, write `test-output\tauri-webview-runtime-smoke\live-preview-model.wav`, and record comparison metrics.
- Hardened WebView smokes to wait for the Tauri invoke bridge before seeding sessions or calling commands.

Export/live comparison evidence:

```json
{
  "offline_engine": "python-render-project",
  "live_preview_engine": "web-audio-deterministic-model",
  "same_engine": false,
  "preview_parity": "approximate",
  "export_faithful_preview_required": true,
  "compared_frames": 64800,
  "export_minus_live_lufs_proxy": 4.963653784202048,
  "rms_difference_dbfs": -22.417607969062146
}
```

Verification run:

```powershell
node --check desktop\tests\tauri-webview-runtime-smoke.mjs
node --check desktop\tests\tauri-webview-ui-smoke.mjs
node --check desktop\tests\tauri-real-song-native-ui-smoke.mjs
node --check desktop\tests\tauri-real-song-album-ui-smoke.mjs
cd desktop
npm run build
npm run test:integration
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..
npm run test:tauri-ui
npm run test:tauri-webview
```

Results:

- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Rust/Tauri `cargo check` passed.
- Tauri UI smoke passed with `previewParityStatus: "Approx audition"`.
- Tauri runtime smoke passed and wrote export-vs-live comparison evidence.
- Tauri dev app was stopped after verification. CDP ports checked with no listener.

Honest gaps after this pass:

- Live Preview is still temporary and approximate; the slice improves honesty and evidence, not export parity.
- No actual human listening approval has been recorded.
- No true multi-song Album Master pass has been run with separate real songs.
- No long-duration full-album playback stability profile has been run on real audio.
- Native pause/seek remains scoped to bounded Track Master A/B audition, not full-track or full-album playback.

Recommended next slice now:

1. Run the app interactively for a human listening pass when the user is ready, and use the `Listening Pass` panel to record approval/problems.
2. If the user provides more real songs, run the Album Master UI smoke against true multi-song input rather than derived excerpts.
3. Decide whether native transport should expand to full-track/album playback or remain bounded A/B while WebView playback handles full artifacts.

## Latest Codex Pass: Real-Source Album Playback Stability

Date: 2026-05-12

Additional changed files in this pass:

- `desktop/package.json`
- `desktop/src-tauri/src/lib.rs`
- `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
- `docs/ENGINE_DECISION_RECORD.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`

What changed:

- Added `npm run test:tauri-real-song-album-playback` as an explicit script for the real-source album playback/stability run.
- Extended the real-source Album Master UI smoke so after visible analyze/render/dashboard/album WAV/transition prep it also runs a native playback stability probe on the rendered `album_sequence.wav` playback cache.
- Increased `native_playback_file_probe`'s duration cap from 5 seconds to 60 seconds so album material can be profiled for more than short snippets.
- Verified against the provided MP3 fixture: `C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3`.

Playback stability evidence:

```json
{
  "sourceTitle": "Lay the Money on the Desk",
  "manifestTrackCount": 3,
  "manifestInterludeCount": 2,
  "albumPlaybackCachePathExists": true,
  "albumPlaybackReady": true,
  "transitionPlaybackReady": true,
  "dashboardLoaded": true,
  "albumPlaybackStability": {
    "requested_duration_ms": 20000,
    "source_duration_ms": 36366.979166666664,
    "queued_output_frames": 960000,
    "played_output_frames": 960000,
    "callback_count": 2000,
    "avg_callback_interval_ms": 10.000632816408233,
    "p95_callback_interval_ms": 10.627,
    "max_callback_interval_ms": 11.629,
    "stream_errors": [],
    "warnings": []
  }
}
```

Verification run:

```powershell
node --check desktop\tests\tauri-real-song-album-ui-smoke.mjs
cd desktop
npm run build
npm run test:integration
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='20'
npm run test:tauri-real-song-album-playback
cd ..
python -m compileall -q src tests
```

Results:

- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Rust/Tauri `cargo check` passed.
- Real-source Album Master UI smoke passed with 20 seconds of native album WAV playback evidence.
- Python compile passed.
- Tauri dev app was stopped after verification.

Honest gaps after this pass:

- The source is still one real MP3 split into three local clips, not a true multi-song album.
- This is automated native playback evidence, not human listening approval.
- Native pause/seek remains scoped to bounded Track Master A/B audition; album WAV full-transport controls still use the WebView path.
- Web Audio Live Preview remains approximate, not export-parity-safe.

Recommended next slice now:

1. Run the app interactively for a human listening pass when the user is ready, and use the `Listening Pass` panel to record approval/problems.
2. If the user provides more real songs, run the Album Master UI smoke against true multi-song input rather than derived excerpts.
3. Decide whether to add native full-track/full-album transport controls or keep native playback as proof/stability instrumentation while WebView playback handles full artifacts.

## Mission

This repo is a private Windows PC album-mastering studio, not a toy normalizer. The user wants to open the app and run it end to end on real songs. Treat workflow, listening, and DSP trust as product requirements.

Core path:

1. Load and reorder songs.
2. Analyze tracks and show the useful analysis in the app.
3. Choose mastering direction, album arc, and fine-tuning.
4. Generate transitions with rationale.
5. Render a continuous album WAV and individual masters.
6. Produce manifest/report/dashboard.
7. Let the user inspect and listen without leaving the workflow when practical.

## User Instruction To Preserve

The user explicitly said the "intentional scoped choices are real as well" because the screenshot reviewer is a project partner who knows the mission. Do not dismiss UX or workflow critiques as merely scoped out. Re-check the screenshot critiques in the conversation before continuing.

The user also asked to "create a loop" like this handoff until every real bug, self-criticism, and low-quality pass is defeated. Keep this document current before any compaction or handoff. The loop is:

1. Re-read the latest screenshots and this file.
2. Verify each criticism against the current code before accepting it.
3. Fix confirmed defects by rebuilding the weak implementation, not by layering cosmetic code over it.
4. Add a regression test when the defect is behaviorally testable.
5. Run compile, unit tests, smoke, app instantiate, and artifact inspection before saying a pass is ready.
6. Update this file and `docs/progress.md` with fixed items and remaining honest gaps.

## Current Git State

Last pushed commit:

```text
e9b3b5e Add Tauri desktop shell
```

Current working tree is intentionally dirty with the standalone Tauri packaging, playback hardening, and interlude-cache patch. The user asked to test, commit, and push after this pass.

Known modified/added files at this update include:

- `.gitignore`
- `AGENTS.md`
- `README.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `desktop/` source/config/lockfiles/tests
- `desktop/engine/engine_entry.py`
- `desktop/scripts/prepare-sidecars.ps1`
- `src/album_mastering_studio/pipeline.py`
- `tests/test_pipeline.py`

Generated Tauri folders are intentionally ignored:

- `desktop/node_modules/`
- `desktop/dist/`
- `desktop/src-tauri/target/`

The current Tauri build artifacts exist locally but are ignored:

```text
desktop\src-tauri\target\release\album-mastering-studio.exe
desktop\src-tauri\target\release\bundle\msi\Album Mastering Studio_0.1.0_x64_en-US.msi
desktop\src-tauri\target\release\bundle\nsis\Album Mastering Studio_0.1.0_x64-setup.exe
```

The release build now also bundles ignored sidecar resources generated from source:

```text
desktop\src-tauri\resources\engine\album-master-engine.exe
desktop\src-tauri\resources\ffmpeg\ffmpeg.exe
desktop\src-tauri\resources\ffmpeg\ffprobe.exe
```

## Current Tauri Desktop Pass

The user asked for a real Tauri shell and then approved installing prerequisites. Rustup and Visual Studio Build Tools were installed locally, and the Tauri build now succeeds.

What exists now:

- `desktop/` Tauri 2 app using React + Vite + Tailwind + TypeScript.
- Rust backend invokes the existing Python CLI, not DSP code in Rust.
- Backend commands: `repo_root`, `default_output_dir`, `read_json`, `write_project`, `open_path`, `cancel_cli`, `run_cli`, and `prepare_playback_file`.
- `run_cli` sets `PYTHONPATH` to the repo `src/`, streams stdout/stderr/status to the frontend, and stores one active child process so cancel can kill it.
- Frontend supports drag/drop audio import, row reordering by drag, remove, inline rename, analyze with waveform thumbnails, preset/delivery/arc/transition/fine-tune controls, open/save `.ams.json`, render full album, render tracks/transitions only, cancel, embedded dashboard, output folder open, and HTML5 audio playback for source/master/album/reference/transitions.
- Keyboard shortcuts implemented in the webview: Ctrl+O, Ctrl+S, Ctrl+R, Space for play/pause, Delete to remove selected track.
- CLI now has `analyze --waveform-bins` and `render`/`render-project --json-events` for waveform thumbnails and stage-level render progress.
- CLI render/init-project now have `--reference-track` parity.
- Release builds now call the bundled `album-master-engine.exe` sidecar instead of `python -m ...`.
- Release builds bundle FFmpeg/FFprobe resources and inject that folder into the engine subprocess `PATH`.
- Playback is now FFmpeg-normalized before the webview receives it: `prepare_playback_file` creates a cached 16-bit stereo 48 kHz WAV for source/master/album/reference/transition playback.
- Tauri now has explicit source/master A/B compare mode that switches A Source and B Master at the same playhead position.
- Full-album assembly now reuses the already-rendered interlude arrays instead of synthesizing every interlude a second time for `album_sequence.wav`.

Important honest caveats:

- The installer now bundles the frozen Python engine and FFmpeg/FFprobe. The repo/Python fallback still exists only for development/debugging.
- The sidecar engine is PyInstaller onefile, so each CLI invocation has some startup/extraction overhead. If that becomes annoying, convert the sidecar to PyInstaller onedir.
- Progress is stage-level JSON from Python, not a detailed ETA from inside FFmpeg.
- The Tauri shell has header buttons and shortcuts but not a native OS menubar yet.
- Still not exposed in Tauri: single-track audition render, iteration pass diff/A-B, live arc-plan preview, per-track tuning values.

## Screenshot Critiques To Re-Check

The conversation includes numbered screenshots #1 through #12. Re-read them before making final calls. The main buckets:

- Critical DSP correctness:
  - BPM-from-root-frequency bug in rhythmic/pulsed transitions.
  - Tanh limiter is not a limiter.
  - Per-sample Python compressor/envelope bottleneck.
  - LUFS/true-peak approximations overstated as trusted numbers.
  - Interlude levels too quiet relative to album.
  - Misnamed or weak crossfade/hard-cut/breath-gap behavior.
- Iteration/scoring:
  - Threshold limbo zone.
  - Preset flip to `velvet-museum`.
  - Scoring only reading first track preset.
  - Rationale score grading word count/prose existence, not correctness.
  - Iteration has no "did this help" regression check.
- App/workflow:
  - No waveform/analysis display beyond table basics.
  - No in-app playback/listen loop.
  - No open/save project from GUI.
  - No progress indicator/cancel.
  - No shortcuts, track counter, clear log, reset tuning.
  - Raw slider floats and unclear units.
  - `os.startfile` Windows-only helper.
  - FFmpeg preflight missing.
  - Output folder timestamp/collision and path confusion.
  - Render/preview behavior creates too many folders.
  - No smoke button in GUI.

## Already Patched In This Dirty Tree

These have code changes started and should be preserved unless found broken:

- Added `constants.py` with `MAX_TRACKS`, `DEFAULT_SAMPLE_RATE`, and `DEFAULT_RENDER_SUBDIR`.
- `audio_io.py`
  - Added FFmpeg/FFprobe preflight helper.
  - Added subprocess timeout.
  - Split `.ogg` to `libvorbis` and `.opus` to `libopus`.
  - Writes dithered 24-bit/16-bit PCM WAVs directly by default; 32-bit float is explicit.
- `standards.py`
  - Added delivery profile shortcuts from the two research reports: streaming universal, AES album mode, Apple/AAC check, YouTube/video, Amazon/speaker-safe, CD 16/44.1, vinyl premaster, and loud-rock reference.
- `analysis.py`
  - Added short-term loudness maximum and LRA-style loudness range proxy fields.
- `mastering.py`
  - Replaced tanh ceiling path with a local oversampled lookahead gain limiter. It no longer uses centered lookahead or whole-song true-peak trim.
  - Replaced the centered compressor attack detector with causal attack/release filtering.
  - Vectorized `_one_pole`.
  - Added `target_lufs` to `MasterResult`.
  - Edge head/tail treatment windows are shortened on very short tracks to avoid overlap/double-processing.
- `interludes.py`
  - Added onset/envelope autocorrelation tempo estimation.
  - Rhythmic/pulsed styles now use estimated tempo, not median root frequency.
  - `crossfade` is now actual equal-power overlap of adjacent audio.
  - `hard-cut` returns silence instead of quiet noise.
  - Interlude target LUFS can be passed in.
  - Root estimation handles mono arrays.
  - Oscillator phase accumulation uses float64.
- `pipeline.py`
  - Uses constants.
  - Passes style-aware relative interlude target loudness based on neighboring tracks.
  - Passes the user/project ceiling through interlude limiting.
  - Uses sample-rate-aware limiter for edge shaping.
  - Adds warning when LUFS match hits the clamp and misses target.
  - Adds optional reference-track analysis to manifests.
  - Adds delivery profile, bit depth, codec QC, metadata, cue sheet, and normalization-preview data to manifests.
  - Writes `album_sequence.cue` and `album_sequence.cue.json` for continuous album renders.
  - Writes AAC and Opus round-trip codec QC preview files when enabled.
  - Accepts `"inherit"` project transition styles and resolves them at render time.
  - Updates edge-shaped `applied_gain_db` after the post-edge limiter.
- `scoring.py`
  - Preset identity averages across tracks, not only track 1.
  - Rationale score uses presence/length threshold, not a strict 10-word count.
  - Album audio loading failures degrade to missing album stats instead of failing score generation.
  - Three-track arc shape uses Spearman rank correlation.
- `iteration.py`
  - Removed `sequence_continuity` and `decision_rationales` from `_needs_iteration` thresholds.
  - No longer flips preset to `velvet-museum`; small warmth/air adjustment keeps user preset.
- `tests/test_pipeline.py`
  - Added tempo regression test.
  - Adjusted hard-cut expectation.
  - Added assertions for cue outputs, codec preview records, 24-bit WAV sample width, metadata preservation, and richer loudness fields.
- `app.py`
  - Added project Open/Save menu and actions.
  - Added FFmpeg preflight.
  - Added progress bar, status, clear log, track counter, reset tuning, smoke button.
  - Added better track analysis columns.
  - Added cross-platform `_open_path`.
  - Added safer output run folder naming.
  - Added `inherit` transition override semantics so explicit `auto` is not overwritten by global style.
  - Added playback and waveform UI.
  - Added reference-track picker.
  - Added target profile shortcuts for common LUFS/ceiling targets.
  - Added cooperative Cancel button and active-task close warning.
  - Saves open track/transition editor fields before render/save/reorder.
  - Preserves `tweak_lufs` through GUI save/load via LU Offset.
  - Uses Tk multi-pattern audio file filters for Windows.
  - Warns when oversized projects/transitions are truncated to the current 8-track cap.
  - Caches decoded playback WAVs and deletes the playback temp folder on close.
  - Validates output folder writability before render/preview.
  - Adds a dark early-2000s-clean-cyberpunk theme with styled menus, tables, waveform canvas, log severity colors, and clearer primary/secondary/destructive button hierarchy.
  - Adds release metadata fields, per-track artist/ISRC fields, delivery profile, bit-depth, and codec QC controls.
  - Adds a Listen / Apply State panel that marks current settings as pending, previewing, rendering, applied, canceled, or errored.
  - Adds quick preset buttons for common mastering directions.
  - Adds selected-track master preview rendering, A/B compare playback, full-album playback, rendered-transition playback, a playback progress bar, and a selected-track waveform playhead.
  - A/B Compare automatically renders the selected master preview first when no current master exists.
  - Warns when Play Master or A/B Compare is using an older preview/render while current settings are pending.
  - Invalidates stale render pointers after track add/remove/reorder so old output cannot masquerade as the current album.
  - Render completion logs now call out master count, transition count, continuous album WAV path, and transition folder.
- `loudness.py`
  - Uses `pyloudnorm` when installed, with the local LUFS approximation retained as a fallback.
- `dashboard.py`
  - Shows reference-track analysis when a reference is selected.
  - Shows delivery profile, release metadata, normalization preview, codec QC, cue outputs, and richer metering.

## Current Status

The Tauri shell is now buildable and is the primary app surface. The older Tk app remains in the repo as a fallback and has several of the earlier bug/UX fixes, but new desktop product work should start in `desktop/` unless the user specifically asks for the Tk launcher.

The two deep-research reports were read and converted into `docs/research-implementation-notes.md`. Implemented now: delivery profiles, integer/dithered WAV exports, codec QC, cue sheets, metadata, normalization preview, and richer metering. Deferred deliberately: JUCE/C++ rewrite, plugin hosting, Demucs/stem separation, cloud AI transition providers, full Essentia/madmom key/tempo stack, real metadata container tagging, and full reference matching.

If another instance resumes this, run verification before assuming the tree is still clean:

```powershell
python -m compileall -q src tests
```

first. If compile/instantiate fails, fix `app.py` before touching deeper DSP.

## Verification Required Before Claiming Ready

Run all of these fresh:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-final-solid-smoke
cd desktop
npm run build:sidecars
npm run build
npm run test:integration
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
```

If touching the Tk fallback, also instantiate it:

```powershell
@'
import tkinter as tk
from album_mastering_studio.app import MasteringStudioApp
root = tk.Tk()
root.withdraw()
app = MasteringStudioApp(root)
root.update_idletasks()
root.destroy()
print('app instantiate ok')
'@ | python -
```

Also inspect the 8-track smoke manifest for:

- 8 mastered tracks
- 7 transitions
- `album_sequence.wav`
- `dashboard.html`
- `album_sequence.cue`
- `album_sequence.cue.json`
- codec preview records/files when enabled
- no NaN/inf
- no unexpected true-peak warnings after limiter patch

Latest verified run in this thread:

```text
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-final-solid-smoke
cd desktop
npm run build:sidecars
npm run build
npm run test:integration
npm run tauri:build through VsDevCmd
sidecar engine smoke
bundled FFmpeg playback conversion
built Tauri exe launch smoke
```

Result:

- Python compile passed.
- 15 unit tests passed.
- Smoke passed in `test-output\codex-final-solid-smoke`.
- Frozen engine sidecar smoke passed in `test-output\sidecar-postbuild-smoke-2`.
- Bundled FFmpeg converted an album WAV to a browser-safe playback WAV.
- Desktop TypeScript/Vite build passed.
- Desktop integration test passed, including waveform analysis, render-project, manifest creation, and JSON progress events.
- Tauri release build passed with bundled engine/FFmpeg resources.
- Built Tauri app stayed alive for a 5-second launch smoke.
- 8-track artifact audit: 8 tracks, 7 interludes, 15 sequence/cue items, continuous album duration exactly matches all sequence items, finite samples, album peak `0.824321`, 0 manifest warnings, dashboard and scorecard present.
- Built artifacts: `album-mastering-studio.exe`, MSI installer, and NSIS setup EXE under `desktop\src-tauri\target\release`.
- Installer sizes at this verification: NSIS setup EXE `142.8 MB`, MSI `169.3 MB`.

## Likely Next Product Fixes After Current Patch

Prioritize these before handing back "ready to run":

1. Real-world Tauri run on the user's actual Crooked Hymns tracks: drag, reorder, analyze, render, play album, play transitions, inspect embedded dashboard.
2. Native Tauri menubar and better About dialog. Header actions and shortcuts exist, but not a real OS menubar yet.
3. Single-track audition render in Tauri so a selected song can be rendered quickly without waiting for all tracks.
4. Live arc/transition plan preview after analyze, before render.
5. Iteration pass diff/A-B in Tauri for `iterate-project` outputs.
6. Actual reference-track matching, not just reference analysis/reporting.
7. Minimum-phase EQ/filtering pass to remove remaining `filtfilt`/`sosfiltfilt` mastering/interlude artifacts.
8. Character classifier cleanup: filename hints should be weak evidence, and `return_acoustic` should be album-role metadata rather than only a hard label.
9. Split the old `app.py` only if the Tk fallback will keep receiving product work; otherwise keep new UI work in `desktop/`.
10. Commit/push only after the user asks or after explicit approval.

## Important Product Judgment

Do not over-focus on making the first local DSP chain academically perfect. But do fix claims that make the tool untrustworthy: limiter behavior, tempo gating, visible metering/analysis, playback loop, project save/load, and warning/report honesty.
