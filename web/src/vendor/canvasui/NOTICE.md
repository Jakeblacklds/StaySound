# Canvas UI vendored components

The files in this directory are copied from:

- Project: Canvas UI
- Repository: https://github.com/DavidHDev/canvas-ui
- Commit: `b01d1e87e3909d233996592a2b9e50906dcf4f69`
- Copyright: Copyright (c) 2026 David Haz
- License: MIT + Commons Clause License Condition v1.0

StaySound uses these components as part of the application and does not sell,
sublicense, or redistribute Canvas UI as a standalone component library.

The complete upstream license is preserved in `LICENSE.md`.

StaySound currently vendors the vanilla engines used by its karaoke and
Live Artwork stages: Asciify, Bend, Blaze, Bubble, Cloth, Clouds, Droplets,
Glass, Glitch, Grid, HexFloat, Laser, Liquid, Magnify, ParticleReveal,
RetroDither, Ripple, Shatter, and VHS.

Local integration change: the internal device-pixel-ratio ceiling is reduced
from 2 to 1.35 for fullscreen playback performance. Shader behavior and public
component options are otherwise preserved.
