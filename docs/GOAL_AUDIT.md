# Goal Coverage Audit

Last updated: 2026-05-12

Active goal:

```text
Rebuild Album Mastering Studio from the existing repo, starting with a verified Track Master-first Tauri desktop surface while preserving the Python engine contract, Album Master path, docs/progress handoff trail, and local/offline workflow.
```

This audit is a handoff guard, not a completion claim. Keep it current when the work crosses a major evidence boundary or when a compaction handoff would otherwise force the next agent to rebuild state from long logs.

## Current Goal Status

Status: active, not complete.

The current repo has strong automated evidence for the Track Master-first Tauri surface, Python engine contract, Album Master path, and packaged Windows flow. The remaining blockers are quality gates that cannot be honestly closed by documentation alone:

- Human listening approval has not been recorded.
- Live Preview remains an explicit Web Audio approximation, not shared/export-engine-faithful DSP.
- OS file-picker Open and Save-As dialog flows remain unautomated.

## Coverage Map

| Goal area | Current evidence | Status |
| --- | --- | --- |
| Start from existing repo | Work continues in `src/album_mastering_studio`, `desktop/`, and the existing `.ams.json` workflow. | Covered |
| Track Master-first Tauri surface | Packaged Track Preview smoke covers mode, two-track rail, preview render, waveform region, loop, seek, A/B, Volume Match, Live Preview first controls, stale state, Update Preview, Render Region, and batch export receipt. | Covered with caveats |
| Python engine contract | `album-master preview-contract --json`, `live_preview_contract()`, and unit regression keep `desktop/src/livePreviewConfig.json` aligned with engine-owned control definitions. | Covered |
| Album Master path | Automated release evidence covers multi-source and full-source Album Master render, transitions, album WAV, dashboard, export checks, and native album playback stability. | Covered with listening caveat |
| Docs/progress handoff trail | `docs/progress.md`, `docs/codex-active-handoff.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/ENGINE_DECISION_RECORD.md` record current evidence and known gaps. | Covered |
| Local/offline workflow | Python sidecar, FFmpeg/FFprobe resources, Tauri release build, and local render/check/report flow remain the core path. | Covered |
| Release package | `npm run tauri:build` has rebuilt the sidecar, release EXE, MSI, and NSIS bundles in recent loops. | Covered with rerun-before-release rule |

## Latest Evidence Anchors

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
2. Live Preview either becomes shared/export-engine faithful for the basic ear-facing controls or remains clearly scoped as an approximation with release-candidate wording adjusted accordingly.
3. The final release loop reruns the release build and the relevant Track Master, Album Master, sidecar, and installer smokes from the current commit.

## Next Unattended Slices

Best next slices when the user is not actively listening:

1. Add a native Rust offline Live Preview model oracle and compare it against the Tauri-accessible Python engine model before wiring any native live playback.
2. Add narrower release smoke coverage for any unverified UI evidence that is currently only documented, especially around project Open/Save-As if a reliable OS-dialog strategy is chosen.
3. Keep tightening the product honesty surface: every preview path should state whether it is Web Audio approximation, Python render-faithful preview, or Python render-faithful region.

Best next slice when the user is present:

1. Run Track Master on `C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3`, listen through Live Preview, Update Preview, Render Region, and Export Master, then record the listening result.
2. Run Album Master with real source material, listen through the continuous album WAV and boundaries, then record approval or concrete problems.
