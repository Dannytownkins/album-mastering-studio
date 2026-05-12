# Album Mastering Studio — Master Feature List

Combined and deduplicated from `docs/PRODUCT.md` (current canon) and `docs/PRODUCT_PLAN_old.md` (prior plan). Provenance markers: `(both)`, `(new)` = from PRODUCT.md, `(legacy)` = from PRODUCT_PLAN_old.md.

---

## 1. Workflow & Modes

- Default path: **Drop audio → Analyze → Universal safe settings → Export** _(new)_
- **Track Master** mode — independent songs, fast mastering loop _(new)_
- **Album Master** mode — sequence of songs as a coherent record _(new)_
- Modes are intent-based, not skill-tiered _(new)_
- Album projects persisted as editable `.ams.json` files _(legacy)_
- CLI `album-master` command preserved for scripting _(legacy)_

## 2. Audio Analysis

On import or Analyze, compute: _(both, legacy is more detailed)_

- Duration
- Peak and true-peak estimate
- RMS and crest factor
- Integrated LUFS-style loudness (BS.1770-aimed)
- Dynamic range
- Stereo image / width
- Spectral balance
- Transient density
- Energy density
- Harshness / artifact-like measured issues _(new)_
- Clipping / decode problems _(new)_

## 3. Mastering Chain (DSP Pipeline)

In order: _(legacy, retained as canonical chain)_

1. Decode source to stereo float via FFmpeg
2. Analyze (see §2)
3. Infer or accept track character across album sequence
4. Plan album arc, per-track LUFS targets, mastering moves, transition handoffs, interlude styles, edge treatments
5. Remove DC offset
6. High-pass rumble
7. Taste EQ + track-position EQ: low shelf, low-mid bell, presence bell, air shelf
8. Linked stereo compression with position-aware intensity
9. Transient shaping
10. Saturation
11. Stereo width via mid/side
12. Match track to arc-adjusted LUFS target
13. Apply adjacent transition head/tail treatments
14. Ceiling-limit and encode

## 4. Preset Library

### Main row (new vocabulary, 6–8 visible) _(new)_

- **Universal** — confident, well-rounded default
- **Clarity** — upper-mid/high detail, vocal intelligibility
- **Tape** — saturation, glue, softened top, fuller low-mid
- **Spatial** — width/depth, careful stereo shaping
- **Oomph** — low-end weight and punch
- **Warmth** — fuller, smoother, less harsh
- **Punch** — transient impact
- **Loud / Energy** — density and level, with safety checks

### Specialty drawer (later) _(new + legacy taste presets)_

- Acoustic Natural
- Heavy Rock / Metal
- Djent / Modern Metal
- Bright / Air
- Dark / Smooth
- CD-safe
- Vinyl premaster
- Platform / delivery-specific profiles
- Legacy taste presets: `3am-kitchen-floor`, `radio-brittle`, `velvet-museum`, `streaming`, `gentle`, `loud`

### Custom presets _(new)_

- User-saveable mastering chains
- Shared across Track Master and Album Master, with mode-specific fields

## 5. Simple Controls (Top Surface)

- Preset tiles _(new)_
- Intensity macro _(both)_
- Low / Mid / High EQ _(new)_
- Original / Mastered toggle _(new)_
- Loop _(new)_
- Export _(both)_

## 6. Intensity Macro

- Scales preset effort across multiple parameters _(both)_
- Touches loudness push, compression density, saturation/warmth, transient shaping, width/brightness as the preset calls for it _(new)_
- **Not** just a volume knob — must not bias A/B comparison _(new)_

## 7. Advanced Controls (Expandable)

- LUFS offset _(new)_
- True-peak ceiling _(new)_
- Width / stereo width _(both)_
- Warmth _(both)_
- Presence / air EQ _(legacy detail; new groups it)_
- Low-end weight _(legacy)_
- Compression / density _(new)_
- Limiter behavior (incl. oversampled) _(new)_
- Bit depth _(new)_
- Delivery profile (platform/format) _(new)_
- Codec QC _(new)_
- Reference details _(new)_

## 8. A/B Listening Workflow

- Large waveform as main focus _(new)_
- Waveform zoom _(new)_
- Region selection by dragging _(new)_
- Loop selected region _(new)_
- Play / pause / seek _(new)_
- Original / Mastered toggle preserving playhead **and** selection _(new)_
- Same-playhead A/B is non-negotiable _(new)_

## 9. Volume Match

- Optional, **off by default** _(new)_
- Aligns playback loudness for fair tone comparison _(new)_
- Does **not** change exported file level _(new)_
- Tooltip explains behavior _(new)_

## 10. Reference Track

- Optional, non-blocking _(new)_
- Visible enough to discover _(new)_
- Foundation for future reference-track matching _(new + legacy "remaining work")_

## 11. Album-Specific Capabilities

- Track reorder as story _(new)_
- Track Roles / Story step after analysis, skippable but reviewable _(new)_
- Character inference per track: `acoustic_folk`, `transition`, `heavy_djent`, `return_acoustic` _(legacy)_
- Per-track role and character overrides _(both)_
- Global album intent + per-track adaptation _(new)_
- Album arcs: `cinematic`, `afterhours`, `club-peak`, `fever-dream` _(legacy)_
- Per-track mastering decisions inside album plan _(new)_
- Album dashboard _(both)_
- Album-level quality checks _(new)_

## 12. Transitions & Boundaries

### Primitives (priority, on by default behavior) _(new)_

- Preserve original boundaries by default
- Direct boundaries
- Timed gaps
- Equal-power crossfades
- Fades
- Ring-outs
- Reverse swell (optional creative primitive)

### Genre-aware handoff planning _(legacy)_

- `acoustic_to_heavy`
- `heavy_to_heavy`
- `heavy_to_acoustic`
- `acoustic_to_acoustic`
- Textural bridge variants
- Tail/head mastering treatments for hard handoffs

### Generated interludes (off by default) _(legacy + new gating)_

- Derive from previous track tail and next track head
- Estimate usable root range, glide tonal centers
- Build harmonic pads, fold in filtered source texture
- Styles: `ambient`, `tape`, `swell`, `rhythmic`, `minimal`
- `auto` chooser based on energy/brightness change, character, handoff type, preset bias, arc position
- Transition preview rendering

## 13. Export Behavior

- One obvious export action per mode _(new)_
- Track Master: single → Export Master; multiple → independent exports _(new)_
- Album Master: individual masters + continuous album WAV _(new)_
- Cue / split data when appropriate _(new + legacy "remaining")_
- Manifest, report, dashboard alongside audio _(new)_
- Export allowed immediately after analysis _(new)_
- Post-render quality checks **required**, advisory not blocking _(new)_
- "Export Anyway" available when technically possible _(new)_
- Multi-format FFmpeg export _(legacy)_
- Integer / dithered WAV exports _(legacy, already implemented)_

## 14. Output Safety

- Never destructively edit source files _(new)_
- Never overwrite previous exports _(new)_
- Timestamped / versioned output folders and files _(new)_
- Rendered files are regenerable — no undo needed for them _(new)_

## 15. Source Format Handling

- Format-neutral by default _(new)_
- No second-class treatment for MP3 / M4A / AAC / Opus / OGG _(new)_
- Warn only on measured issues, not on file extension _(new)_
- Hard stop only on unreadable / corrupt files _(new)_
- Source format quietly recorded in details / reports _(new)_

## 16. Project State

- Quiet autosave of session / project _(new)_
- Explicit Save Project _(new)_
- Undo / Redo (`Ctrl+Z` / `Ctrl+Shift+Z`) _(new)_
- Undo covers presets, intensity, EQ, tuning, track order, roles, transitions, metadata, settings _(new)_

## 17. Reports & Dashboard

- Standalone HTML dashboard with album story, track roles, transition rationales, scorecard _(legacy)_
- Per-track and per-transition rationales in narrative language _(legacy)_
- Reports answer: what changed, settings used, technical risks, file locations, post-export measurements, warnings / codec issues _(new)_
- Reports support confidence but stay secondary to listening _(new)_
- Normalization preview _(legacy, already implemented)_
- Richer metering display _(legacy, already implemented)_

## 18. Scoring & Critique

### Local deterministic scorer _(legacy)_

- `album_arc` — rendered LUFS targets and shape fit
- `interlude_cohesion` — gap coverage, style variation, duration, non-generic transitions
- `translation_safety` — true-peak and ceiling risk
- `preset_identity` — taste metadata and processing distinctness
- `sequence_continuity` — album WAV behaves as one sequence
- `genre_shift_handling` — handoff planning quality
- `decision_rationales` — narrative explanations in manifest

### LLM scorer (optional) _(legacy)_

- Qualitative critique from structured score features
- Requires `OPENAI_API_KEY` and `ALBUM_MASTER_LLM_MODEL`

## 19. Iteration Workflow

- Bounded multi-pass `iterate-project` _(legacy)_
- At most one improvement per pass
- Decision logged for traceability

## 20. Architecture

- **Tauri desktop app** as primary product surface _(new)_
- **Rust** owns app shell, typed product commands, file I/O, project state, autosave, render/analyze job control, progress/cancel, playback cache, output versioning, post-render check orchestration _(new)_
- Desired typed commands: `analyze_tracks`, `render_track_master`, `render_album_master`, `prepare_ab_preview`, `prepare_waveform`, `save_project`, `autosave_session`, `save_user_preset`, `run_export_checks`, `open_output` _(new)_
- **Python engine** retained for current DSP, NumPy/SciPy iteration, sidecar packaging — not assumed permanent _(new)_
- FFmpeg sidecar for decode/encode _(legacy)_
- Engine modernization (Rust / C++ / native audio libs) as a first-class workstream when it demonstrably improves sound, metering, speed, real-time audition, startup, reliability, maintainability _(new)_

## 21. DSP Correctness & Validation

- BS.1770-compliant loudness measurement _(new)_
- True-peak measurement + oversampled limiter behavior _(new)_
- Minimum-phase or mastering-appropriate filter choices _(new)_
- Validate LUFS and true peak against external reference meters _(legacy "remaining")_
- Preset calibration against representative real audio _(new)_
- Honest plain-language metering limits, no "certification" claims _(new)_
- No NaN/inf in analysis or output manifests _(new)_
- Limiter must not destroy quiet material due to isolated spikes _(new)_

## 22. Future / Research-Backed Work

- Reference-track matching algorithm _(both)_
- Better key / tempo detection _(legacy)_
- Optional integration with a real music-generation API for richer interlude beds _(legacy)_
- Real-time audition engine _(new)_
- Native DSP library adoption decisions _(new)_
- Batch preview rendering _(legacy)_
- Render history / library (after settings/custom-preset save lands) _(new)_

## 23. Test Coverage

- Eight-track synthetic album fixture covering acoustic → heavy/djent → acoustic return _(legacy)_
- Regression assertions: character inference / overrides, genre-shift handoffs, non-silent interludes, full album WAV, transition preview, scorecard, dashboard, rationales _(legacy)_
- Product gates: launch, drag/drop, analyze, waveform render, A/B same-position, region loop, non-overwriting export, QC runs, report opens, source files untouched, real user audio works _(new)_
- Album gates: reorder, roles/story appears, per-track overrides persist, continuous WAV, individual masters, cue/split, transitions off by default, boundary preservation _(new)_
- Human listening gates: A/B preserves playhead, Volume Match labels honest, Universal preset doesn't harm representative tracks, aggressive settings warn _(new)_

## 24. Non-Goals

- Not a certified mastering lab _(new)_
- Not a replacement for a skilled mastering engineer _(new)_
- Not a DAW: no clip moving, multitrack arrangement, destructive trimming, timeline editing _(new)_
- Not a toy normalizer _(new)_
