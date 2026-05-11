# Building a Standalone Album-Folding Mastering App for Dan: A Build Plan (May 2026)

## TL;DR

- **Mastering target stack is settled and easy to hit programmatically:** for streaming-only delivery in 2026, aim for **−14 LUFS integrated / −1 dBTP** as a one-master-fits-all baseline (Apple Music will play ~2 dB quieter via Sound Check, everything else lands clean). The hard problem is *album-relative* loudness across acoustic folk → djent → folk; the platforms support this via album-mode normalization, but only Apple Music and Tidal honor it consistently. The Python audio stack (pyloudnorm + Spotify's pedalboard + soundfile + ffmpeg + Matchering 2.0) covers ~90% of the DSP work out of the box.

- **The AI interstitial problem is mostly solved by Suno v5/Udio for 30s–2min musical content, but commercial-grade *audio-to-audio conditioning* (smooth blends between specific keys/tempos/genres) is still rough.** Suno v5 (March 2026 v5.5) and Udio give the best quality but have no official public API; you'll need a third-party API wrapper (APIPASS, sunoapi.org, aimlapi) or self-host MusicGen-Style (audio conditioning) / Stable Audio Open 1.5 (47s cap, ideal for textures). For Dan's case — bridging specific keys/tempos — a hybrid approach (extract real stems from his tracks with Demucs v4, then use them as conditioning audio for MusicGen-Style or Stable Audio 2.5's audio-to-audio) is more controllable than pure text-to-music.

- **Realistic scope for a solo practitioner-coder with Claude Code in May 2026:** 4–8 weekends to a working v1, structured as a Python (DSP/AI orchestration) + small web UI (Tauri or just Gradio/FastAPI+HTMX) project. Don't build one monolithic app — chain small CLI tools behind a thin UI. Claude Code subagents handle the natural split: an `analysis-agent` for key/tempo/loudness, a `mastering-agent` wrapping pedalboard/pyloudnorm/Matchering, a `transition-agent` for AI generation, and a `render-agent` for crossfades/sequencing. Where agents still stumble: anything FFT/phase-related, dither correctness, and gapless concatenation math.

---

## Key Findings

### 1) Industry mastering standards and specs (May 2026)

The streaming spec landscape has stabilized; the loudness war is functionally over for streaming-first delivery (though still alive in metal/EDM where engineers ship louder "for the un-normalized listener"). Current normalization targets:

| Platform | Integrated LUFS | True Peak | Normalization behavior | Codec |
|---|---|---|---|---|
| Spotify | −14 (Normal); user-selectable −19 / −14 / −11 | −1 dBTP (−2 for loud masters) | Turns down loud; turns up quiet (with ~1 dB headroom for codec) | Ogg Vorbis 320 kbps (Premium) |
| Apple Music | −16 (Sound Check) | −1 dBTP | Sound Check turns both up and down without limiting; **user can disable it** | AAC 256 kbps (lossless tier also exists) |
| YouTube / YouTube Music | −14 | −1 dBTP | **Turn-down only** (does not boost quieter tracks) | Opus / AAC |
| Tidal | −14 (album-mode applied even in playlists) | −1 dBTP | Turn-down only; uses album normalization broadly | FLAC up to 352 kHz / 24-bit (MAX) |
| Amazon Music | −14 (some sources cite −13) | **−2 dBTP** (stricter than peers — Alexa/Echo prone to ISP clipping) | Turn-down only | MP3 320 kbps / FLAC on HD |
| SoundCloud | −14 | −1 dBTP | Officially no normalization in their docs, but reports vary | Opus / AAC |
| Deezer | −15 | −1 dBTP | Cannot be disabled by user | FLAC on HiFi |
| Bandcamp | **No normalization** | −2 dBTP recommended | None | FLAC/ALAC/MP3 |

**One-master universal target:** −14 LUFS integrated, −1 dBTP (or −2 dBTP if you want extra Amazon/Alexa safety). Don't make platform-specific masters unless you're shipping commercially — the differences don't justify the workflow cost for a private project.

**Sample rate / bit depth:**
- Mix/master internal processing: **24-bit / 48 kHz** is the most common 2026 default; **24-bit / 96 kHz** if your source mixes are at that rate. 32-bit float for intermediate processing is standard.
- Final master deliverable to distributor: **24-bit WAV at native rate** (44.1 or 48 kHz). Never deliver as 32-bit float — most aggregators reject it. Don't deliver MP3 — double-encoding to Ogg/AAC is audibly destructive.
- DSPs will down-convert internally; deliver 24/44.1 or 24/48 unless using Tidal's MAX/MQA workflow (mostly irrelevant now since MQA died in 2023 and Tidal switched to FLAC).

**File format delivery:** WAV 24-bit is the lingua franca; FLAC is accepted everywhere; ALAC only via Apple's "Mastered for iTunes" workflow (deprecated terminology now, but Apple Digital Masters spec still exists). Don't bother with MFiT/ADM badging for a private project.

**Metadata:**
- ISRC (International Standard Recording Code) — 12-char, identifies *each individual recording*. Even for a private project, every track on a release needs one; your distributor (DistroKid, TuneCore, CD Baby, Routenote) will assign one free if you don't have your own registrant code from usisrc.org (US) or IFPI (international). For a personal release that may not even get distributed: you can embed a placeholder, but if there's any chance this ever ships, get real ISRCs. **Once assigned to a recording, the ISRC is permanent and travels with it forever** — burning a new one when re-releasing kills streaming history.
- UPC (Universal Product Code) — 12-digit, identifies the *release* (one per album/EP/single product). One UPC for the whole "folded album," multiple ISRCs (one per source song — the interstitials can either share a "track" with the song before/after or get their own ISRCs).
- ID3 (MP3/AAC), Vorbis comments (FLAC/Ogg), BWF/iXML (WAV broadcast metadata) — write title, artist, album, track number, year, ISRC, genre. `mutagen` (Python) handles all of these.

**True peak vs sample peak:** Sample peak meters miss the analog reconstruction peak that appears between samples. After codec conversion (AAC, Ogg Vorbis, MP3), inter-sample peaks (ISPs) become real audible clipping. The fix is oversampling-based true-peak limiting: **ITU-R BS.1770-4** specifies a 4x oversampled detection filter, and modern limiters (FabFilter Pro-L 2) use 8x for higher accuracy. **Always limit to dBTP, not dBFS, when targeting streaming.**

**K-weighting / BS.1770-4:** This is the loudness measurement standard implemented by every modern LUFS meter. It uses two IIR filters (a high-shelf around 2 kHz to model head-related transfer, plus a high-pass at ~38 Hz) applied to mean-square values per channel, with channel weighting (surround channels heavier, LFE ignored), then a two-stage gating process (absolute −70 LUFS gate, then relative −10 LU gate) to compute integrated loudness. `pyloudnorm` is a fully BS.1770-4-compliant Python implementation and is essentially the de-facto open-source meter. EBU Tech 3342 defines LRA (Loudness Range), which is what you'd use to judge whether a track is too compressed (LRA ~6–14 LU is healthy for most genres; <4 LU is "squashed").

---

### 2) Genre-specific mastering targets

These are working-engineer norms for streaming-first delivery (Ian Shepherd's "make the loudest moments consistent at ~−10 LUFS Short-Term and let integrated land where it lands" approach, which Bob Katz and most contemporary engineers also endorse):

| Genre cluster | Integrated LUFS target | LRA (LU) | Crest factor / PLR | EQ tendencies | Compression approach |
|---|---|---|---|---|---|
| Acoustic folk / singer-songwriter | −16 to −13 | 9–14 | High (PLR 12–16) | Air shelf 10–16 kHz; warmth 200–400 Hz; presence around 2.5–4 kHz for vocal; HPF ~30–40 Hz | Very light bus compression (1–2 dB GR), gentle soft-knee, slow attack. Minimal limiting (1–2 dB) |
| Indie folk / Americana | −14 to −12 | 8–12 | PLR 10–14 | Same as above but slightly thicker low-mids 150–300 Hz | Slightly more glue compression, parallel compression to bring acoustic-guitar body forward |
| Indie rock / alt-rock | −12 to −10 | 6–10 | PLR 8–12 | Scoop 300–500 Hz to make space for vocals; lift 4–6 kHz for cymbal/drum bite | Broadband bus comp 2–3 dB; multiband to control low-end build-up around 80–120 Hz |
| Pop | −10 to −8 | 4–8 | PLR 7–10 | Bright top (8–12 kHz boost), tight bass <100 Hz, vocal forward 2–4 kHz | Heavy limiting, clipper-into-limiter chain, transient shaping to maintain punch |
| Metal / djent / post-metal | −9 to −6 (often −5 in djent) | 3–6 | PLR 6–9 | Scooped mids ~500–800 Hz; 4–6 kHz attack/pick noise; tight low end with HPF ~35–50 Hz on guitars; sub-bass on bass guitar | Very heavy multiband + broadband; some engineers clip before limit. Kick punch maintained via sidechain to bass + careful transient preservation |
| Ambient / drone | −18 to −14 | 12–24+ | Very high PLR (15–25+) | Minimal correction; lots of low-mid and high content; HPF only as needed | Almost no compression; gentle limiting only to catch occasional peaks |

**The acoustic→djent→acoustic problem (Dan's actual case):** This is intentionally a wide tonal/dynamic gap. Three practical approaches working engineers use:

1. **Don't try to make them feel the same loudness** — that's what kills albums. Master each track to its own genre target (so the folk tracks land at −14 to −16 integrated, the djent track at −7 to −9). Then trust album-mode normalization on Apple/Tidal to preserve those relationships. On Spotify, album mode also fires when listening to the album in sequence.
2. **Match the loudest *moments* (Short-Term LUFS), not the integrated loudness.** Bob Katz and Ian Shepherd both advocate this: if the loudest moment of the folk track and the loudest moment of the djent track both peak at, say, −10 LUFS Short-Term, the two tracks will feel related when sequenced even though their integrated values are wildly different.
3. **Tonal-balance match the high end and low end across all 8 tracks.** Use a single reference (one of the songs, or an external reference) and apply Matchering 2.0 in *reference mode* per-track to bring all 8 songs into the same overall spectral envelope before doing final per-track mastering. This is exactly what Matchering does (matches RMS, FR, peak amplitude, stereo width to a reference). The folk and djent tracks won't end up sounding the same — the source content is too different — but you'll eliminate "different studio" tonal mismatches.

**Engineer references for each genre:**
- Folk: Bon Iver *For Emma, Forever Ago* (Bob Ludwig); Nick Drake *Pink Moon*; Sufjan Stevens *Carrie & Lowell*
- Indie rock: The National *Trouble Will Find Me* (Greg Calbi); Big Thief *U.F.O.F.*
- Pop: Billie Eilish *When We All Fall Asleep* (John Greenham); Phoebe Bridgers *Punisher*
- Metal/djent: Periphery *Periphery III* / *Periphery V* (Adam "Nolly" Getgood); TesseracT *Sonder* (Acle Kahney); Meshuggah *The Violent Sleep of Reason* (Vlado Meller)
- Post-metal: Cult of Luna *A Dawn to Fear*; Russian Circles *Gnosis*
- Ambient: Brian Eno *Ambient 1: Music for Airports*; Stars of the Lid *And Their Refinement of the Decline*

---

### 3) The core technical problem — folding 8 tracks

**Album-level mastering principles (Bob Katz, Ted Jensen, Bob Ludwig school):**
- Album normalization is *artist intent*. Track-by-track normalization is, mathematically, a form of dynamic compression of the album. Tidal applies album normalization even inside playlists; Spotify and Apple use it when songs play in sequence.
- Sequence first, then master to context. Listen to the order. Match perceived loudness of *climaxes* across tracks rather than absolute integrated LUFS.
- Tonal consistency wins over loudness consistency. A listener will forgive a quiet acoustic track between two loud rock tracks; they won't forgive an EQ shift that makes one track sound like it was recorded in a different room.

**Inter-track relative loudness (Dan's specific case):** Build a per-track gain offset table. Master each track to its own genre-appropriate integrated LUFS, then in the final concatenation step apply a small static gain trim per track (typically ±1–3 dB) to taste. Save these offsets as project state.

**Track spacing / crossfading / gapless:**
- For a "continuous album" with AI interstitials, you want **true gapless concatenation** — no MP3-encoder padding, no playback engine gap. The way Pink Floyd's *Dark Side of the Moon*, Daft Punk's *Discovery*, and Abbey Road Side B medley do it: the audio is one continuous file at production time, then sliced at track boundaries with sample-accurate splits. Each track file *starts and ends inside what would be a continuous waveform*. WAV/FLAC/ALAC have zero padding; MP3 has encoder delay (LAME's `--nogap` mode and proper Xing headers fix this; AAC handles it via `iTunSMPB` priming/padding metadata).
- For your build: render the entire folded piece (8 songs + 7 interstitials) as **one master WAV**, then optionally export the track-split version too. Spotify, Apple Music, Tidal all support gapless when the source files are correctly delimited. The interstitials can be embedded into adjacent track files (last 30s of track 1 + 60s interstitial → "Track 1") or stand alone as their own tracks with their own ISRCs.
- Crossfade vs hard cut vs interstitial bridge: for Dan's use case (acoustic → djent transitions), the AI interstitial *is the crossfade*. The actual concatenation can be a 50–200 ms equal-power crossfade between source-song-end and interstitial-start (and same at interstitial-end), which masks any phase/level discontinuity without being audible.

**Key matching / tempo matching / harmonic mixing:**
- Use Camelot wheel logic for transition planning. Convert detected keys to Camelot notation (8A = A minor, 8B = C major, etc.). Adjacent positions (±1 step, or A↔B at same number) are smooth. Going from "1A" (Ab minor / folk track) to "8A" (A minor / djent track) is a Camelot jump that you can either embrace (the interstitial modulates harmonically over 60–90 s) or smooth (the interstitial passes through 4A → 5A → 6A → 7A → 8A in arpeggiated pads).
- Tempo matching: a tempo ramp inside the interstitial (e.g., 90 BPM → 130 BPM over 60s with elastic time-stretching of a pad layer) is musically convincing. `librosa.effects.time_stretch` or `pyrubberband` (a Python wrapper around the Rubber Band Library) handles this. Rubber Band is far better than librosa's phase vocoder for musical material.
- Detection: Essentia's `KeyExtractor` (Krumhansl-Schmuckler with Edma profile) gets ~85% accuracy on well-produced material; `RhythmExtractor2013(method="multifeature")` for tempo; or Madmom's `RNNBeatProcessor` + `DBNBeatTrackingProcessor` for state-of-the-art beat tracking. For Dan's 8 known tracks, run all three and human-verify — you only have to do it once.

**Extreme contrast in 8 tracks:** This is a *feature*, not a bug, of the project. The technical traps are:
- Don't crush the folk tracks to compete with the djent tracks loudness-wise (you'll destroy them, and normalization will undo your effort anyway).
- Do match brightness and bass tightness, even across genres. Use the same high-shelf EQ slope (~+1.5 dB above 8 kHz, gentle Q) on all tracks as a "unifying air."
- Use the interstitials to bridge keys and tempos, but also to *bridge tonal palettes*: the transition into the djent track might start with a resonant acoustic-guitar drone (from a Demucs stem of the previous folk track), gradually adding distorted texture, finally landing in tuned-down chug territory.

---

### 4) AI music generation for interstitials (30s–2min, May 2026)

**Quality leaders (consumer):**
- **Suno v5 / v5.5** (March 2026) — 44.1 kHz output, up to 8-minute generations, vocal cloning, Suno Studio (built-in DAW). Best for vocal-led content; instrumental quality strong on pop/rock/folk/ambient, less reliable on technical metal. ELO score 1,293 on community benchmarks. **No official public API** — you go through third-party wrappers (sunoapi.org, APIPASS, aimlapi.com, evolink.ai) or use a Suno Premier subscription for commercial rights at $30/mo (~$0.03–0.04/song at native pricing). Warner settled with Suno late 2025; Sony lawsuit still pending (ruling expected summer 2026 per reporting).
- **Udio** — Strong instrumental fidelity, 48 kHz, inpainting (regenerate a section without redoing the whole track), stem downloads, 30-second extension increments, audio-to-audio remix with similarity slider. **UMG settled with Udio Oct 2025**; joint UMG×Udio platform planned for 2026. Cleaner licensing story than Suno.

**Developer-friendly with proper APIs:**
- **ElevenLabs Music** (launched Aug 2025) — Clean commercial licensing, ~$0.80/min, lower quality than Suno/Udio (1–2 tiers behind on vocals) but agency-safe.
- **Google Lyria 3** (Feb 2026) — Now via Vertex AI, vocal generation added in early 2026. Image/video→music conditioning.
- **MiniMax Music 2.5** (Jan 2026) — Via FAL.AI, $0.035/track, 60s cap on FAL but longer natively. Best price-to-quality for API access.
- **Riffusion** — Loops and variations specialist; offers a proper API; not for "hero" generations.

**Self-hostable open-source:**
- **MusicGen Stereo Large** (Meta, audiocraft) — 30s per call (chain with 10s overlap for longer), 12 GB VRAM at fp16, **CC-BY-NC 4.0 license (no commercial use)**. **Critically, MusicGen-Style is the variant you want for Dan's project** — it takes a 1.5–4.5 s audio excerpt as a style conditioner. You feed it a snippet of the previous song's outro and it generates 30s in that style. Pair with text prompts ("evolve into drop-tuned palm-muted djent, 130 BPM, D minor"). This is the closest open-source thing to "blend from X to Y."
- **Stable Audio Open 1.5 / 2.5** — Latent diffusion. Open 1.5 is 47s cap, 44.1 kHz stereo, 12 GB VRAM, Stability Community License allows commercial use under revenue threshold. Stable Audio 2.5 (commercial cloud) supports audio-to-audio conditioning natively.
- **YuE 7B** — 2025 Apache 2.0 open model, ~3 min tracks, runs on L40S in ~5 min.
- **ACE-Step 3.5B** — 2025 Apache 2.0, similar tier.

**Architectural tradeoffs:**
- **Autoregressive transformer (MusicGen, YuE, Suno):** better long-form structure and vocals; slower at inference; usually quantize audio into discrete tokens (e.g., Encodec).
- **Latent diffusion (Stable Audio, ACE-Step, Udio is partly diffusion-based):** faster, more controllable for short-form audio (loops, textures, transitions <60s); better sound design quality; struggles with long-form coherence and vocals.

**For Dan's interstitial use case (30s–2min instrumental bridges with specific key/tempo/genre transitions), the practical winning stack is:**

1. **Run Demucs v4 (htdemucs_ft model) on the source song's outro** to extract usable stems (vocals/drums/bass/other) — gives you a clean acoustic guitar tail or a clean djent drone you can use as conditioning material. SDR 9.20 dB on MUSDB-HQ benchmark, MIT license, runs on consumer GPU.
2. **Feed that stem as audio-conditioning to MusicGen-Style** (or Stable Audio 2.5 if commercial license is OK) with a text prompt that describes the *target* sound (key/tempo/genre/mood).
3. **Generate multiple candidates** (cheap: ~$0.10–0.50 per generation) and pick by ear.
4. **For longer-than-30s interstitials**, chain MusicGen with 10s overlap windows, or use Suno v5 via a third-party API with a custom-mode lyric-free prompt.

**Can you actually tell a model "blend from acoustic guitar in D minor 90 BPM to drop-tuned djent in D 130 BPM"?** Partially. Suno v5 understands style descriptions and BPM/key hints in prompts but doesn't do arbitrary modulation/tempo-ramp arcs over a specified time. The cleanest approach for *true* blend is to generate the interstitial in two halves (folk-style first 30–60s, djent-style next 30–60s) and use a programmatic crossfade with a tempo-stretched bridge frame between them. That's a hybrid AI + DSP technique.

**Commercial-use rights for a private project:** For a single-user, non-distributed project ("just for Dan"), legal exposure is minimal across all platforms. If you ever distribute or perform publicly: Udio (UMG-settled, paid tier), ElevenLabs Music (licensed), and Stable Audio Open (CC-trained) are the safest. Suno is still legally contested. MusicGen output cannot be used commercially regardless of self-hosting (CC-BY-NC trains the model on Meta-internal licensed data and restricts output).

---

### 5) Audio DSP tech stack (Python-first)

**Core libraries with current versions / specs:**

| Library | Role | Why it fits this project |
|---|---|---|
| **pedalboard 0.9.x** (Spotify, GPL-3) | Effects chain, VST3/AU plugin host, audio I/O | Wraps JUCE; processes 300× faster than pySoX. Reads MP3/WAV/FLAC/AIFF/OGG. Lets Dan load real plugins (FabFilter Pro-L 2, Pro-Q 3, Ozone) from Python if he owns them. Apple-Silicon native. |
| **pyloudnorm 0.x** (Steinmetz/Reiss, MIT) | BS.1770-4 LUFS meter | Pure-Python, ±0.1 dB ITU compliance, swappable filter classes (DeMan, Fenton/Lee), LRA support. The de-facto Python loudness library. |
| **soundfile** (libsndfile bindings) | File I/O for WAV/FLAC/AIFF | Handles 24/32-bit cleanly. |
| **librosa 0.10+** | Spectral analysis, beat tracking, time-stretch (phase vocoder) | Good for analysis; phase vocoder is mediocre for stretching. Use for chroma/key features and pitch class profiles. |
| **Essentia 2.1+** (UPF MTG, AGPL) | Industrial-grade key/tempo/mood/genre extraction | `RhythmExtractor2013` for BPM, `KeyExtractor` for key (Krumhansl/Edma/Temperley profiles), TempoCNN deep-learning tempo. Most accurate open-source MIR library. |
| **madmom** | State-of-the-art beat tracking via RNN+DBN | Use if Essentia's tempo extractor disagrees with your ear; very robust to non-4/4. |
| **Matchering 2.0** (Sergree, GPL) | Reference-based automated mastering | Match each of Dan's 8 tracks to a single reference for tonal/loudness consistency. Built-in brickwall limiter. Pure Python+NumPy, no MATLAB anymore. Run as Python lib (`mg.process(target, reference, results=[...])`), no need for Docker. |
| **demucs 4.x** (Meta, MIT) | Stem separation | htdemucs_ft model, 9.20 dB SDR. Use to extract stems from Dan's outros for AI conditioning input. |
| **pyrubberband** | Time/pitch stretch | Wraps Rubber Band; far better than librosa for musical stretching of full mixes. |
| **scipy.signal** | Filter design, FFT | For custom EQ/HPF in the interstitial generator. |
| **mutagen** | ID3 / Vorbis / FLAC tagging | Embed ISRC, UPC, artist, etc., into final files. |
| **ffmpeg** (subprocess or `imageio-ffmpeg`/`ffmpeg-python`) | Format conversion, codec preview | For previewing how the master will sound after Ogg Vorbis / AAC encoding (Spotify/Apple chain simulation). |
| **SoX** | CLI utility | Useful for batch operations and dithering. |

**True-peak ISP-aware limiters in open source:** This is the weakest part of the open-source stack. Matchering 2.0 has its own brickwall limiter but it's not strictly ISP-aware in the BS.1770-4 sense. Options:
- Use pedalboard to load a real plugin (FabFilter Pro-L 2 at 8x oversampling with True Peak Limiting enabled — the gold standard) if Dan owns the license.
- Use iZotope Ozone 11/12 Maximizer (IRC IV mode is ISP-aware) via pedalboard if licensed.
- Roll your own: oversample 4–8x via scipy resampling, apply a lookahead brickwall limiter (there are tutorial implementations on GitHub), downsample. Honestly, for a private project, just use pedalboard + a commercial plugin you trust.
- `loudness-scanner` / `libebur128` CLI is BS.1770 measurement only (not limiting).

**Real-time vs offline:** Offline is the entire mode. Dan doesn't need live processing. This makes the architecture *much* simpler — no need to worry about Python's GIL pauses, garbage collection latency, audio buffer underruns, or async DSP. Everything is "load file → process → write file."

**Key/tempo detection for transition planning:**
```python
import essentia.standard as es
audio = es.MonoLoader(filename='track.wav', sampleRate=44100)()
key, scale, key_strength = es.KeyExtractor()(audio)
bpm, beats, conf, _, intervals = es.RhythmExtractor2013(method="multifeature")(audio)
```
Run on all 8 tracks; output a per-track table of (key, scale, Camelot, bpm, integrated_LUFS, LRA, true_peak). That table is the input to the transition-planning step.

---

### 6) App architecture for a simple, private tool

**Recommended stack — three options ranked for Dan's use case:**

1. **(Recommended) Gradio or FastAPI+HTMX as the UI, Python everywhere for DSP/AI.** Local-only, runs in browser at `localhost:7860`, no Electron/Tauri/Rust overhead. Project state is JSON on disk. File I/O via OS dialogs through `tkinter.filedialog` or just a file picker in the browser. Build a single Gradio app per workflow (Analyze, Master, Generate Interstitial, Render) or one tabbed app. Time to working v1: shortest. This is the "lowest-friction stack" for a practitioner-coder.

2. **Tauri + Python sidecar.** Rust shell with a TypeScript/Svelte/React UI, Python process for DSP. Bundle size ~3–10 MB (vs Electron's 150+ MB), memory ~30–50 MB idle. Good if you want a "real desktop app" feel; overkill if it's just for you. Tauri 2.x (stable late 2024) supports `tauri-plugin-shell` for spawning Python; mobile support is available but irrelevant here.

3. **Electron + Python backend.** Most familiar, biggest ecosystem, mature WaveSurfer.js integration. 80–200 MB binaries, 120+ MB RAM at idle. Only choose if Dan already knows Electron well.

**Don't go native Swift/macOS-only.** Cross-platform Python is cheaper.

**Waveform display:** WaveSurfer.js v7 (TypeScript rewrite) for in-browser visualization. For files >10 minutes, pre-generate peaks using BBC's `audiowaveform` CLI (binary format `.dat` is far smaller than JSON) and load those into WaveSurfer rather than letting it decode in-browser. Peaks.js is the alternative (BBC R&D project) — heavier, more feature-complete, but WaveSurfer.js is enough for a private tool.

**Project state (recommended JSON schema):**
```json
{
  "project_id": "danfolded-v1",
  "tracks": [
    {
      "slot": 1,
      "type": "song",
      "source_file": "/path/to/01-folk-intro.wav",
      "title": "...",
      "key": "Am", "camelot": "8A", "bpm": 92.4,
      "integrated_lufs": -16.2, "lra": 9.8, "true_peak": -3.1,
      "mastering_preset": "folk_warm_v2",
      "target_lufs": -14.0,
      "album_gain_offset_db": 0.0,
      "isrc": "USXXX2600001"
    },
    {
      "slot": 2,
      "type": "interstitial",
      "duration_s": 75,
      "from_key": "8A", "to_key": "10A",
      "from_bpm": 92.4, "to_bpm": 130,
      "conditioning_stem": "/cache/track1_outro_other.wav",
      "prompt": "evolve from fingerpicked acoustic guitar in A minor 92 BPM into drop-D djent palm-muted chug at 130 BPM",
      "generator": "musicgen-style", "seed": 42,
      "output_file": "/cache/inter_1to2_v3.wav",
      "fade_in_ms": 80, "fade_out_ms": 120
    }
  ],
  "render_settings": {
    "target_lufs": -14,
    "true_peak_ceiling_dbtp": -1.0,
    "dither": "tpdf",
    "sample_rate": 44100,
    "bit_depth": 24,
    "output_format": "wav"
  }
}
```

**Render queue / progress UX:** A simple background worker (`concurrent.futures.ProcessPoolExecutor` for AI generation jobs that are CPU/GPU-bound, plus a single-thread queue for DSP rendering) with status pushed to the UI via WebSocket (FastAPI) or Gradio's built-in queue. Each operation logs progress to a SQLite project DB. AI generations are cached by `hash(prompt + seed + conditioning_audio_hash)` so re-generation is free if you didn't change inputs.

---

### 7) Agent-assisted development with Claude Code (May 2026)

**What Claude Code can actually do in May 2026:**
- Anthropic's Sonnet 4.5 / Opus 4.6 / Opus 4.7 generation handles Python audio DSP code competently for standard library usage (pedalboard, pyloudnorm, librosa, ffmpeg subprocess invocation). Multi-file project orchestration works well. The 1M-token context window (Opus 4.6 beta) means it can hold Dan's entire codebase plus reference docs.
- Subagent dispatch is the right pattern: define specialized agents in `.claude/agents/`. Each gets isolated context, specific tool permissions, and frontmatter (model: sonnet/opus/haiku, tools allowed). The main session orchestrates; subagents handle bounded tasks.
- Skills (`.claude/skills/SKILL.md`) inject domain knowledge — e.g., a "loudness-mastering" skill with the BS.1770-4 spec, platform targets, and pedalboard idioms always loaded.
- Hooks fire around tool calls — pre-commit lint, post-edit pytest, etc.
- CLAUDE.md at project root provides the persistent context: tech stack, conventions, MCP servers available.

**Recommended subagent structure for this project:**
- `analysis-agent` — librosa/essentia/madmom for key, tempo, LUFS, LRA. Read-only on audio files. Output: per-track JSON.
- `mastering-agent` — pedalboard + pyloudnorm + Matchering 2.0 chains. Reads source WAVs, writes mastered WAVs and a report. Tools: Read, Write, Bash (for ffmpeg).
- `ai-bridge-agent` — calls Suno/Udio/MusicGen-Style/Stable Audio APIs. Web fetch + HTTP calls. Handles retries, caching, hashing of inputs. Has its own credentials in an `.env` it can read.
- `render-agent` — final concatenation, crossfades, dithering, ISRC/metadata embedding via mutagen, ffmpeg encoding to test-preview MP3/AAC, codec preview.
- `ui-agent` — Gradio/FastAPI/TS code. Knows nothing about DSP; just calls the backend agents' CLI entry points.
- `qa-agent` — runs pytest, lints, and most importantly: **runs LUFS measurement on output files to verify the master actually hits target**. This is the "did it work" agent. Use it as a hook on every render.

**Baton-file handoff pattern:** Each agent writes its output to `state/baton_{timestamp}.json`. The next agent reads it. This is more debuggable than long context handoffs and gives you re-runnable pipeline stages.

**Realistic time estimate for a solo practitioner-coder with heavy Claude Code assistance:**
- v0 (analysis + per-track mastering with pedalboard/Matchering + simple concatenation): **1–2 weekends** (~16–24 hours).
- v1 (add AI interstitial generation via Suno third-party API or self-hosted MusicGen-Style, key/tempo planning, Gradio UI): **another 2–3 weekends** (~24–36 hours).
- v2 (proper waveform UI, project state, render queue, codec preview, ISRC/UPC metadata): **2–3 more weekends** (~24–36 hours).
- **Total: 4–8 weekends to a working, used-daily tool.** Most of that is iteration on AI output quality and your own taste, not coding. The DSP plumbing is largely solved.

**Where Claude Code still struggles with audio DSP specifically (May 2026):**
- **FFT-based custom processing** (linear-phase EQ design, custom spectral subtraction): models still get window/overlap math wrong. Verify any custom FFT code with synthetic test signals.
- **Numerical precision in iterative algorithms** (loudness gating, look-ahead limiters): off-by-one in gating block calculation is common. Use `pyloudnorm` and don't write your own meter unless you have to.
- **Dither**: agents often forget to apply TPDF dither when bit-depth reducing from 32-float to 24/16 — or apply it in the wrong stage of the chain.
- **Inter-sample peak / oversampling math**: agents will write code that "looks right" but uses the wrong resampling filter, producing readings that don't match commercial meters. Use `pyloudnorm` for measurement and a real plugin (via pedalboard) for limiting.
- **Gapless concatenation**: agents will naively concatenate WAV samples and forget that MP3/AAC encoders add priming/padding. Use `ffmpeg -copyts` with `-c:a copy` or render as one WAV and split with sample-accurate cue points.
- **Real-time/streaming audio**: not relevant for this project (offline-only), but if you ever want it, agents struggle here.

---

### 8) Critical considerations, gotchas, and prior art

**Existing tools that already do parts of this:**

| Tool | Strength | Weakness for Dan's case |
|---|---|---|
| **LANDR** | One-click mastering, decent across genres, integrated distribution | Black-box; can't fold tracks; aggressive limiting on louder genres; not API-friendly for chaining |
| **eMastered** | Reference-based mastering | Same black-box problem; no transition generation |
| **CloudBounce** | Per-genre presets | Quality varies; no album-mode |
| **iZotope Ozone 11/12** | Best-in-class assistive mastering (Master Assistant), tonal balance reference matching, codec preview built-in | Not scriptable in any easy way (limited Python interop via pedalboard plugin loading); UI-driven; expensive |
| **Matchering 2.0** | Open-source reference matching; the most useful piece for Dan's "make 8 tracks feel consistent" problem | Doesn't handle interstitials, sequencing, or album-mode balancing |
| **Mixea / BandLab Mastering** | Free, decent quality | Same black-box limitations |
| **Mixed In Key** | Best-in-class key detection (Camelot wheel notation), used by working DJs | Closed-source; you'd license output, not the algorithm. Essentia + KeyExtractor is sufficient for personal use. |
| **Rekordbox / Serato** | DJ-grade beat-matching, key analysis, automated transition planning | Designed for live mixing, not album rendering. But the *logic* (Camelot wheel transitions, BPM compatibility ±6%) is exactly what you want to copy. |

**"Continuous mix" album precedents — how they were technically achieved:**
- **Pink Floyd, *Dark Side of the Moon* (1973):** Mixed as a continuous tape master; track splits were physical cue points on the master tape, so the "gaps" are zero-length. Modern reissues preserve this by mastering the album as one continuous file and cutting at sample-accurate boundaries.
- **Daft Punk, *Discovery* (2001):** Same approach — continuous master, cue-point splits.
- **Daft Punk, *Alive 2007*:** Genuinely one continuous DJ set, then sliced.
- **The Beatles, Abbey Road Side B medley:** Continuous tape master with crossfades baked into the audio.
- The DAW-era version (your build): render the entire 8-songs-plus-7-interstitials piece as one master WAV at 24/44.1 or 24/48. Then either deliver as 15 individually-tagged WAV files with sample-accurate splits (for streaming-platform-track-listing reasons) or as one long track (simpler, but loses per-song discovery on platforms). Most "continuous album" releases on Spotify use the split approach because platforms can't deep-link to mid-track positions for playlists. **Apple Music's Continuous Audio Connection (tvOS 26.4)** and similar features in 2026 are trying to fix track-boundary gaps in Dolby Atmos chains, but for stereo it's been solved for years if your files are properly encoded.

**Rights / copyright for AI-generated transitions:**
- **Private use:** Effectively no exposure across any model. Generate, use, enjoy.
- **If you ever share or distribute:**
  - Suno: contested. Premier subscription grants commercial rights but Sony lawsuit unresolved. *Risk to monitor.*
  - Udio: settled with UMG; Standard ($10/mo) and Pro ($30/mo) grant commercial rights. *Safer.*
  - ElevenLabs Music: licensed training data, clean commercial rights on paid plans.
  - Stable Audio Open 1.5: Stability Community License permits commercial use under a revenue threshold (currently $1M; check the model card before shipping).
  - MusicGen / MusicGen-Style: **CC-BY-NC 4.0 — no commercial use, ever, even self-hosted.** Personal-only.
  - YuE / ACE-Step: Apache 2.0 — fully commercial-safe.

**Storage / processing requirements:**
- 8 source songs × ~5 min × 24-bit/48 kHz stereo ≈ 250 MB raw.
- 7 interstitials × ~1.5 min ≈ 30 MB each in WAV at 24/48 = ~250 MB more after multiple generations.
- Demucs v4 separation: ~100–300 MB per stem set, run takes 30s–3min per song on a recent GPU, 5–15 min on CPU.
- Local AI inference: MusicGen-Stereo-Large needs ~12 GB VRAM (RTX 4070+ tier); Stable Audio Open ~5.9 GB during diffusion, ~14.5 GB during decoding (use chunked decoding to fit on smaller GPUs).
- Total project storage: **~10–30 GB** including all cached generations and stems. Trivial on modern storage.
- If using Suno/Udio via API: nothing local except output downloads. Budget $30–100 total across iterations.

**Should this be one app or a pipeline of smaller tools?** **Pipeline of small tools chained by a thin UI.** This is the more agent-friendly architecture, the more debuggable architecture, and the more reusable-later architecture. Build:
1. `analyze` CLI — reads WAVs, writes per-track JSON.
2. `match-tone` CLI — Matchering 2.0 wrapper, reads target + reference, writes tone-matched WAV.
3. `master` CLI — pedalboard chain + pyloudnorm gain stage + true-peak limiter, reads tone-matched WAV + per-track preset, writes mastered WAV.
4. `plan-transitions` CLI — reads per-track JSON, outputs interstitial spec JSON (which key/tempo bridges to which).
5. `extract-stem` CLI — Demucs wrapper for harvesting conditioning audio.
6. `generate-interstitial` CLI — wraps Suno API or MusicGen-Style, takes spec JSON + conditioning audio.
7. `render` CLI — reads project JSON, concatenates with crossfades, applies final album-level gain, dithers, writes final masters + per-track splits + metadata.

The UI (Gradio is the lowest-friction; Tauri if you want a "real app") just orchestrates these CLIs and displays state/waveforms. Each CLI is independently testable, has its own subagent assigned in `.claude/agents/`, and can be rerun without touching the others.

---

## Caveats

- **AI music generation rights and capabilities are moving fast.** Suno v5.5 was March 2026; Sony's Suno lawsuit ruling is expected summer 2026 and could reshape what's safely usable. Stable Audio 2.5 and Lyria 3 both shipped in early 2026 with new capabilities. Re-check the licensing landscape before any distribution.

- **Platform LUFS targets are stable as of May 2026 but not contractually guaranteed.** Spotify in particular has changed its loudness behavior twice in five years (added Loud setting, changed default headroom). The Mat Leffler-Schulman and iZotope sources explicitly note "these numbers are current as of 2026 but subject to change." Have your tool re-measure final masters against currently-published platform docs at release time.

- **No public Suno API exists.** Every "Suno API" you can buy is a third-party wrapper around the consumer site, which means it can be rate-limited or shut down by Suno without notice. If your transition generation pipeline depends on Suno, also wire in a fallback (Udio API via similar wrappers, or self-hosted MusicGen-Style).

- **Matchering 2.0 is great but opinionated.** It matches RMS/FR/peak/stereo width to a single reference. For an album spanning folk to djent, you can't use one reference for all 8 tracks — they're too different. Likely workflow: pick one folk reference and one metal reference; apply Matchering per-cluster. Or apply Matchering only for tonal-balance "air" matching (high shelf curve) and handle the rest manually.

- **Time estimates assume Dan is a practitioner-coder, not a beginner.** If audio DSP concepts (sample peak vs true peak, gating, dithering) are new, double the estimates and add reading time for Bob Katz's *Mastering Audio* (3rd edition, the chapters on metering and album sequencing in particular). Ian Shepherd's free Loudness Penalty tool and his Sound on Sound interviews are excellent companion reading.

- **The "feels cohesive without flattening dynamics" goal is ultimately artistic.** The technical infrastructure described here gets you to a master that *can* be cohesive. Whether the folk→djent→folk arc actually works as a musical statement is a judgment call no app can make for you. Build the tool, run iterations, A/B with reference albums (Opeth's *Damnation* / *Deliverance* pair, or any Anathema record post-2003 for genre-bridging in adjacent territory), trust your ears.

- **One thing the research did not surface authoritative 2026-current numbers for:** SoundCloud's exact normalization behavior. Different sources say "no normalization" and "−14 LUFS normalization." For a streaming-only delivery, treat SoundCloud as a no-normalization safety case (master will play at full level) and your one universal master at −14 LUFS / −1 dBTP will be fine.

- **YouTube Music and YouTube proper share normalization (−14 LUFS, turn-down only), but YouTube's "loudness penalty" is applied at the video level, and uploaded music videos can behave differently from songs uploaded as audio-only.** If YouTube is a delivery target, test with one track first.