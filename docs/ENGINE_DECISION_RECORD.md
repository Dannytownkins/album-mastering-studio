# Engine Decision Record

Date: 2026-05-13

## Architecture decision (locked)

The Python audition path is wrong and is being removed. The "Live Preview" Web Audio approximation in `desktop/src/App.tsx` and the "render-faithful Python pass" duality are a workaround for an architecture that cannot deliver real-time mastering. We are eliminating that duality.

Going forward:

- All real-time DSP runs in native Rust inside the Tauri process, on a cpal audio thread. The audition path is the export path. There is one DSP implementation.
- Python remains only for offline album-mode composition planning: `arc.py`, `character.py`, `interludes.py`, and `dashboard.py`. Those are sequencing/planning code, not DSP, and are not on the audition critical path. They stay.
- The `liveAuditionRef`, `LivePreviewContract`, `livePreviewConfig.json`, `live_preview_contract` Tauri command, `render_live_preview_model`, `render_native_live_preview_model`, the "directional only" warnings, and all "approximate audition" copy will be deleted by the end of this migration.

## Reference implementation

A parallel from-scratch Rust DSP implementation already exists at `../album-mastering-studio-claude-build/src-tauri/src/`. These three files are canonical for the shape of the migration:

- `dsp.rs`: RBJ Audio EQ Cookbook biquads (low-shelf / peak / high-shelf), 3-band linked-stereo multiband compressor, K-weighted BS.1770 momentary LUFS with 400ms sliding mean-square.
- `audio.rs`: `AudioPlayer` running on a cpal thread, atomic snapshot pattern, `MasteringSource` chain.
- `engine.rs`: `analyze_tracks`, `render_track_preview`, `render_track_master` commands.

Do not blind-copy. Adapt the shape into this repo's existing module structure. Where this repo has a `Settings` struct or a `Track` shape that differs, preserve this repo's types and write the DSP to fit them. The reference exists so we do not re-derive the math, not so we fork the codebase.
