from __future__ import annotations

import html
import json
from pathlib import Path


def export_dashboard(manifest_path: Path, output_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    scorecard_path = manifest_path.parent / "scorecard.json"
    scorecard = json.loads(scorecard_path.read_text(encoding="utf-8")) if scorecard_path.exists() else None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(_html(manifest, scorecard), encoding="utf-8")
    return {
        "dashboard": str(output_path),
        "manifest": str(manifest_path),
        "has_scorecard": scorecard is not None,
    }


def _html(manifest: dict, scorecard: dict | None) -> str:
    settings = manifest.get("settings", {})
    tracks = [item for item in manifest.get("sequence", []) if item.get("type") == "track"]
    interludes = [item for item in manifest.get("sequence", []) if item.get("type") == "interlude"]
    preset = tracks[0].get("preset", {}) if tracks else {}
    score = scorecard.get("overall") if scorecard else None
    story = manifest.get("album_story") or manifest.get("arc", {}).get("description", "")
    warnings = manifest.get("warnings", [])

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_e(_title(manifest, settings, preset))} Report</title>
  <style>
    :root {{
      color-scheme: light;
      --paper: oklch(95% 0.014 235);
      --ink: oklch(18% 0.038 257);
      --muted: oklch(43% 0.036 246);
      --line: oklch(78% 0.028 238);
      --oxide: oklch(46% 0.135 33);
      --green: oklch(50% 0.105 154);
      --blue: oklch(43% 0.115 247);
      --violet: oklch(43% 0.115 309);
      --panel: oklch(91% 0.018 228);
      --cream: oklch(93% 0.032 92);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background:
        linear-gradient(90deg, color-mix(in oklch, var(--line), transparent 74%) 1px, transparent 1px),
        linear-gradient(0deg, color-mix(in oklch, var(--line), transparent 78%) 1px, transparent 1px),
        var(--paper);
      background-size: 38px 38px;
      color: var(--ink);
      font-family: ui-serif, Georgia, "Times New Roman", serif;
      letter-spacing: 0;
    }}
    main {{
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: clamp(28px, 5vw, 72px) 0;
    }}
    .mast {{
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr);
      gap: clamp(24px, 5vw, 72px);
      align-items: end;
      border-bottom: 2px solid var(--ink);
      padding-bottom: 28px;
    }}
    h1 {{
      margin: 0;
      font-size: clamp(42px, 8vw, 112px);
      line-height: 0.9;
      max-width: 820px;
      letter-spacing: 0;
    }}
    .subtitle {{
      margin: 18px 0 0;
      max-width: 720px;
      color: var(--muted);
      font: 18px/1.5 ui-sans-serif, system-ui, sans-serif;
    }}
    .story {{
      margin-top: 22px;
      max-width: 820px;
      font: 700 clamp(20px, 3vw, 34px)/1.12 ui-sans-serif, system-ui, sans-serif;
      color: var(--oxide);
    }}
    .plate {{
      border: 2px solid var(--ink);
      background: color-mix(in oklch, var(--panel), white 18%);
      padding: 18px;
      box-shadow: 8px 8px 0 var(--ink);
    }}
    .metric {{
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
      font: 14px/1.2 ui-sans-serif, system-ui, sans-serif;
    }}
    .metric strong {{ font-size: 18px; }}
    section {{ margin-top: clamp(34px, 6vw, 70px); }}
    h2 {{
      margin: 0 0 18px;
      font-size: clamp(28px, 4vw, 52px);
      line-height: 1;
    }}
    .arc {{
      border: 2px solid var(--ink);
      background: color-mix(in oklch, var(--paper), white 14%);
      padding: clamp(18px, 4vw, 32px);
    }}
    svg {{ width: 100%; height: auto; display: block; }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 18px;
    }}
    .track {{
      min-height: 230px;
      border: 2px solid var(--ink);
      background: var(--panel);
      padding: 18px;
      display: grid;
      align-content: space-between;
      gap: 16px;
    }}
    .track:nth-child(3n + 1) {{ background: var(--cream); }}
    .track:nth-child(3n + 2) {{ background: oklch(91% 0.033 151); }}
    .track:nth-child(3n + 3) {{ background: oklch(90% 0.033 232); }}
    .track h3 {{
      margin: 0;
      font-size: 28px;
      line-height: 1;
    }}
    .role {{
      color: var(--oxide);
      font: 700 13px/1.2 ui-sans-serif, system-ui, sans-serif;
      text-transform: uppercase;
    }}
    .character {{
      display: inline-block;
      margin-top: 10px;
      border: 1px solid currentColor;
      padding: 4px 7px;
      color: var(--blue);
      font: 800 12px/1 ui-sans-serif, system-ui, sans-serif;
      text-transform: uppercase;
    }}
    .rationale {{
      margin: 0;
      color: var(--muted);
      font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
    }}
    .data {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 18px;
      font: 13px/1.25 ui-sans-serif, system-ui, sans-serif;
    }}
    .data span {{
      border-top: 1px solid color-mix(in oklch, var(--ink), transparent 72%);
      padding-top: 8px;
    }}
    .interludes {{
      display: grid;
      gap: 10px;
      font: 15px/1.35 ui-sans-serif, system-ui, sans-serif;
    }}
    .bridge {{
      display: grid;
      grid-template-columns: 120px 1fr auto;
      align-items: center;
      gap: 14px;
      border-bottom: 1px solid var(--line);
      padding: 12px 0;
    }}
    .badge {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      border: 2px solid var(--ink);
      background: var(--oxide);
      color: var(--paper);
      font-weight: 800;
    }}
    .score {{
      font-size: clamp(40px, 8vw, 96px);
      line-height: 0.9;
      color: var(--oxide);
    }}
    .log {{
      display: grid;
      gap: 10px;
      font: 14px/1.45 ui-sans-serif, system-ui, sans-serif;
    }}
    .log p {{
      margin: 0;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--line);
    }}
    .paths {{
      display: grid;
      gap: 8px;
      font: 13px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
      overflow-wrap: anywhere;
    }}
    .warning {{
      margin: 0;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
      color: var(--oxide);
      font: 700 14px/1.35 ui-sans-serif, system-ui, sans-serif;
    }}
    .ok {{
      color: var(--green);
      font: 800 15px/1.35 ui-sans-serif, system-ui, sans-serif;
    }}
    @media (max-width: 760px) {{
      .mast {{ grid-template-columns: 1fr; }}
      .bridge {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <main>
    <header class="mast">
      <div>
        <h1>{_e(_title(manifest, settings, preset))}</h1>
        <p class="subtitle">{_e(_subtitle(settings, preset))}</p>
        <div class="story">{_e(story)}</div>
      </div>
      <aside class="plate">
        {_metric("Preset", preset.get("display_name", settings.get("preset", "unknown")))}
        {_metric("Arc", manifest.get("arc", {}).get("display_name", settings.get("arc", "unknown")))}
        {_metric("Tracks", str(manifest.get("track_count", 0)))}
        {_metric("Interludes", str(manifest.get("interlude_count", 0)))}
        {_metric("Score", f"{score:.2f}" if isinstance(score, (int, float)) else "not scored")}
      </aside>
    </header>

    <section>
      <h2>Album Arc</h2>
      <div class="arc">{_arc_svg(tracks)}</div>
    </section>

    <section>
      <h2>Tracks</h2>
      <div class="grid">{''.join(_track_card(track) for track in tracks)}</div>
    </section>

    <section>
      <h2>Transitions</h2>
      <div class="interludes">{''.join(_interlude_row(item) for item in interludes)}</div>
    </section>

    <section>
      <h2>Warnings</h2>
      <div class="plate">{_warnings(warnings)}</div>
    </section>

    <section>
      <h2>Outputs</h2>
      <div class="plate paths">{_outputs(manifest, tracks, interludes)}</div>
    </section>

    <section>
      <h2>Scorecard</h2>
      <div class="plate">{_scorecard(scorecard)}</div>
    </section>

    <section>
      <h2>Decision Log</h2>
      <div class="log">{_decision_log(manifest)}</div>
    </section>
  </main>
</body>
</html>
"""


def _title(manifest: dict, settings: dict, preset: dict) -> str:
    if manifest.get("album_title"):
        return str(manifest["album_title"])
    display_name = preset.get("display_name")
    if display_name:
        return f"{display_name} Master"
    preset_name = str(settings.get("preset", "album")).replace("-", " ")
    return f"{preset_name.title()} Master"


def _subtitle(settings: dict, preset: dict) -> str:
    return str(preset.get("description") or f"{settings.get('arc', 'album')} arc with generated interludes and album-level mastering.")


def _metric(label: str, value: object) -> str:
    return f'<div class="metric"><span>{_e(label)}</span><strong>{_e(value)}</strong></div>'


def _arc_svg(tracks: list[dict]) -> str:
    if not tracks:
        return "<svg viewBox='0 0 100 24' role='img' aria-label='No track arc'></svg>"

    values = [float(track.get("arc", {}).get("target_lufs", track.get("after", {}).get("integrated_lufs", -14.0))) for track in tracks]
    low = min(values) - 0.5
    high = max(values) + 0.5
    span = max(high - low, 0.1)
    points = []
    circles = []
    labels = []
    for index, value in enumerate(values):
        x = 8 + (index * (84 / max(len(values) - 1, 1)))
        y = 76 - (((value - low) / span) * 54)
        points.append(f"{x:.2f},{y:.2f}")
        circles.append(f"<circle cx='{x:.2f}' cy='{y:.2f}' r='2.7' />")
        labels.append(f"<text x='{x:.2f}' y='91' text-anchor='middle'>{index + 1}</text>")
    return (
        "<svg viewBox='0 0 100 100' role='img' aria-label='Album loudness arc'>"
        "<rect x='0' y='0' width='100' height='100' fill='none' />"
        "<path d='M8 76 H92 M8 22 H92' stroke='currentColor' opacity='.18' stroke-width='.6' />"
        f"<polyline points='{' '.join(points)}' fill='none' stroke='var(--oxide)' stroke-width='2.5' stroke-linejoin='round' />"
        f"<g fill='var(--green)' stroke='var(--ink)' stroke-width='.7'>{''.join(circles)}</g>"
        f"<g font-size='5' font-family='ui-sans-serif, system-ui, sans-serif'>{''.join(labels)}</g>"
        "</svg>"
    )


def _track_card(track: dict) -> str:
    after = track.get("after", {})
    arc = track.get("arc", {})
    character = track.get("character", {})
    title = track.get("title") or Path(str(track.get("source", "track"))).stem
    warnings = track.get("warnings", [])
    return f"""
      <article class="track">
        <div>
          <div class="role">{_e(arc.get("role", "track"))}</div>
          <h3>{_e(track.get("index", ""))}. {_e(title)}</h3>
          <span class="character">{_e(character.get("display_name", "Unclassified"))}</span>
        </div>
        <p class="rationale">{_e(track.get("rationale", ""))}</p>
        {f"<p class='warning'>{_e('; '.join(warnings))}</p>" if warnings else ""}
        <div class="data">
          <span>LUFS<br><strong>{_num(after.get("integrated_lufs"))}</strong></span>
          <span>Target<br><strong>{_num(arc.get("target_lufs"))}</strong></span>
          <span>True peak<br><strong>{_num(after.get("true_peak_dbfs"))}</strong></span>
          <span>Energy<br><strong>{_num(after.get("energy_density"))}</strong></span>
        </div>
      </article>
    """


def _interlude_row(item: dict) -> str:
    between = item.get("between", ["?", "?"])
    analysis = item.get("analysis", {})
    return f"""
      <div class="bridge">
        <span class="badge">{_e(item.get("style", "interlude"))}</span>
        <span><strong>{_e(item.get("handoff", "handoff")).replace("_", " ")}</strong><br>{_e(item.get("rationale", f"Track {between[0]} into track {between[1]}"))}<br><small>LUFS {_num(analysis.get("integrated_lufs"))} | peak {_num(analysis.get("true_peak_dbfs"))}</small></span>
        <strong>{_num(item.get("duration_seconds"))}s</strong>
      </div>
    """


def _scorecard(scorecard: dict | None) -> str:
    if not scorecard:
        return "<p>Run <code>album-master score-render</code> to attach a scorecard.</p>"
    dimensions = scorecard.get("dimensions", {})
    rows = "".join(_metric(name.replace("_", " ").title(), f"{data.get('score', 0):.2f}") for name, data in dimensions.items())
    notes = scorecard.get("llm_notes") or "Local scorer only. Set OPENAI_API_KEY and ALBUM_MASTER_LLM_MODEL for LLM critique."
    suggestions = "".join(f"<p>{_e(item)}</p>" for item in scorecard.get("suggestions", []))
    return f"<div class='score'>{scorecard.get('overall', 0):.2f}</div>{rows}<p>{_e(notes)}</p>{suggestions}"


def _decision_log(manifest: dict) -> str:
    log = manifest.get("decision_log", {})
    rows = []
    for group in ("album", "tracks", "transitions", "edge_mastering"):
        for item in log.get(group, []):
            rows.append(f"<p>{_e(item)}</p>")
    return "".join(rows) or "<p>No decision log was written.</p>"


def _warnings(warnings: list) -> str:
    if not warnings:
        return "<p class='ok'>No render warnings were emitted by the local checks.</p>"
    return "".join(f"<p class='warning'>{_e(item)}</p>" for item in warnings)


def _outputs(manifest: dict, tracks: list[dict], interludes: list[dict]) -> str:
    outputs = manifest.get("outputs", {})
    rows = []
    for label in ("manifest", "album_sequence", "masters_dir", "interludes_dir"):
        value = outputs.get(label)
        if value:
            rows.append(f"<div><strong>{_e(label.replace('_', ' ').title())}</strong><br>{_e(value)}</div>")
    for track in tracks:
        rows.append(f"<div><strong>Track {track.get('index', '?')}</strong><br>{_e(track.get('output', 'n/a'))}</div>")
    for item in interludes:
        between = item.get("between", ["?", "?"])
        rows.append(f"<div><strong>Transition {between[0]} to {between[1]}</strong><br>{_e(item.get('output', 'n/a'))}</div>")
    return "".join(rows) or "<div>No output paths recorded.</div>"


def _num(value: object) -> str:
    if isinstance(value, (int, float)):
        return f"{value:.2f}"
    return "n/a"


def _e(value: object) -> str:
    return html.escape(str(value), quote=True)
