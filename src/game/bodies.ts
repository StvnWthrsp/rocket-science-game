import { Vector3 } from 'three';
import { DEG, TWO_PI, mod } from './math';

export interface Atmosphere {
  height: number;
  rho0: number;
  scaleHeight: number;
  color: number;
}

export interface BodyAppearance {
  primary: number;
  secondary: number;
  accent: number;
  ocean: number;
  ice: number;
  atmosphere: number;
  cloud: number;
  roughness: number;
}

export interface OrbitConfig {
  a: number;
  e: number;
  inclination: number;
  phase: number;
  period: number;
}

export interface Crater {
  center: Vector3;
  radius: number;
  depth: number;
  rim: number;
}

export type BodyId = 'sol' | 'terra' | 'luna' | 'mochi' | 'rusty' | 'verdant';

export interface BodyConfig {
  id: BodyId;
  name: string;
  shortName: string;
  description: string;
  radius: number;
  mu: number;
  soiRadius: number;
  parent: Body | null;
  orbit: OrbitConfig | null;
  atmosphere: Atmosphere | null;
  appearance: BodyAppearance;
  rotationPeriod: number;
  hasSurface: boolean;
  terrainSeed: number;
  terrainAmplitude: number;
  terrainRoughness: number;
  craters: Crater[];
  landingZones: { lat: number; lon: number; radius: number; name: string }[];
}

export class Body {
  id!: BodyId;
  name!: string;
  shortName!: string;
  description!: string;
  radius!: number;
  mu!: number;
  soiRadius!: number;
  parent!: Body | null;
  orbit!: OrbitConfig | null;
  atmosphere!: Atmosphere | null;
  appearance!: BodyAppearance;
  rotationPeriod!: number;
  hasSurface!: boolean;
  terrainSeed!: number;
  terrainAmplitude!: number;
  terrainRoughness!: number;
  craters!: Crater[];
  landingZones!: { lat: number; lon: number; radius: number; name: string }[];
  children: Body[] = [];
  private cachedT = Number.NaN;
  private cachedPos = new Vector3();
  private cachedVel = new Vector3();

  constructor(cfg: BodyConfig) {
    Object.assign(this, cfg);
    if (cfg.parent) cfg.parent.children.push(this);
  }

  get surfaceGravity(): number {
    return this.mu / (this.radius * this.radius);
  }

  get circumference(): number {
    return TWO_PI * this.radius;
  }

  rotationAngle(t: number): number {
    return (TWO_PI * t) / this.rotationPeriod;
  }

  /** Position and velocity in the global (heliocentric inertial) frame, meters and m/s. */
  globalState(t: number): { pos: Vector3; vel: Vector3 } {
    if (t === this.cachedT) return { pos: this.cachedPos.clone(), vel: this.cachedVel.clone() };
    let pos = new Vector3();
    let vel = new Vector3();
    if (this.parent && this.orbit) {
      const p = this.parent.globalState(t);
      const o = this.orbit;
      const n = (TWO_PI * Math.sign(o.a)) / Math.abs(o.period);
      const theta = o.phase + n * t;
      const ca = Math.cos(o.inclination);
      const sa = Math.sin(o.inclination);
      const x = o.a * (Math.cos(theta) - o.e);
      const z = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(theta);
      // Orbit lies in XZ, inclined around X, with the parent at the focus.
      const yRot = 0;
      const px = x * Math.cos(yRot) + z * Math.sin(yRot);
      const pz = -x * Math.sin(yRot) + z * Math.cos(yRot);
      const py = z * sa;
      const pz2 = pz * ca;
      const vx = -o.a * n * Math.sin(theta);
      const vz = o.a * n * Math.sqrt(1 - o.e * o.e) * Math.cos(theta);
      const vpx = vx * Math.cos(yRot) + vz * Math.sin(yRot);
      const vpz = -vx * Math.sin(yRot) + vz * Math.cos(yRot);
      const vpy = vz * sa;
      const vpz2 = vpz * ca;
      pos = p.pos.clone().add(new Vector3(px, py, pz2));
      vel = p.vel.clone().add(new Vector3(vpx, vpy, vpz2));
    }
    this.cachedT = t;
    this.cachedPos.copy(pos);
    this.cachedVel.copy(vel);
    return { pos: pos.clone(), vel: vel.clone() };
  }

  /** Unit vector from body centre toward a body-fixed latitude/longitude. */
  surfaceDirection(latDeg: number, lonDeg: number, t = 0): Vector3 {
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG + this.rotationAngle(t);
    return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
  }

  /** Approximate local north/east/up on a rotating body. */
  localFrameAt(pos: Vector3): { up: Vector3; north: Vector3; east: Vector3 } {
    const up = pos.clone().normalize();
    const axis = new Vector3(0, 1, 0);
    let east = new Vector3().crossVectors(axis, up);
    if (east.lengthSq() < 1e-10) east = new Vector3(0, 0, 1);
    east.normalize();
    const north = new Vector3().crossVectors(up, east).normalize();
    return { up, north, east };
  }

  /** Terrain elevation in meters relative to the reference sphere. \`unit\` is body-fixed. */
  terrainHeight(unit: Vector3): number {
    if (!this.hasSurface) return 0;
    const s = this.terrainSeed;
    let h = 0;
    const sample = (freq: number) => fbm(unit.x * freq + s, unit.y * freq - s * 1.7, unit.z * freq + s * 0.3, 5);
    if (this.id === 'terra') {
      h = (sample(2.8) - 0.5) * this.terrainAmplitude;
      h += (ridge(unit.x * 6.1 + s, unit.y * 6.1, unit.z * 6.1) - 0.42) * this.terrainAmplitude * 0.55;
      // Flatten the launch complex.
      const site = this.surfaceDirection(0, 0, 0);
      const d = Math.acos(Math.max(-1, Math.min(1, unit.dot(site)))) * this.radius;
      const flat = 1 - smooth01(80, 1600, d);
      h *= 1 - flat;
    } else if (this.id === 'luna' || this.id === 'mochi' || this.id === 'rusty') {
      h = (sample(3.6) - 0.5) * this.terrainAmplitude;
      h += (ridge(unit.x * 8.7, unit.y * 8.7, unit.z * 8.7) - 0.45) * this.terrainAmplitude * 0.35;
      for (const c of this.craters) {
        const ang = Math.acos(Math.max(-1, Math.min(1, unit.dot(c.center)))) * this.radius;
        if (ang > c.radius * 2.2) continue;
        const x = ang / c.radius;
        if (x < 1) {
          h += -c.depth * (1 - x * x) * (1 - x * x);
        }
        h += c.rim * Math.exp(-Math.pow((x - 1.02) / 0.24, 2));
      }
      if (this.id === 'rusty') {
        h += (fbm(unit.x * 18 + 31, unit.y * 6, unit.z * 18, 3) - 0.5) * 40;
      }
    }
    return h;
  }

  /** Surface radius for a body-fixed unit direction. */
  surfaceRadiusAt(unit: Vector3): number {
    return this.radius + this.terrainHeight(unit);
  }

  /** Sea-level atmospheric density, kg/m^3. */
  densityAt(altitude: number): number {
    if (!this.atmosphere) return 0;
    if (altitude > this.atmosphere.height) return 0;
    if (altitude < 0) altitude = 0;
    return this.atmosphere.rho0 * Math.exp(-altitude / this.atmosphere.scaleHeight);
  }

  pressureAt(altitude: number): number {
    if (!this.atmosphere) return 0;
    if (altitude > this.atmosphere.height) return 0;
    return Math.exp(-Math.max(0, altitude) / this.atmosphere.scaleHeight);
  }

  nearestLandingZone(unitFixed: Vector3): { lat: number; lon: number; radius: number; name: string } | null {
    let best: { lat: number; lon: number; radius: number; name: string } | null = null;
    let bestD = Infinity;
    for (const z of this.landingZones) {
      const dir = this.surfaceDirection(z.lat, z.lon, 0);
      const d = Math.acos(Math.max(-1, Math.min(1, unitFixed.dot(dir)))) * this.radius;
      if (d < bestD) { bestD = d; best = z; }
    }
    return best && bestD <= best.radius ? best : null;
  }
}

function smooth01(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- procedural noise

function hash3(x: number, y: number, z: number): number {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const n000 = hash3(xi, yi, zi), n100 = hash3(xi + 1, yi, zi);
  const n010 = hash3(xi, yi + 1, zi), n110 = hash3(xi + 1, yi + 1, zi);
  const n001 = hash3(xi, yi, zi + 1), n101 = hash3(xi + 1, yi, zi + 1);
  const n011 = hash3(xi, yi + 1, zi + 1), n111 = hash3(xi + 1, yi + 1, zi + 1);
  const nx00 = n000 + (n100 - n000) * u;
  const nx10 = n010 + (n110 - n010) * u;
  const nx01 = n001 + (n101 - n001) * u;
  const nx11 = n011 + (n111 - n011) * u;
  const nxy0 = nx00 + (nx10 - nx00) * v;
  const nxy1 = nx01 + (nx11 - nx01) * v;
  return nxy0 + (nxy1 - nxy0) * w;
}

export function fbm(x: number, y: number, z: number, octaves = 4): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function ridge(x: number, y: number, z: number): number {
  const n = fbm(x, y, z, 3);
  return 1 - Math.abs(n * 2 - 1);
}

// ---------------------------------------------------------------- body catalogue

const earthColors = { primary: 0x7ecb8f, secondary: 0x4eae83, accent: 0xf7e2a3, ocean: 0x58b7d6, ice: 0xf5fbff, atmosphere: 0x9bdcff, cloud: 0xffffff, roughness: 0.7 };
const lunaColors = { primary: 0xc9c4d8, secondary: 0x9b93b8, accent: 0xe9e3f4, ocean: 0x77708e, ice: 0xf2effa, atmosphere: 0x9b93b8, cloud: 0xd9d3ea, roughness: 0.95 };
const mochiColors = { primary: 0xb7e6d6, secondary: 0x7fcbb9, accent: 0xf9f2d0, ocean: 0x6bb8ad, ice: 0xffffff, atmosphere: 0x9ee7d4, cloud: 0xf6fffc, roughness: 0.85 };
const rustyColors = { primary: 0xe8a47e, secondary: 0xc9795f, accent: 0xf6dcc0, ocean: 0xa85e4a, ice: 0xf6eee2, atmosphere: 0xf0b08e, cloud: 0xffe0c8, roughness: 0.88 };
const verdantColors = { primary: 0x75c8b6, secondary: 0x4e9e9d, accent: 0xf4e6a8, ocean: 0x3e7f8d, ice: 0xe8f7ef, atmosphere: 0x8fe0d2, cloud: 0xf2fff8, roughness: 0.55 };
const solColors = { primary: 0xffd36e, secondary: 0xffb03a, accent: 0xfff3c4, ocean: 0xffcf5e, ice: 0xfff7d6, atmosphere: 0xffd36e, cloud: 0xfff6cf, roughness: 0.5 };

function makeCraters(seed: number, count: number, rMin: number, rMax: number, depth: number): Crater[] {
  const out: Crater[] = [];
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1;
    const a = rnd() * TWO_PI;
    const rr = Math.sqrt(1 - z * z);
    const radius = rMin + Math.pow(rnd(), 2.2) * (rMax - rMin);
    out.push({
      center: new Vector3(rr * Math.cos(a), z, rr * Math.sin(a)),
      radius,
      depth: depth * (0.35 + rnd() * 0.9) * (0.5 + radius / rMax),
      rim: depth * (0.06 + rnd() * 0.08),
    });
  }
  return out;
}

const sol = new Body({
  id: 'sol', name: 'Sol', shortName: 'SOL', description: 'A warm little star. Everything here orbits it, eventually.',
  radius: 2.616e8, mu: 1.172e18, soiRadius: Infinity, parent: null, orbit: null,
  atmosphere: null, appearance: solColors, rotationPeriod: 432000, hasSurface: true, terrainSeed: 0, terrainAmplitude: 0, terrainRoughness: 0, craters: [], landingZones: [],
});

const terra = new Body({
  id: 'terra', name: 'Terra', shortName: 'TERRA', description: 'Home. Soft blue oceans, mint-green continents, and one very crowded launch pad.',
  radius: 600000, mu: 3.5316e12, soiRadius: 8.416e7, parent: sol,
  orbit: { a: 1.35e10, e: 0, inclination: 0, phase: 2.1, period: 9.2e6 },
  atmosphere: { height: 70000, rho0: 1.225, scaleHeight: 5600, color: 0x9bdcff },
  appearance: earthColors, rotationPeriod: 21549, hasSurface: true, terrainSeed: 17, terrainAmplitude: 420, terrainRoughness: 0.6,
  craters: [], landingZones: [{ lat: 0, lon: 0, radius: 900, name: 'Mewport Launch Complex' }],
});

const luna = new Body({
  id: 'luna', name: 'Luna', shortName: 'LUNA', description: 'Terra\'s big, quiet moon. Lavender dust, deep craters, no wind to erase your pawprints.',
  radius: 200000, mu: 6.5138e10, soiRadius: 2.429e6, parent: terra,
  orbit: { a: 1.2e7, e: 0, inclination: 0, phase: 2.35, period: 138984 },
  atmosphere: null, appearance: lunaColors, rotationPeriod: 138984, hasSurface: true, terrainSeed: 53, terrainAmplitude: 430, terrainRoughness: 0.9,
  craters: makeCraters(7, 70, 700, 6200, 380), landingZones: [{ lat: 4, lon: 118, radius: 1800, name: 'Mare Mochi' }],
});

const mochi = new Body({
  id: 'mochi', name: 'Mochi', shortName: 'MOCHI', description: 'A tiny mint-green moon on a tilted orbit. Sparkly ice, low gravity, excellent for bouncing.',
  radius: 60000, mu: 1.7658e9, soiRadius: 2.247e6, parent: terra,
  orbit: { a: 2.6e7, e: 0.05, inclination: 6.2 * DEG, phase: 5.1, period: 443000 },
  atmosphere: null, appearance: mochiColors, rotationPeriod: 40400, hasSurface: true, terrainSeed: 91, terrainAmplitude: 140, terrainRoughness: 0.8,
  craters: makeCraters(19, 30, 300, 1600, 80), landingZones: [{ lat: -8, lon: 20, radius: 900, name: 'Sherbet Flats' }],
});

const rusty = new Body({
  id: 'rusty', name: 'Rusty', shortName: 'RUSTY', description: 'A dusty peach planet with a thin atmosphere. Bring extra fuel and a good air filter.',
  radius: 320000, mu: 3.013e11, soiRadius: 4.79e7, parent: sol,
  orbit: { a: 2.2e10, e: 0.04, inclination: 1.7 * DEG, phase: 2.2, period: 1.7e7 },
  atmosphere: { height: 50000, rho0: 0.12, scaleHeight: 4200, color: 0xf0b08e },
  appearance: rustyColors, rotationPeriod: 66000, hasSurface: true, terrainSeed: 133, terrainAmplitude: 1100, terrainRoughness: 0.7,
  craters: makeCraters(29, 24, 2000, 9000, 350), landingZones: [],
});

const verdant = new Body({
  id: 'verdant', name: 'Verdant', shortName: 'VERDANT', description: 'A soft teal gas giant. No surface to land on, but the view from orbit is worth the trip.',
  radius: 1.2e6, mu: 2.8e12, soiRadius: 1.0e8, parent: sol,
  orbit: { a: 4.05e10, e: 0.03, inclination: 3.1 * DEG, phase: 4.4, period: 4.3e7 },
  atmosphere: { height: 220000, rho0: 0.9, scaleHeight: 12000, color: 0x8fe0d2 },
  appearance: verdantColors, rotationPeriod: 36000, hasSurface: false, terrainSeed: 211, terrainAmplitude: 0, terrainRoughness: 0,
  craters: [], landingZones: [],
});

export const BODIES: Body[] = [sol, terra, luna, mochi, rusty, verdant];
export const BODY: Record<BodyId, Body> = { sol, terra, luna, mochi, rusty, verdant };
export const LAUNCH_BODY = terra;
export const LAUNCH_LAT = 0;
export const LAUNCH_LON = 0;

export function bodiesByParent(parent: Body | null): Body[] {
  return BODIES.filter((b) => b.parent === parent);
}

export function dominantBody(pos: Vector3, t: number): Body {
  let current: Body = sol;
  let guard = 0;
  while (guard++ < 8) {
    let best: Body | null = null;
    let bestD = Infinity;
    for (const child of current.children) {
      const p = child.globalState(t).pos;
      const d = pos.distanceTo(p);
      if (d < child.soiRadius && d < bestD) {
        best = child;
        bestD = d;
      }
    }
    if (!best) break;
    current = best;
  }
  return current;
}

/** Rotate a body-fixed surface point into the global frame. */
export function surfacePoint(body: Body, latDeg: number, lonDeg: number, altitude: number, t: number): Vector3 {
  const fixed = body.surfaceDirection(latDeg, lonDeg, 0);
  const dir = bodyFixedToGlobalDir(body, fixed, t);
  const bs = body.globalState(t);
  return bs.pos.clone().addScaledVector(dir, body.radius + altitude + (body.hasSurface ? body.terrainHeight(fixed) : 0));
}

export function surfaceRelativeVelocity(body: Body, globalPos: Vector3, globalVel: Vector3, t: number): Vector3 {
  const bs = body.globalState(t);
  const rel = globalPos.clone().sub(bs.pos);
  const omega = new Vector3(0, TWO_PI / body.rotationPeriod, 0);
  return globalVel.clone().sub(bs.vel).sub(new Vector3().crossVectors(omega, rel));
}

export function bodyFixedVelocity(body: Body, pos: Vector3, t: number): Vector3 {
  const bs = body.globalState(t);
  const rel = pos.clone().sub(bs.pos);
  const omega = new Vector3(0, (TWO_PI / body.rotationPeriod), 0);
  return bs.vel.clone().add(new Vector3().crossVectors(omega, rel));
}

export function bodyFixedToGlobalDir(body: Body, dir: Vector3, t: number): Vector3 {
  return dir.clone().applyAxisAngle(new Vector3(0, 1, 0), body.rotationAngle(t));
}

export function globalToBodyFixedDir(body: Body, dir: Vector3, t: number): Vector3 {
  return dir.clone().applyAxisAngle(new Vector3(0, 1, 0), -body.rotationAngle(t));
}

export function latLonOf(body: Body, globalPos: Vector3, t: number): { lat: number; lon: number } {
  const bs = body.globalState(t);
  const local = globalPos.clone().sub(bs.pos).normalize().applyAxisAngle(new Vector3(0, 1, 0), -body.rotationAngle(t));
  const lat = Math.asin(Math.max(-1, Math.min(1, local.y))) * (180 / Math.PI);
  const lon = mod(Math.atan2(-local.z, local.x) * (180 / Math.PI), 360);
  return { lat, lon };
}

export function altitudeOf(body: Body, globalPos: Vector3, t: number): number {
  const bs = body.globalState(t);
  const rel = globalPos.clone().sub(bs.pos);
  const d = rel.length();
  const fixed = globalToBodyFixedDir(body, rel.normalize(), t);
  return d - body.surfaceRadiusAt(fixed);
}

export function soiOf(body: Body): number {
  return body.soiRadius;
}
