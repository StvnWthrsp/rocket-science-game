# Art direction and model iterations

## Visual language

The target is a soft, bright, toy-like cel-shaded look: think Animal Crossing's pastel world and rounded silhouettes, filtered through a space-program diorama. The renderer uses:

- a custom 3-band toon fragment shader with a warm camera-facing fill and rim light;
- inverted-hull outlines on rocket parts, cat and props;
- a procedural sky dome with gradient horizon, stars, sun disk/glow and cloud noise;
- procedural planet shaders with quantized lighting, continents, atmosphere rim, clouds, rings and gas bands;
- a procedural local terrain patch with vertex colours, curvature, craters, trees, rocks, flowers and a launch complex;
- a chibi cat astronaut constructed from primitives (big head, triangular ears, muzzle, whiskers, striped tail, bubble helmet, backpack and suit).

The palette is built around cream, coral, mint, teal, sky, lavender and warm yellow.

## Reference work

At least five references were gathered for each major subject before modelling, and a second visual pass was performed after screenshotting the rendered result. The categories and sources are listed in [REFERENCES.md](REFERENCES.md). Highlights:

- Saturn V launch photography for stack proportions, roll pattern and engine bells;
- Apollo Lunar Module and Apollo 17 surface photography for landing legs, descent stage and lunar regolith;
- domestic cat portrait photography for head geometry, ear placement, muzzle, whiskers and eyes;
- Momo / cartoon cat references for chibi proportions and big-eye expression;
- KSP navball, rocket and VAB imagery for the functional layout of the UI;
- Animal Crossing: New Horizons official screenshots for soft lighting, pastel palette, rounded props and the friendly HUD style;
- cel-shaded game-art references for banding and contour treatment.

## Iterations

1. **Lighting and depth.** The first build rendered rocket bodies almost black. Two causes were found: custom shaders lacked logarithmic-depth chunks while MeshBasicMaterial outlines had them, and custom shaders did not include the colour-space conversion chunk. Adding logdepthbuf and colorspace chunks gave correct bright cream/coral parts and stopped outlines covering the hull.
2. **Sky and atmosphere.** The horizon was tied to world Y rather than the local radial up; adding a camera-up uniform and increasing the horizon falloff exponent produced blue daytime flight skies and a readable sunset menu.
3. **Rocket silhouette.** The stack was too plain. A Saturn-V-inspired black/cream checker band, gold lower band, three-bell heavy engine cluster, rounded tank shoulders, cat-ear capsule, window cat and MEOW decals were added. The VAB pod close-up is a direct comparison shot against the Saturn V/LEM references.
4. **World set dressing.** The launch pad was a bare disc. A sandy ring, red/white gantry, fuel tanks, control hut, ring of low-poly trees, flowers and a waving cat engineer were added; the menu cat was enlarged and placed near the camera.
5. **Flag and Luna.** The first flag read as a black rectangle because the decal texture had a transparent background. It now has a dedicated cream/coral flag texture. Lunar terrain amplitude and crater count were increased, rocks made larger, and a helmeted cat astronaut now stands beside the flag.

## Screenshots

- docs/screenshots/menu.png — menu diorama with launch complex, trees and cat.
- docs/screenshots/vab.png — Rocket Lab with checker-banded Moon Cat.
- docs/screenshots/flight.png — launch HUD, navball, throttle and flight computer.
- docs/screenshots/map.png — orbital map with Terra, Luna and Mochi.
