# Project Memory

## Verified state (2026-10-27)

- Default rocket: Moon Cat Mk II (3 Kitten tanks + Tabby tank upper stage, 2× Maine Coon lower stage, Tiger cluster, vacuum Kitten, lander legs, Paw-Chute).
- Verified full mission: launch → 80 km orbit → Luna landing at ~1.5 m/s → lunar ascent → Earth return → parachute landing at ~9.3 m/s. MET ≈ 81.3 h; remaining fuel ≈ 846 kg.
- Commands: npm run dev | npm run build | npm run test:physics | npm run test:ui.
- Tests: tests/e2e.cjs uses Playwright; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH on hosts with a nonstandard browser cache. Physics verification is headless and CI-safe.
- Headless WebGL uses SwiftShader; RAF is only a few FPS, so screenshots/frames can appear frozen. Use window.__rs.simulate or tools/verify-mission.ts for physics checks.
- The initial sun phase (2.1 rad) keeps the launch site in daylight and makes the orbit view readable.

## Gotchas

- Custom ShaderMaterials need both logdepthbuf chunks (renderer has logarithmicDepthBuffer) and colorspace_fragment (outputColorSpace sRGB), otherwise depth/outline ordering and colours break.
- Landed ships must be pinned after incrementing simulation time, otherwise they lag the rotating planet by one frame.
- Parachute must not be cut at 15 m; cut only near touchdown.
- Autopilot circularization must stop at Pe > 80 km, not the old Ap>140/Pe>60 shortcut.
- Mochi is inclined 6.2°; the flight computer intentionally requires a manual plane change. Rusty/Verdant require manual interplanetary flight.
