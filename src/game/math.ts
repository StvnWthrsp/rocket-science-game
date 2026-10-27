import { Matrix4, Quaternion, Vector3 } from 'three';

export const TWO_PI = Math.PI * 2;
export const G0 = 9.80665;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (v - a) / (b - a);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a: number) => {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
};
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const signedSqrt = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));

export interface OrbitElements {
  a: number;
  e: number;
  h: number;
  energy: number;
  period: number;
  periapsis: number;
  apoapsis: number;
  meanMotion: number;
  eHat: Vector3;
  qHat: Vector3;
  hHat: Vector3;
  trueAnomaly: number;
  eccentricAnomaly: number;
  meanAnomaly: number;
  radius: number;
  speed: number;
  isElliptic: boolean;
}

export function orbitalElements(r: Vector3, v: Vector3, mu: number): OrbitElements {
  const radius = r.length();
  const speed = v.length();
  const hVec = new Vector3().crossVectors(r, v);
  const h = hVec.length();
  const energy = (speed * speed) / 2 - mu / radius;
  const isElliptic = energy < 0 && Number.isFinite(energy);
  const a = isElliptic ? -mu / (2 * energy) : energy > 0 ? -mu / (2 * energy) : Infinity;
  const eVec = new Vector3()
    .copy(r)
    .multiplyScalar(speed * speed - mu / radius)
    .addScaledVector(v, -r.dot(v))
    .divideScalar(mu);
  const e = eVec.length();
  const hHat = h > 1e-9 ? hVec.clone().divideScalar(h) : new Vector3(0, 1, 0);
  let eHat: Vector3;
  if (e > 1e-6) eHat = eVec.clone().divideScalar(e);
  else eHat = radius > 0 ? r.clone().divideScalar(radius) : new Vector3(1, 0, 0);
  // Make the perifocal basis right handed: qHat = hHat x eHat.
  const qHat = new Vector3().crossVectors(hHat, eHat).normalize();
  eHat = new Vector3().crossVectors(qHat, hHat).normalize();
  const trueAnomaly = Math.atan2(r.dot(qHat), r.dot(eHat));
  const eccentricAnomaly = e < 1
    ? 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(trueAnomaly / 2), Math.sqrt(1 + e) * Math.cos(trueAnomaly / 2))
    : NaN;
  const meanAnomaly = e < 1 ? eccentricAnomaly - e * Math.sin(eccentricAnomaly) : NaN;
  const meanMotion = isElliptic && a > 0 ? Math.sqrt(mu / (a * a * a)) : Math.sqrt(mu / Math.abs(a * a * a));
  const period = isElliptic ? TWO_PI / meanMotion : Infinity;
  const periapsis = a * (1 - e);
  const apoapsis = isElliptic ? a * (1 + e) : Infinity;
  return { a, e, h, energy, period, periapsis, apoapsis, meanMotion, eHat, qHat, hHat, trueAnomaly, eccentricAnomaly, meanAnomaly, radius, speed, isElliptic };
}

export function stateFromElements(el: OrbitElements, nu: number, mu: number): { r: Vector3; v: Vector3 } {
  const p = el.a * (1 - el.e * el.e);
  const r = new Vector3()
    .copy(el.eHat)
    .multiplyScalar((p / (1 + el.e * Math.cos(nu))) * Math.cos(nu))
    .addScaledVector(el.qHat, (p / (1 + el.e * Math.cos(nu))) * Math.sin(nu));
  const fac = Math.sqrt(mu / p);
  const v = new Vector3()
    .copy(el.eHat)
    .multiplyScalar(-fac * Math.sin(nu))
    .addScaledVector(el.qHat, fac * (el.e + Math.cos(nu)));
  return { r, v };
}

export function solveKepler(M: number, e: number): number {
  M = mod(M + Math.PI, TWO_PI) - Math.PI;
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let i = 0; i < 12; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/** Two-body propagation. Uses conic elements for ellipses and universal variables for hyperbolae. */
export function propagate(r: Vector3, v: Vector3, mu: number, dt: number): { r: Vector3; v: Vector3 } {
  if (dt === 0) return { r: r.clone(), v: v.clone() };
  const el = orbitalElements(r, v, mu);
  if (el.isElliptic) {
    const M = el.meanAnomaly + el.meanMotion * dt;
    const E = solveKepler(M, el.e);
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    const oneMinusECos = 1 - el.e * cosE;
    const rr = el.a * oneMinusECos;
    const x = el.a * (cosE - el.e);
    const y = el.a * Math.sqrt(1 - el.e * el.e) * sinE;
    const nx = (-el.a * el.meanMotion * sinE) / oneMinusECos;
    const ny = (el.a * el.meanMotion * Math.sqrt(1 - el.e * el.e) * cosE) / oneMinusECos;
    const pos = new Vector3().copy(el.eHat).multiplyScalar(x).addScaledVector(el.qHat, y);
    const vel = new Vector3().copy(el.eHat).multiplyScalar(nx).addScaledVector(el.qHat, ny);
    // Guard against tiny numerical drift near circular orbits.
    if (!Number.isFinite(rr) || pos.lengthSq() === 0) return universalPropagate(r, v, mu, dt);
    return { r: pos, v: vel };
  }
  return universalPropagate(r, v, mu, dt);
}

function stumpffC(z: number): number {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}
function stumpffS(z: number): number {
  if (z > 1e-8) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-8) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

export function universalPropagate(r0: Vector3, v0: Vector3, mu: number, dt: number): { r: Vector3; v: Vector3 } {
  const r0m = r0.length();
  const v0m = v0.length();
  const vr0 = r0.dot(v0) / r0m;
  const alpha = 2 / r0m - (v0m * v0m) / mu;
  const sqrtMu = Math.sqrt(mu);
  let x: number;
  if (alpha > 1e-9) x = sqrtMu * alpha * dt;
  else if (Math.abs(alpha) < 1e-9) x = (sqrtMu * dt) / r0m;
  else x = Math.sign(dt || 1) * Math.sqrt(-1 / alpha) * Math.log((-2 * mu * alpha * dt) / (r0.dot(v0) + Math.sign(dt || 1) * Math.sqrt(-mu / alpha) * (1 - r0m * alpha)));
  if (!Number.isFinite(x)) x = sqrtMu * Math.abs(dt) / r0m;
  for (let i = 0; i < 40; i++) {
    const z = alpha * x * x;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F = (r0m * vr0) / sqrtMu * x * x * C + (1 - alpha * r0m) * x * x * x * S + r0m * x - sqrtMu * dt;
    const dF = (r0m * vr0) / sqrtMu * x * (1 - z * S) + (1 - alpha * r0m) * x * x * C + r0m;
    const dx = F / dF;
    x -= dx;
    if (Math.abs(dx) < 1e-7 * Math.max(1, Math.abs(x))) break;
  }
  const z = alpha * x * x;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - (x * x * C) / r0m;
  const g = dt - (x * x * x * S) / sqrtMu;
  const r = new Vector3().copy(r0).multiplyScalar(f).addScaledVector(v0, g);
  const rm = r.length();
  const fdot = (sqrtMu / (rm * r0m)) * (alpha * x * x * x * S - x);
  const gdot = 1 - (x * x * C) / rm;
  const v = new Vector3().copy(r0).multiplyScalar(fdot).addScaledVector(v0, gdot);
  if (!Number.isFinite(rm) || !Number.isFinite(v.lengthSq())) {
    const h = new Vector3().crossVectors(r0, v0);
    const out = h.clone().normalize().multiplyScalar(0);
    return { r: r0.clone().add(out), v: v0.clone() };
  }
  return { r, v };
}

export function sampleOrbit(el: OrbitElements, count = 160, maxNu = TWO_PI): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= count; i++) {
    const nu = (i / count) * maxNu;
    const p = el.a * (1 - el.e * el.e);
    const denom = 1 + el.e * Math.cos(nu);
    if (denom < 1e-5) continue;
    const rr = p / denom;
    if (!Number.isFinite(rr) || rr < 0) continue;
    pts.push(new Vector3().copy(el.eHat).multiplyScalar(rr * Math.cos(nu)).addScaledVector(el.qHat, rr * Math.sin(nu)));
  }
  return pts;
}

export function timeToApoapsis(el: OrbitElements): number {
  if (!el.isElliptic) return Infinity;
  const M = mod(-el.meanAnomaly, TWO_PI);
  return M / el.meanMotion;
}

export function timeToPeriapsis(el: OrbitElements): number {
  if (!el.isElliptic) return Infinity;
  const M = mod(Math.PI - el.meanAnomaly, TWO_PI);
  return M / el.meanMotion;
}

export function enuBasis(up: Vector3): { east: Vector3; north: Vector3; up: Vector3 } {
  const ref = Math.abs(up.y) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const east = new Vector3().crossVectors(ref, up).normalize();
  const north = new Vector3().crossVectors(up, east).normalize();
  return { east, north, up: up.clone().normalize() };
}

export function quatFromForwardUp(forward: Vector3, upHint: Vector3): Quaternion {
  const f = forward.clone().normalize();
  let right = new Vector3().crossVectors(upHint, f);
  if (right.lengthSq() < 1e-8) right = new Vector3().crossVectors(new Vector3(0, 0, 1), f);
  right.normalize();
  const up = new Vector3().crossVectors(f, right).normalize();
  const m = new Matrix4().makeBasis(right, up, f);
  return new Quaternion().setFromRotationMatrix(m);
}


export function quatFromThrustUp(dir: Vector3, upHint: Vector3): Quaternion {
  const y = dir.clone().normalize();
  let z = upHint.clone().addScaledVector(y, -upHint.dot(y));
  if (z.lengthSq() < 1e-8) {
    z = Math.abs(y.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    z.addScaledVector(y, -z.dot(y));
  }
  z.normalize();
  const x = new Vector3().crossVectors(y, z).normalize();
  const m = new Matrix4().makeBasis(x, y, z);
  return new Quaternion().setFromRotationMatrix(m);
}

export function thrustAxis(q: Quaternion): Vector3 {
  return new Vector3(0, 1, 0).applyQuaternion(q).normalize();
}

export function quatErrorVector(desired: Quaternion, current: Quaternion): Vector3 {
  const inv = current.clone().invert();
  const dq = desired.clone().multiply(inv);
  if (dq.w < 0) {
    dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w;
  }
  const v = new Vector3(dq.x, dq.y, dq.z);
  const sinHalf = v.length();
  if (sinHalf < 1e-9) return v.multiplyScalar(2);
  const angle = 2 * Math.atan2(sinHalf, dq.w);
  return v.normalize().multiplyScalar(angle);
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞';
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

export function formatDistance(m: number): string {
  const a = Math.abs(m);
  if (a >= 1e9) return `${(m / 1e9).toFixed(2)} Gm`;
  if (a >= 1e6) return `${(m / 1e6).toFixed(2)} Mm`;
  if (a >= 1000) return `${(m / 1000).toFixed(a >= 1e5 ? 0 : 1)} km`;
  return `${m.toFixed(0)} m`;
}
