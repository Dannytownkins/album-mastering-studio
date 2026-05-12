# Engine Decision Record

Last updated: 2026-05-12

## Status

In progress. This is the first real-time audition spike record, not a final engine decision.

Current recommendation:

- Keep the Python CLI/sidecar as the trusted offline render engine for now.
- Keep Tauri as the primary product shell.
- Use Web Audio only as a short-term audition baseline for first-layer Track Master controls.
- Continue the Rust native audio spike before calling Track Master release-candidate, because browser audio does not provide enough packaging, device, latency, or export-parity confidence for the final product.
- Treat current native playback as local playback-cache transport evidence, not as the final streaming/audio-DSP engine.

## Product Requirement

Track Master cannot be considered top-tier until basic ear-facing controls respond in real time or near real time.

Controls to prove first:

- Gain or level compensation.
- Low/Mid/High EQ.
- Width.
- Volume Match.
- Basic Intensity subset.

Targets from `docs/IMPLEMENTATION_PLAN.md`:

- Lightweight controls audible in about 150 ms or less.
- Heavier macro changes audible in about 500 ms or less.
- No obvious clicks, zipper noise, glitches, or unstable playback.
- Preview and export must match in audible intent.

## Baseline Implemented

Implemented a narrow Web Audio baseline in the Tauri frontend:

- UI toggle: `Live Preview`.
- Scope: source playback only.
- Controls wired:
  - Low shelf from `Low`.
  - Mid peaking EQ from `Mid`.
  - High shelf from `High`.
  - Mid/side width matrix from `Width`.
  - Light dynamics from positive `Intensity`.
  - Existing Volume Match playback gain remains active.
- Parameter smoothing: 15 ms `setTargetAtTime`.
- Offline preview/export path remains unchanged through Python.

Files:

- `desktop/src/App.tsx`
- `desktop/src/styles.css`
- `desktop/tests/tauri-webview-ui-smoke.mjs`

## Latency Observations

Evidence gathered in this pass:

- The Web Audio chain builds inside the actual Tauri WebView.
- UI changes are applied directly to AudioParams with 15 ms smoothing.
- The UI exposes the Web Audio context latency when WebView2 reports `baseLatency` / `outputLatency`.
- The live Tauri WebView UI smoke reported `Live Preview armed ~10 ms` from the Web Audio context estimate on this machine.

Limits:

- No human listening pass has been performed yet.
- No sustained playback jitter/dropout measurement has been performed yet.
- No audio loopback measurement exists yet.
- Browser/WebView2-reported latency is only an API estimate, not proof of end-to-end audible latency.

## CPU And Memory Observations

Evidence gathered in this pass:

- The TypeScript/Vite build remains small enough for the current desktop shell.
- The live chain is one media element source, three filters, a compressor, and a mid/side gain matrix. It is intentionally lightweight.
- No CPU spikes, process exits, or WebView crashes occurred during automated UI smoke.

Limits:

- CPU and memory were not profiled during sustained playback.
- The automated UI smoke toggles live preview and verifies state, but it does not run a long listening loop.
- This record must be updated after a 5-10 minute playback/tweak pass on real audio.

## Fidelity And Export-Parity Risks

Web Audio is useful for proving interaction feel, but it is not export-parity-safe yet.

Known risks:

- Browser BiquadFilter curves will not exactly match the Python offline mastering filters.
- The light Web Audio compressor is not the same as the offline mastering dynamics path.
- The width matrix is a simple mid/side audition layer, not the final mastering width algorithm.
- Intensity is only a small subset of the real preset macro.
- The live path currently affects source playback only; rendered master playback remains offline output.

Implication:

- Web Audio can support a temporary "what will this direction feel like?" loop.
- It should not be presented as final export-accurate mastering unless the DSP definitions are shared or calibrated.

## Packaging Implications

Web Audio baseline:

- No new native dependencies.
- Works inside the existing Tauri WebView.
- Keeps the current installer/sidecar model unchanged.
- Depends on WebView2 audio behavior and device routing.

Rust native audio spike:

- Adds native audio dependency and device-management surface.
- Better path for low-latency playback, metering hooks, and long-term preview/export parity.
- Requires packaging validation across the same Windows installer flow.
- Initial cpal probe is now in the app process.

JUCE/native rewrite:

- Highest audio-app ceiling.
- Highest rewrite and packaging cost.
- Not justified until a smaller Rust/native spike proves Tauri cannot meet the listening workflow.

## Decision

Use the Web Audio baseline as temporary scaffolding only.

Next engine work should be a Rust native audio spike that answers:

1. Can Tauri plus Rust playback keep source/master A/B, region loop, and first-layer controls responsive enough?
2. Can the same control definitions drive both the live preview and Python/offline export intent?
3. What dependency gives the cleanest Windows packaging path: `cpal`, `rodio`, Symphonia, a custom FFmpeg decode cache, or another route?
4. Does Rust native audio expose enough timing/control reliability to avoid moving to JUCE?

## Native Audio Probe

Implemented a typed Tauri command:

- `native_audio_probe`

The command uses `cpal` to inspect the default host/device/config from the Rust/Tauri process.

Current evidence from `npm run test:tauri-webview` on this Windows machine:

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

- Rust can see the user's native WASAPI output path from inside the Tauri process.
- The default device matches a serious external audio interface path, not only a generic browser route.
- cpal reports the default buffer as `default`, not fixed, so exact native latency cannot be inferred from static config.
- The next native spike must open a stream and measure callback cadence/dropouts during playback.

Implementation files:

- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/Cargo.lock`
- `desktop/src-tauri/src/lib.rs`
- `desktop/tests/tauri-webview-runtime-smoke.mjs`

## Native Stream Cadence Probe

Implemented a typed Tauri command:

- `native_audio_stream_probe`

The command opens the default `cpal` output stream from the Tauri process, writes silence for a bounded probe window, records callback timing/frame counts, captures stream errors, then tears the stream down. It is deliberately not a player yet.

Current evidence from `npm run test:tauri-webview` on this Windows machine:

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

- Tauri/Rust can open the native WASAPI output stream, not only inspect it.
- The default callback cadence is roughly 10 ms on the Focusrite output in this environment.
- The first callback can have a different frame count than the steady callbacks, so real playback code should tolerate variable callback buffer sizes.
- No stream errors were reported during this short probe.
- This is still silence-only evidence. It does not prove decode, transport, source/master A/B, looping, CPU headroom, or export/live parity.

## Native Playback Cache Probe

Implemented a typed Tauri command:

- `native_playback_file_probe`

The command reads a bounded segment from the existing playback-cache WAV path and writes those real samples to the default `cpal` output stream. It deliberately accepts the browser-safe cache shape produced by `prepare_playback_file`: PCM 16-bit stereo 48 kHz RIFF/WAVE. This keeps native audition work behind the existing FFmpeg import/export boundary instead of adding a second decoder.

Current evidence from `npm run test:tauri-webview` on this Windows machine:

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

- Tauri/Rust can now play actual cached WAV samples through the native WASAPI output stream.
- The probe consumed the full queued 500 ms segment and reported no stream errors.
- The callback cadence stayed near 10 ms while writing real audio samples.
- This is still a bounded probe, not a production transport. It does not yet provide UI play/pause/seek, source/master A/B, region looping, long-run stability, or live/export parity.

## Native A/B Loop Probe

Implemented a typed Tauri command:

- `native_ab_loop_probe`

The command accepts source and mastered playback-cache WAV paths, reads the same bounded region from each, alternates source/master chunks for a bounded total duration, writes the looped buffer to `cpal`, and records callback/dropout evidence. It is still a probe command rather than the production transport, but it proves the native layer can consume both A and B cached files and loop a region without relying on Web Audio.

Current evidence from `npm run test:tauri-webview` on this Windows machine:

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

- Tauri/Rust can play a bounded source/master A/B region loop through native WASAPI output.
- The run consumed every queued output frame and reported no stream errors.
- The default output device followed the current Windows default output during verification.
- This still needs production transport state, cancellation, UI wiring, and longer stress runs before it replaces the Web Audio preview.

## Native Playback State Manager

Implemented typed Tauri commands:

- `start_native_ab_loop_playback`
- `native_playback_status`
- `stop_native_playback`

The Rust layer now owns one current native playback session with start/status/stop semantics. The Track Master UI exposes a `Native A/B` control that prepares source/master playback-cache WAVs, starts a bounded native A/B loop, polls status while active, and can stop the session. This is native transport proof; Web Audio remains the live DSP preview.

Current evidence from `npm run test:tauri-webview` on this Windows machine:

```json
{
  "start": {
    "active": true,
    "queued_output_frames": 72000,
    "played_output_frames": 0,
    "stream_errors": [],
    "warnings": []
  },
  "running_after_300_ms": {
    "active": true,
    "played_output_frames": 14976,
    "callback_count": 30,
    "avg_callback_interval_ms": 10.020551724137931,
    "p95_callback_interval_ms": 10.634,
    "stream_errors": [],
    "warnings": []
  },
  "after_stop": {
    "active": false,
    "played_output_frames": 14976,
    "stream_errors": [],
    "warnings": []
  }
}
```

Interpretation:

- Native playback is no longer only a blocking probe command; it has a managed start/status/stop lifecycle.
- The real Tauri WebView can exercise that lifecycle through the same command bridge the UI uses.
- The first UI exposure is deliberately narrow: a bounded native A/B loop, not a full replacement for the HTML/Web Audio transport.
- Remaining work is transport hardening: pause/seek/cancel semantics, longer stress evidence, and clearer live-DSP/export-parity boundaries.

## Native Playback Stress Smoke

Implemented a dedicated stress command:

- `npm run test:tauri-native-stress`

The stress smoke connects to the real Tauri WebView, renders a synthetic Track Master fixture, prepares source/master playback-cache WAVs, starts an 8-second native source/master A/B loop, polls `native_playback_status`, and samples the running Tauri process with PowerShell `Get-Process`.

Current evidence from this Windows machine:

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

- Native playback consumed the full 8-second queued A/B loop with no cpal stream errors or warnings.
- Callback cadence stayed near 10 ms during the longer run.
- Basic process sampling did not show memory growth across this short stress window.
- This is still not a complete stress profile. It does not yet cover long album playback, real-song listening, native full-track/album transport, or CPU/memory sampling across a full render-and-audition session.

## Real-Song Native A/B UI Smoke

Implemented a dedicated UI smoke:

- `npm run test:tauri-real-song-native-ui`

The smoke requires `AMS_REAL_SONG_PATH` so local/private source files are not hardcoded into the repo. It analyzes the provided song through the Tauri command bridge, seeds a Track Master autosave session, reloads the real Tauri UI, clicks the visible `Native A/B` button, waits for native playback to start, pauses from the visible pause button, seeks with the visible native position slider, resumes from the visible resume button, clicks `Native A/B` again to stop, restores the previous autosave, and writes a screenshot/evidence JSON.

Evidence from the user-provided MP3:

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
    "played_output_frames": 60480,
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

- The visible Track Master `Native A/B` button works on a real MP3-backed session, not only synthetic WAV fixtures.
- The UI path rendered/prepared a master as needed, started native A/B playback, paused it, sought inside the queued audition buffer, resumed, and stopped it.
- This is still a controlled automated check. It does not replace a human listening pass.

## Real-Source Album Master UI Smoke

Implemented a dedicated Album Master UI smoke:

- `npm run test:tauri-real-song-album-ui`

The smoke requires `AMS_REAL_SONG_PATH` so local/private source files are not hardcoded into the repo. It derives three short WAV clips from the provided MP3 under `test-output`, seeds an Album Master session in the real Tauri WebView, clicks visible `Analyze`, waits for visible LUFS evidence and the `Export Album` command to enable, clicks visible `Export Album`, reads the generated manifest, checks the dashboard and album WAV artifacts, and prepares playback for both `album_sequence.wav` and a rendered transition through the UI artifact buttons.

Evidence from the user-provided MP3-derived Album Master run:

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

Interpretation:

- Album Master now has real-source-derived UI coverage, not only synthetic CLI/runtime smoke coverage.
- The smoke covers the visible Album Master path from analysis through render, dashboard load, album WAV artifact, transition artifact, and playback-cache prep.
- This is still not a human listening pass and not a true three-song album. It uses three excerpts from the provided song because only one real source file is currently available.

## Listening Checklist Surface

Added a persistent `Listening Pass` panel to the Tauri surface. It is stored in the normal autosaved session snapshot and participates in undo/redo without marking renders stale, because it records review state rather than changing audio output.

Checklist fields:

- `trackOriginal`
- `trackMaster`
- `trackNativeAb`
- `albumSequence`
- `albumTransitions`
- `dashboardReviewed`
- `notes`

The Tauri UI smoke now toggles three checklist items, writes listening notes, waits for autosave, calls `load_recent_session`, and verifies the persisted checklist:

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

Interpretation:

- The app now has a durable place to record human review separately from automated render evidence.
- This does not claim a listening pass has happened; it only gives the workflow a surface to record one.

## Export Vs Live Preview Honesty

The Tauri UI now keeps Live Preview visibly classified as approximate. When Web Audio `Live Preview` is armed, the audition row shows `Approx audition`; when relying on rendered preview/export artifacts, it shows `Render-faithful preview`.

The runtime WebView smoke now renders a Track Master file through the Python engine, runs the same source through a deterministic Web Audio-style model of the current live controls, writes the modeled WAV under `test-output`, and records comparison metrics:

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

Interpretation:

- Live Preview remains useful for fast first-layer ear checks, but it is not the export engine.
- `Update Preview`, `Mastered`, `Original/Mastered`, and final exports remain the render-faithful path because they go through the Python engine and playback cache.
- The measured fixture delta is evidence for honest labeling, not a sound-quality verdict.

## First-Control Export Vs Live Comparison

The packaged Track Preview UI smoke now compares the Python-rendered preview against a deterministic model of the same first-control Live Preview set that the UI exercises:

- Low shelf.
- Mid peaking EQ.
- High shelf.
- Mid/side Width.
- Basic Intensity compressor curve.

Evidence from `npm run test:tauri-track-preview-ui`:

```json
{
  "live_preview_engine": "web-audio-first-control-model",
  "modeled_controls": ["Low", "Mid", "High", "Width", "Intensity"],
  "modeled_width": 1.36,
  "modeled_drive": 0.4,
  "tuning": {
    "bassDb": 0.5,
    "midDb": -0.25,
    "highDb": 0.35,
    "width": 0.2,
    "intensity": 0.4
  },
  "exportDiffersFromLiveMaterially": true,
  "export_minus_live_lufs_proxy": 9.08023618964403,
  "rms_difference_dbfs": -19.5359668627911,
  "exportLoudnessDeltaVsSource": 7.27101810965978,
  "liveLoudnessDeltaVsSource": 1.80921807998426,
  "exportAndLiveLoudnessDeltaDifference": 5.46180002967552
}
```

Interpretation:

- The comparison model is now aligned with the current first-control Web Audio audition surface instead of only Low EQ.
- The measured delta still supports the same decision: Web Audio Live Preview is approximate scaffolding, not shared/export-engine DSP.
- The next parity step is not more labeling; it is either calibrated shared DSP definitions or a native live path that uses the same intent model as offline export.

## Real-Song First-Control Export Vs Live Comparison

The release-backed real-song performance smoke now runs the first-control comparison against the user-provided MP3 instead of only synthetic fixtures. It uses the real playback-cache WAV as the deterministic live-model source and a second Python Track Master render with the same first-control tuning as the export reference.

Evidence from `npm run test:tauri-real-song-performance` with `Lay the Money on the Desk (1).mp3`:

```json
{
  "analysisDurationSeconds": 186.31997916666663,
  "firstControlRenderDurationMs": 27192.7,
  "live_preview_engine": "web-audio-first-control-model",
  "modeled_controls": ["Low", "Mid", "High", "Width", "Intensity"],
  "tuning": {
    "bassDb": 0.5,
    "midDb": -0.25,
    "highDb": 0.35,
    "width": 0.2,
    "intensity": 0.4
  },
  "exportDiffersFromLiveMaterially": false,
  "export_minus_live_lufs_proxy": 0.714872039163112,
  "rms_difference_dbfs": -29.5362869826173,
  "exportLoudnessDeltaVsSource": 3.54647695122973,
  "liveLoudnessDeltaVsSource": 4.26134899039284,
  "exportAndLiveLoudnessDeltaDifference": 0.714872039163112,
  "compared_frames": 8943359
}
```

Interpretation:

- Real user audio still confirms the same architectural boundary: the current Web Audio first-control model and Python export are not the same engine.
- After aligning the model constants closer to export intent, this MP3 no longer trips the `exportDiffersFromLiveMaterially` boolean even though the paths remain distinct and approximate.
- Real-song parity checks should record the material-mismatch flag and numeric deltas instead of forcing the mismatch to stay true after calibration.
- This narrows the evidence gap from synthetic-only to one real source file. It still does not replace shared DSP definitions, native live DSP parity, or human listening approval.

## Shared Web Audio Model Definition

Added `desktop/src/livePreviewConfig.json` as the shared definition point for the current Web Audio first-control model. The Tauri frontend now reads the Web Audio filter frequencies, width mapping, compressor curve, and smoothing from that JSON file. The deterministic smoke-test comparator reads the same file before generating the Python model used in export-vs-live evidence.

The shared config has now been tuned toward Python export intent: low shelf `105 Hz`, presence `3.2 kHz`, air `9.8 kHz`, and a lighter hard-knee Intensity curve. This reduced the provided real-song export/live LUFS-proxy delta from roughly `3.92 dB` to roughly `0.715 dB` in the automated comparison, while the synthetic fixture still shows a material mismatch.

The Python engine now owns the preview contract through `live_preview_contract()` and the CLI command:

```powershell
album-master preview-contract --json
```

The contract exposes the modeled Web Audio controls and the unmodeled export stages. A Python regression test compares `desktop/src/livePreviewConfig.json` against this engine contract so the app/test model cannot silently drift from the export intent constants.

Verification after the extraction:

- `npm run build`
- `npm run tauri:build`
- `npm run test:tauri-track-preview-ui`
- `npm run test:tauri-real-song-performance` with `Lay the Money on the Desk (1).mp3`
- `python -m unittest tests.test_pipeline.PipelineTest.test_live_preview_config_matches_engine_contract`
- `npm run test:tauri-webview`

Interpretation:

- This reduces drift between the running UI and the automated comparison model.
- It is still a shared definition for a temporary Web Audio approximation, not shared DSP with the Python export engine.
- The contract makes the approximation boundary executable: modeled controls are `Low`, `Mid`, `High`, `Width`, and `Intensity`; unmodeled export stages include preset base tone, highpass, low-mid EQ, brightness, warmth/saturation, transient shaping, LUFS match, ceiling limiting, and codec QC.
- The next real parity step is to define or generate common intent/DSP parameters that both offline export and the live path consume, or to move the live path toward a native engine that can share those definitions directly.

## Real-Source Album Playback Stability

The real-source Album Master UI smoke now also probes native playback stability for the rendered continuous album WAV. It still drives the visible Album Master UI path first: derive local clips from the provided MP3, seed Album Master, analyze, export album, load dashboard, select `Album WAV`, and prepare transition playback. After that, it converts `album_sequence.wav` through the playback cache and runs `native_playback_file_probe` on the album cache.

The native file probe duration cap was increased from 5 seconds to 60 seconds so album playback profiling can cover more than a short snippet.

Evidence from the provided real-source fixture:

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

Interpretation:

- This closes the short, automatable part of the full-album playback stability gap for one real source file.
- It does not replace human listening approval.
- It does not prove a true multi-song album because the current fixture is one MP3 split into three local clips.
- It does not make native album transport feature-complete; pause/seek for full album still belongs to a future native transport slice.

## Native Full-File Transport

The native transport spike now has a full-file playback command in addition to bounded A/B loops:

- `start_native_file_playback`
- `native_playback_status`
- `pause_native_playback`
- `seek_native_playback`
- `stop_native_playback`

Implementation notes:

- The command accepts a playback-cache WAV path, optional label, start seconds, and max duration.
- The current implementation pre-buffers PCM samples into memory before starting the CPAL stream.
- A one-hour hard cap protects the current pre-buffered path from unbounded reads.
- It reuses the same native session status model as A/B, so pause/seek/resume/stop telemetry stays consistent.
- The Tauri transport now exposes visible `Native Play` / `Native Stop` controls for the current prepared item.
- `Native A/B` remains a separate bounded source/master comparison loop.

Verification already completed:

- `cargo check`
- `npm run build`
- `npm run test:integration`
- `python -m compileall -q src tests`
- `npm run test:tauri-webview` against live Tauri/WebView2 on CDP port `9334`
- `npm run test:tauri-real-song-native-ui` against `Lay the Money on the Desk (1).mp3`
- `npm run test:tauri-real-song-album-playback` against MP3-derived album clips from `Lay the Money on the Desk (1).mp3`
- `npm run test:tauri-ui` broad UI regression against the live Tauri app
- `git diff --check` with only normal LF-to-CRLF warnings

What that proves:

- The Rust command contract works from the real Tauri WebView.
- Native file playback can start, pause, seek, resume, and stop under automation.
- The existing real-song Track Master native A/B path still works after the shared native transport changes.
- The visible Album Master `Album WAV` path can start native full-file playback, pause, seek to 2 seconds, resume, stop, and return to `Native transport ready`.
- A 20-second native stability probe of the rendered album WAV completed with 2000 callbacks, 960000 played output frames, no stream errors, and no warnings.

What it does not prove yet:

- This is not a streaming native transport yet.
- This is not live DSP/export parity.
- Human listening approval has not happened.

## Temporary Vs Final

Temporary:

- Web Audio `Live Preview`.
- Browser/WebView2 latency estimate.
- Web Audio EQ/compressor/width approximations.

Likely final or durable:

- Tauri as product shell unless the native spike disproves it.
- Python CLI/sidecar for offline render until a better engine has evidence.
- Typed Tauri commands as the frontend/backend contract.
- Playback-cache assets for browser and native audition paths.

## Verification Evidence

Current automated evidence:

```powershell
cd desktop
npm run build
npm run test:tauri-ui
npm run test:tauri-webview
```

The UI smoke verifies the `Live Preview` toggle in the real Tauri WebView.
The runtime smoke verifies `native_audio_probe`, `native_audio_stream_probe`, `native_playback_file_probe`, `native_ab_loop_probe`, `start_native_ab_loop_playback`, `native_playback_status`, `pause_native_playback`, `seek_native_playback`, `stop_native_playback`, and the typed render commands from the real Tauri WebView.
The native stress smoke verifies an 8-second native A/B loop and captures basic Tauri process resource samples.
The real-song native UI smoke verifies that a user-provided MP3 can seed Track Master, prepare source/master caches, start native A/B from the visible button, pause/resume, seek with the visible native slider, report active playback status, and stop from the same button.
The real-source Album Master UI smoke verifies that a user-provided MP3 can derive local clips, drive visible Album Master analyze/render commands, produce a manifest/dashboard/album WAV/transitions, prepare album/transition playback artifacts, and run 20 seconds of native album WAV playback with callback/error evidence.

Remaining required evidence:

- Real audio listening pass.
- Longer playback stability pass across more real songs and complete album-length runs.
- CPU/memory sampling during live control changes and full-session use.
- Deeper export-vs-live comparison across preset/advanced live-control settings and additional real songs.
- Native transport beyond bounded A/B audition: direct full-file pause/seek exists; visible real-song Album WAV smoke, streaming/cancel behavior, and complete-session stability still remain.
- True multi-song source pass when more than one real song is available.
