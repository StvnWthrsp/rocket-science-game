# Physics

## Units and bodies

All simulation is in SI units, with double-precision JavaScript numbers. Rendering uses camera-relative positions to avoid float32 blow-up at planetary scales. Distant bodies beyond 52,000 km are visually scaled about their centre so angular size is preserved.

| Body | Radius (km) | μ (m³/s²) | SOI (km) | Atmosphere |
| --- | --- | --- | --- | --- |
| Sol | 261,600 | 1.172×10¹⁸ | — | none |
| Terra | 600 | 3.5316×10¹² | 84,160 | 70 km, ρ₀ = 1.225 kg/m³, H = 5.6 km |
| Luna | 200 | 6.5138×10¹⁰ | 2,429 | none |
| Mochi | 60 | 1.7658×10⁹ | 2,247 | none, 6.2° inclination |
| Rusty | 320 | 3.013×10¹¹ | 47,900 | 50 km, thin |
| Verdant | 1,200 | 2.8×10¹² | 100,000 | 220 km, gas giant |

Terra's day is 21,549 s. Planets orbit Sol and moons orbit Terra on Keplerian rails. The launch site is at 0° latitude, 0° longitude; the initial orbital velocity from rotation is about 175 m/s eastward.

## Rocket equation

For each stage:

    Δv = Isp × g0 × ln(m0 / mf)

Thrust and Isp interpolate between sea-level and vacuum values with ambient pressure:

    T = Tvac + (Tsl - Tvac) p
    Isp = Isp,vac + (Isp,sl - Isp,vac) p

Mass flow is mdot = T / (Isp × g0). Tanks drain proportionally inside the active stage so the centre of mass stays stable. Decouplers split the stack into stages; the bottom stage is jettisoned first.

## Attitude dynamics

The ship is a rigid body with scalar inertia approximated from the stack:

    Ixx = Izz ≈ Σ( m(3r² + h²)/12 + m dy² )
    Iyy ≈ Σ m r² / 2

SAS is a PD controller on quaternion error and body angular rate, with authority from reaction wheels, RCS and engine gimbal. Manual input adds local torques. Rates are damped and clamped.

## Aerodynamics and landing

Drag uses F = 0.5 ρ v² Cd A against the co-rotating atmosphere. Chutes add 650 m² (Paw-Chute) or 1450 m² (Big Paw-Chute) with a deployment ramp. Touchdown success requires vertical speed below 13 m/s with legs, low lateral speed and less than 30° tilt; parachutes bring the capsule down around 9 m/s. Landed vessels are stored in body-fixed latitude/longitude and re-derived from the rotating planet each frame.

## Orbital mechanics

The ship stores global inertial position and velocity. Gravity is the dominant body's two-body field. Sphere-of-influence membership is resolved recursively from Sol → planet → moon. Rails warp uses conic propagation (eccentric anomaly for ellipses, universal variables for hyperbolae) with a 200 s sampling guard around SOI crossings. Trajectory prediction and the map use osculating elements and sampled conics.

The autopilot uses a Hohmann phase-angle window, burns until the target apoapsis is reached, then captures and follows a constant-deceleration powered-descent profile:

    v_descent = min(160, 0.55 × sqrt(2 g (h - h_ground)))

with a lower profile near the surface. The return sets an Earth periapsis below the atmosphere and holds retrograde through re-entry.

## Known simplifications

- Single dominant-body gravity; no N-body perturbations.
- No heat damage, structural failure or ullage.
- No persistent debris collision; jettisoned stages are visual and fade.
- The default flight computer handles Luna. Mochi requires a manual plane change; Rusty and Verdant require manual interplanetary flight.
