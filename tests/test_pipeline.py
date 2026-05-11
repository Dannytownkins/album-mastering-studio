from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from album_mastering_studio.dashboard import export_dashboard
from album_mastering_studio.iteration import iterate_project
from album_mastering_studio.mastering import PRESETS, limit_ceiling, master_track
from album_mastering_studio.analysis import analyze_audio
from album_mastering_studio.audio_io import load_audio
from album_mastering_studio.interludes import INTERLUDE_STYLES, make_interlude
from album_mastering_studio.scoring import score_render
from album_mastering_studio.pipeline import (
    RenderOptions,
    create_project,
    render_album,
    render_project,
    render_transition_preview,
)


class PipelineTest(unittest.TestCase):
    def test_render_album_creates_masters_interludes_and_album_sequence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "inputs"
            output_dir = root / "outputs"
            input_dir.mkdir()
            self._write_sine(input_dir / "01_open.wav", 220.0, 0.55)
            self._write_sine(input_dir / "02_middle.wav", 330.0, 0.40)
            self._write_sine(input_dir / "03_close.wav", 165.0, 0.50)

            manifest = render_album(
                [input_dir],
                output_dir,
                RenderOptions(interlude_duration=1.5, interlude_style="swell", album_wav=True),
            )

            self.assertEqual(manifest["track_count"], 3)
            self.assertEqual(manifest["interlude_count"], 2)
            self.assertEqual(manifest["settings"]["interlude_style"], "swell")
            self.assertIn("integrated_lufs", manifest["sequence"][0]["after"])
            self.assertIn("true_peak_dbfs", manifest["sequence"][0]["after"])
            self.assertIn("short_term_lufs_max", manifest["sequence"][0]["after"])
            self.assertIn("loudness_range_lu_proxy", manifest["sequence"][0]["after"])
            self.assertEqual(manifest["settings"]["bit_depth"], 24)
            self.assertEqual(len(manifest["cue_points"]), 5)
            self.assertTrue(Path(manifest["cue_sheet"]).exists())
            self.assertTrue(Path(manifest["outputs"]["cue_json"]).exists())
            self.assertEqual(len(manifest["codec_previews"]), 2)
            self.assertTrue((output_dir / "manifest.json").exists())
            self.assertEqual(len(list((output_dir / "masters").glob("*.wav"))), 3)
            self.assertEqual(len(list((output_dir / "interludes").glob("*.wav"))), 2)
            self.assertTrue((output_dir / "album_sequence.wav").exists())
            with wave.open(str(output_dir / "album_sequence.wav"), "rb") as wav:
                self.assertEqual(wav.getsampwidth(), 3)

            album = load_audio(output_dir / "album_sequence.wav", 48_000)
            self.assertGreater(album.shape[0], 48_000 * 10)
            self.assertFalse(np.any(np.isnan(album)))
            self.assertLessEqual(float(np.max(np.abs(album))), 1.0)
            self.assertGreater(float(np.sqrt(np.mean(np.square(album)))), 0.01)

    def test_cli_render_command_creates_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "inputs"
            output_dir = root / "outputs"
            input_dir.mkdir()
            self._write_sine(input_dir / "01_a.wav", 196.0, 0.35)
            self._write_sine(input_dir / "02_b.wav", 261.63, 0.35)

            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "album_mastering_studio.cli",
                    "render",
                    str(input_dir),
                    "--output",
                    str(output_dir),
                    "--interlude-duration",
                    "0.75",
                    "--interlude-style",
                    "tape",
                    "--reference-track",
                    str(input_dir / "01_a.wav"),
                    "--album-wav",
                ],
                check=True,
                text=True,
                capture_output=True,
            )

            summary = json.loads(result.stdout)
            self.assertEqual(summary["track_count"], 2)
            self.assertEqual(summary["interlude_count"], 1)
            self.assertTrue((output_dir / "manifest.json").exists())
            self.assertTrue((output_dir / "album_sequence.wav").exists())
            manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["reference"]["path"], str(input_dir / "01_a.wav"))
            self.assertIn("integrated_lufs", manifest["reference"]["analysis"])

    def test_cli_analyze_includes_waveform_bins(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_path = root / "source.wav"
            self._write_sine(input_path, 220.0, 0.25)

            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "album_mastering_studio.cli",
                    "analyze",
                    str(input_path),
                    "--waveform-bins",
                    "16",
                ],
                check=True,
                text=True,
                capture_output=True,
            )

            rows = json.loads(result.stdout)
            self.assertEqual(len(rows), 1)
            self.assertEqual(len(rows[0]["waveform"]), 16)
            self.assertIn("integrated_lufs", rows[0]["analysis"])

    def test_interlude_styles_render_finite_audio(self) -> None:
        sample_rate = 48_000
        track_a = self._sine_array(220.0, 0.45, seconds=2.0)
        track_b = self._sine_array(329.63, 0.45, seconds=2.0)

        for style in INTERLUDE_STYLES:
            with self.subTest(style=style):
                interlude = make_interlude(track_a, track_b, sample_rate, 1.0, style)
                stats = analyze_audio(interlude, sample_rate)
                self.assertEqual(interlude.shape, (sample_rate, 2))
                self.assertFalse(np.any(np.isnan(interlude)))
                if style == "hard-cut":
                    self.assertLess(float(np.max(np.abs(interlude))), 0.0001)
                else:
                    self.assertGreater(stats.integrated_lufs, -80.0)
                self.assertLessEqual(stats.true_peak_dbfs, -2.5)

    def test_rhythmic_interlude_uses_onset_tempo_not_root_pitch(self) -> None:
        from album_mastering_studio.interludes import _estimate_transition_tempo

        sample_rate = 48_000
        source = self._click_track(120.0, seconds=4.0)
        tempo = _estimate_transition_tempo(source, source, sample_rate)
        self.assertGreater(tempo, 110.0)
        self.assertLess(tempo, 130.0)

    def test_limiter_does_not_global_trim_for_single_spike(self) -> None:
        sample_rate = 48_000
        source = self._sine_array(220.0, 0.18, seconds=2.0)
        source[sample_rate, :] = 1.4

        limited = limit_ceiling(source, -1.0, sample_rate)
        far_before = source[: sample_rate // 2]
        far_after = limited[: sample_rate // 2]
        before_rms = float(np.sqrt(np.mean(np.square(far_before))))
        after_rms = float(np.sqrt(np.mean(np.square(far_after))))

        self.assertLessEqual(float(np.max(np.abs(limited))), 0.9)
        self.assertGreater(after_rms / before_rms, 0.98)

    def test_project_file_controls_transition_style_duration_and_enabled_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "inputs"
            output_dir = root / "outputs"
            project_path = root / "album.ams.json"
            input_dir.mkdir()
            self._write_sine(input_dir / "01_a.wav", 220.0, 0.35)
            self._write_sine(input_dir / "02_b.wav", 261.63, 0.35)
            self._write_sine(input_dir / "03_c.wav", 329.63, 0.35)

            project = create_project(
                [input_dir],
                project_path,
                RenderOptions(interlude_duration=1.0, interlude_style="ambient", album_wav=True),
                album_title="Project Control Test",
            )
            project["transitions"][0]["style"] = "minimal"
            project["transitions"][0]["duration_seconds"] = 0.5
            project["transitions"][1]["enabled"] = False
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")

            manifest = render_project(project_path, output_dir)

            self.assertEqual(manifest["project"], str(project_path))
            self.assertEqual(manifest["track_count"], 3)
            self.assertEqual(manifest["interlude_count"], 1)
            interludes = [item for item in manifest["sequence"] if item["type"] == "interlude"]
            self.assertEqual(interludes[0]["style"], "minimal")
            self.assertEqual(interludes[0]["duration_seconds"], 0.5)
            self.assertTrue(Path(interludes[0]["output"]).exists())
            self.assertTrue((output_dir / "album_sequence.wav").exists())

    def test_project_preserves_tweak_lufs_and_inherit_transition_semantics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "inputs"
            output_dir = root / "outputs"
            project_path = root / "album.ams.json"
            input_dir.mkdir()
            self._write_sine(input_dir / "01_a.wav", 220.0, 0.35)
            self._write_sine(input_dir / "02_b.wav", 261.63, 0.35)

            project = create_project(
                [input_dir],
                project_path,
                RenderOptions(
                    interlude_duration=0.75,
                    interlude_style="tape",
                    tweak_lufs=-1.25,
                    album_wav=True,
                    delivery_profile="apple-aac-check",
                ),
                album_title="Inherit Test",
                metadata={"artist": "Dan", "album_artist": "Dan", "genre": "Folk Metal", "release_year": "2026", "upc": "123456789012"},
            )
            project["tracks"][0]["isrc"] = "USAAA2600001"
            project["transitions"][0]["style"] = "inherit"
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")

            manifest = render_project(project_path, output_dir)
            interlude = next(item for item in manifest["sequence"] if item["type"] == "interlude")

            self.assertEqual(manifest["settings"]["tweak_lufs"], -1.25)
            self.assertEqual(manifest["delivery_profile"]["key"], "apple-aac-check")
            self.assertEqual(manifest["metadata"]["album_artist"], "Dan")
            self.assertEqual(manifest["sequence"][0]["isrc"], "USAAA2600001")
            self.assertEqual(interlude["style"], "tape")

    def test_hard_cut_silence_is_not_reported_as_unintentional(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "inputs"
            output_dir = root / "outputs"
            project_path = root / "album.ams.json"
            input_dir.mkdir()
            self._write_sine(input_dir / "01_a.wav", 220.0, 0.35)
            self._write_sine(input_dir / "02_b.wav", 261.63, 0.35)

            project = create_project(
                [input_dir],
                project_path,
                RenderOptions(interlude_duration=0.5, interlude_style="hard-cut", album_wav=True),
                album_title="Hard Cut Test",
            )
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")

            manifest = render_project(project_path, output_dir)
            self.assertFalse(any("almost silent" in warning for warning in manifest["warnings"]))

    def test_transition_preview_renders_tail_interlude_and_head(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "inputs"
            project_path = root / "album.ams.json"
            preview_path = root / "preview.wav"
            input_dir.mkdir()
            self._write_sine(input_dir / "01_a.wav", 220.0, 0.35)
            self._write_sine(input_dir / "02_b.wav", 261.63, 0.35)

            project = create_project(
                [input_dir],
                project_path,
                RenderOptions(interlude_duration=0.75, interlude_style="tape"),
                album_title="Preview Test",
            )
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")

            summary = render_transition_preview(
                project_path,
                after_track=1,
                output_path=preview_path,
                tail_seconds=0.5,
                head_seconds=0.5,
            )

            preview = load_audio(preview_path, 48_000)
            self.assertEqual(summary["between"], [1, 2])
            self.assertEqual(summary["style"], "tape")
            self.assertAlmostEqual(summary["duration_seconds"], 1.75, places=2)
            self.assertEqual(preview.shape[0], int(48_000 * 1.75))
            self.assertFalse(np.any(np.isnan(preview)))

    def test_opinionated_presets_have_audibly_different_targets_and_tone(self) -> None:
        sample_rate = 48_000
        source = self._sine_array(220.0, 0.35, seconds=3.0)

        late = master_track(source, sample_rate, "3am-kitchen-floor")
        brittle = master_track(source, sample_rate, "radio-brittle")

        self.assertLess(PRESETS["3am-kitchen-floor"].target_lufs, PRESETS["radio-brittle"].target_lufs)
        self.assertLess(late.after.integrated_lufs, brittle.after.integrated_lufs)
        self.assertLess(PRESETS["3am-kitchen-floor"].presence_db, 0)
        self.assertGreater(PRESETS["radio-brittle"].presence_db, 0)
        self.assertIn("late-night", PRESETS["3am-kitchen-floor"].science_note)
        self.assertIn("broadcast", PRESETS["radio-brittle"].science_note)

    def test_auto_arc_render_scores_and_iteration_writes_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "inputs"
            output_dir = root / "outputs"
            project_path = root / "album.ams.json"
            input_dir.mkdir()
            self._write_sine(input_dir / "01_a.wav", 196.0, 0.32)
            self._write_sine(input_dir / "02_b.wav", 293.66, 0.45)
            self._write_sine(input_dir / "03_c.wav", 246.94, 0.38)

            project = create_project(
                [input_dir],
                project_path,
                RenderOptions(
                    preset="3am-kitchen-floor",
                    interlude_duration=0.75,
                    interlude_style="auto",
                    arc="afterhours",
                    album_wav=True,
                ),
                album_title="Iteration Test",
            )
            self.assertEqual(project["settings"]["arc"], "afterhours")

            summary = iterate_project(project_path, output_dir, passes=2, scorer="local")

            self.assertEqual(len(summary["passes"]), 2)
            self.assertTrue((output_dir / "pass_01" / "scorecard.json").exists())
            self.assertTrue((output_dir / "pass_02" / "manifest.json").exists())
            manifest = json.loads((output_dir / "pass_01" / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["settings"]["interlude_style"], "auto")
            self.assertIn("arc", manifest)
            interlude_styles = [item["style"] for item in manifest["sequence"] if item["type"] == "interlude"]
            self.assertNotIn("auto", interlude_styles)
            self.assertEqual(manifest["interlude_count"], 2)
            pass_two = json.loads((output_dir / "pass_02" / "manifest.json").read_text(encoding="utf-8"))
            pass_two_durations = [
                item["duration_seconds"]
                for item in pass_two["sequence"]
                if item["type"] == "interlude"
            ]
            self.assertTrue(all(duration >= 1.5 for duration in pass_two_durations))

    def test_dashboard_export_writes_standalone_html(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "inputs"
            output_dir = root / "outputs"
            dashboard_path = root / "dashboard.html"
            input_dir.mkdir()
            self._write_sine(input_dir / "01_a.wav", 196.0, 0.32)
            self._write_sine(input_dir / "02_b.wav", 293.66, 0.45)

            render_album(
                [input_dir],
                output_dir,
                RenderOptions(
                    preset="velvet-museum",
                    interlude_duration=1.0,
                    interlude_style="auto",
                    arc="cinematic",
                    album_wav=True,
                ),
            )
            summary = export_dashboard(output_dir / "manifest.json", dashboard_path)

            html = dashboard_path.read_text(encoding="utf-8")
            self.assertEqual(summary["dashboard"], str(dashboard_path))
            self.assertIn("Album Arc", html)
            self.assertIn("Velvet Museum", html)
            self.assertIn("<svg", html)

    def test_synthetic_eight_track_album_exercises_acoustic_heavy_return_workflow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "inputs"
            output_dir = root / "outputs"
            project_path = root / "album.ams.json"
            preview_path = root / "preview_03_to_04.wav"
            dashboard_path = root / "dashboard.html"
            input_dir.mkdir()

            self._write_acoustic(input_dir / "01_acoustic_opener.wav", 196.0, 0.30)
            self._write_transition_texture(input_dir / "02_threshold_transition.wav", 146.83, 0.24)
            self._write_acoustic(input_dir / "03_acoustic_threshold.wav", 220.0, 0.34)
            self._write_djent(input_dir / "04_djent_arrival.wav", 73.42, 0.58)
            self._write_djent(input_dir / "05_djent_pressure.wav", 82.41, 0.62)
            self._write_djent(input_dir / "06_heavy_center.wav", 92.50, 0.64)
            self._write_acoustic(input_dir / "07_return_acoustic.wav", 174.61, 0.28)
            self._write_acoustic(input_dir / "08_acoustic_afterglow.wav", 164.81, 0.24)

            project = create_project(
                [input_dir],
                project_path,
                RenderOptions(
                    preset="velvet-museum",
                    interlude_duration=0.5,
                    interlude_style="auto",
                    arc="cinematic",
                    album_wav=True,
                ),
                album_title="Synthetic Folk/Djent Return",
            )
            project["tracks"][1]["character"] = "transition"
            project["tracks"][6]["character"] = "return_acoustic"
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")

            manifest = render_project(project_path, output_dir)
            scorecard = score_render(output_dir / "manifest.json", scorer="local")
            preview = render_transition_preview(
                project_path,
                after_track=3,
                output_path=preview_path,
                tail_seconds=0.4,
                head_seconds=0.4,
            )
            dashboard = export_dashboard(output_dir / "manifest.json", dashboard_path)

            tracks = [item for item in manifest["sequence"] if item["type"] == "track"]
            interludes = [item for item in manifest["sequence"] if item["type"] == "interlude"]
            labels = [track["character"]["label"] for track in tracks]
            handoffs = [item["handoff"] for item in interludes]
            targets = [float(track["arc"]["target_lufs"]) for track in tracks]

            self.assertEqual(manifest["track_count"], 8)
            self.assertEqual(manifest["interlude_count"], 7)
            self.assertEqual(labels[0], "acoustic_folk")
            self.assertIn("transition", labels)
            self.assertIn("heavy_djent", labels)
            self.assertIn("return_acoustic", labels)
            self.assertIn("acoustic_to_heavy", handoffs)
            self.assertIn("heavy_to_acoustic", handoffs)
            self.assertGreater(max(targets) - min(targets), 2.0)
            self.assertTrue(all(len(track.get("rationale", "").split()) >= 10 for track in tracks))
            self.assertTrue(all(len(item.get("rationale", "").split()) >= 10 for item in interludes))
            self.assertTrue(all(item["tail_treatment"]["rationale"] for item in interludes))
            self.assertTrue(all(item["head_treatment"]["rationale"] for item in interludes))
            self.assertGreaterEqual(scorecard["dimensions"]["genre_shift_handling"]["score"], 0.86)
            self.assertGreaterEqual(scorecard["dimensions"]["decision_rationales"]["score"], 0.92)
            self.assertEqual(preview["between"], [3, 4])
            self.assertTrue(preview_path.exists())
            self.assertEqual(dashboard["dashboard"], str(dashboard_path))

            album = load_audio(output_dir / "album_sequence.wav", 48_000)
            self.assertGreater(float(np.sqrt(np.mean(np.square(album)))), 0.01)
            for item in interludes:
                rendered = load_audio(Path(item["output"]), 48_000)
                self.assertGreater(float(np.sqrt(np.mean(np.square(rendered)))), 0.001)

            html = dashboard_path.read_text(encoding="utf-8")
            self.assertIn("Synthetic Folk/Djent Return", html)
            self.assertIn("Decision Log", html)
            self.assertIn("acoustic to heavy", html)

    def _write_sine(self, path: Path, frequency: float, amplitude: float) -> None:
        sample_rate = 48_000
        seconds = 3.0
        stereo = self._sine_array(frequency, amplitude, seconds)
        wavfile.write(path, sample_rate, stereo)

    def _click_track(self, bpm: float, seconds: float) -> np.ndarray:
        sample_rate = 48_000
        frame_count = int(sample_rate * seconds)
        audio = np.zeros(frame_count, dtype=np.float32)
        interval = int(sample_rate * 60.0 / bpm)
        click_len = int(sample_rate * 0.020)
        envelope = np.exp(-np.linspace(0.0, 8.0, click_len, dtype=np.float32))
        for start in range(0, frame_count - click_len, interval):
            audio[start : start + click_len] += envelope * 0.45
        return np.column_stack([audio, audio]).astype(np.float32)

    def _sine_array(self, frequency: float, amplitude: float, seconds: float) -> np.ndarray:
        sample_rate = 48_000
        t = np.linspace(0.0, seconds, int(sample_rate * seconds), endpoint=False)
        tone = amplitude * np.sin(2.0 * np.pi * frequency * t)
        return np.column_stack([tone, tone * 0.92]).astype(np.float32)

    def _write_acoustic(self, path: Path, frequency: float, amplitude: float) -> None:
        sample_rate = 48_000
        seconds = 2.2
        t = np.linspace(0.0, seconds, int(sample_rate * seconds), endpoint=False)
        strum_phase = np.mod(t * 2.0, 1.0)
        strum = np.exp(-strum_phase * 5.5)
        body = (
            np.sin(2.0 * np.pi * frequency * t)
            + (0.45 * np.sin(2.0 * np.pi * frequency * 2.0 * t))
            + (0.20 * np.sin(2.0 * np.pi * frequency * 3.0 * t))
        )
        air = 0.020 * np.sin(2.0 * np.pi * 3600.0 * t)
        left = amplitude * ((body * (0.42 + strum)) + air)
        right = amplitude * ((body * 0.90 * (0.40 + np.roll(strum, 91))) - air)
        wavfile.write(path, sample_rate, np.column_stack([left, right]).astype(np.float32))

    def _write_djent(self, path: Path, frequency: float, amplitude: float) -> None:
        sample_rate = 48_000
        seconds = 2.2
        t = np.linspace(0.0, seconds, int(sample_rate * seconds), endpoint=False)
        gate = (0.30 + 0.70 * (np.sin(2.0 * np.pi * 8.0 * t) > 0.15).astype(np.float32))
        riff = (
            np.sin(2.0 * np.pi * frequency * t)
            + (0.75 * np.sin(2.0 * np.pi * frequency * 2.01 * t))
            + (0.55 * np.sin(2.0 * np.pi * frequency * 3.02 * t))
            + (0.22 * np.sin(2.0 * np.pi * 2600.0 * t))
        )
        distorted = np.tanh(riff * 3.0) * gate
        left = amplitude * distorted
        right = amplitude * np.tanh((riff * 2.7) + (0.10 * np.sin(2.0 * np.pi * 41.0 * t))) * np.roll(gate, 57)
        wavfile.write(path, sample_rate, np.column_stack([left, right]).astype(np.float32))

    def _write_transition_texture(self, path: Path, frequency: float, amplitude: float) -> None:
        sample_rate = 48_000
        seconds = 2.2
        t = np.linspace(0.0, seconds, int(sample_rate * seconds), endpoint=False)
        swell = np.sin(np.linspace(0.0, np.pi, t.size)) ** 1.4
        pad = np.sin(2.0 * np.pi * frequency * t) + (0.30 * np.sin(2.0 * np.pi * frequency * 1.5 * t))
        left = amplitude * pad * swell
        right = amplitude * (pad * 0.82 + 0.12 * np.sin(2.0 * np.pi * 900.0 * t)) * swell
        wavfile.write(path, sample_rate, np.column_stack([left, right]).astype(np.float32))


if __name__ == "__main__":
    unittest.main()
