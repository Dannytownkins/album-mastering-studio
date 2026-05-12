# Progress Notes

## 2026-05-12

### First-Control Export Vs Live Model Smoke Slice

- Extended the packaged Track Preview smoke's export-vs-live comparison so it no longer compares a multi-control Live Preview run against a Low-only model.
- The deterministic live model now applies the same first-control set the smoke exercises: Low shelf, Mid peaking EQ, High shelf, mid/side Width, and a basic Intensity compressor curve.
- The comparison remains an honesty check, not a parity claim: it records the live model as `web-audio-first-control-model`, keeps `same_engine: false`, and still requires a Python-rendered preview for export-faithful audition.

Verification:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run test:tauri-track-preview-ui
cd ..
```

Results:

- Node syntax check passed.
- Release-backed Track Preview UI smoke passed.
- Evidence: `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Evidence values:
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

Honest gap:

- This makes the automated comparison less misleading for the current first-control Live Preview path, but it still proves mismatch rather than shared/export-engine DSP parity.

### Multi-Control Live Preview Response Smoke Slice

- Extended `desktop/tests/tauri-track-preview-ui-smoke.mjs` so the packaged Track Preview smoke verifies the Phase 5 first-control set, not only the Low slider.
- The release-backed smoke now opens Advanced controls when needed and proves `Low`, `Mid`, `High`, and `Width` update the running Web Audio snapshot inside the 150 ms lightweight-control budget.
- The same run verifies `Intensity` updates the live drive snapshot inside the 500 ms macro-control budget.
- The stale-state guardrail stays intact: after live control changes, the exact rendered master is invalidated, the parity badge returns to `Render required`, and `Update Preview` hands back to the Python-rendered master.

Verification:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run test:tauri-track-preview-ui
cd ..
```

Results:

- Node syntax check passed.
- Release-backed Track Preview UI smoke passed.
- Evidence: `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Evidence values:
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

Honest gap:

- This proves the listed UI controls update the current Web Audio audition quickly and keep stale exact renders honest. It does not make Web Audio Live Preview export-engine faithful or shared-DSP.

### Live Source To Engine Region Replacement Smoke Slice

- Extended `desktop/tests/tauri-real-song-region-ui-smoke.mjs` to prove that active Live Preview source playback is replaced by Python-rendered region playback.
- The release-backed smoke now clicks `Original`, arms `Live Preview`, and verifies the Web Audio snapshot is active before the first `Render Region` click.
- Because no exact master exists yet in this flow, the parity badge correctly remains `Render required` while Live Preview is active on the source.
- After `Render Region`, the smoke verifies the transport moves to `Engine Region`, the Python region audition payload is present, Live Preview becomes armed/inactive, and the parity badge becomes non-warn `Render-faithful region`.

Verification:

```powershell
node --check .\desktop\tests\tauri-real-song-region-ui-smoke.mjs
cd desktop
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_REGION_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-ui-smoke'
$env:AMS_REAL_SONG_REGION_SECONDS='12'
npm run test:tauri-real-song-region-ui
cd ..
```

Results:

- Node syntax check passed.
- Release-backed real-song region UI smoke passed.
- Evidence: `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
- Evidence values:
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

Honest gap:

- This proves the visible region-render path replaces an active Web Audio source audition with exact Python region playback. It does not make Web Audio Live Preview export-engine faithful.

### Cue-Preserving Exact/Approx Audition Smoke Slice

- Extended `desktop/tests/tauri-track-preview-ui-smoke.mjs` to verify the exact-vs-approx audition contract after an engine-rendered preview.
- Updated `desktop/src/App.tsx` so `Update Preview` records the source audition cue point in the preview artifact and `window.__AMS_EXPORT_ENGINE_AUDITION__`.
- The `Render-faithful preview` status tooltip now discloses that the rendered preview used the Python export engine and was cued at the captured source time.
- The packaged smoke already clicks `Live Preview`, changes `Low` to `+0.50 dB`, verifies `Render required`, and clicks `Update Preview` to hand off to a Python-rendered master.
- The new assertions verify that the Python-rendered master resumes at the captured cue point, the rendered master transport shows `Render-faithful preview`, switching back to `Original` reactivates the Web Audio source audition, and parity changes back to `Approx audition`.
- The smoke now also asserts the measured export-vs-live comparison is materially different, not merely finite.
- This protects the user-facing honesty rule: the app must not imply the Web Audio live path is export-engine faithful.

Verification:

```powershell
node --check .\desktop\tests\tauri-track-preview-ui-smoke.mjs
cd desktop
npm run build
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
npm run test:tauri-track-preview-ui
npm run test:tauri-ui
cd ..
```

Results:

- Node syntax check passed.
- Desktop TypeScript/Vite build passed.
- Windows Tauri release build passed and rebuilt the release EXE/MSI/NSIS bundles.
- Release-backed Track Preview UI smoke passed.
- Broad WebView UI smoke was attempted after the tooltip copy change, but it requires a running Tauri dev WebView on CDP port `9222`; no dev WebView was running, so the harness stopped before reaching the app.
- Evidence: `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Evidence values:
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

Honest gap:

- This proves the UI cues and labels the rendered-master and live-source playback paths correctly after switching. It does not make Web Audio Live Preview export-engine faithful.

### Fast Region Audition-Only Render Slice

- Added an optional `auditionOnly` flag to the Tauri `render_track_region_preview` command.
- The visible Track Master `Render Region` button now passes `auditionOnly: true`, so it still renders audio through Python `render-project` but skips `score-render` and `export-dashboard` for faster audition turnover.
- Full Track Master renders, Album Master renders, and the direct/default region-preview backend path keep the existing scored/dashboard behavior by using the default render options.
- Extended both region UI smokes to assert the split contract: region audition renders omit `dashboard.html`, while normal whole-track previews still generate dashboards.

Verification:

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

Results:

- Node syntax checks passed for both updated smoke files.
- Release-backed real-song region UI smoke passed.
- Release-backed direct backend region-preview smoke passed.
- Release-backed Track Preview UI smoke passed.
- Evidence:
  - `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
  - `test-output\tauri-real-song-region-preview-smoke\tauri-real-song-region-preview-smoke.json`
  - `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
- Evidence values:
  - real-song UI region audition: `dashboardExists: false`, `dashboardSkippedForAudition: true`
  - real-song UI region audition: `firstRegionPreviewParity: Render-faithful region`
  - real-song UI stale state: `regionParityAfterLowChange: Render required`
  - real-song UI second render: `secondRegionPreviewParity: Render-faithful region`
  - real-song UI engine: `regionEngineAuditionEngine: python-render-track-region-preview`
  - real-song UI timing: start `65.0362191430817s`, duration `12.0111936255241s`, rendered duration `12.011s`
  - direct backend region-preview default: `dashboardExists: true`, `manifestExists: true`, `regionSourceExists: true`, `regionMasterExists: true`, `regionEngine: python-render-track-region-preview`
  - Track Preview UI: `regionPreviewDashboardExists: false`, `regionPreviewDashboardSkippedForAudition: true`, `previewDashboardExists: true`, `previewParityAfterUpdatePreview: Render-faithful preview`, `exportEngineAuditionEngine: python-render-track-master`

Honest gap:

- Region audition is faster because report/scoring work is skipped, but it is still render-first through the Python export engine. True real-time export-engine DSP parity and human listening approval remain open.

### Real-Song Region Stale/Re-Render UI Smoke Slice

- Extended `desktop/tests/tauri-real-song-region-ui-smoke.mjs` to cover stale-state behavior for bounded region renders.
- After the first visible `Render Region` pass, the smoke moves the visible `Low` control to `+0.50 dB`.
- The smoke verifies the old region audition is invalidated as `Render required`, the transport returns to `Player idle`, and `Render Region` is enabled again.
- The smoke then clicks `Render Region` a second time and verifies a new Python-engine region master path replaces the previous one.
- The second-render wait now relies on `window.__AMS_REGION_ENGINE_AUDITION__.path` changing instead of counting log matches, because render stdout can push older log lines out of the visible log tail.

Verification:

```powershell
node --check .\desktop\tests\tauri-real-song-region-ui-smoke.mjs
cd desktop
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_REGION_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-ui-smoke'
$env:AMS_REAL_SONG_REGION_SECONDS='12'
npm run test:tauri-real-song-region-ui
cd ..
```

Results:

- Node syntax check passed.
- Release-backed real-song region stale/re-render UI smoke passed.
- Evidence: `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
- Evidence values:
  - `firstRegionPreviewParity: Render-faithful region`
  - `firstRegionPreviewMasterPath: ...\region-preview-20260512-081826-124\masters\01_lay-the-money-on-the-desk_mastered.wav`
  - `lowControlOutput: +0.50 dB`
  - `regionInvalidatedAfterLowChange: true`
  - `regionParityAfterLowChange: Render required`
  - `transportLabelAfterLowChange: Player idle`
  - `renderRegionEnabledAfterLowChange: true`
  - `secondRegionButtonEnabledBeforeClick: true`
  - `secondRegionRenderStarted: true`
  - `secondRegionPreviewReadyVisible: true`
  - `secondRegionPreviewMasterPath: ...\region-preview-20260512-081841-579\masters\01_lay-the-money-on-the-desk_mastered.wav`
  - `secondRegionPreviewParity: Render-faithful region`
  - `secondAudioLoadedRegion: true`
  - `regionEngineAuditionEngine: python-render-track-region-preview`
  - `regionEngineAuditionStartSeconds: 65.03621914308174`
  - `regionEngineAuditionDurationSeconds: 12.011193625524115`
  - `regionRenderedDurationSeconds: 12.011`
  - `manifest.track_count: 1`
  - `manifest.interlude_count: 0`

Honest gap:

- This strengthens stale-state protection for bounded region audition. It is still render-first automation, not true live export-engine DSP or human listening approval.

### Real-Song Analyze-To-Render Region UI Smoke Slice

- Tightened `desktop/tests/tauri-real-song-region-ui-smoke.mjs` so it now starts from an unanalyzed Track Master session.
- The smoke uses FFprobe only to choose a deterministic 12-second waveform drag target; it no longer precomputes analysis through a direct `analyze_tracks` invoke before seeding the app.
- The visible UI flow is now: load real-song Track Master session, confirm `Needs analysis`, click `Analyze`, wait for Source LUFS/Peak and waveform readiness, drag a waveform region, click `Render Region`, and verify the Python-engine region handoff.
- The Analyze wait now fails fast if source validation blocks or Analyze fails, instead of burning the full smoke timeout.

Verification:

```powershell
node --check .\desktop\tests\tauri-real-song-region-ui-smoke.mjs
cd desktop
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_TAURI_REAL_SONG_REGION_UI_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-real-song-region-ui-smoke'
$env:AMS_REAL_SONG_REGION_SECONDS='12'
npm run test:tauri-real-song-region-ui
cd ..
```

Results:

- Node syntax check passed for the updated smoke.
- Release-backed real-song Analyze -> Render Region UI smoke passed.
- Evidence: `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
- Evidence values:
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

Honest gap:

- This proves the visible release UI can analyze the real MP3 and then render/audition a bounded region. It is still an automated smoke, not human listening approval or true real-time export-engine DSP.

### Real-Song Render Region UI Smoke Slice

- Added release-backed real-song UI coverage for the visible Track Master `Render Region` path.
- Added `desktop/tests/tauri-real-song-region-ui-smoke.mjs`.
- Added package script `npm run test:tauri-real-song-region-ui`.
- Fixed the visible region readout so an analyzed track can show region times before any audio is loaded into the transport. The readout now falls back to `selectedTrack.analysis.duration_seconds` instead of only using the active audio element duration.
- The smoke backs up/restores the user's autosave, launches the release EXE, analyzes the provided song through the Tauri command bridge, seeds Track Master, drags a waveform region in the real UI, clicks the visible `Render Region` button, waits for the Python-engine region render, and verifies the transport is handed to `Engine Region`.

Verification:

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

Results:

- Node syntax check passed for the new smoke.
- Desktop TypeScript/Vite build passed.
- Windows Tauri release build passed and rebuilt the EXE/MSI/NSIS bundles.
- Release-backed real-song `Render Region` UI smoke passed.
- Evidence: `test-output\tauri-real-song-region-ui-smoke\tauri-real-song-region-ui-smoke.json`
- Evidence values:
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

Honest gap:

- This proves the visible release UI can render and audition a bounded region from one real MP3. It is still render-first, not real-time export-engine DSP, and it is not human listening approval.

### Real-Song Region Preview Turnaround Slice

- Added release-backed real-song smoke coverage for bounded Python-engine region previews.
- Added `desktop/tests/tauri-real-song-region-preview-smoke.mjs`.
- Added package script `npm run test:tauri-real-song-region-preview`.
- The smoke requires `AMS_REAL_SONG_PATH`, so the user's private audio path is not committed.
- The smoke launches the release EXE, validates/analyzes the provided song, renders a bounded 12-second region through `render_track_region_preview`, verifies the manifest points at `region-source.wav`, prepares playback, and runs a short native playback probe on the prepared region master.

Verification:

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

Results:

- Node syntax check passed for the new smoke.
- Desktop TypeScript/Vite build passed.
- Release-backed real-song region preview smoke passed.
- Evidence: `test-output\tauri-real-song-region-preview-smoke\tauri-real-song-region-preview-smoke.json`
- Evidence values:
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

Honest gap:

- This proves a bounded export-engine region preview can turn around on one real MP3 in this environment. It is still render-first, not real-time live DSP, and it is not human listening approval.

### Bounded Python-Engine Region Preview Slice

- Added a bounded Track Master region preview path that stays separate from Web Audio `Live Preview`.
- Added Tauri command `render_track_region_preview`.
- The command:
  - receives a one-track project plus `start_seconds` and `duration_seconds`
  - trims the source with bundled/dev FFmpeg into `region-source.wav`
  - points the one-track project at that clipped source
  - disables transitions, album WAV, and codec preview for the bounded audition render
  - calls the existing `render_project_product` path, preserving the Python CLI contract
- Added a visible `Render Region` button next to `Update Preview`.
- `Render Region` uses the selected waveform region when present; otherwise it uses a bounded playhead window.
- The rendered region is immediately prepared in the transport as `Engine Region`.
- The preview-parity label shows `Render-faithful region` while that bounded Python-rendered region is active.
- The normal full-track `Update Preview` path remains available and still renders through `render_track_master`.

Verification:

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

Results:

- Node syntax check passed for the touched packaged smoke.
- Desktop TypeScript/Vite build passed.
- Rust `cargo check` passed.
- Rust `cargo fmt` passed.
- Tauri release build passed and rebuilt the release EXE plus MSI/NSIS bundles.
- Packaged Track Preview smoke passed.
- Live Tauri WebView UI smoke passed.
- Evidence:
  - `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
  - `test-output\tauri-region-preview-ui-smoke\tauri-webview-ui-smoke.json`
- Evidence values:
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
  - Live Preview still reports `Approx audition`
  - full-track `Update Preview` still reports `Render-faithful preview`

Honest gap:

- This is a faster bounded export-engine audition path, not true real-time export-engine DSP. It still renders a short clip before playback.

### Update Preview Export-Engine Audition Handoff Slice

- Tightened Track Master audition behavior without porting DSP to Rust or changing Python render semantics.
- `Update Preview` still renders through the existing Python engine path:
  - Tauri `render_track_master`
  - CLI `render-project --json-events`
  - Python `pipeline.render_project`
  - Python `master_track`
- The visible `Update Preview` button now immediately prepares the rendered master in the transport after the preview render completes.
- If source playback had a current position or selected region, the mastered transport is cued to that position/region start where possible.
- The preview-parity label now depends on the active playback path:
  - source playback with Web Audio Live Preview active remains `Approx audition`
  - stale/missing rendered master remains `Render required`
  - a Python-rendered master audition shows `Render-faithful preview`, even if Live Preview is merely armed
- Added smoke evidence that the post-render audition path is the Python-rendered master, while keeping the negative Web Audio comparison evidence.

Verification:

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

Results:

- Node syntax check passed for the touched packaged smoke.
- Desktop TypeScript/Vite build passed.
- Tauri release build passed and rebuilt the release EXE plus MSI/NSIS bundles.
- Packaged Track Preview smoke passed.
- Live Tauri WebView UI smoke passed.
- Evidence:
  - `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
  - `test-output\tauri-update-preview-handoff-ui-smoke\tauri-webview-ui-smoke.json`
- Evidence values:
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

Honest gap:

- This does not make Web Audio Live Preview export-equivalent. It makes the current-settings export-engine audition one click closer by immediately playing the Python-rendered preview.

### Full-Source Multi-Song Album Master Verification Slice

- Extended the multi-source Album Master evidence from 10-second excerpts to full source songs.
- Reused the same three distinct local WAV sources through `AMS_REAL_SONG_ALBUM_PATHS`.
- Set `AMS_REAL_SONG_ALBUM_CLIP_SECONDS=999`, which let FFmpeg take each full source because all three songs are shorter than that limit.
- Verified the release-backed performance path on full-source audio:
  - `sourceMode: multi-song`
  - `distinctSourceCount: 3`
  - analyzed durations: `118.56s`, `116.00s`, `148.56s`
  - 3 source validations passed
  - 3 analyses produced 256 waveform bins
  - 3 rendered masters
  - 2 generated interludes
  - continuous album WAV, cue JSON, cue sheet, manifest, and dashboard exist
  - export checks passed with 3 tracks, 2 transitions, and 0 warnings
- Verified the Tauri UI/native playback path on the full-source album:
  - Album Master mode restored with `3 / 8 tracks`
  - Track Roles / Story visible before render
  - role override persisted into render as `heavy_djent`
  - export receipt passed
  - album WAV playback prepared
  - native file playback start/pause/seek/resume/stop worked
  - rendered album sequence duration was about `387.54s`
  - bounded native album WAV stability ran for 30 seconds with no stream errors or warnings

Verification:

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

Results:

- Full-source multi-song release performance smoke passed.
- Full-source multi-song Tauri UI/native playback smoke passed.
- Evidence:
  - `test-output\tauri-real-song-album-performance-multisong-fullsource\tauri-real-song-album-performance-smoke.json`
  - `test-output\tauri-real-song-album-ui-multisong-fullsource\tauri-real-song-album-ui-smoke.json`
- Evidence values:
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

Honest gap:

- This is now full-source multi-song automated Album Master evidence, but it is still automated verification. It is not a human listening pass or musical approval of the generated transitions.

### True Multi-Source Album Master Verification Slice

- Closed the prior automated evidence gap where Album Master real-source coverage used three excerpts from one MP3.
- Ran the existing multi-source Album Master harness with three distinct local WAV sources:
  - `A Sacred Love`
  - `Against All Odds`
  - `AI Love`
- Kept private source paths out of committed code by passing them through `AMS_REAL_SONG_ALBUM_PATHS`.
- Verified the release-backed performance path:
  - `sourceMode: multi-song`
  - `distinctSourceCount: 3`
  - 3 source validations passed
  - 3 analyses produced 256 waveform bins
  - 3 rendered masters
  - 2 generated interludes
  - continuous album WAV, cue JSON, cue sheet, manifest, and dashboard exist
  - export checks passed with 3 tracks, 2 transitions, and 0 warnings
- Verified the Tauri UI/native playback path:
  - Album Master mode restored with `3 / 8 tracks`
  - Track Roles / Story visible before render
  - role override persisted into render as `heavy_djent`
  - export receipt passed
  - album WAV playback prepared
  - native file playback start/pause/seek/resume/stop worked
  - bounded native album WAV stability ran for 12 seconds with no stream errors or warnings

Verification:

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

Results:

- Multi-source release performance smoke passed.
- Multi-source Tauri UI/native playback smoke passed.
- Evidence:
  - `test-output\tauri-real-song-album-performance-multisong-3source\tauri-real-song-album-performance-smoke.json`
  - `test-output\tauri-real-song-album-ui-multisong-3source\tauri-real-song-album-ui-smoke.json`
- Evidence values:
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

Honest gap:

- This is now true multi-source automated Album Master evidence, but still uses 10-second excerpts from each source and automated native playback checks. It is not a full-song album listen and not human approval.

### Live Preview Render-Required Guardrail Slice

- Tightened the Track Master preview-parity status so the app distinguishes three states:
  - `Render required` when no exact rendered master is selected
  - `Approx audition` when Web Audio `Live Preview` is armed while a rendered preview exists
  - `Render-faithful preview` when a Python-engine rendered preview is selected and Live Preview is not armed
- Kept Web Audio Live Preview honest as an audition path, not an export-faithful render path.
- Extended packaged Track Preview smoke evidence so it verifies:
  - exact Python preview render first produces a playable mastered preview
  - enabling Live Preview after that render shows `Approx audition`
  - changing the Low control invalidates the rendered master and changes the status to `Render required`
  - clicking `Update Preview` again renders a second Python-engine preview
- Updated the broad Tauri WebView UI smoke so arming Live Preview before any exact rendered master now expects `Render required`.

Verification:

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

Results:

- Node syntax checks passed for both touched smoke files.
- Desktop TypeScript/Vite build passed.
- Packaged Tauri build passed and rebuilt the release EXE plus MSI/NSIS bundles.
- Packaged Track Preview smoke passed.
- Live Tauri WebView UI smoke passed.
- Evidence:
  - `test-output\tauri-track-preview-ui-smoke\tauri-track-preview-ui-smoke.json`
  - `test-output\tauri-webview-ui-smoke\tauri-webview-ui-smoke.json`
- Evidence values:
  - `previewParityStatus: Render required`
  - `previewParityAfterLivePreview: Approx audition`
  - `previewParityAfterControlChange: Render required`
  - `exportVsLiveComparison.preview_parity: approximate`
  - `exportVsLiveComparison.export_faithful_preview_required: true`

Honest gap:

- This improves product honesty and stale-state protection. It does not implement export-engine live parity; render-faithful audition still requires `Update Preview`.

### Listening Approval Capture Slice

- Split human approval from checklist completion in the Tauri session model.
- Added top-level autosaved session state:
  - `listeningApproved`
- Kept `listeningChecklist` focused on activity evidence:
  - original checked
  - master checked
  - native A/B checked
  - album WAV checked
  - transitions checked
  - dashboard checked
  - notes
- Added an explicit `Approved after listening` control in the `Listening Pass` panel.
- Added a visible approval status pill:
  - `Not approved`
  - `Approved`
  - `Approval stale` if a stale render is approved
- Render-affecting edits now clear `listeningApproved`, so tuning/source/settings changes cannot silently keep an old approval.
- `Clear Listening Pass` clears both checklist fields and the approval flag.
- Extended the broad Tauri UI smoke so it verifies:
  - initial approval status is `Not approved`
  - checklist progress remains `3/6` after three checks plus approval
  - approval status becomes `Approved`
  - `load_recent_session` persists `listeningApproved: true` separately from `listeningChecklist`

Verification:

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

Results:

- Node syntax check passed.
- Desktop TypeScript/Vite build passed.
- Live Tauri UI smoke passed.
- Evidence: `test-output\tauri-listening-approval-ui-smoke\tauri-webview-ui-smoke.json`
- Evidence values:
  - `listeningApprovalInitial: Not approved`
  - `listeningProgressAfterChecks: Listening Pass3/6Approved`
  - `listeningApprovalAfterChecks: Approved`
  - `persistedListeningApproved: true`
- `git diff --check` emitted only the existing LF-to-CRLF working-copy warnings.

Honest gap:

- This creates a durable approval capture surface, but it is still not real human approval. A user still needs to run an actual listening pass and intentionally mark approval in the app.

### Real-Song Album Multi-Source Harness Slice

- Extended the real-song Album Master smokes so they can run either:
  - the existing single-source fallback with `AMS_REAL_SONG_PATH`, which derives three clips from one song
  - a true multi-song source list through `AMS_REAL_SONG_ALBUM_PATHS`
- `AMS_REAL_SONG_ALBUM_PATHS` accepts either:
  - a JSON array of local audio paths
  - a Windows path-delimited list, for example `path1;path2;path3`
- The harness validates the multi-song list before rendering:
  - at least two paths
  - at least two distinct files
  - no more than eight files
  - every file exists
- Updated:
  - `desktop/tests/tauri-real-song-album-ui-smoke.mjs`
  - `desktop/tests/tauri-real-song-album-performance-smoke.mjs`
- Both smokes now record source provenance:
  - `sourceMode`
  - `sourcePaths`
  - `distinctSourceCount`
  - per-derived-clip source information
- Count assertions are now dynamic, so two to eight real songs can be tested without rewriting the harness.
- Seeded UI track titles remain normalized as `Album Clip N`, so role override assertions stay stable across arbitrary real filenames.

Verification:

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

Results:

- Node syntax checks passed for both changed smoke files.
- Packaged release Album performance smoke passed against the provided MP3 fallback:
  - evidence: `test-output\tauri-real-song-album-performance-multisource-ready\tauri-real-song-album-performance-smoke.json`
  - `sourceMode: single-song-derived-clips`
  - `distinctSourceCount: 1`
  - source validation count: `3`
  - render track count: `3`
  - render interlude count: `2`
  - export receipt status: `pass`
  - album WAV, cue JSON, cue sheet, dashboard, manifest, track outputs, and interlude outputs existed
- Visible Album UI smoke passed against the provided MP3 fallback:
  - evidence: `test-output\tauri-real-song-album-ui-multisource-ready\tauri-real-song-album-ui-smoke.json`
  - `sourceMode: single-song-derived-clips`
  - `distinctSourceCount: 1`
  - visible seeded count: `3 / 8 tracks`
  - manifest track count: `3`
  - manifest interlude count: `2`
  - five-second native album WAV playback probe completed with zero stream errors
- `git diff --check` emitted only the existing LF-to-CRLF working-copy warnings.

Honest gap:

- A true multi-song Album Master pass still has not been run because only one real song file is currently available in the provided fixture set. The harness is now ready for that pass as soon as two or more distinct local song paths are supplied through `AMS_REAL_SONG_ALBUM_PATHS`.

### Album Boundary Primitive Coverage Slice

- Tightened the Album Master boundary regression so generated-off primitives are proven individually:
  - `gap`: sequence `track,boundary,track`, cue points `track,boundary,track`
  - `fade`: sequence `track,boundary,track`, cue points `track,track` because it fades adjacent edges without inserting a separate boundary chunk
  - `ring-out`: sequence `track,boundary,track`, cue points `track,boundary,track`
  - `crossfade`: sequence `track,boundary,track`, cue points `track,boundary,track`
- Extended the WebView UI smoke so the Album Master `Boundary` selector proves `gap`, `fade`, `ring-out`, and `crossfade` can all be selected, not only `gap`.
- Extended the WebView runtime smoke so the Tauri `render_album_master` bridge renders all four non-direct boundary primitives with generated transitions disabled.
- The live runtime smoke wrote evidence to `test-output\tauri-boundary-primitives-runtime\tauri-webview-runtime-smoke.json`.
- The first live Tauri launch attempt failed before test execution because the hidden `tauri dev` process could not find `cargo`; retrying with `%USERPROFILE%\.cargo\bin` prepended to `PATH` passed.

Verification:

```powershell
python -m unittest tests.test_pipeline.PipelineTest.test_project_boundary_primitives_render_without_generated_interludes
node --check .\desktop\tests\tauri-webview-runtime-smoke.mjs
node --check .\desktop\tests\tauri-webview-ui-smoke.mjs
python -m compileall -q src tests
python -m unittest discover -s tests
cd desktop
npm run build
npm run test:integration
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:TAURI_CDP_PORT='9340'
$env:AMS_TAURI_WEBVIEW_OUTPUT='C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-boundary-primitives-runtime'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9340'
# launched npm run tauri:dev in a hidden background process, then ran:
npm run test:tauri-webview
```

Results:

- Focused boundary regression passed.
- Node syntax checks passed for both changed WebView smoke files.
- Python compile passed.
- All 17 Python unit tests passed.
- Desktop TypeScript/Vite build passed.
- Desktop CLI integration test passed.
- Live Tauri WebView runtime smoke passed after the Cargo PATH retry.
- Boundary runtime evidence:
  - all boundary album WAV paths exist
  - all primitive renders report `interludeCount: 0`
  - all primitive renders report sequence types `track,boundary,track`
  - `gap`, `ring-out`, and `crossfade` report cue types `track,boundary,track`
  - `fade` reports cue types `track,track`
  - all primitive manifests preserve `generated_transitions: false`

### Packaged Track Preview And A/B UI Slice

- Added a packaged Track Master preview UI smoke:
  - `desktop/tests/tauri-track-preview-ui-smoke.mjs`
  - `npm run test:tauri-track-preview-ui`
- Enabled Tauri's local asset protocol for the app's local user/temp media locations in `desktop/src-tauri/tauri.conf.json`.
- Updated the WebView transport seek control in `desktop/src/App.tsx` to expose `aria-label="Playback position"`, respond on `input`, and update visible position state immediately after seeking.
- Updated region-loop playback state so both enabling a loop and jumping at the loop boundary update the visible transport position immediately.
- Added a live-audition diagnostic snapshot so the packaged smoke can verify that the Web Audio audition chain is active and receives control updates.
- Added a CDP pointer-drag assertion to the packaged smoke so playback seek is verified with real WebView mouse input, not only synthetic range events.
- Updated Track Master multi-export receipt handling so independent batch exports aggregate every rendered track into one quality-check manifest instead of showing only the last one-track receipt.
- The smoke launches the current release EXE, restores a two-track Track Master session, selects Track 2, clicks the visible `Update Preview` button, and verifies:
  - visible app mode is `Track Master`
  - visible library count is `2 / 8 tracks`
  - selected heading is `Track 2`
  - the UI logs `Preview ready:`
  - the generated preview manifest contains exactly the selected track
  - the generated master WAV and dashboard exist
  - the visible status changes to `Master ready`
  - the `Mastered` playback button becomes enabled
  - playback cache preparation succeeds through the Tauri command
  - the WebView audio element actually loads the prepared local playback file
  - the visible playback-position range seeks the WebView audio element to a nonzero time
  - a pixel-level mouse drag on the playback-position range changes the audio playhead
  - the visible A/B Original/Mastered buttons can start a compare pair
  - a nonzero playhead is preserved across Original -> Mastered -> Original switching
  - waveform drag creates a region selection
  - `Loop` enables after region selection
  - playback jumps back to the region start after crossing the region end
  - clearing the region disables Loop again
  - Volume Match defaults off
  - Volume Match reduces mastered playback gain for fair comparison
  - turning Volume Match off returns playback gain to unity
  - Live Preview defaults off and can be enabled from the visible button
  - the Web Audio live chain reaches `running` state
  - the app reports live preview as approximate audition
  - a Low control move reaches the live chain under the 150 ms target
  - changing a Low EQ slider marks the prior preview stale
  - the `Mastered` playback button disables again after the control change
  - the visible `Update Preview` button can render a second Low=+0.5 dB preview after the stale state
  - the second Python preview export is compared against a deterministic Web Audio low-shelf model and recorded as approximate, not the same engine
  - the visible Track Master `Export Master` path renders both tracks independently and shows one batch quality receipt
  - the batch quality receipt reports `2 track(s), 0 transition(s), 0 warning(s)`
  - the batch `Track outputs` check reports `2 rendered track path(s) exist`
- The first run exposed a brittle smoke assertion that read the first status pill (`Analyzed`) instead of the master status pill. The selector was narrowed to the second status pill, then the smoke passed.
- The first A/B run exposed a real packaging gap: `convertFileSrc` was being used without `app.security.assetProtocol`, so prepared local audio paths existed but the WebView audio element had `duration=0`. Enabling the asset protocol and rebuilding the release EXE fixed that load path.

Verification:

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

`git diff --check` emitted only the existing LF-to-CRLF working-copy warnings.

Evidence from the passing run:

- active mode: `Track Master`
- track count label: `2 / 8 tracks`
- selected heading: `Track 2`
- preview button enabled before render: `true`
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

Evidence output:

- `test-output/tauri-track-preview-ui-smoke/tauri-track-preview-ui-smoke.json`
- `test-output/tauri-track-preview-ui-smoke/tauri-track-preview-ui.png`
- `test-output/tauri-track-preview-ui-smoke/preview-20260512-051105-563/manifest.json`
- `test-output/tauri-track-preview-ui-smoke/preview-20260512-051105-563/dashboard.html`
- `test-output/tauri-track-preview-ui-smoke/preview-20260512-051105-563/masters/01_preview-fixture-2_mastered.wav`
- `test-output/tauri-track-preview-ui-smoke/preview-20260512-051118-151/masters/01_preview-fixture-2_mastered.wav`
- `test-output/tauri-track-preview-ui-smoke/live-preview-low-model.wav`

Honest notes:

- This proves the packaged visible Track Master preview path, WebView local audio load path, transport range seek path, pixel-level transport seek drag, same-position A/B switching, region loop behavior, Volume Match gain behavior, Web Audio live-audition control response, stale-preview guard, second render after a live-control change, and batch Track Master export receipt.
- The packaged smoke now records export-vs-live comparison metrics, but those metrics prove the current Live Preview path is approximate; they do not make it export-engine parity.
- Human listening approval is still incomplete.

### Packaged Project Persistence Slice

- Added a packaged `.ams.json` project persistence smoke:
  - `desktop/tests/tauri-project-persistence-smoke.mjs`
  - `npm run test:tauri-project-persistence`
- The smoke launches the current release EXE, restores a two-track Album Master session with a known project path, clicks the real Tauri `Save` button, and verifies:
  - visible app mode is `Album Master`
  - visible library count is `2 / 8 tracks`
  - the UI logs `Saved project:`
  - a readable `saved-album.ams.json` exists
  - project metadata, album settings, tracks, and disabled boundary transition serialize correctly
  - the saved project can be read back through the Tauri `read_json` command
  - the saved project can render through the Python engine sidecar
- The first run failed because the synthetic sine fixtures correctly produced dense-source advisory warnings. The fixture generator was revised to use a more dynamic pulse envelope, then the smoke passed with no render warnings.

Verification:

```powershell
cd desktop
node --check .\tests\tauri-project-persistence-smoke.mjs
npm run build
npm run test:tauri-project-persistence
```

Evidence from the passing run:

- active mode: `Album Master`
- track count label: `2 / 8 tracks`
- save log visible: `true`
- saved project: `test-output/tauri-project-persistence-smoke/saved-album.ams.json`
- saved project album title: `Persistence Smoke Album`
- saved project artist: `Persistence Artist`
- saved project `album_wav`: `true`
- saved project `generated_transitions`: `false`
- saved project boundary style: `gap`
- render from saved project track count: `2`
- render from saved project transition count: `0`
- export checks status: `pass`
- render warnings: `0`

Evidence output:

- `test-output/tauri-project-persistence-smoke/tauri-project-persistence-smoke.json`
- `test-output/tauri-project-persistence-smoke/tauri-project-persistence.png`
- `test-output/tauri-project-persistence-smoke/saved-album.ams.json`
- `test-output/tauri-project-persistence-smoke/rendered-from-saved-project/manifest.json`
- `test-output/tauri-project-persistence-smoke/rendered-from-saved-project/dashboard.html`
- `test-output/tauri-project-persistence-smoke/rendered-from-saved-project/album_sequence.wav`

Honest notes:

- This proves the no-dialog Save path when a project path already exists.
- The OS file-picker Open/Save-As dialogs are still not automated in this smoke.

### Real-Song Album Release Performance Slice

- Added a packaged real-song Album Master performance smoke:
  - `desktop/tests/tauri-real-song-album-performance-smoke.mjs`
  - `npm run test:tauri-real-song-album-performance`
- The script requires `AMS_REAL_SONG_PATH` so private audio is not hardcoded into the repo.
- Ran it with:
  - `C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3`
- The smoke derives three 10-second WAV clips under ignored `test-output`, launches the current release EXE, waits for Tauri invoke readiness, and measures:
  - source validation for the three derived clips
  - three-track analysis with 256 waveform bins
  - Album Master render with continuous album WAV enabled
  - two generated transitions enabled
  - export checks
- The smoke verifies actual output files:
  - three mastered track WAVs
  - two interlude WAVs
  - `album_sequence.wav`
  - cue JSON and cue sheet
  - dashboard HTML
  - manifest JSON

Verification:

```powershell
cd desktop
node --check .\tests\tauri-real-song-album-performance-smoke.mjs
npm run build
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-album-performance
```

Measured on this machine in this pass:

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

- `test-output/tauri-real-song-album-performance-smoke/tauri-real-song-album-performance-smoke.json`
- `test-output/tauri-real-song-album-performance-smoke/tauri-real-song-album-performance.png`
- `test-output/tauri-real-song-album-performance-smoke/album-master-real-song/manifest.json`
- `test-output/tauri-real-song-album-performance-smoke/album-master-real-song/dashboard.html`
- `test-output/tauri-real-song-album-performance-smoke/album-master-real-song/album_sequence.wav`
- `test-output/tauri-real-song-album-performance-smoke/album-master-real-song/album_sequence.cue`
- `test-output/tauri-real-song-album-performance-smoke/album-master-real-song/album_sequence.cue.json`

Honest notes:

- This is a packaged Album Master real-audio baseline using derived clips from one MP3, not a broad listening test.
- It verifies generated transition artifact creation, but not manual listening quality.

### Real-Song Release Performance Slice

- Added a packaged real-song performance smoke:
  - `desktop/tests/tauri-real-song-performance-smoke.mjs`
  - `npm run test:tauri-real-song-performance`
- The script requires `AMS_REAL_SONG_PATH` so private audio is not hardcoded into the repo.
- Ran it with:
  - `C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3`
- The smoke launches the current release EXE, waits for Tauri invoke readiness, and measures:
  - source validation
  - full-song analysis with 256 waveform bins
  - playback-cache preparation
  - full Track Master render
  - export checks
- The smoke verifies actual output files:
  - playback cache WAV
  - mastered track WAV
  - dashboard HTML
  - manifest JSON

Verification:

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

Measured on this machine in this pass:

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

- `test-output/tauri-real-song-performance-smoke/tauri-real-song-performance-smoke.json`
- `test-output/tauri-real-song-performance-smoke/tauri-real-song-performance.png`
- `test-output/tauri-real-song-performance-smoke/track-master-real-song/manifest.json`
- `test-output/tauri-real-song-performance-smoke/track-master-real-song/dashboard.html`
- `test-output/tauri-real-song-performance-smoke/track-master-real-song/masters/01_lay-the-money-on-the-desk-1_mastered.wav`

Honest notes:

- The source MP3 remains outside the repo.
- This is one real-song baseline, not broad real-audio performance coverage.

### Release Performance Baseline Slice

- Added a packaged release performance smoke:
  - `desktop/tests/tauri-release-performance-smoke.mjs`
  - `npm run test:tauri-performance`
- The smoke launches the current release EXE, waits for WebView/Tauri invoke readiness, writes eight local WAV fixtures, and measures:
  - launch to WebView CDP target
  - launch to Tauri invoke readiness
  - native audio probe
  - source validation for 8 tracks
  - analysis for 8 tracks with 128 waveform bins
  - 8-track Album Master render with continuous album WAV enabled and generated transitions disabled
  - export checks
- The smoke verifies actual output files, not only manifest fields:
  - `album_sequence.wav`
  - `dashboard.html`
  - `manifest.json`

Verification:

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

- `test-output/tauri-release-performance-smoke/tauri-release-performance-smoke.json`
- `test-output/tauri-release-performance-smoke/tauri-release-performance.png`
- `test-output/tauri-release-performance-smoke/album-master-performance/manifest.json`
- `test-output/tauri-release-performance-smoke/album-master-performance/dashboard.html`
- `test-output/tauri-release-performance-smoke/album-master-performance/album_sequence.wav`

Honest notes:

- These are local synthetic-fixture measurements, not stable product budgets.
- The smoke establishes a repeatable baseline for Phase 12; representative real-song timing still needs separate measurement.

### Source Repair Panel Slice

- Added a focused source-repair panel in the left rail that appears only when one or more tracks have a non-`ok` source health state.
- The panel gives each broken source an actionable row with:
  - status chip
  - friendly source-health detail
  - `Replace`
  - `Remove`
- Added `Recheck` for the current source-issue set.
- Source-health state is now preserved through session normalization/autosave restore via `snapshotTrack`.
- Updated the seeded WebView UI smoke so it covers the source-repair panel and a successful recheck path.
- Extended the packaged release launch smoke to seed a temporary corrupt-source session, reload the packaged app, verify the source-repair panel, remove the bad source, and restore the user's prior recent-session file afterward.
- The first packaged smoke attempt found that `snapshotTrack` was dropping `sourceStatus`; that is now fixed and covered.

Verification:

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
- Release smoke source repair evidence:
  - repair panel visible before action: `true`
  - issue count before action: `1`
  - status text: `Unreadable source`
  - issue count after `Remove`: `0`
  - track count after `Remove`: `1`
- Release smoke restored the prior recent-session file after seeding the temporary source-repair session.
- The restored session still points at the prior `Lay the Money on the Desk Album UI Smoke` state.
- Python compileall passed.
- Desktop CLI contract integration test passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Latest rebuilt package artifacts after this slice:

- release EXE: `9805824`
- NSIS setup EXE: `149842681`
- MSI: `177704960`
- engine sidecar: `53809409`

Latest sidecar startup measurements after this slice:

- cold `--help`: `2188.5 ms`
- warm `--help`: `2039.1 ms`
- direct `analyze`: `3108.2 ms`

Honest gaps:

- The packaged release smoke verifies `Remove`; `Replace` still requires a manual file-dialog check or a future dialog-mocking harness.

### Safe Output/Report Open Slice

- Hardened the native `open_path` command so it refuses missing paths before spawning Explorer/open/xdg-open.
- Added a React `openLocalPath` helper that logs success or failure for:
  - top-bar output folder
  - selected track output folder
  - dashboard HTML
- Extended the release launch smoke to call `open_path` on a missing fixture path and assert a clean error instead of allowing an unhandled invoke or OS opener side effect.

Verification:

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
- Missing open-path error was:
  - `Cannot open missing path: C:\Users\Daniel Kinsner\OneDrive\Documents\GitHub\album-mastering-studio\test-output\tauri-release-launch-smoke\inputs\03_missing_fixture.wav`
- Track Master render still passed in the same release smoke.
- No release app process remained after the smoke.
- Python compileall passed after the doc updates.
- Desktop CLI contract integration test passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Latest rebuilt package artifacts after this slice:

- release EXE: `9805824`
- NSIS setup EXE: `149842681`
- MSI: `177704960`
- engine sidecar: `53809409`

### Source Health / Missing-Corrupt File Slice

- Added a native source-health preflight command:
  - `validate_audio_sources`
- The command validates selected paths before analysis and reports:
  - `ok` for readable supported audio
  - `missing` when a saved/project path no longer exists
  - `unsupported` when the file/folder has no supported audio
  - `unreadable` when bundled FFprobe cannot read the file
- Corrupt/unreadable files now return a short user-facing `detail` plus an optional `diagnostic` field with raw FFprobe output.
- The Track Master/Album Master `Analyze` action now preflights all selected sources before invoking the Python engine.
- If any source is blocked, analysis stops cleanly, the affected track rows show a source-health chip, and the log tells the user to fix missing or unreadable source files.
- Extended the release launch smoke to validate one readable WAV, one missing WAV path, and one corrupt MP3 fixture before rendering.

Verification:

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
- Source validation statuses from the release smoke:
  - readable fixture: `ok`
  - missing fixture path: `missing`
  - corrupt MP3 fixture: `unreadable`
- The corrupt fixture reported the friendly detail:
  - `FFprobe could not read this audio source. The file may be corrupt or use an unsupported codec.`
- Raw FFprobe output was preserved in `diagnostic` for evidence/debugging.
- Track Master render still passed after the source-health preflight:
  - analysis count: `1`
  - waveform bins: `32`
  - manifest/dashboard/mastered WAV exist
  - export checks status: `warn` only for the existing dense-fixture limiter-pressure advisory
- Python compileall passed.
- Python unit tests passed: `17` tests.
- Desktop CLI contract integration test passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- Evidence output:
  - `test-output/tauri-release-launch-smoke/tauri-release-launch-smoke.json`
  - `test-output/tauri-release-launch-smoke/tauri-release-launch.png`

Latest rebuilt package artifacts after this slice:

- release EXE: `9805824`
- NSIS setup EXE: `149842681`
- MSI: `177704960`
- engine sidecar: `53809409`

Honest gaps:

- The UI currently shows compact source-health chips in the track list; it does not yet have a dedicated source-repair panel.
- Real-world bad-codec coverage is only as broad as FFprobe's local error reporting.

### Sidecar Startup Overhead Smoke Slice

- Added a reusable release sidecar startup smoke:
  - `desktop/tests/tauri-sidecar-startup-smoke.mjs`
  - `npm run test:tauri-sidecar-startup`
- The smoke runs the packaged PyInstaller engine directly from release resources:
  - `desktop/src-tauri/target/release/resources/engine/album-master-engine.exe`
- It injects the bundled FFmpeg folder into `PATH` for the direct sidecar process:
  - `desktop/src-tauri/target/release/resources/ffmpeg/ffmpeg.exe`
  - `desktop/src-tauri/target/release/resources/ffmpeg/ffprobe.exe`
- It measures:
  - cold `--help` startup
  - warm `--help` startup
  - one real `analyze` command over a generated WAV fixture with 32 waveform bins
- Evidence output:
  - `test-output/tauri-sidecar-startup-smoke/tauri-sidecar-startup-smoke.json`

Verification:

```powershell
cd desktop
node --check .\tests\tauri-sidecar-startup-smoke.mjs
npm run test:tauri-sidecar-startup
```

Measured on this machine in this pass:

- engine sidecar size: `53809409`
- FFmpeg size: `148234240`
- FFprobe size: `148097536`
- cold `--help`: `2188.5 ms`
- warm `--help`: `2039.1 ms`
- direct `analyze`: `3108.2 ms`
- analyze result count: `1`
- waveform bins: `32`
- stderr bytes for all measured commands: `0`

Honest notes:

- These are local machine measurements, not stable product budgets.
- The startup cost is still PyInstaller onefile-style process startup; if it becomes annoying in real use, compare PyInstaller onedir or a persistent sidecar process.

### MSI Package Payload Smoke Slice

- Added a reusable MSI package payload smoke:
  - `desktop/tests/tauri-msi-package-smoke.mjs`
  - `npm run test:tauri-msi`
- The generated WiX MSI is `perMachine` and targets Program Files/HKLM install state, so this default smoke does not perform a real MSI install.
- The first administrative-image attempt used `msiexec /a`; it timed out without a surviving `msiexec` process and left an empty current-user app key, which was removed and rechecked before continuing:
  - `HKCU\Software\album-mastering-studio\Album Mastering Studio`
- The replacement smoke uses WiX `dark.exe` to extract the MSI payload without elevation:
  - `C:\Users\Daniel Kinsner\AppData\Local\tauri\WixTools314\dark.exe`
- The smoke parses the decompiled WiX XML, materializes the app payload into the same runtime layout the Tauri app expects, and verifies:
  - `album-mastering-studio.exe`
  - `resources\engine\album-master-engine.exe`
  - `resources\ffmpeg\ffmpeg.exe`
  - `resources\ffmpeg\ffprobe.exe`
- It then launches the materialized MSI payload through the existing release launch smoke and verifies:
  - app text includes `Album Mastering Studio`
  - Tauri invoke is available
  - `native_audio_probe` returns `Wasapi`
  - `analyze_tracks` returns one analyzed fixture track
  - `render_track_master` creates a manifest, dashboard, and mastered WAV
  - `run_export_checks` returns `warn` only because the generated fixture triggers the existing limiter-pressure advisory
  - required manifest, track-output, and meter checks pass
- Evidence output:
  - `test-output/tauri-msi-package-smoke/tauri-msi-package-smoke.json`
  - `test-output/tauri-msi-package-smoke/release-launch/tauri-release-launch-smoke.json`
  - `test-output/tauri-msi-package-smoke/release-launch/tauri-release-launch.png`

Verification:

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
- MSI size: `177696768`.
- Extracted payload sizes:
  - app EXE: `9791488`
  - engine sidecar: `53810132`
  - FFmpeg: `148234240`
  - FFprobe: `148097536`
- Launch smoke exit code: `0`.
- The extracted image and materialized app directories were removed after the smoke.
- Rechecked cleanup after the smoke:
  - no `album-mastering-studio` process remained
  - no Album Mastering Studio uninstall key existed under HKCU or HKLM
  - no leftover `HKCU\Software\album-mastering-studio\Album Mastering Studio` key existed
- Desktop TypeScript/Vite build passed after adding the MSI smoke.
- Desktop CLI contract integration test passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Honest gaps:

- A true elevated MSI install/uninstall smoke is still unverified.
- MSI upgrade behavior from an older installed version is still unverified.

### NSIS Installed-App Smoke Slice

- Added a reusable NSIS installed-app smoke:
  - `desktop/tests/tauri-nsis-install-smoke.mjs`
  - `npm run test:tauri-nsis`
- The smoke preflights that no current-user Album Mastering Studio install exists:
  - `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Album Mastering Studio`
  - `HKCU\Software\Album Mastering Studio`
  - `%LOCALAPPDATA%\Album Mastering Studio`
- The generated NSIS package is current-user and installs to:
  - `C:\Users\Daniel Kinsner\AppData\Local\Album Mastering Studio`
- The smoke installs silently with shortcuts disabled:
  - `Album Mastering Studio_0.1.0_x64-setup.exe /S /NS`
- It then launches the installed EXE through the existing release launch smoke and verifies:
  - app text includes `Album Mastering Studio`
  - Tauri invoke is available
  - `native_audio_probe` returns `Wasapi`
  - `analyze_tracks` returns one analyzed fixture track
  - `render_track_master` creates a manifest, dashboard, and mastered WAV
  - `run_export_checks` returns `warn` only because the generated fixture triggers the existing limiter-pressure advisory
  - required manifest, track-output, and meter checks pass
- Finally it runs the installed uninstaller silently and verifies cleanup:
  - install exit code: `0`
  - launch smoke exit code: `0`
  - uninstall exit code: `0`
  - installed EXE removed
  - install directory removed
  - uninstall registry key removed
  - manufacturer registry key absent
- Evidence output:
  - `test-output/tauri-nsis-install-smoke/tauri-nsis-install-smoke.json`
  - `test-output/tauri-nsis-install-smoke/release-launch/tauri-release-launch-smoke.json`
  - `test-output/tauri-nsis-install-smoke/release-launch/tauri-release-launch.png`

Verification:

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

- NSIS install smoke passed.
- The installed app path, not the repo build tree, launched and rendered successfully.
- The silent uninstaller removed the app and registry entries; the harness polls for cleanup because registry removal can lag briefly after uninstaller process exit.
- Desktop TypeScript/Vite build passed after adding the NSIS smoke.
- Desktop CLI contract integration test passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Honest gaps:

- The MSI package still has not been installed and smoke-tested.
- This does not prove installer upgrade behavior from an older installed version.

### Release Package Build / Launch Smoke Slice

- Ran the documented Windows package build through Visual Studio Build Tools:
  - `npm run tauri:build`
  - Tauri `beforeBuildCommand` re-ran `npm run build && npm run build:sidecars`.
- Confirmed the release build produced the launchable app and installer artifacts:
  - `desktop/src-tauri/target/release/album-mastering-studio.exe`
    - size: `9791488`
    - last write: `2026-05-12 01:00:27`
  - `desktop/src-tauri/target/release/bundle/nsis/Album Mastering Studio_0.1.0_x64-setup.exe`
    - size: `149834748`
    - last write: `2026-05-12 01:00:27`
  - `desktop/src-tauri/target/release/bundle/msi/Album Mastering Studio_0.1.0_x64_en-US.msi`
    - size: `177696768`
    - last write: `2026-05-12 00:58:25`
- Confirmed the release resources include the rebuilt sidecar package:
  - `desktop/src-tauri/target/release/resources/engine/album-master-engine.exe`
    - size: `53810132`
    - last write: `2026-05-12 00:57:28`
  - `desktop/src-tauri/target/release/resources/ffmpeg/ffmpeg.exe`
  - `desktop/src-tauri/target/release/resources/ffmpeg/ffprobe.exe`
- Added a reusable release launch smoke:
  - `desktop/tests/tauri-release-launch-smoke.mjs`
  - `npm run test:tauri-release`
- The release smoke launches the built release EXE, opens WebView CDP, verifies Tauri invoke availability, writes a synthetic WAV fixture, and runs:
  - `native_audio_probe`
  - `analyze_tracks`
  - `render_track_master`
  - `run_export_checks`
- Release smoke evidence was written to:
  - `test-output/tauri-release-launch-smoke/tauri-release-launch-smoke.json`
  - `test-output/tauri-release-launch-smoke/tauri-release-launch.png`
- Smoke result confirmed:
  - app text included `Album Mastering Studio`
  - analysis count: `1`
  - waveform bins: `32`
  - rendered track count: `1`
  - track manifest exists
  - track dashboard exists
  - track WAV exists
  - native audio host: `Wasapi`
  - export checks status: `warn`
  - warning reason: generated fixture was dense enough to trigger the existing limiter-pressure advisory
  - required output checks still passed

Verification:

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
- MSI and NSIS installer bundles were produced.
- Release EXE launch smoke passed.
- Desktop TypeScript/Vite build passed after the release smoke was added.
- Desktop CLI contract integration test passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- The smoke exercised the release Tauri command path through the packaged Python engine and bundled FFmpeg resources.
- No release app process remained running after the smoke; port `9341` only showed normal `TimeWait` cleanup immediately after process exit.

Honest gaps:

- The MSI/NSIS installers were built but not installed onto this machine in this slice.
- This was a release EXE/package-resource smoke, not a full installed-app upgrade/uninstall test.

### Sidecar Refresh / Boundary Package Smoke Slice

- Rebuilt the bundled Python engine sidecar after the boundary primitive engine changes.
- Refreshed bundled audio resources through the normal desktop script:
  - `desktop/src-tauri/resources/engine/album-master-engine.exe`
  - `desktop/src-tauri/resources/ffmpeg/ffmpeg.exe`
  - `desktop/src-tauri/resources/ffmpeg/ffprobe.exe`
- Confirmed the rebuilt sidecar timestamp and size:
  - `album-master-engine.exe`
  - size: `53808973`
  - last write: `2026-05-12T00:30:21-07:00`
- Ran a direct sidecar render smoke using a generated two-track boundary project:
  - `generated_transitions: false`
  - `default_boundary_style: gap`
  - `default_boundary_duration: 0.5`
  - one transition row with `enabled: false`, `boundary_style: gap`, and `boundary_duration_seconds: 0.5`
- Sidecar smoke output confirmed:
  - album WAV exists
  - `interlude_count: 0`
  - sequence types: `track,boundary,track`
  - cue types: `track,boundary,track`
  - manifest preserves `generated_transitions: false`
  - manifest preserves `default_boundary_style: gap`
  - manifest preserves `default_boundary_duration: 0.5`

Verification:

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
- The rebuilt `album-master-engine.exe --help` command returned the expected CLI command list.
- Direct sidecar boundary render passed and produced the expected boundary-only album manifest.
- Desktop TypeScript/Vite build passed.
- Rust `cargo check` passed.
- Focused Python boundary primitive regression passed.

Interpretation:

- The normal installed/release engine resource now includes the boundary primitive code, while debug Tauri still uses source Python by default after the previous launcher fix.
- Full installer packaging was not run in this slice; this was a sidecar freshness and direct sidecar behavior gate.

### Boundary Primitives / Dev Engine Source Loop Slice

- Added explicit Album Master boundary primitive support to the Python project/render contract:
  - `direct`
  - `gap`
  - `fade`
  - `ring-out`
  - `crossfade`
- Extended `TransitionSpec` with:
  - `boundary_style`
  - `boundary_duration_seconds`
- Generated interludes remain on the existing `enabled: true` transition path.
- Boundary primitives run when generated interludes are disabled:
  - `direct`: track-to-track adjacency, no generated audio
  - `gap`: inserts silence as a boundary chunk
  - `crossfade`: creates an equal-power overlap boundary chunk
  - `fade`: fades outgoing tail and incoming head without generated interlude audio
  - `ring-out`: fades outgoing tail and inserts silence
- Manifests now preserve boundary intent:
  - `settings.generated_transitions`
  - `settings.default_boundary_style`
  - `settings.default_boundary_duration`
  - `sequence` entries of type `boundary` when a non-direct primitive is used
  - cue points of type `boundary` for primitives that create a discrete album-sequence chunk
- Disabled/generated-off transitions no longer apply album edge-treatment EQ/saturation moves to the individual masters.
- Added Tauri UI controls:
  - `Boundary`
  - `Boundary Seconds`
- User presets/settings chains now include boundary primitive settings.
- Updated the runtime WebView smoke to render a boundary-only Album Master project through the typed Tauri command and verify:
  - album WAV exists
  - `interlude_count` is `0`
  - sequence types are `track,boundary,track`
  - cue types are `track,boundary,track`
  - manifest settings preserve `generated_transitions: false`, `default_boundary_style: gap`, and `default_boundary_duration: 0.5`
- Fixed the Tauri dev engine loop:
  - debug/dev builds now prefer the source Python engine
  - release builds still prefer the bundled `album-master-engine.exe`
  - `ALBUM_MASTER_USE_SIDECAR=1` can force sidecar use in debug when needed
  - `ALBUM_MASTER_ENGINE` still remains the hard override

Verification:

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

Live Tauri verification:

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

- Node syntax checks passed.
- Desktop TypeScript/Vite build passed.
- Targeted boundary regression tests passed.
- Python compile and all 17 Python unit tests passed.
- Desktop integration test passed.
- Rust format and `cargo check` passed.
- First live runtime attempt correctly exposed that Tauri dev was using the stale bundled sidecar; after the Rust launcher fix, the runtime smoke passed.
- Runtime WebView smoke evidence:
  - `boundaryAlbumSequenceExists: true`
  - `boundaryInterludeCount: 0`
  - `boundarySequenceTypes: track,boundary,track`
  - `boundaryCueTypes: track,boundary,track`
  - `boundarySettings.generated_transitions: false`
  - `boundarySettings.default_boundary_style: gap`
  - `boundarySettings.default_boundary_duration: 0.5`
- Broad UI smoke evidence:
  - generated transitions default off
  - generated transitions opt-in works
  - boundary defaults to `direct`
  - `gap` can be selected
  - boundary duration can be set to `3.0 s`
- Real-song Album Master smoke still passed with generated transitions explicitly enabled:
  - 2 rendered interludes
  - export receipt status `pass`
  - 20-second native album playback probe with `0` stream errors
- Hidden Tauri/Vite/WebView processes were stopped after verification.
- Ports `1420` and `9340` were confirmed clear.
- Temporary `test-output\tauri-dev-9340.*.log` files were removed.

Interpretation:

- Album Master now has reliable non-generated boundary primitives in the project/engine contract and Tauri UI.
- This keeps generated interludes available as an opt-in creative path while making safer boundary primitives the product path.
- Per-boundary customization is still global for now; there is not yet a per-transition boundary editor.
- Human listening review is still required before treating any primitive as musically approved for final album work.

### Album Boundary Defaults / Transition Opt-In Slice

- Changed Album Master so generated transitions are explicit opt-in instead of the default.
- Added `transitionsEnabled` to the Tauri settings model and autosaved session/settings chain path.
- The default Album Master project now preserves direct source boundaries:
  - `generated_transitions: false`
  - transition rows are still written into `.ams.json`
  - each transition is marked `enabled: false` unless the user opts in
- Added a visible Album Master checkbox:
  - `Generated transitions`
- Save Project and render paths now use the saved/generated transition setting instead of assuming every Album Master render should generate interludes.
- Project loading preserves old projects:
  - explicit `generated_transitions` is respected
  - older projects infer opt-in from enabled transition rows
- Preserved the existing generated-transition path by setting the real-song Album Master smoke fixture to opt in explicitly.
- Added a Python engine regression for all-disabled project transitions:
  - no interludes rendered
  - album sequence still exists
  - cue points contain only track chunks
  - no interlude WAVs are written

Verification:

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

Live Tauri verification:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9338'
npm run test:tauri-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='20'
npm run test:tauri-real-song-album-playback
```

Results:

- Node syntax checks passed.
- Desktop TypeScript/Vite build passed.
- Targeted Python boundary regression passed.
- Python compile and all 16 Python unit tests passed.
- Desktop integration test passed.
- Rust `cargo check` passed.
- Broad Tauri UI smoke passed and now verifies:
  - Album Master opens with generated transitions off by default
  - the user can opt in via the visible checkbox
  - existing role override, user preset, listening checklist, waveform, loop, and native status coverage still pass
- Real-song Album Master smoke passed with generated transitions explicitly enabled and still verifies:
  - 2 rendered interludes
  - export receipt status `pass`
  - 20-second native album playback probe with `0` stream errors
- Hidden Tauri/Vite/WebView processes were stopped after verification.
- Ports `1420` and `9338` were confirmed clear.
- Temporary `test-output\tauri-dev-9338.*.log` files were removed.

Interpretation:

- This aligns Album Master with the product canon's "preserve boundaries by default" rule while keeping generated interludes available when the user opts in.
- Reliable gap/crossfade/fade/ring-out primitive UI is still not implemented.
- The Python engine still supports generated interludes; this slice changes the product default, not the engine's capability.

### Export Checks / Quality Receipt Slice

- Added a typed Rust/Tauri command:
  - `run_export_checks`
- The command accepts a render manifest and returns a local/offline quality receipt with:
  - overall status: `pass`, `warn`, or `fail`
  - summary counts for tracks, transitions, and warnings
  - check rows for manifest shape, rendered track outputs, finite meter values, Album WAV, Codec QC, and advisory warnings
- Strengthened the receipt checks so rendered track outputs, Album WAV, and codec-preview outputs must exist on disk, not just appear as non-empty manifest strings.
- Wired the Tauri Track/Album surface to run export checks after:
  - Track Master export
  - Album Master export
  - render-faithful Track preview
- Added a visible `Quality Checks` receipt panel that shows the latest current render's export-check status and per-check details.
- Existing dirty/stale paths clear the receipt so the UI does not show old checks after settings or track changes.
- Extended smoke coverage:
  - direct WebView command smoke now invokes `run_export_checks` for Track Master and Album Master manifests
  - real-song Album Master UI smoke now verifies the visible export receipt and confirms `Track outputs` and `Album WAV` pass on the MP3-derived album fixture

Verification:

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

Live Tauri verification:

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

- Node syntax checks passed.
- Desktop TypeScript/Vite build passed.
- Desktop integration test passed.
- Rust `cargo check` passed.
- Python compile and Python unit tests passed.
- Runtime WebView smoke passed and now verifies export-check command output:
  - Track Master receipt: `warn`, `1 track(s), 0 transition(s), 1 warning(s)`
  - Album Master receipt: `warn`, `2 track(s), 1 transition(s), 2 warning(s)`
  - check labels include `Manifest`, `Track outputs`, `Meter values`, `Album WAV`, `Codec QC`, and `Advisory warnings`
- Broad UI smoke still passed after the receipt UI/style changes.
- Real-song Album Master playback smoke passed and now verifies:
  - export receipt is visible after render
  - real-song receipt status is `pass`
  - real-song receipt summary is `3 track(s), 2 transition(s), 0 warning(s)`
  - `Track outputs` status is `pass`
  - `Album WAV` status is `pass`
  - 20-second native album playback probe played `960000` frames with `0` stream errors
- Hidden Tauri/Vite/WebView processes were stopped after verification.
- Ports `1420` and `9337` were confirmed clear.
- Temporary `test-output\tauri-dev-9337.*.log` files were removed.

Interpretation:

- The app now has an automatable, visible "do these export artifacts exist and do they look sane?" receipt for the current render.
- This is still not final release metering, human listening approval, or platform-specific release validation.
- The receipt is latest-render oriented; it is not a full render-history library yet.

### User Presets / Settings Chain Slice

- Added local Rust/Tauri user preset commands:
  - `list_user_presets`
  - `save_user_preset`
- User presets are stored offline under the normal app state folder:

```text
Documents\Album Mastering Studio\State\user-presets.json
```

- Presets store reusable mastering settings only, not output paths, artist metadata, project names, or source file paths.
- The saved settings chain includes shared Track/Album settings such as:
  - preset
  - delivery profile
  - target LUFS / ceiling
  - sample rate / bit depth / output format / codec QC
  - transition style/duration
  - album arc/intensity
  - Low/Mid/High, warmth, limiter, width, intensity, and LUFS offset
- Added a `User Presets` panel to the Tauri controls rail:
  - preset name input
  - `Save`
  - saved preset selector
  - `Apply`
- Applying a user preset uses the existing settings update path, so it marks current previews/renders stale instead of pretending an old render matches the new chain.
- The UI smoke backs up and restores `user-presets.json` so automated tests do not leave a `Codex Smoke Chain` preset on the user's machine.

Verification:

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

Live Tauri verification:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9336'
npm run test:tauri-ui
```

Results:

- Node syntax check passed.
- Desktop TypeScript/Vite build passed.
- Desktop integration test passed.
- Rust `cargo check` passed.
- Python compile passed.
- Broad Tauri UI smoke passed and now verifies:
  - the user preset panel exists
  - `Codex Smoke Chain` can be saved
  - saved preset list count is at least 1
  - switching back to Universal then applying the saved user preset returns the active preset to Clarity
  - existing Album Story / Roles, listening checklist, live preview, waveform region, loop, and Volume Match checks still pass
- `git diff --check` passed with only normal LF-to-CRLF warnings.
- Hidden Tauri/Vite/WebView processes were stopped after verification.
- Ports `1420` and `9336` were confirmed clear.
- Temporary `test-output\tauri-dev-9336.*.log` files were removed.

Interpretation:

- This closes the automatable part of the custom settings-chain gate in the current Tauri shell.
- It does not add cloud sync, preset import/export files, delete/rename UI, or a render history library; those are still later features.

### Album Story / Roles Review Slice

- Added a visible `Album Story / Roles` review block to the Album Master controls rail.
- The review block appears in Album Master mode and shows one card per track.
- Before render, each card uses humble analysis-based language:
  - likely sequence role from position
  - likely character from local analysis when available
  - confidence/status text such as `Moderate`, `Unsure`, `Manual override`, or `Needs analysis`
  - a short rationale for why the role may matter
- After render, the same block uses manifest-backed story data when the render is current:
  - `album_story`
  - per-track `character.display_name`
  - per-track `character.confidence`
  - `arc.role`
  - `rationale` / mastering rationale
- Each role card includes an `Override role` select that writes back to the existing per-track `character` field, preserving the Python project/engine contract.
- This makes the Album Master path visibly reviewable before export instead of hiding story/role decisions only in the post-render dashboard.

Verification:

```powershell
cd desktop
node --check tests/tauri-webview-ui-smoke.mjs
node --check tests/tauri-real-song-album-ui-smoke.mjs
npm run build
npm run test:integration
cd ..\desktop\src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check
cd ..\..
python -m compileall -q src tests
```

Live Tauri verification:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9335'
npm run test:tauri-ui
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='20'
npm run test:tauri-real-song-album-playback
```

Results:

- Node syntax checks passed.
- Desktop TypeScript/Vite build passed.
- Desktop integration test passed.
- Rust `cargo check` passed.
- Python compile passed.
- Broad Tauri UI smoke passed and now verifies:
  - `Album Story / Roles` is visible in Album Master
  - 2 role cards are rendered for the seeded UI session
  - a role override select can set `Codex UI Fixture A` to `heavy_djent`
  - autosave persists that role override
- Real-song Album Master UI smoke passed and now verifies:
  - `Album Story / Roles` is visible before render
  - 3 role cards are visible for the MP3-derived album fixture
  - `Album Clip 2` can be overridden to `heavy_djent` before export
  - the rendered manifest records that override as `renderedOverrideCharacter: "heavy_djent"`
  - the rendered manifest includes a non-empty album story
  - the previous Album WAV native playback checks still pass
- Real-song album playback evidence from this run:
  - rendered `album_sequence.wav` duration: `36.767` seconds
  - native file playback started as `Native file: album_sequence.wav`
  - visible native seek reached `2.0` seconds
  - 20-second stability probe played `960000` output frames
  - `callback_count: 2000`
  - `p95_callback_interval_ms: 10.616`
  - `max_callback_interval_ms: 10.985`
  - `stream_errors: []`
  - `warnings: []`
- `git diff --check` passed with only normal LF-to-CRLF warnings.
- Hidden Tauri/Vite/WebView processes were stopped after verification.
- Ports `1420` and `9335` were confirmed clear.
- Temporary `test-output\tauri-dev-9335.*.log` files were removed.

Interpretation:

- This closes the automatable part of the Album Master Track Roles / Story review gate.
- It does not make the role classifier a robust genre model; the UI intentionally says likely/moderate/unsure before render.
- Human review and true multi-song album testing still remain.

### Native Full-File Transport Slice

- Added `start_native_file_playback` to the Tauri/Rust backend.
- The new native command plays a prepared playback-cache WAV through the same CPAL session model already used by native A/B:
  - active/inactive status
  - pause/resume
  - seek
  - stop
  - output-device reporting
  - callback telemetry
  - stream errors and warnings
- Kept file playback bounded with `NATIVE_FILE_PLAYBACK_MAX_MS` at one hour, because the current native transport pre-buffers playback-cache WAV samples.
- Generalized `read_pcm16_wav_segment` to accept an optional duration while keeping short probes and A/B loops bounded.
- Added a visible `Native Play` / `Native Stop` button to the Tauri transport for the currently prepared source/master/album/transition item.
- Kept `Native A/B` separate as the bounded source/master comparison loop.
- Updated native status and pause/resume labels so the UI distinguishes `Native A/B` from generic `Native playback`.
- Updated smoke coverage:
  - runtime WebView smoke now starts native file playback, pauses, seeks, resumes, and stops it
  - real-song native A/B UI smoke uses the renamed `Native playback position` slider
  - real-song Album UI smoke now includes visible native Album WAV play/pause/seek/resume/stop coverage

Verification already run:

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

Live Tauri verification already run:

```powershell
cd desktop
$env:TAURI_CDP_PORT='9334'
npm run test:tauri-webview
$env:AMS_REAL_SONG_PATH='C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3'
npm run test:tauri-real-song-native-ui
$env:AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS='20'
npm run test:tauri-real-song-album-playback
npm run test:tauri-ui
```

Results:

- Node syntax checks passed.
- Rust `cargo check` passed.
- Desktop TypeScript/Vite build passed.
- Desktop integration test passed.
- Python compile passed.
- Runtime WebView smoke passed, including direct `start_native_file_playback` pause/seek/resume/stop evidence.
- Real-song visible Track Master native A/B UI smoke passed against `Lay the Money on the Desk (1).mp3`.
- Real-song visible Album Master UI smoke passed against MP3-derived clips from `Lay the Money on the Desk (1).mp3`.
- Broad Tauri UI smoke passed after adding the native file transport button.
- Album WAV native transport evidence:
  - `Native file: album_sequence.wav`
  - visible native status text: `Native playback playing`
  - visible seek slider used to reach `2.0` seconds
  - visible stop returned status text to `Native transport ready`
  - output device: `Headphones (HyperX Cloud Alpha Wireless)`
  - source duration: `36.36697916666667` seconds
  - queued output frames: `1745615`
- Album WAV 20-second native stability probe:
  - `callback_count: 2000`
  - `played_output_frames: 960000`
  - `avg_callback_interval_ms: 9.999973986993481`
  - `p95_callback_interval_ms: 10.63`
  - `max_callback_interval_ms: 10.734`
  - `stream_errors: []`
  - `warnings: []`

Pending before calling this slice fully closed:

- None for this automated slice.
- `git diff --check` passed with only normal LF-to-CRLF warnings.
- Hidden Tauri/Vite/WebView processes were stopped after live smokes.
- Ports `1420` and `9334` were confirmed clear.
- Temporary `test-output\tauri-dev-9334.*.log` files were removed.

Interpretation:

- This closes the direct native full-file command contract and the visible Track Master native regression.
- It closes the automatable real-song Album WAV visible native transport gate for the one provided MP3-derived fixture.
- The native full-file path is still a pre-buffered local playback-cache path, not a streaming engine or export-DSP parity path.

### Track Master Rebuild Slice

- Started the rebuild from the current Tauri desktop surface, with `docs/PRODUCT.md`, `docs/IMPLEMENTATION_PLAN.md`, `AGENTS.md`, and `docs/codex-active-handoff.md` as the working anchors.
- Created a Codex goal for the rebuild so future compactions/resumes have an explicit objective.
- Replaced the mixed album-first desktop layout with a Track Master-first workstation in `desktop/src/App.tsx`.
- Added an intent mode switch for `Track Master` and `Album Master`.
- Made Track Master the default surface with:
  - left imported-track rail
  - large waveform audition area
  - waveform zoom control
  - drag region selection on the waveform
  - loop selected region
  - same-position Original/Mastered A/B toggle
  - optional Volume Match playback gain, off by default
  - product-facing preset tiles: Universal, Clarity, Tape, Spatial, Oomph, Warmth, Punch, Energy
  - Intensity plus Low/Mid/High first-layer controls
  - collapsed advanced controls
  - quality-check panel for selected-track warnings
- Added independent Track Master export behavior: multiple imported songs render as separate one-track projects under a timestamped `track-master-*` output root instead of being treated as an album sequence.
- Preserved Album Master mode with album export, masters-only export, arc/transition controls, per-track role/preset overrides, continuous album playback, transition playback, dashboard embedding, and the existing Python CLI project contract.
- Extended the frontend `Track` type with mastered analysis, quality warnings, and last output folder metadata so A/B, Volume Match, and output review can stay tied to the selected track.
- Reworked `desktop/src/styles.css` around a restrained hardware-console palette with charcoal, muted green/steel, brass state accents, and red warnings.

Verification:

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
- Vite dev server responded on `http://127.0.0.1:1420` with HTTP 200; visual screenshot was not captured because no `msedge` or `chrome` headless command was available in this shell.

Remaining honest gaps:

- The waveform selection/loop UI is implemented, but it has not yet been manually exercised inside the Tauri webview.
- Track Master preview is still whole-track offline rendering through the Python engine, not real-time DSP.
- Volume Match uses available source/master LUFS values to adjust playback volume; it depends on analysis/preview data and does not change export level.
- Autosave and undo/redo are still pending.
- Rust/Tauri commands are still generic CLI bridge calls rather than the typed command layer described in the implementation plan.
- A native audio/real-time audition spike has not started.

Next move:

- Exercise the new Track Master path in the Tauri app with real or private fixture audio: add, analyze, preview, A/B, select/loop region, export, inspect warnings, and open output.
- Then decide whether the next verified slice should be typed Rust commands or native/real-time audition.

### Autosave And Undo/Redo Slice

- Added Rust/Tauri `autosave_session` and `load_recent_session` commands in `desktop/src-tauri/src/lib.rs`.
- Autosaves write to the user's local Documents app state folder:

```text
Documents\Album Mastering Studio\State\recent-session.json
```

- Added frontend startup restore for the recent session, preserving mode, settings, imported tracks, selected track, project path, waveform region, zoom, Volume Match state, loop state, and advanced panel state.
- Added undo/redo snapshots for non-destructive user state:
  - mode changes
  - presets and tuning controls
  - metadata/session settings
  - track add/remove/reorder/title/role/preset edits
  - album arc and transition settings
- Added Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y handling.
- Added toolbar Undo/Redo icon buttons.
- Undo/redo intentionally invalidates mastered preview/render pointers instead of pretending old audio still matches the restored settings. Rendered files are not deleted.
- Kept autosave as app state, not an explicit `.ams.json` project save replacement.

Verification:

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
- Rust/Tauri `cargo check` passed with the local cargo binary. Plain `cargo` was not on this shell's PATH.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track transition, and 8-track workflow.

Remaining honest gaps:

- Autosave/undo/redo have compile and app-shell command coverage, but not a dedicated automated UI regression test.
- The new restore path has not yet been manually exercised in the running Tauri app.
- Rendered output history/library remains later; undo/redo only restores non-destructive session state.

### Typed Product Command Slice

- Added typed Rust/Tauri commands for the primary product actions:
  - `analyze_tracks`
  - `render_track_master`
  - `render_album_master`
- Kept the Python CLI as the engine contract. The new Rust commands still call the local engine sidecar/dev fallback, but the frontend no longer assembles raw `render-project`, `score-render`, or `export-dashboard` argument arrays for the main product flows.
- Moved render-project JSON writing, manifest loading, local score generation, and dashboard export behind the typed render commands.
- Updated Track Master export so each independent track render calls `render_track_master` and receives a structured manifest/dashboard result.
- Updated Album Master render so album project writing, audio render, scoring, dashboard export, and returned project path are owned by `render_album_master`.
- Updated preview rendering to use the Track Master command path, keeping preview behavior aligned with the export behavior.
- Updated analysis to call `analyze_tracks` with typed `paths`, `sampleRate`, and `waveformBins` parameters.

Verification:

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

Remaining honest gaps:

- The typed commands have build/check coverage, but no dedicated command-level integration test yet.
- The frontend still uses generic JSON commands for project open/save, which is intentional for now.
- `run_cli` remains available in Rust as a fallback engine bridge, but it is no longer used by the primary frontend product actions.
- Runtime invocation of the typed commands still needs a live Tauri/webview exercise on real or fixture audio.

### Tauri WebView Runtime Smoke Harness

- Launched the real Tauri dev app with WebView2 remote debugging enabled:

```powershell
cd desktop
cmd /c 'set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222" && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:dev'
```

- Confirmed the app opened as a native Tauri window titled `Album Mastering Studio`.
- Confirmed WebView2 exposed a debuggable page target at `http://127.0.0.1:9222/json/list`.
- Exercised the live WebView command bridge against synthetic local WAV fixtures:
  - `analyze_tracks`
  - `render_track_master`
  - `prepare_playback_file`
  - `render_album_master`
- Verified the runtime smoke produced:
  - 2 analysis rows with 48 waveform bins each
  - 1 Track Master render
  - Track Master `manifest.json`
  - Track Master `dashboard.html`
  - Track Master mastered WAV
  - playback-cache WAV
  - 2-track Album Master render
  - Album Master `manifest.json`
  - Album Master `dashboard.html`
  - `album_sequence.wav`
  - Tauri WebView screenshot
- Added a reusable dependency-free smoke script: `desktop/tests/tauri-webview-runtime-smoke.mjs`.
- Added npm script: `npm run test:tauri-webview`.

Verification:

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
- Runtime smoke evidence was written to `test-output\tauri-webview-runtime-smoke\tauri-webview-runtime-smoke.json`.
- Tauri WebView screenshot was written to `test-output\tauri-webview-runtime-smoke\tauri-webview.png`.
- Desktop TypeScript/Vite build passed after adding the harness.
- Desktop CLI contract test passed after adding the harness.
- `git diff --check` passed. Git reported normal LF-to-CRLF working-copy warnings only.

Remaining honest gaps:

- This smoke invokes product commands from inside the actual Tauri WebView, but it does not yet click through the React UI controls or file picker.
- It verifies typed command/runtime/sidecar behavior and render artifacts, not human listening quality.
- Real-time or near-real-time audition remains unimplemented.

### Tauri WebView UI Smoke Harness

- Added a second live-WebView smoke script: `desktop/tests/tauri-webview-ui-smoke.mjs`.
- Added npm script: `npm run test:tauri-ui`.
- The script uses the same WebView2/CDP path as the runtime smoke, then temporarily seeds the app autosave with two synthetic analyzed tracks so the React UI has waveform and analyzed-track state without controlling the native file picker.
- The script backs up and restores `Documents\Album Mastering Studio\State\recent-session.json` so the user's recent session is not left replaced by test data.
- The UI smoke verifies:
  - Track Master is the initial mode.
  - Two seeded tracks appear in the left rail.
  - Universal is the initial preset.
  - Clarity preset tile changes the active preset.
  - Undo returns the preset to Universal.
  - Redo returns the preset to Clarity.
  - Album Master mode switch reveals album controls.
  - Switching back returns to Track Master.
  - Advanced controls expand and show advanced fields.
  - Volume Match toggles active.
  - Waveform zoom updates the readout to `2.0x`.
  - Dragging on the waveform creates a region.
  - Loop enables and becomes active after a region exists.
  - Clear Region clears the region and disables Loop.
  - A live Tauri WebView screenshot is captured.

Verification:

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
- UI smoke evidence was written to `test-output\tauri-webview-ui-smoke\tauri-webview-ui-smoke.json`.
- UI smoke screenshot was written to `test-output\tauri-webview-ui-smoke\tauri-webview-ui.png`.
- `npm run test:tauri-webview` still passed after adding the UI harness.
- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Python compile passed.
- `git diff --check` passed. Git reported normal LF-to-CRLF working-copy warnings only.
- The Tauri dev app and ports `1420` / `9222` were stopped after verification.

Remaining honest gaps:

- This verifies UI state transitions through React controls, but it still does not operate the native Add/Open file picker.
- Region creation is verified as UI state; the seeded UI did not load audio metadata, so the region time readout remained `00:00 - 00:00`.
- It does not verify subjective listening quality or real-time/near-real-time audition.

### Real-Time Audition Baseline Slice

- Added a first Web Audio `Live Preview` baseline to the Track Master UI.
- The live path is source-playback only and is explicitly temporary scaffolding for the engine decision work.
- Live controls wired in the Web Audio graph:
  - Low shelf from the `Low` control
  - Mid peaking EQ from the `Mid` control
  - High shelf from the `High` control
  - Simple mid/side width matrix from `Width`
  - Light compressor behavior from positive `Intensity`
  - Existing Volume Match playback gain remains active
- Added 15 ms AudioParam smoothing to avoid zippery control jumps.
- Added `Live Preview` UI button and status readout. In this environment the WebView reported about `10 ms` Web Audio context latency when armed.
- Added `liveAudition` to autosaved/restored non-destructive session state.
- Created `docs/ENGINE_DECISION_RECORD.md` and recorded the Web Audio baseline as temporary, with Rust native audio as the next spike candidate before Track Master can be called release-candidate.
- Extended the Tauri UI smoke to verify the `Live Preview` toggle in the actual Tauri WebView.

Verification:

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

Remaining honest gaps:

- The Web Audio baseline is not export-parity-safe with the Python offline mastering chain.
- It has not had a human listening pass.
- It has not had sustained playback CPU/memory/jitter profiling.
- It does not replace the planned Rust native audio spike.

### Native Audio Probe Slice

- Added `cpal` to the Tauri Rust dependencies as the first native-audio spike dependency.
- Added typed Tauri command `native_audio_probe`.
- The probe reports:
  - default cpal host
  - available cpal hosts
  - default output device name
  - default output config
  - first supported output config ranges
  - fixed-buffer latency estimate when cpal exposes a fixed buffer
  - warnings when static config cannot prove latency
- Extended `desktop/tests/tauri-webview-runtime-smoke.mjs` so the live Tauri WebView runtime smoke invokes `native_audio_probe` before the typed analyze/render commands.

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

Interpretation:

- Rust/Tauri can see the native WASAPI output path.
- The default device is the user's Focusrite USB audio output.
- Static config does not expose a fixed default buffer, so the next native spike needs actual stream callback cadence/dropout measurement.

Verification:

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

Remaining honest gaps:

- No native stream is opened yet.
- No callback cadence, dropout, or CPU/memory measurement yet.
- No native source/master A/B playback yet.
- The Web Audio baseline remains the only live audition path in the UI.

### Native Stream Cadence Probe Slice

- Completed the next native-audio spike by adding typed Tauri command `native_audio_stream_probe`.
- The command opens the default `cpal` output stream, writes silence for a bounded probe window, records callback timestamps/frame counts, captures stream errors, and tears the stream down.
- Registered the command in the Tauri invoke handler.
- Extended `desktop/tests/tauri-webview-runtime-smoke.mjs` so the live Tauri WebView runtime smoke calls both `native_audio_probe` and `native_audio_stream_probe`.

Runtime evidence from this machine:

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

Interpretation:

- Rust/Tauri can open a native WASAPI output stream on the Focusrite output.
- The measured callback cadence is roughly 10 ms in this environment.
- Buffer sizes can vary at callback boundaries, so real playback code must handle variable callback frame counts.
- This is still silence-only. It does not yet prove decode/playback, source/master A/B, looped regions, sustained stability, or live/export parity.

Real-song Track Master test:

- Used the user-provided local MP3 `C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3` as an ad hoc fixture through the live Tauri WebView typed command path.
- Invoked `analyze_tracks`, `render_track_master`, and `prepare_playback_file` from the running Tauri WebView via CDP.
- Output folder: `test-output\real-song-track-master`.
- Produced `masters\01_lay-the-money-on-the-desk_mastered.wav`, `manifest.json`, `scorecard.json`, `dashboard.html`, `track.ams.json`, and a playback-cache WAV.
- Manifest result: 1 track, 0 interludes, 0 render warnings.
- Source analysis: `-12.44 LUFS`, `-0.43 dBFS` true-peak proxy.
- Render analysis: `-15.80 LUFS`, `-3.37 dBFS` true-peak proxy.
- Character inference: `acoustic_folk` at confidence `0.5463`.
- Local scorecard overall: `0.8462`.

Verification:

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
- `npm run test:tauri-webview` passed against the running Tauri WebView and captured native stream cadence evidence.
- `npm run test:tauri-ui` still passed.
- Desktop TypeScript/Vite build passed.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders.
- Real-song Track Master run passed through the Tauri command path.

Remaining honest gaps:

- Native stream is silence-only; it is not a native player yet.
- No native decode, source/master toggle, looped region playback, or gain-matched A/B exists yet.
- No sustained native playback CPU/memory/dropout measurement yet.
- Web Audio `Live Preview` remains the only in-UI live audition path.

### Native Playback Cache Probe Slice

- Added typed Tauri command `native_playback_file_probe`.
- The command reads a bounded segment from the existing playback-cache WAV file produced by `prepare_playback_file`.
- It currently supports the deliberate playback-cache boundary format: RIFF/WAVE PCM 16-bit stereo 48 kHz.
- It writes real audio samples to the default `cpal` output stream and records callback cadence, consumed frames, stream errors, and warnings.
- Extended `desktop/tests/tauri-webview-runtime-smoke.mjs` so the live Tauri WebView runtime smoke renders a Track Master fixture, creates the playback-cache WAV, then verifies native playback from that cache.

Runtime evidence from this machine:

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

Interpretation:

- Rust/Tauri can now play actual cached audio samples through the native Focusrite/WASAPI path.
- The probe consumed the full queued 500 ms segment with no stream errors.
- Callback cadence remained around 10 ms while writing real audio, not just silence.
- The implementation remains a bounded proof command. It is not yet the user-facing transport.

Verification:

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
- `git diff --check` passed before doc edits, with normal LF-to-CRLF working-copy warnings only.

Remaining honest gaps:

- Native playback is still a synchronous bounded probe, not a persistent transport.
- No native UI controls exist yet for source/master toggle, pause/seek, region loop, or gain-matched A/B.
- No sustained native playback CPU/memory/dropout measurement yet.
- Web Audio `Live Preview` remains the only in-UI live audition path.

### Native A/B Loop Probe Slice

- Added typed Tauri command `native_ab_loop_probe`.
- The command accepts source and mastered playback-cache WAV paths, reads the same bounded region from each, alternates source/master chunks for a bounded total duration, writes the looped buffer through `cpal`, and records callback/dropout evidence.
- Extended `desktop/tests/tauri-webview-runtime-smoke.mjs` so the live Tauri WebView runtime smoke prepares both source and mastered cache WAVs, then verifies native A/B loop playback.

Runtime evidence from this machine:

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

Interpretation:

- Rust/Tauri can play a bounded native source/master A/B region loop from the existing playback-cache WAV files.
- The probe consumed the full queued 800 ms loop, switched sides 3 times, and reported no stream errors.
- The default output followed the current Windows default output device, which was HyperX headphones for this run.
- This is still not a persistent user-facing transport.

Verification:

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
- `git diff --check` passed before doc edits, with normal LF-to-CRLF working-copy warnings only.

Remaining honest gaps:

- Native A/B playback is still a synchronous bounded probe, not a cancellable/persistent transport.
- No native UI controls exist yet for play/pause/seek/cancel.
- No sustained native playback CPU/memory/dropout measurement yet.
- Web Audio `Live Preview` remains the only in-UI live audition path.

### Native Playback State Manager Slice

- Added Rust-managed native playback session state.
- Added typed Tauri commands:
  - `start_native_ab_loop_playback`
  - `native_playback_status`
  - `stop_native_playback`
- `start_native_ab_loop_playback` prepares a bounded source/master A/B loop from playback-cache WAVs and returns immediately while the native stream runs on a worker thread.
- `native_playback_status` reports active state, elapsed time, queued/played frames, callback count, callback intervals, stream errors, and warnings.
- `stop_native_playback` requests shutdown, joins the worker, drops the stream, and returns the final status.
- Added a Track Master `Native A/B` button that prepares source/master cache files, starts the Rust native A/B loop, polls status, and stops the native session when clicked again.
- Kept `Live Preview` as the Web Audio live-DSP baseline. The new `Native A/B` control is native transport evidence, not export/live DSP parity.
- Extended `desktop/tests/tauri-webview-runtime-smoke.mjs` to verify start/status/stop through the real Tauri WebView command bridge.
- Extended `desktop/tests/tauri-webview-ui-smoke.mjs` to verify the `Native A/B` control is present/enabled and the native status chip is visible.

Runtime evidence from this machine:

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

Verification:

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
- `git diff --check` passed before doc edits, with normal LF-to-CRLF working-copy warnings only.

Remaining honest gaps:

- Native playback still does not expose pause/seek or a full transport timeline.
- Native playback stress evidence is short; no long-running CPU/memory/dropout profile yet.
- `Native A/B` plays cached source/master audio, but Web Audio remains the only live control-change audition path.
- Export-vs-live DSP parity is not claimed.

### Native Playback Stress Smoke Slice

- Added `desktop/tests/tauri-native-stress-smoke.mjs`.
- Added package script `npm run test:tauri-native-stress`.
- The stress smoke:
  - connects to the running Tauri WebView through CDP
  - synthesizes a local stress WAV fixture
  - invokes `analyze_tracks`, `render_track_master`, and `prepare_playback_file`
  - starts an 8-second native source/master A/B loop through `start_native_ab_loop_playback`
  - polls `native_playback_status` until completion
  - samples the Tauri process with PowerShell `Get-Process`
  - writes evidence to `test-output\tauri-native-stress-smoke\tauri-native-stress-smoke.json`

Runtime evidence from this machine:

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

Interpretation:

- The native state manager consumed the full 8-second A/B loop with no stream errors or warnings.
- Callback cadence remained around 10 ms across the longer native run.
- Basic process sampling did not show memory growth during this short stress window.
- This is still short synthetic evidence, not a real-song/manual-listening pass.

Verification:

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
- Normal Tauri WebView runtime smoke passed when run serially.
- Tauri UI smoke passed.
- Desktop CLI contract test passed.
- Rust format/check passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders.
- `git diff --check` passed before doc edits, with normal LF-to-CRLF working-copy warnings only.

Remaining honest gaps:

- Stress smoke is synthetic and 8 seconds, not real-song or full-album duration.
- No pause/seek native transport exists yet.
- No real user listening pass through the `Native A/B` button yet.
- Web Audio remains the live control-change preview path; native playback does not yet apply live tuning controls.

### Real-Song Native A/B UI Smoke Slice

- Added `desktop/tests/tauri-real-song-native-ui-smoke.mjs`.
- Added package script `npm run test:tauri-real-song-native-ui`.
- The smoke requires `AMS_REAL_SONG_PATH`, so the user's private Downloads path is not committed into the repo.
- The smoke backs up and restores the existing autosave, analyzes the provided real MP3 through the Tauri command bridge, seeds a Track Master session with analysis and waveform data, reloads the real WebView, clicks the visible `Native A/B` button, pauses from the visible pause button, seeks with the visible native position slider, resumes from the visible resume button, clicks the same `Native A/B` button again to stop, and writes screenshot/evidence artifacts.

Runtime evidence from the user-provided MP3:

```json
{
  "title": "Lay the Money on the Desk",
  "waveformBins": 256,
  "sourceLufs": -12.444218262030333,
  "sourceTruePeakDbfs": -0.4290349634996211,
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
  },
  "runningStatus": {
    "active": true,
    "paused": false,
    "label": "Native A/B 2000 ms region from 0.00s",
    "output_device": "Headphones (HyperX Cloud Alpha Wireless)",
    "queued_output_frames": 240000,
    "played_output_frames": 60480,
    "callback_count": 182,
    "avg_callback_interval_ms": 9.999878453038678,
    "p95_callback_interval_ms": 10.526,
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

Interpretation:

- The visible Track Master `Native A/B` button now has real-song coverage, not just synthetic WAV coverage.
- The native playback state can be started, paused, sought, resumed, and stopped from the UI with no stream errors or warnings on this machine.
- The visible slider evidence was tightened after an initial weak assertion: the current run confirms the backend position moved to the requested `0.600s` target.
- This is still automated evidence. It does not replace a manual listening pass, native full-track/album transport work, live-control native DSP parity, or a full-album real-song audition.

Verification:

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

- Real-song native UI smoke passed against the provided MP3, including visible pause/resume and position-slider seek.
- Native stress smoke passed after the playback callback cursor/pause changes.
- Tauri UI smoke passed.
- Tauri WebView runtime smoke passed, including direct `pause_native_playback` and `seek_native_playback` command coverage.
- Desktop CLI contract test passed.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed for 1-track, 2-track, and 8-track synthetic renders at `test-output\native-transport-harness-smoke`.
- Rust format/check passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed after the doc/handoff edit, with normal LF-to-CRLF working-copy warnings only.

Remaining honest gaps:

- Native pause/seek currently applies to the bounded source/master A/B audition buffer, not the main full-track/album transport.
- No human listening pass through the `Native A/B` button yet.
- No full-album real-song audition or long-duration real-song playback stability profile yet.
- Web Audio remains the live control-change preview path; native playback does not yet apply live tuning controls.

### Real-Source Album Master UI Smoke Slice

- Added `desktop/tests/tauri-real-song-album-ui-smoke.mjs`.
- Added package script `npm run test:tauri-real-song-album-ui`.
- The smoke requires `AMS_REAL_SONG_PATH`, so the user's private Downloads path is not committed into the repo.
- The smoke derives three local WAV clips from the provided MP3 under `test-output`, seeds Album Master mode in autosave, reloads the real Tauri WebView, clicks visible `Analyze`, waits for visible LUFS evidence and `Export Album` enablement, clicks visible `Export Album`, verifies generated manifest/dashboard/album WAV artifacts, and prepares playback from the visible `Album WAV` and transition artifact buttons.

Runtime evidence from the user-provided MP3-derived Album Master run:

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

Artifacts:

- Evidence JSON: `test-output\tauri-real-song-album-ui-smoke\tauri-real-song-album-ui-smoke.json`
- Screenshot: `test-output\tauri-real-song-album-ui-smoke\tauri-real-song-album-ui.png`
- Manifest/dashboard/album WAV under `test-output\tauri-real-song-album-ui-smoke\album-master-*`

Verification:

```powershell
node --check tests\tauri-real-song-album-ui-smoke.mjs
cd desktop
npm run build
npm run test:tauri-real-song-album-ui
npm run test:tauri-ui
npm run test:integration
npm run test:tauri-webview
```

Results:

- Real-source Album Master UI smoke passed against MP3-derived clips from the provided song.
- Tauri UI smoke passed.
- Desktop CLI contract test passed.
- Tauri WebView runtime smoke passed.
- Desktop TypeScript/Vite build passed.
- `git diff --check` passed after the doc/handoff edit, with normal LF-to-CRLF working-copy warnings only.

Remaining honest gaps:

- The Album Master real-source smoke uses three excerpts from one provided song, not three separate real songs.
- This is automated artifact/playback-prep coverage, not a human listening pass.
- No long-duration full-album playback stability profile has been run on real audio.
- Native pause/seek remains scoped to bounded Track Master A/B audition, not full-track or full-album playback.

### Listening Checklist Surface Slice

- Added a persistent `Listening Pass` panel to the Tauri lower deck.
- Added checklist fields for original playback, mastered playback, native A/B, album WAV, transitions, dashboard review, and listening notes.
- The checklist is included in the autosaved session snapshot and undo/redo history.
- Checklist edits do not mark renders stale because they document human review state rather than changing render settings.
- Extended `desktop/tests/tauri-webview-ui-smoke.mjs` to toggle checklist fields, enter notes, wait for autosave, and verify persistence through `load_recent_session`.

Runtime evidence:

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

Verification:

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

Remaining honest gaps:

- The checklist surface exists, but no actual human listening approval has been recorded.
- No true multi-song Album Master pass has been run with separate real songs.
- No long-duration full-album playback stability profile has been run on real audio.
- Native pause/seek remains scoped to bounded Track Master A/B audition, not full-track or full-album playback.

### Export Vs Live Preview Honesty Slice

- Added a visible `Approx audition` status when Web Audio `Live Preview` is armed, while the offline/export path remains labeled as render-faithful preview.
- Extended the Tauri UI smoke to assert that Live Preview is presented as approximate in the real WebView.
- Extended the Tauri runtime smoke to render a Track Master file through the Python engine, create a deterministic Web Audio-style live-preview model from the same source/settings, write `test-output\tauri-webview-runtime-smoke\live-preview-model.wav`, and record comparison metrics.
- Hardened the WebView smoke harnesses so they wait for the Tauri invoke bridge before seeding sessions or calling typed commands.

Runtime evidence from `test-output\tauri-webview-runtime-smoke\tauri-webview-runtime-smoke.json`:

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

Verification:

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
- Tauri UI smoke passed and captured `previewParityStatus: "Approx audition"`.
- Tauri runtime smoke passed and captured export-vs-live comparison evidence.

Remaining honest gaps:

- This proves the current Live Preview path is approximate; it does not make Web Audio export-parity-safe.
- No human listening approval has been recorded.
- No true multi-song Album Master pass has been run with separate real songs.
- No long-duration full-album playback stability profile has been run on real audio.
- Native pause/seek remains scoped to bounded Track Master A/B audition, not full-track or full-album playback.

### Real-Source Album Playback Stability Slice

- Extended `desktop/tests/tauri-real-song-album-ui-smoke.mjs` so the existing real-source Album Master UI path now performs a bounded native playback stability check on the rendered `album_sequence.wav`.
- Added `npm run test:tauri-real-song-album-playback` as an explicit package script alias for the real-source album playback/stability run.
- Increased `native_playback_file_probe`'s maximum requested duration from 5 seconds to 60 seconds so it can profile full-track/full-album material instead of only short snippets.
- Ran the smoke against the provided local MP3 fixture:

```text
C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3
```

Runtime evidence from `test-output\tauri-real-song-album-ui-smoke\tauri-real-song-album-ui-smoke.json`:

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

Verification:

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
- Real-source Album Master UI smoke passed with 20 seconds of native album WAV playback stability evidence.
- Python compile passed.

Remaining honest gaps:

- The source is still one real MP3 split into three local clips, not a true multi-song album.
- This is automated native playback evidence, not human listening approval.
- Native pause/seek remains scoped to bounded Track Master A/B audition; album WAV full-transport controls still use the WebView path.
- Web Audio Live Preview remains approximate, not export-parity-safe.

## 2026-05-10

### Tauri Desktop Shell Pass

- Added a new Tauri 2 desktop app in `desktop/` using React, Vite, Tailwind, and TypeScript.
- Kept the Python package and CLI as the engine contract. The Rust backend invokes `python -m album_mastering_studio.cli ...`, sets `PYTHONPATH` to the repo `src/`, streams stdout/stderr/status events, reads JSON artifacts, opens OS paths, and can kill the active Python subprocess.
- Added drag-and-drop audio import, add/remove/reorder rows, inline track title edits, preset/delivery/arc/transition controls, fine-tuning sliders, project open/save, output folder open, and an embedded dashboard pane.
- Added HTML5 audio playback for source, selected master, continuous album WAV, reference track, and rendered transition files with play/pause/seek/time display.
- Added waveform thumbnail support through a CLI `analyze --waveform-bins` option, cached in frontend state and rendered on HTML canvas.
- Added `--reference-track` parity to the CLI render/init-project paths and included reference assertions in tests.
- Added `--json-events` for CLI render/render-project and wired the Tauri UI to show stage labels plus determinate progress while the Python engine runs.
- Fixed remaining desktop/Tk issues from the latest critique that were cheap and real: preview folders no longer nest through `last_output_dir`, smoke check preflights FFmpeg, cancel is disabled while idle, Reset Tuning no longer clears track/transition overrides, and album-warning ceiling default now matches the render default.
- Added desktop integration coverage for the CLI contract: synthesize dropped WAVs, analyze with waveform bins, render a manifest, and assert progress events.
- Added generated Tauri folders to `.gitignore` so `desktop/node_modules/`, `desktop/dist/`, and `desktop/src-tauri/target/` do not pollute commits.

Build outputs produced:

```text
desktop\src-tauri\target\release\album-mastering-studio.exe
desktop\src-tauri\target\release\bundle\msi\Album Mastering Studio_0.1.0_x64_en-US.msi
desktop\src-tauri\target\release\bundle\nsis\Album Mastering Studio_0.1.0_x64-setup.exe
```

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-tauri-progress-smoke
cd desktop
npm run build
npm run test:integration
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
```

Results:

- Compile passed.
- Python unit tests passed: 14 tests.
- Product smoke passed, including 1-track, 2-track, and 8-track renders.
- Desktop TypeScript/Vite build passed.
- Desktop integration test passed.
- Tauri release build passed and produced both MSI and setup EXE installers.

Remaining honest gaps:

- The first Tauri shell did not bundle Python/FFmpeg yet. This was fixed in the follow-up standalone packaging pass below.
- Progress is stage-level from CLI JSON events, not per-sample or per-FFmpeg-frame ETA.
- There is no native OS menu yet; Open/Save/Output/About are available in the app header and shortcuts are handled in the webview.
- The Tauri shell does not yet expose single-track render, iteration pass diff/A-B, live arc preview, or per-track tuning values.

### Standalone Packaging / Playback Pass

- Added a PyInstaller engine entrypoint at `desktop/engine/engine_entry.py`.
- Added `desktop/scripts/prepare-sidecars.ps1` and `npm run build:sidecars`.
- Tauri release builds now generate and bundle:
  - `resources/engine/album-master-engine.exe`
  - `resources/ffmpeg/ffmpeg.exe`
  - `resources/ffmpeg/ffprobe.exe`
- Updated the Rust backend so release builds call the bundled engine exe directly, with bundled FFmpeg injected into `PATH`.
- Kept dev fallback behavior: if sidecars are absent, the backend still calls `python -m album_mastering_studio.cli` with the repo `src/` on `PYTHONPATH`.
- Added a default installed-app output folder under `Documents\Album Mastering Studio\Renders` instead of assuming a repo `outputs/` path.
- Hardened playback by adding a Rust `prepare_playback_file` command. Every source/master/album/reference/transition play request is converted through FFmpeg to a cached browser-safe 16-bit stereo 48 kHz WAV before the HTML5 player sees it.
- Added explicit source/master A/B compare mode in the Tauri UI. It prepares both playback files and switches between A Source and B Master while keeping the current playhead position.
- Reused already-rendered interlude audio when assembling `album_sequence.wav` so full-album renders no longer synthesize the same transition twice.

Verification:

```powershell
npm run build:sidecars
$env:PATH = "desktop\src-tauri\resources\ffmpeg;$env:PATH"
desktop\src-tauri\resources\engine\album-master-engine.exe smoke --output test-output\sidecar-postbuild-smoke-2
& desktop\src-tauri\resources\ffmpeg\ffmpeg.exe -hide_banner -loglevel error -y -i test-output\sidecar-final-smoke\two-track\render\album_sequence.wav -vn -ac 2 -ar 48000 -c:a pcm_s16le test-output\sidecar-final-playback-cache.wav
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-final-solid-smoke
cd desktop
npm run build
npm run test:integration
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
```

Results:

- Frozen engine sidecar smoke passed.
- Bundled FFmpeg produced a browser-safe playback WAV from `album_sequence.wav`.
- Python compile passed.
- Python unit tests passed: 15 tests.
- Product smoke passed, including 1-track, 2-track-with-transition, and 8-track renders.
- Desktop TypeScript/Vite build passed.
- Desktop integration test passed.
- Tauri release build passed and bundled engine/FFmpeg resources.
- Built Tauri app launch-smoke passed: process stayed alive for 5 seconds.
- Final 8-track artifact audit passed: 8 tracks, 7 interludes, 15 sequence/cue items, matching continuous-album duration, finite samples, peak `0.824321`, and 0 manifest warnings.
- Installer artifacts: NSIS setup EXE `142.8 MB`, MSI `169.3 MB`.

### Listen / Apply Loop Pass

- Responded to real app-use feedback that the controls existed but did not make it obvious what was pending, what was rendered, or whether playback was source/master/current settings.
- Added a Listen / Apply State panel that marks settings as `PENDING`, `PREVIEWING`, `RENDERING`, `APPLIED`, `CANCELED`, or `ERROR`.
- Added quick preset buttons for Natural, Metal, Djent, Warm, Bright, Loud, and Cinematic so choosing a direction is less combobox-heavy.
- Added selected-track master preview rendering, A/B compare playback, full-album playback, and rendered-transition playback controls.
- A/B Compare now automatically renders the selected master preview first when no current master exists, then starts the comparison.
- Added a playback time/progress bar and waveform playhead for selected source/master playback.
- Made A/B compare choose an audible 10-second section instead of blindly using a possibly silent intro.
- Made Play Master/A-B warn when it is using an older preview/render while current settings are pending.
- Invalidated stale render pointers after adding, removing, or reordering tracks so old output cannot masquerade as the current album.
- Renamed the full render action to `Auto Master Album (Full WAV + Transitions)` and the partial render action to `Render Masters + Transition Files Only`.
- Render completion logs now explicitly report master count, transition count, continuous album WAV path, and transition output folder.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-listen-loop-smoke-2
```

Results:

- Compile passed.
- Unit tests passed: 13 tests.
- Hidden Tk app instantiation passed.
- Smoke passed.
- Eight-track smoke render produced 8 masters, 7 interludes, `album_sequence.wav`, cue files, `manifest.json`, `scorecard.json`, `dashboard.html`, and 2 codec preview files.
- Eight-track album WAV is stereo 48 kHz, 24-bit PCM.

### Partner Review Fix Pass

- Treated the screenshot review as product requirements, including previously scoped UX items.
- Added a durable active handoff at `docs/codex-active-handoff.md` for compaction/resume safety.
- Replaced the tanh ceiling saturator with a simple lookahead gain limiter plus true-peak-proxy trim.
- Vectorized the linked compressor envelope and `_one_pole` smoothing path.
- Fixed rhythmic and pulsed transition timing to use onset-envelope tempo estimation instead of root frequency.
- Changed `crossfade` to use real adjacent-audio equal-power overlap.
- Changed `hard-cut` to render silence instead of quiet noise.
- Made interlude loudness relative to neighboring mastered tracks instead of a fixed -23 LUFS target.
- Added FFmpeg/FFprobe preflight and subprocess timeout handling.
- Split OGG and Opus export codec mappings.
- Added shared constants for track limit and default sample rate.
- Improved iteration behavior so it no longer flips the user's preset to `velvet-museum`.
- Updated scoring so preset identity considers all tracks and rationale scoring is less word-count brittle.
- Added GUI project open/save, smoke check, reset tuning, progress bar/status, track counter, clear log, shortcuts, safer output folders, and cross-platform file opening.
- Added source/master/transition-preview playback controls with a Windows `winsound` path and fallback file opening.
- Added selected-track waveform and analysis summary after analyze.
- Added optional `pyloudnorm` LUFS measurement path with the existing local approximation retained as a fallback.
- Added reference-track selection in the desktop app and reference analysis in the manifest/dashboard.
- Added desktop target profile shortcuts for common streaming/platform-style LUFS targets.
- Made open track/transition editor fields save into the project before render/save/reorder operations, reducing the "forgot to click Apply" trap.
- Added a cancel request button and close-warning path. This is a cooperative stop request, not a hard worker kill.
- Added a reference-track smoke render check after the main smoke run.

### Critique Loop 2

The next Claude critique found several real regressions or still-weak patches. Confirmed issues fixed in this loop:

- Rebuilt `limit_ceiling` again so it no longer uses a centered max window or whole-song true-peak trim. It now limits on an oversampled local lookahead pass, holds gain locally for release, and only trims local sample-domain overs.
- Replaced the compressor sidechain's centered max-filter attack with causal attack/release filtering.
- Made transition LUFS targets style-aware instead of always `adjacent - 6 LU` with a fixed `[-24, -16]` clamp.
- Passed the user's project ceiling through interlude leveling instead of hard-capping interludes at `-3 dBFS`.
- Suppressed "almost silent" warnings for intentional `hard-cut` transitions.
- Preserved `"inherit"` transition semantics in project JSON while resolving it only at render time.
- Preserved `tweak_lufs` through GUI project save/load by adding an LU Offset field.
- Fixed the Windows file dialog audio filter to use Tk's multi-pattern tuple form.
- Added project-load warnings when oversized projects/transitions are truncated to the current 8-track product cap.
- Cached decoded playback WAVs by path, modified time, and sample rate, and cleaned the playback temp folder on app close.
- Validated that the output folder is writable before starting render/preview work.
- Wrote WAV outputs directly instead of temp-WAV-to-FFmpeg-to-WAV round trips.
- Made FFmpeg timeout configurable through `ALBUM_MASTER_FFMPEG_TIMEOUT`, defaulting to 900 seconds.
- Fixed mono root-estimation input handling and used float64 oscillator phase accumulation for synthesized interludes.
- Avoided overlapping head/tail edge treatment on very short tracks by proportionally shortening the edge windows.
- Updated edge-shaped `applied_gain_db` after the post-edge limiter changes audio level.
- Made score/dashboard failures non-fatal after a successful GUI render.
- Made scorecard album-audio loading failures degrade to missing album stats instead of failing the whole score.
- Switched three-track arc-shape scoring to Spearman rank correlation.

Additional regression tests added:

- Single-spike limiter protection does not globally attenuate an otherwise quiet song.
- Project `tweak_lufs` survives render and `inherit` transition style resolves to the global style.
- Intentional hard-cut silence does not emit an "almost silent" warning.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-loop-smoke
```

Results:

- Compile passed.
- Unit tests passed: 13 tests.
- Smoke passed.
- Hidden Tk app instantiation passed.
- Eight-track smoke render produced 8 masters, 7 interludes, `album_sequence.wav`, `manifest.json`, `scorecard.json`, and `dashboard.html`.
- Eight-track smoke warnings: 0.
- Eight-track album true-peak proxy: -1.14 dBFS.
- Interlude LUFS now tracks style/context more closely; smoke interludes landed around `-20.0` to `-14.9` LUFS instead of a fixed quiet value.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-review-smoke-reference-pass
```

Results:

- Compile passed.
- Unit tests passed: 10 tests.
- Smoke passed.
- Hidden Tk app instantiation passed.
- Eight-track smoke render produced 8 masters, 7 interludes, `album_sequence.wav`, `manifest.json`, `scorecard.json`, and `dashboard.html`.
- Eight-track smoke warnings: 0.
- Eight-track album true-peak proxy: -1.05 dBFS.
- Reference-track render check wrote reference analysis to `manifest.json` and `dashboard.html`.

Remaining partner-review items:

- Cancel is cooperative. It can skip post-render scoring/dashboard if requested late, but it does not hard-kill FFmpeg or interrupt the core render mid-file.
- Reference-track support is analysis/reporting only. It does not yet automatically match tonal balance or loudness to the reference.
- In-app playback is intentionally basic and Windows-first. It now has progress/time, source/master play, A/B clip, transition play, album play, and waveform playhead, but not pause/seek/scrub or true realtime DSP while a slider is moving.
- LUFS uses `pyloudnorm` when installed, but this local environment did not have it installed during verification, so the fallback path was used here.
- Mastering EQ/interlude filters still use zero-phase `filtfilt`/`sosfiltfilt` in several places; this is a known DSP quality target for a future minimum-phase pass.
- Character inference still uses filename hints and positional return-acoustic logic. Overrides make it controllable, but the classifier is not yet a robust genre model.
- The app is still a large single Tk class; the loop is prioritizing correctness and first-run workflow before splitting presentation/project/playback modules.

### Dark UI / Product Feel Pass

- Reworked the Tk desktop app into a dark, clean cyberpunk-style interface with restrained green/amber/red hierarchy.
- Added a styled app header, dark input/menu/tree/log surfaces, zebra-striped tables, themed waveform canvas, and clearer primary/secondary/destructive button treatment.
- Kept interaction behavior direct and stable: no animated or hover-heavy effects, just better visual priority and readability.
- Added log severity color so warnings/errors/completions separate visually during longer renders.
- Fixed a Tk runtime issue where the global `Segoe UI` font string was parsed incorrectly because of the space in the font family name.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-ui-smoke
```

Results:

- Compile passed.
- Hidden Tk app instantiation passed.
- Unit tests passed: 13 tests.
- Smoke passed.
- Eight-track smoke render produced 8 masters, 7 interludes, `album_sequence.wav`, `manifest.json`, `scorecard.json`, and `dashboard.html`.
- Eight-track smoke warnings: 0.

### Deep Research Implementation Pass

- Read both local research reports and captured the implementation decisions in `docs/research-implementation-notes.md`.
- Treated overlapping report guidance as product direction where it fit the personal/offline scope: album-mode loudness, delivery profiles, integer PCM output, dither, codec QC, cue sheets, metadata, and richer metering.
- Added `standards.py` with delivery profiles for streaming universal, AES album mode, Apple/AAC check, YouTube/video, Amazon/speaker-safe, CD 16/44.1, vinyl premaster, and loud-rock reference renders.
- Added GUI/CLI settings for delivery profile, bit depth, and codec QC preview.
- Changed WAV writing to deterministic dithered 24-bit or 16-bit PCM by default, with 32-bit float available only when selected.
- Added short-term loudness maximum and LRA-style loudness range proxy to track, reference, interlude, album, and codec-preview analysis.
- Added sample-accurate `album_sequence.cue` and `album_sequence.cue.json` outputs for continuous album renders.
- Added local AAC and Opus round-trip codec QC preview files and warnings.
- Added release metadata fields for artist, album artist, genre, year, UPC, per-track artist, and ISRC in the GUI, project JSON, manifest, and dashboard.
- Updated README and AGENTS with the delivery/metadata/cue/codec workflow.
- Added regression assertions for cue files, codec preview records, 24-bit WAV sample width, metadata preservation, and richer loudness fields.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-research-smoke
```

Results:

- Compile passed.
- Hidden Tk app instantiation passed.
- Unit tests passed: 13 tests.
- Smoke passed.
- Eight-track smoke render produced 8 masters, 7 interludes, `album_sequence.wav`, `album_sequence.cue`, `album_sequence.cue.json`, `manifest.json`, `scorecard.json`, `dashboard.html`, and 2 codec preview files.
- Eight-track smoke warnings: 0.
- Eight-track album WAV is stereo 48 kHz, 24-bit PCM (`sample_width` 3), with true-peak proxy about `-1.14 dBFS` and integrated loudness about `-14.29 LUFS`.

### What Works

- Python CLI package renders album projects locally through FFmpeg/FFprobe.
- Tkinter desktop launcher starts on Windows and exposes the core workflow:
  - add/remove/reorder up to 8 songs
  - analyze source files
  - choose global preset and album arc
  - set delivery profile, target LUFS, ceiling proxy, sample rate, bit depth, codec QC preview, brightness, bass, presence, air, warmth, compression, limiter, and stereo width
  - enter album artist/release metadata and per-track artist/ISRC metadata
  - select a reference track for analysis/reporting
  - set global transition length/style
  - override selected track character/preset
  - override selected transition style/duration/enabled state
  - render full album or individual mastered tracks only
  - preview a selected transition
  - open output folder or dashboard
  - use a dark desktop UI with visible table, waveform, action, status, and log hierarchy
- Required user-facing preset names are available alongside the original creative presets.
- Transition generator now supports additional practical local styles: crossfade, filtered-fade, reverse-swell, noise-riser, sub-drop, tape-stop, breath-gap, ring-out, pulsed-swell, drone-pad, and hard-cut marker.
- Manifest now records output paths, album analysis, per-track warnings, interlude analysis, aggregate warnings, selected presets, delivery profile, metadata, normalization preview, codec QC, cue paths, ceiling proxy, and tuning settings.
- Dashboard shows delivery settings, metadata, codec QC, warnings, reference analysis, and output paths in addition to arc, tracks, transitions, scorecard, and decision log.
- `album-master smoke` creates synthetic 1-track, 2-track, and 8-track renders and verifies key artifacts, cue files, and codec preview records.

### Verification Run

Commands run from repo root:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-smoke
```

Results:

- Compile passed.
- Unit tests passed: 10 tests.
- Smoke passed.
- Hidden Tk app instantiation passed.
- Eight-track smoke render produced:
  - 8 mastered WAV files
  - 7 transition WAV files
  - `album_sequence.wav`
  - `manifest.json`
  - `scorecard.json`
  - `dashboard.html`
  - 0 render warnings

### Weak Spots

- GUI is workflow-complete and dark themed, with a basic transport, A/B clip, waveform playhead, and source/master/transition/album playback. It is still not a DAW-style scrubber or real-time streaming processor.
- True peak remains a local oversampling proxy, and LUFS falls back to the local approximation when `pyloudnorm` is not installed.
- Tempo/key/chroma are not full musicology features; transition roots are estimated from local spectra.
- Reference matching is not automatic yet; the app only analyzes/reports the reference track.
- Cancellation is not a hard kill for an already-running render operation.

### Next Move

- Add a richer transport with pause/seek/scrub and a true source/master toggle if the Tk/winsound path remains the app surface.
- Consider level-matched A/B mode after the current non-level-matched comparison has been tested on real songs.
- Add actual reference-track matching once the core workflow has been used on real songs.
