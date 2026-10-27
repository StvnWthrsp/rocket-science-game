import { Quaternion, Vector3 } from 'three';
import {
  BODY, Body, LAUNCH_BODY, LAUNCH_LAT, LAUNCH_LON,
  altitudeOf, bodyFixedToGlobalDir, bodyFixedVelocity, dominantBody, surfaceRelativeVelocity,
  globalToBodyFixedDir, latLonOf,
} from './bodies';
import { G0, clamp, mod, orbitalElements, propagate, quatErrorVector, quatFromThrustUp, thrustAxis } from './math';
import { PART, computeStats, groupStages } from './parts';
import type { PartDef, PartInstance, RocketDesign, RocketStats } from './parts';

export type SasMode = 'stability' | 'prograde' | 'retrograde' | 'radial+' | 'radial-' | 'normal+' | 'normal-' | 'target' | 'up' | 'autopilot';
export type ChuteState = 'packed' | 'deploying' | 'deployed' | 'cut';

export interface Controls {
  throttle: number;
  pitch: number;
  yaw: number;
  roll: number;
  translate: Vector3;
  stage: boolean;
  sas: boolean;
  sasMode: SasMode;
  rcs: boolean;
  gear: boolean;
  chute: boolean;
}

export interface PartLayout {
  inst: PartInstance;
  def: PartDef;
  yBottom: number;
  yCenter: number;
  radius: number;
  mass: number;
}

export interface VesselLayout {
  parts: PartLayout[];
  height: number;
  comHeight: number;
  maxRadius: number;
  mass: number;
  dryMass: number;
  fuelMass: number;
  monoprop: number;
  inertia: Vector3;
  torque: number;
  tall: number;
}

export interface Debris {
  parts: PartInstance[];
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  omega: Vector3;
  age: number;
  bodyId: string;
  layout: PartLayout[];
  height: number;
  comHeight: number;
}

export interface FlightEvent {
  type: 'stage' | 'landed' | 'crashed' | 'soi' | 'chute' | 'launch' | 'fuelout' | 'recovered' | 'milestone' | 'warpstop';
  title?: string;
  body?: string;
  detail?: string;
  speed?: number;
}

export interface LandedInfo {
  bodyId: string;
  unitFixed: Vector3;
  lat: number;
  lon: number;
  time: number;
  speed: number;
  zone: string | null;
  returned: boolean;
}

export interface Telemetry {
  altitude: number;
  surfaceAltitude: number;
  speed: number;
  orbitalSpeed: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  apoapsis: number;
  periapsis: number;
  period: number;
  ecc: number;
  inclination: number;
  timeToAp: number;
  timeToPe: number;
  mass: number;
  fuelStage: number;
  fuelStageMax: number;
  monoprop: number;
  twr: number;
  thrust: number;
  stageIndex: number;
  stagesLeft: number;
  currentBody: string;
  bodyName: string;
  soiCrossed: boolean;
  distanceToTarget: number;
  targetName: string;
  targetAngle: number;
}

const UP = new Vector3(0, 1, 0);
const EAST = new Vector3(0, 0, -1);
const MAX_SUBSTEP = 0.02;

export class Ship {
  design: RocketDesign;
  stats: RocketStats;
  pos = new Vector3();
  vel = new Vector3();
  quat = new Quaternion();
  angVel = new Vector3();
  throttle = 0;
  sasEnabled = true;
  rcsEnabled = false;
  sasMode: SasMode = 'stability';
  gearDeployed = false;
  chuteState: ChuteState = 'packed';
  chuteProgress = 0;
  sasTarget = new Quaternion();
  landed = true;
  landedInfo: LandedInfo | null = null;
  crashed = false;
  recovered = false;
  time = 0;
  met = 0;
  currentBody: Body = LAUNCH_BODY;
  targetBodyId = 'luna';
  activeStage = 0;
  debris: Debris[] = [];
  events: FlightEvent[] = [];
  launchSite = { lat: LAUNCH_LAT, lon: LAUNCH_LON };
  lastImpactSpeed = 0;
  stageFuelAtIgnition = 0;
  solidIgnited = false;
  warpStopRequested = false;
  private lastSasTarget = new Quaternion();
  private controlTorque = new Vector3();
  private lastFuelWarning = false;
  private hasLaunched = false;
  private stagingLock = 0;

  constructor(design: RocketDesign, startTime = 0) {
    this.design = design;
    this.stats = computeStats(design);
    this.time = startTime;
    this.initMonoprop();
    const layout = this.computeLayout();
    const body = LAUNCH_BODY;
    const bs = body.globalState(this.time);
    const fixed = body.surfaceDirection(LAUNCH_LAT, LAUNCH_LON, 0);
    const dir = bodyFixedToGlobalDir(body, fixed, this.time);
    const surfaceR = body.surfaceRadiusAt(fixed);
    this.pos.copy(bs.pos).addScaledVector(dir, surfaceR + layout.comHeight + 0.45);
    this.vel.copy(bodyFixedVelocity(body, this.pos, this.time));
    const up = dir.clone();
    const east = new Vector3().crossVectors(new Vector3(0, 1, 0), up).normalize();
    this.quat.copy(quatFromThrustUp(up, east));
    this.sasTarget.copy(this.quat);
    this.landed = true;
    this.landedInfo = {
      bodyId: body.id, unitFixed: fixed.clone(), lat: LAUNCH_LAT, lon: LAUNCH_LON,
      time: 0, speed: 0, zone: 'Mewport Launch Complex', returned: true,
    };
    this.currentBody = body;
    this.sasMode = 'stability';
    this.gearDeployed = true;
    this.solidIgnited = false;
    this.activeStage = 0;
    this.stageFuelAtIgnition = this.stageFuel(0);
  }

  get stages(): PartInstance[][] {
    return groupStages(this.design);
  }

  get stageCount(): number {
    return this.stages.length;
  }

  get activeParts(): PartInstance[] {
    return this.stages[this.activeStage] ?? [];
  }

  get activeEngines(): PartInstance[] {
    return this.activeParts.filter((p) => PART[p.defId]?.kind === 'engine' || PART[p.defId]?.kind === 'srb');
  }

  get activeTanks(): PartInstance[] {
    return this.activeParts.filter((p) => PART[p.defId]?.kind === 'tank' || PART[p.defId]?.kind === 'srb');
  }

  stageFuel(index: number): number {
    let f = 0;
    for (const p of this.stages[index] ?? []) if (PART[p.defId]?.kind === 'tank' || PART[p.defId]?.kind === 'srb') f += p.fuel;
    return f;
  }

  stageFuelMax(index: number): number {
    let f = 0;
    for (const p of this.stages[index] ?? []) if (PART[p.defId]?.kind === 'tank' || PART[p.defId]?.kind === 'srb') f += PART[p.defId].fuel;
    return f;
  }

  get monopropTotal(): number {
    let m = 0;
    for (const p of this.design.stack) m += PART[p.defId].monoprop > 0 ? PART[p.defId].monoprop : 0;
    return m;
  }

  get monopropRemaining(): number {
    return this._monoprop;
  }

  private _monoprop = 0;
  private monopropByPart = new Map<number, number>();

  initMonoprop(): void {
    this.monopropByPart.clear();
    for (const p of this.design.stack) {
      const d = PART[p.defId];
      if (d.monoprop > 0) this.monopropByPart.set(p.uid, d.monoprop);
    }
    this._monoprop = [...this.monopropByPart.values()].reduce((a, b) => a + b, 0);
  }

  totalMass(): number {
    return this.computeLayout().mass;
  }

  computeLayout(): VesselLayout {
    const stack = this.design.stack;
    const parts: PartLayout[] = [];
    let cursor = 0;
    let mass = 0, dryMass = 0, fuelMass = 0, monoprop = 0, torque = 0;
    // bottom -> top
    for (let i = stack.length - 1; i >= 0; i--) {
      const inst = stack[i];
      const def = PART[inst.defId];
      if (!def) continue;
      const radius = def.radius || this.autoRadius(i);
      const pMass = def.dryMass + inst.fuel + (this.monopropByPart.get(inst.uid) ?? 0);
      parts.push({ inst, def, yBottom: cursor, yCenter: cursor + def.height / 2, radius, mass: pMass });
      cursor += def.height;
      mass += pMass;
      dryMass += def.dryMass;
      fuelMass += inst.fuel;
      monoprop += this.monopropByPart.get(inst.uid) ?? 0;
      torque += def.torque;
    }
    let com = 0;
    let maxRadius = 0.6;
    for (const p of parts) {
      com += p.yCenter * p.mass;
      maxRadius = Math.max(maxRadius, p.radius);
    }
    com = mass > 0 ? com / mass : 0;
    let ixx = 0, iyy = 0, izz = 0;
    for (const p of parts) {
      const r = p.radius;
      const h = p.def.height;
      const dy = p.yCenter - com;
      ixx += (p.mass * (3 * r * r + h * h)) / 12 + p.mass * dy * dy;
      izz += (p.mass * (3 * r * r + h * h)) / 12 + p.mass * dy * dy;
      iyy += (p.mass * r * r) / 2;
    }
    const avgI = (ixx + iyy + izz) / 3;
    return {
      parts, height: cursor, comHeight: com, maxRadius, mass, dryMass, fuelMass, monoprop,
      inertia: new Vector3(Math.max(1, ixx), Math.max(1, iyy), Math.max(1, izz)),
      torque, tall: cursor > maxRadius * 4 ? 1 : 0.4,
    };
  }

  private autoRadius(index: number): number {
    const stack = this.design.stack;
    for (let d = 1; d < stack.length; d++) {
      const a = stack[index - d] ? PART[stack[index - d].defId].radius : 0;
      const b = stack[index + d] ? PART[stack[index + d].defId].radius : 0;
      const r = Math.max(a, b);
      if (r > 0) return r;
    }
    return 1.25;
  }

  init(): void {
    this.initMonoprop();
    this.stats = computeStats(this.design);
    this.activeStage = 0;
    this.stageFuelAtIgnition = this.stageFuel(0);
    this.computeLayout();
  }

  requestStage(): void {
    if (this.stagingLock > 0 || this.stages.length < 2) return;
    this.stagingLock = 0.7;
    const removed = this.stages[0];
    const layout = this.computeLayout();
    const removedLayout = layout.parts.filter((p) => removed.some((r) => r.uid === p.inst.uid));
    let removedMass = 0;
    let com = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of removedLayout) {
      removedMass += p.mass;
      com += p.mass * (p.yCenter - layout.comHeight);
      minY = Math.min(minY, p.yBottom - layout.comHeight);
      maxY = Math.max(maxY, p.yBottom + p.def.height - layout.comHeight);
    }
    com = removedMass > 0 ? com / removedMass : 0;
    const localOffset = new Vector3(0, com, 0).applyQuaternion(this.quat);
    const worldPos = this.pos.clone().add(localOffset);
    const relV = this.vel.clone().sub(this.currentBody.globalState(this.time).vel);
    const ang = this.angVel.clone().multiplyScalar(0.35).add(new Vector3((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06));
    const worldOmega = this.angVel.clone().applyQuaternion(this.quat);
    this.debris.push({
      parts: removed.map((p) => ({ ...p })),
      pos: worldPos, vel: relV.clone().add(new Vector3().crossVectors(worldOmega, localOffset)), quat: this.quat.clone(), omega: ang,
      age: 0, bodyId: this.currentBody.id, layout: removedLayout, height: maxY - minY, comHeight: maxY - com,
    });
    const removeIds = new Set(removed.map((p) => p.uid));
    this.design.stack = this.design.stack.filter((p) => !removeIds.has(p.uid));
    this.stats = computeStats(this.design);
    this.activeStage = 0;
    this.stageFuelAtIgnition = this.stageFuel(0);
    this.solidIgnited = false;
    this.events.push({ type: 'stage', title: 'Stage separation', detail: `${this.stages.length} stage${this.stages.length === 1 ? '' : 's'} remaining` });
  }

  deployChute(): void {
    if (this.chuteState === 'packed') {
      this.chuteState = 'deploying';
      this.chuteProgress = 0;
      this.events.push({ type: 'chute', title: 'Parachute armed', detail: 'Paw-chute is deploying' });
    }
  }

  cutChute(): void {
    if (this.chuteState !== 'packed') {
      this.chuteState = 'cut';
      this.chuteProgress = 0;
    }
  }

  setSas(mode: SasMode): void {
    this.sasMode = mode;
    this.sasEnabled = true;
    this.lastSasTarget.copy(this.quat);
  }

  targetDirection(): Vector3 {
    const t = BODY[this.targetBodyId as keyof typeof BODY] ?? BODY.luna;
    const tp = t.globalState(this.time).pos;
    return tp.sub(this.pos).normalize();
  }

  targetDistance(): number {
    const t = BODY[this.targetBodyId as keyof typeof BODY] ?? BODY.luna;
    return t.globalState(this.time).pos.distanceTo(this.pos);
  }

  bodyRelativeVelocity(): Vector3 {
    const bs = this.currentBody.globalState(this.time);
    return this.vel.clone().sub(bs.vel);
  }

  orbitElements() {
    const r = this.pos.clone().sub(this.currentBody.globalState(this.time).pos);
    const v = this.bodyRelativeVelocity();
    return orbitalElements(r, v, this.currentBody.mu);
  }

  telemetry(): Telemetry {
    const bs = this.currentBody.globalState(this.time);
    const rel = this.pos.clone().sub(bs.pos);
    const up = rel.clone().normalize();
    const fixed = globalToBodyFixedDir(this.currentBody, up, this.time);
    const surfR = this.currentBody.surfaceRadiusAt(fixed);
    const alt = rel.length() - surfR;
    const vRel = this.bodyRelativeVelocity();
    const el = orbitalElements(rel, vRel, this.currentBody.mu);
    const layout = this.computeLayout();
    const target = BODY[this.targetBodyId as keyof typeof BODY] ?? BODY.luna;
    const tv = target.globalState(this.time).pos.clone().sub(this.pos);
    return {
      altitude: alt,
      surfaceAltitude: alt - layout.comHeight,
      speed: vRel.length(),
      orbitalSpeed: el.speed,
      verticalSpeed: vRel.dot(up),
      horizontalSpeed: vRel.clone().addScaledVector(up, -vRel.dot(up)).length(),
      apoapsis: el.apoapsis - this.currentBody.radius,
      periapsis: el.periapsis - this.currentBody.radius,
      period: el.period,
      ecc: el.e,
      inclination: Math.acos(clamp(el.hHat.y, -1, 1)) * (180 / Math.PI),
      timeToAp: el.isElliptic ? mod(-el.meanAnomaly, Math.PI * 2) / el.meanMotion : Infinity,
      timeToPe: el.isElliptic ? mod(Math.PI - el.meanAnomaly, Math.PI * 2) / el.meanMotion : Infinity,
      mass: layout.mass,
      fuelStage: this.stageFuel(0),
      fuelStageMax: this.stageFuelMax(0),
      monoprop: this._monoprop,
      twr: this.currentThrust(layout, true) / Math.max(1, layout.mass * this.currentBody.surfaceGravity),
      thrust: this.currentThrust(layout, true),
      stageIndex: this.activeStage,
      stagesLeft: this.stages.length,
      currentBody: this.currentBody.id,
      bodyName: this.currentBody.name,
      soiCrossed: false,
      distanceToTarget: tv.length(),
      targetName: target.name,
      targetAngle: Math.atan2(
        vRel.clone().cross(tv).dot(el.hHat),
        vRel.dot(tv),
      ),
    };
  }

  availableThrust(): number {
    const body = this.currentBody;
    const bs = body.globalState(this.time);
    const rel = this.pos.clone().sub(bs.pos);
    const fixed = globalToBodyFixedDir(body, rel.clone().normalize(), this.time);
    const alt = rel.length() - body.surfaceRadiusAt(fixed);
    const pressure = body.pressureAt(alt);
    let thrust = 0;
    for (const e of this.activeEngines) {
      const d = PART[e.defId];
      const tSL = d.thrustSL ?? d.thrust;
      thrust += tSL + (d.thrust - tSL) * (1 - pressure);
    }
    return thrust;
  }

  private currentThrust(layout: VesselLayout, sl: boolean): number {
    const pressure = this.currentBody.pressureAt(Math.max(0, this.pos.distanceTo(this.currentBody.globalState(this.time).pos) - this.currentBody.radius));
    let thrust = 0;
    for (const e of this.activeEngines) {
      const d = PART[e.defId];
      const t = sl
        ? (d.thrustSL ?? d.thrust)
        : (d.thrustSL ?? d.thrust) + (d.thrust - (d.thrustSL ?? d.thrust)) * (1 - pressure);
      thrust += t;
    }
    return thrust * this.throttle;
  }

  /** Warp propagation around the current body. Called only when engines are off and above the atmosphere. */
  railsStep(dt: number): void {
    if (this.landed || this.crashed) return;
    const steps = Math.max(1, Math.ceil(dt / 300));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const t = this.time + h;
      const body = this.currentBody;
      const bs0 = body.globalState(this.time);
      const rel = this.pos.clone().sub(bs0.pos);
      const vRel = this.vel.clone().sub(bs0.vel);
      const el = orbitalElements(rel, vRel, body.mu);
      if (el.isElliptic && el.periapsis < body.radius + (body.atmosphere?.height ?? 0) * 0.5) {
        this.warpStopRequested = true;
        return;
      }
      // Propagate using conic elements, sampled in 200 second chunks to catch SOI crossings.
      const sub = Math.max(1, Math.ceil(h / 200));
      let cc = { r: rel, v: vRel };
      for (let k = 0; k < sub; k++) {
        cc = propagateSafe(cc.r, cc.v, body.mu, h / sub);
      }
      const bs1 = body.globalState(t);
      this.pos.copy(bs1.pos).add(cc.r);
      this.vel.copy(bs1.vel).add(cc.v);
      this.time = t;
      this.met += h;
      const newBody = dominantBody(this.pos, this.time);
      if (newBody !== this.currentBody) {
        this.events.push({ type: 'soi', title: `Entering ${newBody.name} SOI`, body: newBody.id, detail: `Now flying in ${newBody.name}'s sphere of influence` });
        this.currentBody = newBody;
        this.warpStopRequested = true;
        return;
      }
      const alt = altitudeOf(this.currentBody, this.pos, this.time);
      if (alt < 0) {
        this.warpStopRequested = true;
        return;
      }
      this.updateDebris(h);
    }
  }

  update(dt: number, controls: Controls): void {
    dt = clamp(dt, 0, 0.25);
    this.stagingLock = Math.max(0, this.stagingLock - dt);
    if (controls.stage) {
      this.requestStage();
      controls.stage = false;
    }
    if (controls.chute) {
      this.deployChute();
      controls.chute = false;
    }
    this.gearDeployed = controls.gear;
    this.throttle = clamp(controls.throttle, 0, 1);
    this.sasEnabled = controls.sas;
    this.rcsEnabled = controls.rcs;
    this.sasMode = controls.sasMode;
    this._monoprop = [...this.monopropByPart.values()].reduce((a, b) => a + b, 0);

    if (this.landed) {
      this.time += dt;
      this.met += dt;
      this.updateLanded(dt, controls);
      this.updateDebris(dt);
      return;
    }

    const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.substep(h, controls);
      if (this.crashed || this.landed) break;
    }
    this.updateDebris(dt);
  }

  private updateLanded(dt: number, controls: Controls): void {
    const li = this.landedInfo;
    if (!li) return;
    const body = BODY[li.bodyId as keyof typeof BODY] ?? LAUNCH_BODY;
    const layout = this.computeLayout();
    const dir = bodyFixedToGlobalDir(body, li.unitFixed, this.time);
    const bs = body.globalState(this.time);
    const surfR = body.surfaceRadiusAt(li.unitFixed);
    this.pos.copy(bs.pos).addScaledVector(dir, surfR + layout.comHeight + 0.05);
    this.vel.copy(bodyFixedVelocity(body, this.pos, this.time));
    const east = new Vector3().crossVectors(new Vector3(0, 1, 0), dir).normalize();
    if (east.lengthSq() < 1e-8) east.set(0, 0, 1);
    this.quat.copy(quatFromThrustUp(dir, east));
    this.angVel.set(0, 0, 0);
    this.sasTarget.copy(this.quat);
    if (this.chuteState === 'deployed' || this.chuteState === 'deploying') {
      this.chuteState = 'cut';
      this.chuteProgress = 0;
    }
    if (controls.throttle > 0.02 && this.activeEngines.length > 0 && this.stageFuel(0) > 0.1) {
      const twr = this.currentThrust(layout, true) / (layout.mass * body.surfaceGravity);
      if (twr > 1.02) {
        this.launched(body, li);
      }
    }
  }

  private launched(body: Body, li: LandedInfo): void {
    this.landed = false;
    this.hasLaunched = true;
    this.chuteState = 'packed';
    this.chuteProgress = 0;
    this.events.push({ type: 'launch', title: 'Liftoff!', detail: li.returned ? 'Returning to the sky' : 'Pawprints confirmed on ' + body.name });
    this.landedInfo = { ...li, returned: true };
  }

  private substep(h: number, controls: Controls): void {
    const t = this.time;
    const body = this.currentBody;
    const bs = body.globalState(t);
    const rel = this.pos.clone().sub(bs.pos);
    const r = rel.length();
    const up = rel.clone().normalize();
    const fixed = globalToBodyFixedDir(body, up, t);
    const surfR = body.surfaceRadiusAt(fixed);
    const alt = r - surfR;
    const vRel = this.vel.clone().sub(bs.vel);
    const pressure = body.pressureAt(alt);
    const layout = this.computeLayout();

    // ---- thrust/fuel
    let thrust = 0;
    let usedFuel = 0;
    const activeEngines = this.activeEngines;
    const tanks = this.activeTanks;
    let availableFuel = tanks.reduce((a, p) => a + p.fuel, 0);
    if (this.throttle > 0.001 && activeEngines.length && availableFuel > 0) {
      let requestedThrust = 0;
      for (const e of activeEngines) {
        const d = PART[e.defId];
        const tSL = d.thrustSL ?? d.thrust;
        let thr = tSL + (d.thrust - tSL) * (1 - pressure);
        if (d.solid) thr = tSL + (d.thrust - tSL) * (1 - pressure);
        requestedThrust += thr;
      }
      requestedThrust *= this.throttle;
      // mixture of sea-level and vacuum Isp
      let mdot = 0;
      for (const e of activeEngines) {
        const d = PART[e.defId];
        const tSL = d.thrustSL ?? d.thrust;
        const ispSL = d.ispSL ?? d.ispVac;
        const isp = ispSL + (d.ispVac - ispSL) * (1 - pressure);
        const thr = (tSL + (d.thrust - tSL) * (1 - pressure)) * this.throttle;
        mdot += thr / (isp * G0);
      }
      usedFuel = mdot * h;
      if (usedFuel > availableFuel) {
        const scale = availableFuel / usedFuel;
        usedFuel = availableFuel;
        requestedThrust *= scale;
      }
      // Drain proportionally so the centre of mass stays put.
      for (const tank of tanks) {
        tank.fuel = Math.max(0, tank.fuel - usedFuel * (tank.fuel / Math.max(1e-6, availableFuel)));
      }
      thrust = requestedThrust;
      if (availableFuel - usedFuel <= 0.01 && !this.lastFuelWarning) {
        this.lastFuelWarning = true;
        this.events.push({ type: 'fuelout', title: 'Stage fuel depleted', detail: 'Press SPACE to stage' });
      }
      if (availableFuel > 1) this.lastFuelWarning = false;
    }

    const mass = layout.mass;
    const thrustAcc = thrust / mass;
    const forward = thrustAxis(this.quat);

    // ---- gravity and drag
    const gAcc = rel.clone().multiplyScalar(-body.mu / (r * r * r));
    const atmVel = vRel.clone().sub(new Vector3(0, (Math.PI * 2) / body.rotationPeriod, 0).cross(rel));
    const airSpeed = atmVel.length();
    const chuteDef = this.activeParts.map((p) => PART[p.defId]).find((d) => d.kind === 'chute');
    const chuteMax = chuteDef?.chuteArea ?? 0;
    const chuteA = this.chuteState === 'deployed' ? chuteMax : this.chuteState === 'deploying' ? chuteMax * this.chuteProgress * this.chuteProgress : 0;
    const chuteArea = chuteA;
    const area = Math.PI * layout.maxRadius * layout.maxRadius + this.activeParts.reduce((a, p) => a + PART[p.defId].dragArea, 0) + chuteArea;
    const cd = 0.42 + (chuteArea > 1 ? 1.15 : 0);
    let dragAcc = new Vector3();
    if (pressure > 1e-9 && airSpeed > 0.01) {
      const rho = body.densityAt(alt);
      const q = 0.5 * rho * airSpeed * airSpeed;
      const dragF = q * cd * area;
      dragAcc = atmVel.clone().normalize().multiplyScalar(-dragF / mass);
    }
    // Mach-ish buffet and re-entry glow are handled by the renderer from airSpeed.

    // ---- control torque
    const maxAuthority = this.attitudeAuthority(layout, thrust);
    const manual = new Vector3(controls.pitch, controls.yaw, controls.roll).multiplyScalar(maxAuthority * 0.55);
    let sasTorque = new Vector3();
    if (this.sasEnabled && !this.crashed) {
      const target = this.computeSasTarget(up, vRel, body);
      this.sasTarget.copy(target);
      const inv = this.quat.clone().invert();
      const errW = quatErrorVector(target, this.quat);
      const err = errW.applyQuaternion(inv);
      const omegaLocal = this.angVel.clone();
      const iAvg = (layout.inertia.x + layout.inertia.y + layout.inertia.z) / 3;
      const kp = 0.9;
      const kd = 2.1;
      if (err.lengthSq() < 1e-8 && omegaLocal.lengthSq() < 1e-4) {
        sasTorque.set(0, 0, 0);
      } else {
        sasTorque.copy(err).multiplyScalar(kp * iAvg).addScaledVector(omegaLocal, -kd * iAvg);
        if (sasTorque.length() > maxAuthority) sasTorque.setLength(maxAuthority);
      }
      // RCS puffs drain monoprop for large corrections.
      if (this.rcsEnabled && sasTorque.length() > layout.torque + 12000 && this._monoprop > 0) {
        this.drainMonoprop(h * 0.35 * (sasTorque.length() / Math.max(1, maxAuthority)));
      }
    }
    const torque = manual.add(sasTorque);
    const inertia = layout.inertia;
    const alpha = new Vector3(torque.x / inertia.x, torque.y / inertia.y, torque.z / inertia.z);
    this.lastTorque.copy(torque);
    this.lastSasTorque.copy(sasTorque);
    this.lastAngAccel.copy(alpha);

    // ---- RCS translation
    let rcsAcc = new Vector3();
    if (this.rcsEnabled && this._monoprop > 0) {
      const tr = controls.translate;
      if (tr.lengthSq() > 0) {
        const local = tr.clone().clampLength(0, 1);
        const world = local.applyQuaternion(this.quat);
        const rcsThrust = 26000;
        rcsAcc = world.multiplyScalar(rcsThrust / mass);
        this.drainMonoprop((rcsThrust / (220 * G0)) * h * Math.min(1, tr.length()));
      }
    }

    // ---- aerodynamic weathercocking
    if (airSpeed > 25 && pressure > 1e-8) {
      const stab = this.activeParts.reduce((a, p) => a + PART[p.defId].stability, 0);
      if (stab > 0.01) {
        const vHat = atmVel.clone().normalize();
        const axis = new Vector3().crossVectors(forward, vHat);
        const sinA = axis.length();
        const q = 0.5 * body.densityAt(alt) * airSpeed * airSpeed;
        const aero = axis.normalize().multiplyScalar(q * area * stab * 0.045 * sinA);
        const inv = this.quat.clone().invert();
        alpha.add(aero.applyQuaternion(inv).divide(inertia));
      }
    }

    // ---- integrate attitude
    this.angVel.addScaledVector(alpha, h);
    this.angVel.multiplyScalar(1 - 0.04 * h);
    if (this.angVel.length() > 3.5) this.angVel.setLength(3.5);
    this.integrateQuat(h);
    this.quat.normalize();

    // ---- integrate translation
    const acc = gAcc.add(dragAcc).add(rcsAcc).addScaledVector(forward, thrustAcc);
    this.vel.addScaledVector(acc, h);
    this.pos.addScaledVector(this.vel, h);
    this.lastThrustForFx = thrust;
    this.lastAirSpeed = airSpeed;
    this.lastAlt = alt;
    this.lastPressure = pressure;

    // ---- chute deploy animation
    if (this.chuteState === 'deploying') {
      this.chuteProgress = Math.min(1, this.chuteProgress + h / 2.4);
      if (this.chuteProgress >= 1) {
        this.chuteState = 'deployed';
        this.events.push({ type: 'chute', title: 'Parachute deployed', detail: 'Descent slowed to a comfortable purr' });
      }
    }
    if (this.chuteState === 'deployed' && (alt < 1.5 || pressure < 1e-9)) {
      this.chuteState = 'cut';
      this.chuteProgress = 0;
    }

    const tNext = this.time + h;
    // ---- SOI transition
    const newBody = dominantBody(this.pos, tNext);
    if (newBody !== this.currentBody) {
      this.events.push({ type: 'soi', title: `Entering ${newBody.name} SOI`, body: newBody.id, detail: `Switching navigation to ${newBody.name}` });
      this.currentBody = newBody;
      this.warpStopRequested = true;
    }

    // ---- ground contact (evaluated at the end of the step, when the body has rotated)
    const newRel = this.pos.clone().sub(this.currentBody.globalState(tNext).pos);
    const newUp = newRel.clone().normalize();
    const newFixed = globalToBodyFixedDir(this.currentBody, newUp, tNext);
    const newSurf = this.currentBody.surfaceRadiusAt(newFixed);
    const clearance = newRel.length() - newSurf - layout.comHeight;
    if (clearance <= 0.02) {
      this.handleImpact(this.currentBody, newFixed, layout, tNext);
    }
    this.time = tNext;
    this.met += h;
  }

  private handleImpact(body: Body, fixed: Vector3, layout: VesselLayout, atTime = this.time): void {
    const bs = body.globalState(atTime);
    const dir = bodyFixedToGlobalDir(body, fixed, atTime);
    const up = dir.clone();
    const surf = body.surfaceRadiusAt(fixed);
    this.pos.copy(bs.pos).addScaledVector(up, surf + layout.comHeight + 0.04);
    const vRel = surfaceRelativeVelocity(body, this.pos, this.vel, atTime);
    const vertical = vRel.dot(up);
    const horizontal = vRel.clone().addScaledVector(up, -vertical).length();
    const tilt = Math.acos(clamp(thrustAxis(this.quat).dot(up), -1, 1)) * (180 / Math.PI);
    const legs = this.activeParts.some((p) => PART[p.defId].kind === 'legs') && this.gearDeployed;
    const maxV = legs ? 13.0 : 4.0;
    const maxH = legs ? 6.0 : 2.0;
    const maxTilt = legs ? 30 : 12;
    const speed = vRel.length();
    this.lastImpactSpeed = speed;
    if (vertical < -maxV || horizontal > maxH || tilt > maxTilt) {
      this.crashed = true;
      this.events.push({ type: 'crashed', title: 'Rapid Unplanned Disassembly', detail: `Touchdown at ${speed.toFixed(1)} m/s. The cats are fine; the rocket is confetti.`, speed });
      this.vel.set(0, 0, 0);
      return;
    }
    const ll = latLonOf(body, this.pos, this.time);
    const zone = body.nearestLandingZone(fixed);
    const nearZone = zone ? zone : null;
    this.landed = true;
    this.landedInfo = {
      bodyId: body.id, unitFixed: fixed.clone(), lat: ll.lat, lon: ll.lon, time: this.met,
      speed, zone: nearZone?.name ?? null, returned: body.id === 'terra',
    };
    this.vel.copy(bs.vel);
    this.angVel.set(0, 0, 0);
    this.quat.copy(quatFromThrustUp(up, new Vector3().crossVectors(new Vector3(0, 1, 0), up).normalize()));
    this.chuteState = 'packed';
    this.chuteProgress = 0;
    this.events.push({
      type: 'landed', title: `Touchdown on ${body.name}`, body: body.id,
      detail: `${speed.toFixed(1)} m/s · ${ll.lat.toFixed(1)}° ${ll.lon.toFixed(1)}°${nearZone ? ' · ' + nearZone.name : ''}`,
      speed,
    });
  }

  private computeSasTarget(up: Vector3, vRel: Vector3, body: Body): Quaternion {
    const east = new Vector3().crossVectors(new Vector3(0, 1, 0), up).normalize();
    const mode = this.sasMode;
    if (mode === 'stability') {
      // Hold the orientation captured when SAS was enabled, gently.
      return this.lastSasTarget.clone();
    }
    if (mode === 'autopilot') {
      return this.sasTarget.clone();
    }
    const el = orbitalElements(this.pos.clone().sub(body.globalState(this.time).pos), vRel, body.mu);
    if (mode === 'prograde' && vRel.lengthSq() > 1) return quatFromThrustUp(vRel.clone().normalize(), up);
    if (mode === 'retrograde' && vRel.lengthSq() > 1) return quatFromThrustUp(vRel.clone().normalize().negate(), up);
    if (mode === 'radial+') return quatFromThrustUp(up, east);
    if (mode === 'radial-') return quatFromThrustUp(up.clone().negate(), east);
    if (mode === 'normal+') return quatFromThrustUp(el.hHat, east);
    if (mode === 'normal-') return quatFromThrustUp(el.hHat.clone().negate(), east);
    if (mode === 'target') return quatFromThrustUp(this.targetDirection(), up);
    if (mode === 'up') return quatFromThrustUp(up, east);
    return quatFromThrustUp(vRel.lengthSq() > 1 ? vRel.normalize() : up, up);
  }

  private attitudeAuthority(layout: VesselLayout, thrust: number): number {
    let authority = layout.torque + 20000;
    if (this.rcsEnabled && this._monoprop > 0) authority += 55000;
    if (thrust > 1) authority += thrust * Math.sin(7 * Math.PI / 180) * (layout.height * 0.5) * 0.22;
    return Math.max(authority, 60000);
  }

  private drainMonoprop(kg: number): void {
    let remaining = kg;
    const keys = [...this.monopropByPart.keys()];
    for (const k of keys) {
      if (remaining <= 0) break;
      const cur = this.monopropByPart.get(k) ?? 0;
      const take = Math.min(cur, remaining);
      this.monopropByPart.set(k, cur - take);
      remaining -= take;
    }
    this._monoprop = [...this.monopropByPart.values()].reduce((a, b) => a + b, 0);
  }

  private integrateQuat(h: number): void {
    const q = this.quat;
    const wx = this.angVel.x, wy = this.angVel.y, wz = this.angVel.z;
    const dq = new Quaternion(
      0.5 * (q.w * wx + q.y * wz - q.z * wy) * h,
      0.5 * (q.w * wy + q.z * wx - q.x * wz) * h,
      0.5 * (q.w * wz + q.x * wy - q.y * wx) * h,
      0.5 * (-q.x * wx - q.y * wy - q.z * wz) * h,
    );
    q.x += dq.x; q.y += dq.y; q.z += dq.z; q.w += dq.w;
    q.normalize();
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      d.age += dt;
      const body = BODY[d.bodyId as keyof typeof BODY] ?? this.currentBody;
      const bs = body.globalState(this.time);
      const rel = d.pos.clone().sub(bs.pos);
      const g = rel.clone().multiplyScalar(-body.mu / Math.pow(rel.length(), 3));
      d.vel.addScaledVector(g, dt);
      d.pos.addScaledVector(d.vel, dt);
      const q = new Quaternion(d.omega.x * dt, d.omega.y * dt, d.omega.z * dt, 0).multiply(d.quat);
      d.quat.x += q.x * 0.5; d.quat.y += q.y * 0.5; d.quat.z += q.z * 0.5; d.quat.w += q.w * 0.5;
      d.quat.normalize();
    }
    this.debris = this.debris.filter((d) => d.age < 45);
  }

  // Exposed for renderer effects.
  lastThrustForFx = 0;
  lastAirSpeed = 0;
  lastAlt = 0;
  lastPressure = 0;
  lastTorque = new Vector3();
  lastSasTorque = new Vector3();
  lastAngAccel = new Vector3();

  /** Directly set a target attitude for the flight computer. */
  setAttitudeTarget(q: Quaternion): void {
    this.sasTarget.copy(q);
    this.sasMode = 'autopilot';
    this.sasEnabled = true;
  }
}

function propagateSafe(r: Vector3, v: Vector3, mu: number, dt: number): { r: Vector3; v: Vector3 } {
  return propagate(r, v, mu, dt);
}
