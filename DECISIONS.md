# Project Decisions

## 2026-10-27 — Vite + TypeScript + Three.js, static build

Chosen for a zero-backend, GitHub Pages-friendly build, fast iteration, and full control over custom shaders. All art is procedural so no third-party asset licensing or binary models are shipped.

## 2026-10-27 — Patched-conic physics with a single dominant body

Two-body fields with recursive SOI membership reproduce the KSP feel and remain stable at 10,000× rails warp. N-body perturbations, heat and structural failure were deliberately left out to keep the mission loop playable and the frame cheap.

## 2026-10-27 — Landing state is body-fixed

Landed vessels store a body-fixed unit direction and are re-derived from the rotating planet each frame. This avoids sliding/drifting on the pad and correctly supports Earth's rotating launch site.

## 2026-10-27 — Autopilot scope

The flight computer automates the full Terra → Luna → Terra mission. Mochi is a manual plane-change target; the planets are manual interplanetary targets. This keeps the autopilot robust while the physics supports all destinations.

## 2026-10-27 — GitHub Pages deployment

The GitHub Actions workflow builds, typechecks, runs the headless mission test, and deploys the static dist folder to Pages.
