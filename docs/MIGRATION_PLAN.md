# Rust DSP Migration Plan

Date: 2026-05-13

## Migration plan

Six phases. Each phase ends with deletion of its Python predecessor, not parallel paths. Each phase has a binary parity gate before it closes. We will not preserve both paths "for compatibility." That instruction is what kept Python alive last time. Do not do it again.

## Phase 1 - EQ

- Add `desktop/src-tauri/src/dsp.rs` with `BiquadCoeffs`, `Biquad` state, and `low_shelf` / `peak` / `high_shelf` builders per the RBJ cookbook. Adapt from `../album-mastering-studio-claude-build/src-tauri/src/dsp.rs`.
- Add a `process_eq(samples: &mut [f32], settings: &EqSettings, sample_rate: f32)` function. Stereo, linked.
- Expose a Tauri command `render_rust_eq(input_path, output_path, settings)` that loads a WAV, runs `process_eq`, writes a WAV. Keep the existing Python EQ path running in parallel only for this phase, only to serve as the parity oracle.
- Write `desktop/src-tauri/tests/eq_parity.rs`: load `private-audio-fixtures/*.wav` or the canonical test track, run both Python EQ and Rust EQ at three settings: flat, +3dB at 100/1000/10000, and -3dB at the same. Compute per-channel RMS of `rust_output - python_output`, assert <= -60 dBFS, approximately 0.001 RMS error. `cargo test` must pass.
- Replace the Python EQ stage in `src/album_mastering_studio/mastering.py` with a subprocess call to the new Rust command for the export path. Delete the Python EQ implementation, the numpy filtering code, not the orchestration. The Python function `apply_eq` ceases to exist.
- Wire `App.tsx` audition: when the user toggles an EQ control during playback, send the new settings to an `update_chain` Tauri command which feeds the cpal audio thread. The `liveAuditionRef` Web Audio chain for the EQ section is disabled; playback now goes through the Rust EQ in real time.
- Commit message format: `Phase 1 closed: Rust EQ replaces Python EQ + parity <= -60dBFS`.

Stop condition for Phase 1: parity test green and `apply_eq` no longer exists in Python and audition EQ controls update audio in real time without re-rendering a WAV. If any of these three fail, stop and report. Do not start Phase 2.

## Phase 2 - Multiband compressor

Same pattern. Port the 3-band linked-stereo multiband from the reference. Parity oracle is `compression_density` Python stage. Same parity threshold. Delete Python compressor when green.

## Phase 3 - Saturation / character

Same pattern for tape, warmth, and air stages. These are nonlinear, so parity is looser: allow up to -45 dBFS RMS error, but also assert THD spectrum within 1 dB at the third harmonic. Delete Python saturation when green.

## Phase 4 - Limiter + ceiling

True-peak ceiling, look-ahead limiter. Parity threshold -55 dBFS RMS. Critical: assert no inter-sample peaks exceed `settings.ceiling_dbtp` measured at 4x oversample. Delete Python limiter when green.

## Phase 5 - LUFS metering on audio thread

Implement K-weighted BS.1770 momentary LUFS in Rust. Emit a `playback:tick` event at about 20Hz with current LUFS. Replace the Web Audio approximation in `App.tsx` with the live tick subscription. The MASTER OUT readout becomes broadcast-standard accurate during playback.

## Phase 6 - Delete the honesty layer

After Phase 5, search the repo for:

- `liveAuditionRef`
- `LivePreviewContract`
- `live_preview_contract`
- `livePreviewConfig`
- `render_live_preview_model`
- `render_native_live_preview_model`
- `fallbackPreviewParityLabel`
- `previewParityWarn`
- `directional`
- `approximate audition`
- `directional only`
- `Live Preview is a Web Audio approximation`

Delete every occurrence in code and docs. The README must no longer mention an approximation. The audition is the export.

## What survives the migration

Do not touch:

- `src/album_mastering_studio/arc.py`
- `src/album_mastering_studio/character.py`
- `src/album_mastering_studio/interludes.py`
- `src/album_mastering_studio/dashboard.py`
- `src/album_mastering_studio/cli.py`
- the Tauri listening-packet HTML generator in `lib.rs`
- the codec preview pipeline using FFmpeg shell-outs
- `tests/tauri-real-song-*.mjs` smoke tests
- `docs/PRODUCT.md`
- the research markdowns at the repo root

These are album composition logic, preserved handoff/reporting paths, codec checks, or product/research docs, not the DSP audition path being replaced.

## What dies during or after the migration

- The PowerShell `scripts/release-readiness.ps1` and the JSON receipts pipeline. After Phase 6, delete `scripts/release-readiness.ps1` and collapse `package.json` test scripts to: `test:unit` (`cargo test`), `test:integration` (the surviving real-song smokes), and `test:build` (`npm run build` plus `tauri build`). Six scripts max.
- Every Python DSP function as its phase closes. Do not leave them as fallback paths.
- `docs/codex-active-handoff.md`, now archived at `docs/_archive/codex-active-handoff-pre-rust-migration.md`, is not to be read during the migration. It anchors the old architecture.

## Working rules for this migration

- One phase per session. Close Phase 1 cleanly, commit, stop. Do not freelance into Phase 2 in the same session.
- Short, scoped, gated sessions only.
- Parity tests are the only acceptable evidence. Do not write new release-readiness smoke variants. Do not generate JSON evidence artifacts. `cargo test --lib && cargo test` passing is the bar.
- Existing real-song UI smokes stay green as a side-channel, but they are not the gate.
- If parity cannot be achieved within the threshold, stop and report. Do not lower the threshold. Do not preserve best-effort parallel paths. The phase remains open.
- No new "directional only" or "approximate" copy goes into the codebase.
- The Python audition path does not get refactored, prettified, or kept clean during migration. It gets deleted, stage by stage, as Rust replaces it.
- The goal state is `src/album_mastering_studio/mastering.py` containing only orchestration code that subprocess-calls into Rust commands, with all DSP gone.
- Commit hygiene: one logical change per commit, phase tag in the subject, parity-gate close as its own commit with the measured dBFS error in the body. No "Record evidence trace" commits. No "Add handoff doc" commits. The commit is the evidence.
