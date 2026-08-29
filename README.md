# Ragazzo Editor · Efeitos

*[Leia em português](README.md)*

A CEP (Common Extensibility Platform) panel for Adobe Premiere Pro with one-click shortcuts for repetitive editing effects and adjustments — zoom, alignment, cropping, split screens, clip animations, and a motion-easing curve editor, applied directly to the selected clip on the timeline.

<p align="center">
  <img src="https://img.shields.io/badge/Premiere%20Pro-15.0+-9999FF?logo=adobepremierepro&logoColor=white" alt="Premiere Pro 15.0+">
  <img src="https://img.shields.io/badge/CEP-10.0-333333" alt="CEP 10.0">
  <img src="https://img.shields.io/badge/build-none%20(vanilla%20JS)-lightgrey" alt="No build step">
</p>

## Features

- **Zoom** — animates the clip's Scale from start to end (in/out), with an adjustable easing curve and savable presets.
- **Alignment** — a 3×3 anchor grid to snap the clip's edge to a corner/side/center of the frame; copy/paste/reset Position, Scale, Rotation, and Opacity between clips.
- **Crop** — zoom + anchor offset to simulate a crop-to-fill, without leaving Premiere.
- **Split screen** — 2 side-by-side, 2 stacked, or a 2×2 grid, from the clips selected across different tracks.
- **Distribute / Cascade** — distributes N clips into equal parts of the frame, or stacks them in layers (picture-in-picture style) starting from the first selected clip's position.
- **Silence cut** — detects pauses in speech (not generic silence — the analysis focuses on the human voice frequency range) and automatically generates a cut version of the clip, already inserted into the timeline in place of the original.
- **Animate clip/object** — entrance/exit presets (slide, fade, pop, rotate) with configurable duration and easing curve.
- **Smooth motion** — a multi-anchor bezier curve editor (drag handles, add/remove points, switch between Value and Speed views) to redraw the curve between two existing keyframes; or one-click automatic smoothing (moving average) of all existing keyframes at once.

Every effect is applied directly to Premiere's own native components/effects (Motion, Opacity, Lumetri, Volume) — nothing is "baked" or rendered separately, except Silence cut, which generates a new media file (via ffmpeg) and inserts it into the timeline.

## Themes

Two themes available from the switcher in the panel header — **Dark** (default) and **Paper** (light) — with the preference saved locally and applied before first paint (no flash of the wrong theme).

## Requirements

- Adobe Premiere Pro 15.0 or later.
- [ffmpeg and ffprobe](https://ffmpeg.org/download.html) available on the system `PATH` — used only by Silence cut, to detect pauses and render the cut version.

## Installation

This is an **unsigned** CEP extension, so Premiere needs to be configured to load extensions in debug mode before installing it:

1. Enable CEP debug mode (one-time setup): in `regedit`, create/edit the key `HKEY_CURRENT_USER\Software\Adobe\CSXS.10` and add a string value `PlayerDebugMode` = `1`.
2. Copy this entire folder into the CEP extensions folder:
   ```
   %APPDATA%\Adobe\CEP\extensions\com.RagazzoEditor.efeitos
   ```
3. Open (or restart) Premiere Pro and go to **Window → Extensions → Ragazzo Editor - Efeitos**.

After any change to the extension's files, just reload the panel (close and reopen it from the same menu) — a full Premiere restart is only needed when `CSXS/manifest.xml` changes.

## Project structure

```
com.RagazzoEditor.efeitos/
├── CSXS/manifest.xml   # CEP manifest: host, version, entry points
├── index.html          # panel UI
├── style.css           # styles + themes (Dark/Paper)
├── jsx/hostscript.jsx  # ExtendScript that runs inside Premiere
└── js/
    ├── cep-bridge.js     # bridge to the CEP host (evalScript)
    ├── main.js           # UI event wiring
    ├── ui.js             # card expand/collapse, generic sliders
    ├── theme.js           # theme switching
    ├── curves.js         # bezier curve math (EFCurves)
    ├── graph.js           # canvas curve editor
    ├── curve-presets.js  # locally saved curve presets
    └── silence-cut.js     # pause detection/cutting via ffmpeg
```

No build step, bundler, or third-party dependencies — plain HTML/CSS/JS loaded directly by Premiere.

## License

Personal/private project — no public-use license defined.
