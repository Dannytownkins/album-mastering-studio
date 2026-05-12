# Product Plan

## Product Promise

Album Mastering Studio should feel like a tasteful mastering assistant for whole records. It should not merely normalize files. It should plan an emotional sequence, master each song into that sequence, generate musical interludes from surrounding audio, and critique its own output.

The product promise is especially tested by an acoustic/indie-folk -> djent/heavy -> acoustic return album. The hard handoffs should feel composed, not pasted together. The mastering chain participates in the transition by preparing outgoing tails and incoming heads, while generated interludes carry derived musical material between them.

## Current Product Surface

- CLI package with installed `album-master` command.
- Multi-format FFmpeg import/export.
- Editable `.ams.json` album projects.
- Opinionated mastering presets:
  - `3am-kitchen-floor`
  - `radio-brittle`
  - `velvet-museum`
  - `streaming`
  - `gentle`
  - `loud`
- Fine-tuning controls for loudness, warmth, low-end weight, air EQ, presence EQ, stereo width, and intensity.
- Sequence-level character inference with optional project overrides:
  - `acoustic_folk`
  - `transition`
  - `heavy_djent`
  - `return_acoustic`
- Album arcs:
  - `cinematic`
  - `afterhours`
  - `club-peak`
  - `fever-dream`
- Auto interlude planning from source-track loudness, centroid, energy, inferred character, preset bias, and arc position.
- Genre-aware handoff planning:
  - `acoustic_to_heavy`
  - `heavy_to_heavy`
  - `heavy_to_acoustic`
  - `acoustic_to_acoustic`
  - textural bridge variants
- Tail/head mastering treatments for hard handoffs before the interlude is generated.
- Interlude synthesis styles:
  - `ambient`
  - `tape`
  - `swell`
  - `rhythmic`
  - `minimal`
- Transition preview rendering.
- Render scorecards with local deterministic scoring.
- Optional LLM scoring notes when `OPENAI_API_KEY` and `ALBUM_MASTER_LLM_MODEL` are available.
- Bounded multi-pass `iterate-project` workflow that applies at most one improvement per pass and logs the decision.
- Standalone HTML dashboard/report with album story, track roles, transition rationales, and scorecard.

## Mastering Chain

1. Decode source audio to stereo float through FFmpeg.
2. Analyze duration, peak, true peak estimate, RMS, integrated LUFS-style loudness, crest factor, dynamic range, stereo image, spectral balance, transient density, and energy density.
3. Infer or accept track character across the full album sequence.
4. Plan an album arc, per-track loudness targets, per-track mastering moves, transition handoffs, interlude styles, interlude durations, and edge-mastering treatments.
5. Remove DC offset.
6. High-pass rumble.
7. Apply taste EQ plus track-position EQ moves: low shelf, low-mid bell, presence bell, air shelf.
8. Apply linked stereo compression with track-position intensity.
9. Shape transients.
10. Add saturation.
11. Adjust stereo width using mid/side processing.
12. Match track to the arc-adjusted LUFS target.
13. Apply adjacent transition head/tail treatments.
14. Ceiling-limit and encode.

## Interlude System

Interludes derive from the previous track tail and next track head. They estimate a usable root range, glide between tonal centers, create harmonic pads, fold in filtered source texture, and then apply style-specific behavior.

- `ambient`: pad plus source texture and light air.
- `tape`: warmer, darker, saturated, low-passed, slight wobble.
- `swell`: reversed texture and lifting envelope.
- `rhythmic`: pulsed pad movement from estimated root-derived tempo.
- `minimal`: quiet connective tissue with more negative space.

`auto` chooses between these based on energy change, brightness change, inferred character, handoff type, preset bias, and arc position. The interlude is generated from neighboring audio, but it is not the only transition mechanism: hard acoustic/heavy shifts also alter the outgoing tail and incoming head of the mastered tracks.

## Scoring

The local scorer evaluates:

- `album_arc`: rendered LUFS targets and shape fit.
- `interlude_cohesion`: gap coverage, style variation, duration, and non-generic transitions.
- `translation_safety`: true-peak and ceiling risk.
- `preset_identity`: whether the selected preset has strong taste metadata and processing choices.
- `sequence_continuity`: whether the album WAV and interludes behave like one sequence.
- `genre_shift_handling`: whether acoustic/heavy/return handoffs have planned interludes and mastering edge moves.
- `decision_rationales`: whether the manifest explains mastering and transition choices in narrative language.

The optional LLM scorer adds qualitative critique from the structured score features.

## Test Coverage

The regression suite includes an eight-track synthetic album with the required acoustic -> heavy/djent -> acoustic return shape. It asserts character inference/overrides, genre-shift handoffs, non-silent interludes, full album WAV rendering, transition preview, scorecard generation, dashboard export, and per-track/per-transition rationales.

## Remaining Publish-Quality Work

- Validate LUFS and true peak against external reference meters.
- Add batch preview rendering.
- Add waveform or local web UI.
- Add cue sheets and metadata export.
- Add reference-track matching.
- Add better key/tempo detection.
- Consider optional integration with a real music generation API for more elaborate interlude beds.
