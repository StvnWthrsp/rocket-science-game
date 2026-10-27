import { Quaternion, Vector3 } from 'three';
import { BODY, Body, altitudeOf, dominantBody, globalToBodyFixedDir, latLonOf, surfaceRelativeVelocity } from './bodies';
import {
  G0, clamp, mod, orbitalElements, propagate, quatFromThrustUp, thrustAxis, wrapAngle,
} from './math';
import { PART } from './parts';
import type { Controls, Ship } from './ship';

export type AutoMode = 'off' | 'ascent' | 'transfer' | 'land' | 'return' | 'mission';
export type AutoPhase =
  | 'idle' | 'liftoff' | 'ascent' | 'coast' | 'circularize' | 'orbit'
  | 'transfer-wait' | 'plane-change' | 'transfer-burn' | 'transfer-coast'
  | 'capture' | 'descent-brake' | 'descent' | 'landed' | 'lunar-ascent' | 'lunar-ascent-burn' | 'lunar-coast' | 'lunar-circularize'
  | 'escape-burn' | 'return-cruise' | 'return-adjust' | 'reentry' | 'chute' | 'complete' | 'failed';

export interface AutoStatus {
  mode: AutoMode;
  phase: AutoPhase;
  label: string;
  detail: string;
  warp: number;
  progress: number;
}

const UP = new Vector3(0, 1, 0);

export class FlightComputer {
  mode: AutoMode = 'off';
  phase: AutoPhase = 'idle';
  targetBodyId = 'luna';
  warpRequest = 1;
  statusLabel = 'Standby';
  statusDetail = '';
  failure = '';
  timer = 0;
  burnStartDv = 0;
  lastStageCount = 0;
  private lastPhase = '';
  private log: string[] = [];
  private warpCeiling = 1000;
  private ascentTargetAlt = 85000;
  private lunaOrbitAlt = 30000;
  private transferTime = 0;
  private transferBurnDv = 0;
  private orbitHold = 0;
  private touchdownTimer = 0;
  private heading = new Vector3();
  private startTime = 0;
  private planeSign = 1;
  debugInfo: Record<string, number> = {};
  closestTarget = Infinity;
  closestAt = 0;
  descentDebug: Record<string, number> = {};

  engage(mode: AutoMode, ship: Ship, target = 'luna'): void {
    this.mode = mode;
    this.targetBodyId = target;
    this.failure = '';
    this.timer = 0;
    this.orbitHold = 0;
    this.touchdownTimer = 0;
    this.startTime = ship.met;
    this.lastStageCount = ship.stages.length;
    if (mode === 'ascent') this.phase = 'liftoff';
    else if (mode === 'transfer') {
      this.phase = ship.currentBody.id === this.targetBodyId ? 'capture' : 'transfer-wait';
    } else if (mode === 'land') {
      this.phase = ship.landed ? (ship.landedInfo?.bodyId === this.targetBodyId ? 'landed' : 'idle') : 'capture';
    } else if (mode === 'return') {
      if (ship.landed && ship.landedInfo?.bodyId !== 'terra') this.phase = 'lunar-ascent';
      else if (ship.currentBody.id === 'terra') this.phase = 'return-adjust';
      else this.phase = 'escape-burn';
    } else if (mode === 'mission') {
      if (ship.landed) this.phase = 'liftoff';
      else this.phase = 'orbit';
    }
    this.log.push('engage ' + mode + ' from ' + this.phase);
  }

  disengage(): void {
    this.mode = 'off';
    this.phase = 'idle';
    this.warpRequest = 1;
    this.statusLabel = 'Manual control';
    this.statusDetail = 'SAS and RCS are yours, captain.';
  }

  get active(): boolean {
    return this.mode !== 'off';
  }

  getStatus(): AutoStatus {
    const progress = 0;
    return {
      mode: this.mode, phase: this.phase, label: this.statusLabel, detail: this.statusDetail,
      warp: this.warpRequest, progress,
    };
  }

  update(ship: Ship, dt: number): Controls {
    const controls: Controls = {
      throttle: 0, pitch: 0, yaw: 0, roll: 0, translate: new Vector3(),
      stage: false, sas: true, sasMode: 'autopilot', rcs: ship.rcsEnabled, gear: ship.gearDeployed, chute: false,
    };
    if (this.mode === 'off') {
      controls.sasMode = ship.sasMode;
      controls.sas = ship.sasEnabled;
      controls.throttle = ship.throttle;
      controls.gear = ship.gearDeployed;
      controls.rcs = ship.rcsEnabled;
      return controls;
    }
    this.timer += dt;
    this.orbitHold += dt;
    this.warpRequest = 1;

    if (ship.crashed) this.fail('The ship was lost.');
    if (this.phase === 'complete' || this.phase === 'failed') {
      controls.throttle = 0;
      return controls;
    }

    const body = ship.currentBody;
    const bs = body.globalState(ship.time);
    const rel = ship.pos.clone().sub(bs.pos);
    const up = rel.clone().normalize();
    const fixed = globalToBodyFixedDir(body, up, ship.time);
    const alt = rel.length() - body.surfaceRadiusAt(fixed);
    const vRel = ship.bodyRelativeVelocity();
    const vSurface = surfaceRelativeVelocity(body, ship.pos, ship.vel, ship.time);
    const layout = ship.computeLayout();
    const tel = ship.telemetry();
    const speed = vRel.length();
    const east = new Vector3().crossVectors(UP, up).normalize();
    if (east.lengthSq() < 1e-8) east.set(0, 0, 1);
    const north = new Vector3().crossVectors(up, east).normalize();

    const setDir = (dir: Vector3) => {
      const d = dir.clone();
      if (d.lengthSq() < 1e-9) d.copy(up);
      ship.setAttitudeTarget(quatFromThrustUp(d.normalize(), east));
    };
    const aimError = (dir: Vector3): number => {
      const d = dir.clone();
      if (d.lengthSq() < 1e-9) return 0;
      return Math.acos(clamp(thrustAxis(ship.quat).dot(d.normalize()), -1, 1));
    };
    const burn = (dir: Vector3, throttle = 1): void => {
      setDir(dir);
      const err = aimError(dir);
      controls.throttle = err > 0.3 ? 0 : throttle * clamp(1 - err / 0.5, 0.05, 1);
    };
    const stageIfEmpty = () => {
      if (ship.stages.length > 1 && (ship.stageFuel(0) < Math.max(1, ship.stageFuelMax(0) * 0.004) || ship.activeEngines.length === 0)) {
        controls.stage = true;
      }
    };
    const prograde = speed > 1 ? vRel.clone().normalize() : east.clone();
    const retrograde = prograde.clone().negate();
    const tangential = new Vector3().crossVectors(orbitalElements(rel, vRel, body.mu).hHat, up).normalize();
    const circular = Math.sqrt(body.mu / Math.max(1, rel.length()));

    switch (this.phase) {
      case 'liftoff': {
        controls.gear = false;
        controls.throttle = 1;
        setDir(up);
        if (!ship.landed) {
          this.phase = 'ascent';
          this.statusLabel = 'Liftoff';
          this.statusDetail = 'Pitching east for orbit. Hold on to your whiskers.';
        } else if (this.timer > 1.5) {
          // The engine may need a moment to spool up, but if TWR is too low we cannot fly.
          if (tel.twr < 1.01 && this.timer > 5) this.fail('Not enough thrust to lift off.');
        }
        break;
      }
      case 'ascent': {
        controls.gear = false;
        controls.throttle = 1;
        stageIfEmpty();
        let pitch = 0;
        if (alt > 400) {
          const f = clamp((alt - 400) / 50000, 0, 1);
          pitch = 88 * Math.pow(f, 0.45);
        }
        const pr = pitch * Math.PI / 180;
        const dir = up.clone().multiplyScalar(Math.cos(pr)).addScaledVector(east, Math.sin(pr));
        setDir(dir);
        this.statusLabel = 'Ascent';
        this.statusDetail = `Pitch ${pitch.toFixed(0)}° · ${(alt / 1000).toFixed(0)} km · ${speed.toFixed(0)} m/s`;
        if (tel.apoapsis > 95000 && alt > 25000) {
          this.phase = 'coast';
          this.timer = 0;
        } else if (alt > 72000) {
          this.phase = 'coast';
          this.timer = 0;
        }
        break;
      }
      case 'coast': {
        controls.throttle = 0;
        controls.gear = false;
        setDir(prograde);
        this.warpRequest = tel.periapsis > 5000 && tel.timeToAp > 30 ? 100 : 1;
        this.statusLabel = 'Coasting to apoapsis';
        this.statusDetail = `Ap ${(tel.apoapsis / 1000).toFixed(0)} km · ${(tel.timeToAp / 60).toFixed(1)} min`;
        if (tel.timeToAp < 12 || tel.verticalSpeed < 4) {
          this.phase = 'circularize';
          this.timer = 0;
        }
        break;
      }
      case 'circularize': {
        controls.throttle = 1;
        controls.gear = false;
        stageIfEmpty();
        setDir(prograde);
        this.statusLabel = 'Circularizing';
        this.statusDetail = `Pe ${(tel.periapsis / 1000).toFixed(0)} km → 80 km`;
        if (tel.periapsis > 80000) {
          this.phase = 'orbit';
          this.timer = 0;
          controls.throttle = 0;
        }
        if (alt < 30000 && tel.verticalSpeed < -100) this.fail('Fell back into the atmosphere before reaching orbit.');
        break;
      }
      case 'orbit': {
        controls.throttle = 0;
        controls.gear = false;
        setDir(prograde);
        this.statusLabel = 'Stable orbit';
        this.statusDetail = `${(tel.periapsis / 1000).toFixed(0)} × ${(tel.apoapsis / 1000).toFixed(0)} km`;
        this.warpRequest = 1;
        if (this.mode === 'ascent') {
          this.phase = 'complete';
          this.statusLabel = 'Orbit achieved';
          this.statusDetail = 'Welcome to the club, kitten.';
        } else if (this.mode === 'mission' || this.mode === 'transfer') {
          this.phase = 'transfer-wait';
          this.orbitHold = 0;
          this.statusLabel = 'Waiting for transfer window';
          this.statusDetail = 'Luna is not quite in the right spot yet.';
        }
        break;
      }
      case 'transfer-wait': {
        controls.throttle = 0;
        controls.gear = false;
        setDir(prograde);
        const target = BODY[this.targetBodyId as keyof typeof BODY] ?? BODY.luna;
        if (target.parent !== body) {
          this.fail(target.name + ' is outside ' + body.name + '\'s SOI. Escape manually, then use a heliocentric transfer.');
          break;
        }
        const r1 = rel.length();
        const r2 = target.orbit?.a ?? r1 * 2;
        const at = (r1 + r2) / 2;
        const tt = Math.PI * Math.sqrt(Math.pow(at, 3) / body.mu);
        this.transferTime = tt;
        const n2 = Math.sqrt(body.mu / Math.pow(r2, 3));
        const phaseTarget = Math.PI - n2 * tt;
        const tpos = target.globalState(ship.time).pos.clone().sub(bs.pos);
        const hHat = orbitalElements(rel, vRel, body.mu).hHat;
        const currentPhase = Math.atan2(new Vector3().crossVectors(rel, tpos).dot(hHat), rel.dot(tpos));
        let diff = wrapAngle(currentPhase - phaseTarget);
        if (target.id === 'mochi') {
          const targetEl = orbitalElements(tpos, target.globalState(ship.time).vel.clone().sub(bs.vel), body.mu);
          const plane = Math.acos(clamp(hHat.dot(targetEl.hHat), -1, 1)) * 180 / Math.PI;
          if (plane > 1) {
            this.fail('Mochi is on a 6.2° tilted orbit. Match planes manually with Normal +/− SAS at the node, then use Fly to Target.');
            break;
          }
        }
        if (tel.periapsis < 70000) { this.phase = 'circularize'; break; }
        this.statusLabel = 'Waiting for transfer window';
        this.statusDetail = `${target.name} phase ${(diff * 180 / Math.PI).toFixed(1)}° · target ${(phaseTarget * 180 / Math.PI).toFixed(0)}° · ${(tt / 3600).toFixed(1)} h`;
        this.warpRequest = Math.abs(diff) < 0.06 ? 5 : (tel.altitude > 70000 ? 1000 : 5);
        this.debugInfo = { currentPhase: currentPhase * 180 / Math.PI, phaseTarget: phaseTarget * 180 / Math.PI, diff: diff * 180 / Math.PI, tt: tt / 3600, r1: r1 / 1000, r2: r2 / 1000 };
        if (Math.abs(diff) < 0.025) {
          this.phase = 'transfer-burn';
          this.transferBurnDv = 0;
          this.warpRequest = 1;
          this.timer = 0;
          this.statusLabel = 'Transfer burn';
          this.statusDetail = 'Luna, here we come.';
        }
        break;
      }
      case 'plane-change': {
        controls.throttle = 0;
        controls.gear = false;
        const target = BODY[this.targetBodyId as keyof typeof BODY] ?? BODY.mochi;
        const tp = target.globalState(ship.time).pos.clone().sub(bs.pos);
        const targetEl = orbitalElements(tp, target.globalState(ship.time).vel.clone().sub(bs.vel), body.mu);
        const hHat = orbitalElements(rel, vRel, body.mu).hHat;
        const plane = Math.acos(clamp(hHat.dot(targetEl.hHat), -1, 1)) * 180 / Math.PI;
        if (plane < 0.35) {
          this.phase = 'transfer-wait';
          this.warpRequest = 5;
          this.statusLabel = 'Plane aligned';
          this.statusDetail = 'Waiting for the transfer window';
          break;
        }
        const normal = hHat.clone().multiplyScalar(this.planeSign);
        burn(normal, 0.65);
        this.warpRequest = 1;
        this.statusLabel = 'Plane change burn';
        this.statusDetail = 'Inclination ' + plane.toFixed(2) + '° → 0°';
        break;
      }
      case 'transfer-burn': {
        controls.gear = false;
        stageIfEmpty();
        const target = BODY[this.targetBodyId as keyof typeof BODY] ?? BODY.luna;
        const r2 = (target.parent === body ? target.orbit?.a : 0) ?? 1.2e7;
        const targetApAlt = r2 - body.radius;
        burn(prograde, 1);
        this.statusLabel = target.id === 'mochi' ? 'Transfer burn' : 'Trans-lunar injection';
        this.statusDetail = `Ap ${(tel.apoapsis / 1000).toFixed(0)} → ${(targetApAlt / 1000).toFixed(0)} km`;
        if (tel.apoapsis >= targetApAlt - 40000 || (this.transferBurnDv > 0 && this.transferBurnDv > 2000)) {
          this.phase = 'transfer-coast';
          this.timer = 0;
          controls.throttle = 0;
          this.warpRequest = 1000;
        }
        if (ship.stages.length > 1 && ship.stageFuel(0) < 1 && ship.activeEngines.length === 0) {
          this.fail('Out of fuel during the transfer burn.');
        }
        break;
      }
      case 'transfer-coast': {
        controls.throttle = 0;
        controls.gear = false;
        setDir(prograde);
        this.warpRequest = 10000;
        const tgt = BODY[this.targetBodyId as keyof typeof BODY] ?? BODY.luna;
        const tdist = tgt.globalState(ship.time).pos.distanceTo(ship.pos);
        if (tdist < this.closestTarget) { this.closestTarget = tdist; this.closestAt = ship.met; }
        this.statusLabel = 'Cruising to ' + (tgt?.name ?? 'Luna');
        this.statusDetail = `MET ${(ship.met / 3600).toFixed(2)} h · range ${(tdist / 1000).toFixed(0)} km`;
        if (body.id === this.targetBodyId) {
          this.phase = 'capture';
          this.timer = 0;
          this.warpRequest = 10;
          this.statusLabel = 'Arrived at ' + body.name;
          this.statusDetail = 'Preparing a gentle capture.';
        } else if (this.timer > 6 * 86400) {
          this.fail('The transfer missed its target.');
        }
        break;
      }
      case 'capture': {
        controls.gear = true;
        controls.throttle = 0;
        this.warpRequest = 10;
        if (body.id !== this.targetBodyId) {
          // We are still in the parent SOI; keep coasting toward the target.
          this.phase = 'transfer-coast';
          break;
        }
        const near = alt < 260000 || tel.timeToPe < 80;
        if (!near) {
          setDir(prograde);
          this.warpRequest = 100;
          this.statusLabel = 'Approaching ' + body.name;
          this.statusDetail = `Pe ${(tel.periapsis / 1000).toFixed(0)} km · ${(tel.timeToPe / 60).toFixed(0)} min`;
          break;
        }
        // Match a circular velocity at the current radius. This kills the hyperbolic arrival
        // without needing a precisely targeted periapsis.
        const vDes = tangential.clone().multiplyScalar(circular);
        const dv = vDes.clone().sub(vRel);
        const maxA = ship.availableThrust() / Math.max(1, layout.mass);
        if (dv.length() > 12) {
          burn(dv, clamp(dv.length() / 80, 0.35, 1));
          this.statusLabel = 'Capture burn';
          this.statusDetail = `Δv ${dv.length().toFixed(0)} m/s · alt ${(alt / 1000).toFixed(0)} km`;
          this.warpRequest = 1;
          if (alt < 12000) {
            this.phase = 'descent-brake';
            this.timer = 0;
          }
          break;
        }
        // Good enough — start the powered descent.
        this.phase = 'descent-brake';
        this.timer = 0;
        this.warpRequest = 1;
        this.statusLabel = 'Powered descent';
        this.statusDetail = 'Feet first, claws out.';
        break;
      }
      case 'descent-brake': {
        controls.gear = true;
        controls.rcs = true;
        this.warpRequest = 1;
        const vUp = vSurface.dot(up);
        const vHoriz = vSurface.clone().addScaledVector(up, -vUp).length();
        if (vHoriz > 15 && alt > 2500) {
          burn(vSurface.clone().negate(), 1);
          this.statusLabel = 'Braking orbit';
          this.statusDetail = `Horizontal ${vHoriz.toFixed(0)} m/s → 15 m/s · alt ${(alt / 1000).toFixed(1)} km`;
        } else {
          this.phase = 'descent';
          this.timer = 0;
          this.statusLabel = 'Final descent';
          this.statusDetail = 'Feet first, claws out.';
        }
        break;
      }
      case 'descent': {
        controls.gear = true;
        controls.rcs = true;
        this.warpRequest = 1;
        const g = body.mu / (rel.length() * rel.length());
        const h = Math.max(0, alt);
        const clearanceForSpeed = Math.max(0, altitudeBelowClearance(ship, layout));
        let descentSpeed = clamp(Math.sqrt(2 * g * clearanceForSpeed) * 0.55, 0.8, 160);
        if (h < 300) descentSpeed = clamp(clearanceForSpeed * 0.055, 0.8, 16);
        if (h < 40) descentSpeed = clamp(clearanceForSpeed * 0.04, 0.6, 3);
        const vDesired = up.clone().multiplyScalar(-descentSpeed);
        const gain = h > 3000 ? 1.0 : h > 300 ? 1.8 : 2.8;
        const aErr = vDesired.clone().sub(vSurface).multiplyScalar(gain);
        const aDesired = aErr.addScaledVector(up, g);
        const thrustAvail = Math.max(1, ship.availableThrust());
        let throttle = clamp((aDesired.length() * layout.mass) / thrustAvail, 0, 1);
        if (-vSurface.dot(up) > descentSpeed + 4 && clearanceForSpeed < 4000) {
          throttle = Math.max(throttle, clamp((-vSurface.dot(up) - descentSpeed) / 25, 0.35, 1));
        }
        const clearance = altitudeBelowClearance(ship, layout);
        if (h < 0.8 && vRel.length() < 1.2) {
          controls.throttle = 0;
          controls.rcs = false;
          if (ship.landed) this.phase = 'landed';
        } else {
          setDir(aDesired);
          const err = aimError(aDesired);
          const alignment = clamp(1 - err / 0.6, 0, 1);
          controls.throttle = clearance < 0.45 && vSurface.length() < 2 ? 0 : throttle * alignment;
        }
        this.statusLabel = 'Powered descent';
        this.statusDetail = `Alt ${h < 1000 ? h.toFixed(0) + ' m' : (h / 1000).toFixed(1) + ' km'} · ↓${Math.max(0, -vSurface.dot(up)).toFixed(1)} m/s · ${(throttle * 100).toFixed(0)}%`;
        this.descentDebug = { alt: h, clearance, vUp: vSurface.dot(up), vHoriz: vSurface.clone().addScaledVector(up, -vSurface.dot(up)).length(), targetDown: descentSpeed, thr: controls.throttle, err: aimError(aDesired), aLen: aDesired.length(), fuel: ship.stageFuel(0) };
        if (ship.landed) {
          this.phase = 'landed';
          this.statusLabel = 'Touchdown on ' + body.name;
          this.statusDetail = `${body.name} · ${ship.landedInfo?.zone ?? 'Open terrain'}`;
        }
        if (ship.crashed) this.fail('Crash landing.');
        break;
      }
      case 'landed': {
        controls.throttle = 0;
        controls.gear = true;
        controls.rcs = false;
        this.warpRequest = 1;
        this.touchdownTimer += dt;
        this.statusLabel = 'Landed on ' + body.name;
        this.statusDetail = `${ship.landedInfo?.lat.toFixed(1)}° lat · ${ship.landedInfo?.lon.toFixed(1)}° lon · ${ship.landedInfo?.speed.toFixed(1)} m/s touchdown`;
        if (this.mode === 'mission' && this.touchdownTimer > 3) {
          if (body.id === 'luna' || body.id === 'mochi') {
            this.phase = 'lunar-ascent';
            this.touchdownTimer = 0;
            controls.gear = false;
            this.statusLabel = 'Returning to orbit';
            this.statusDetail = 'Planting a flag, then heading home.';
          } else if (body.id === 'terra') {
            this.phase = 'complete';
            this.statusLabel = 'Mission complete';
            this.statusDetail = 'Home safe. The cats demand snacks.';
          }
        }
        break;
      }
      case 'lunar-ascent': {
        controls.gear = false;
        controls.throttle = 1;
        setDir(alt < 1200 ? up : up.clone().multiplyScalar(0.35).addScaledVector(east, 0.94).normalize());
        if (!ship.landed) {
          this.phase = 'lunar-ascent-burn';
          this.timer = 0;
          this.statusLabel = 'Lunar liftoff';
          this.statusDetail = 'Low gravity, big hops.';
        } else if (this.timer > 2) {
          this.statusLabel = 'Spooling up';
          this.statusDetail = 'Waiting for enough thrust.';
        }
        break;
      }
      case 'lunar-ascent-burn': {
        controls.gear = false;
        controls.throttle = 1;
        stageIfEmpty();
        let pitch = 0;
        if (alt > 800) {
          const f = clamp((alt - 800) / 14000, 0, 1);
          pitch = 84 * Math.pow(f, 0.5);
        }
        const pr = pitch * Math.PI / 180;
        const dir = up.clone().multiplyScalar(Math.cos(pr)).addScaledVector(east, Math.sin(pr));
        setDir(dir);
        this.statusLabel = 'Lunar ascent';
        this.statusDetail = `Pitch ${pitch.toFixed(0)}° · ${(alt / 1000).toFixed(1)} km · Ap ${(tel.apoapsis / 1000).toFixed(0)} km`;
        if ((tel.apoapsis > 36000 && alt > 2200) || alt > 42000) {
          this.phase = 'lunar-coast';
          this.timer = 0;
          controls.throttle = 0;
        }
        break;
      }
      case 'lunar-coast': {
        controls.throttle = 0;
        setDir(prograde);
        this.warpRequest = 10;
        this.statusLabel = 'Lunar orbit insertion';
        this.statusDetail = `Ap ${(tel.apoapsis / 1000).toFixed(0)} km · Pe ${(tel.periapsis / 1000).toFixed(0)} km`;
        if (this.timer > 2 && (tel.timeToAp < 12 || tel.verticalSpeed < 0.5)) this.phase = 'lunar-circularize';
        break;
      }
      case 'lunar-circularize': {
        stageIfEmpty();
        burn(prograde, 1);
        this.statusLabel = 'Circularizing at Luna';
        this.statusDetail = `Pe ${(tel.periapsis / 1000).toFixed(0)} km → ${(this.lunaOrbitAlt / 1000).toFixed(0)} km`;
        if (tel.periapsis > 15000 || alt > 120000) {
          this.phase = 'escape-burn';
          this.timer = 0;
          controls.throttle = 0;
        }
        break;
      }
      case 'escape-burn': {
        controls.gear = false;
        burn(prograde, 1);
        this.warpRequest = 1;
        this.statusLabel = body.id === 'terra' ? 'Leaving Terra' : 'Trans-Earth injection';
        this.statusDetail = `Speed ${speed.toFixed(0)} m/s · apoapsis ${(tel.apoapsis / 1000).toFixed(0)} km`;
        if (body.id === 'luna' || body.id === 'mochi') {
          if (tel.apoapsis > body.soiRadius - body.radius + 50000) {
            this.phase = 'return-cruise';
            this.timer = 0;
            controls.throttle = 0;
            this.warpRequest = 100;
          }
        } else if (body.id === 'terra') {
          // We are already out of the moon's SOI; adjust the Earth periapsis.
          this.phase = 'return-adjust';
          this.timer = 0;
        }
        break;
      }
      case 'return-cruise': {
        controls.throttle = 0;
        setDir(prograde);
        this.warpRequest = 1000;
        this.statusLabel = 'Returning to Terra';
        this.statusDetail = `Leaving ${body.name} SOI · ${(tel.distanceToTarget / 1e6).toFixed(2)} Mm`;
        if (body.id === 'terra') {
          this.phase = 'return-adjust';
          this.timer = 0;
        }
        break;
      }
      case 'return-adjust': {
        controls.throttle = 0;
        setDir(retrograde);
        this.warpRequest = 10;
        this.statusLabel = 'Setting re-entry periapsis';
        this.statusDetail = `Pe ${(tel.periapsis / 1000).toFixed(0)} km`;
        if (body.id === 'terra') {
          if (tel.periapsis > 45000) {
            burn(retrograde, 1);
            this.warpRequest = 1;
          } else {
            this.warpRequest = 100;
          }
          if (tel.altitude < 90000 && tel.verticalSpeed < 0 && tel.periapsis < 60000) {
            this.phase = 'reentry';
            this.timer = 0;
            controls.throttle = 0;
            this.warpRequest = 1;
          }
        } else {
          this.phase = 'escape-burn';
        }
        break;
      }
      case 'reentry': {
        controls.throttle = 0;
        controls.gear = true;
        if (tel.periapsis > 65000 && alt > 90000 && ship.stageFuel(0) > 2) {
          burn(retrograde, 1);
          this.warpRequest = 1;
          this.statusLabel = 'Re-entry trim';
          this.statusDetail = 'Lowering periapsis to the atmosphere';
          break;
        }
        setDir(retrograde);
        this.statusLabel = 'Re-entry';
        this.statusDetail = `Alt ${(tel.altitude / 1000).toFixed(1)} km · ${speed.toFixed(0)} m/s`;
        this.warpRequest = tel.altitude > 250000 ? 10 : 1;
        if (tel.altitude < 12000 && ship.chuteState === 'packed') {
          controls.chute = true;
          this.phase = 'chute';
          this.timer = 0;
        }
        if (tel.altitude < 100) this.phase = 'chute';
        break;
      }
      case 'chute': {
        controls.throttle = 0;
        controls.gear = true;
        if (ship.chuteState === 'packed') controls.chute = true;
        if (alt < 6000) setDir(up); else setDir(retrograde);
        this.warpRequest = 1;
        this.statusLabel = 'Parachute descent';
        this.statusDetail = `Alt ${(tel.altitude / 1000).toFixed(2)} km · ↓${Math.max(0, -tel.verticalSpeed).toFixed(1)} m/s`;
        if (ship.landed) {
          this.phase = body.id === 'terra' ? 'complete' : 'landed';
          this.statusLabel = body.id === 'terra' ? 'Welcome home' : 'Touchdown';
          this.statusDetail = body.id === 'terra' ? 'Mission complete. Snacks for everyone.' : '';
        }
        break;
      }
      case 'idle':
      default: {
        controls.throttle = 0;
        break;
      }
    }

    // Any transition into 'ascent' from lunar liftoff uses the generic ascent state.
    if (this.phase === 'ascent' && this.statusLabel === 'Lunar liftoff') {
      // handled next tick
    }
    if (this.phase === 'complete') {
      this.warpRequest = 1;
      controls.throttle = 0;
    }
    this.lastPhase = this.phase;
    return controls;
  }

  private fail(reason: string): void {
    this.phase = 'failed';
    this.failure = reason;
    this.statusLabel = 'Flight computer aborted';
    this.statusDetail = reason;
    this.warpRequest = 1;
  }

  /** For tests and telemetry. */
  get history(): string[] {
    return this.log;
  }
}

function altitudeBelowClearance(ship: Ship, layout: { comHeight: number }): number {
  const rel = ship.pos.clone().sub(ship.currentBody.globalState(ship.time).pos);
  const fixed = globalToBodyFixedDir(ship.currentBody, rel.clone().normalize(), ship.time);
  return rel.length() - ship.currentBody.surfaceRadiusAt(fixed) - layout.comHeight;
}

// A tiny re-export to keep the autopilot's plane-change math discoverable.
export function nextNodeAngle(rel: Vector3, vRel: Vector3, body: Body): number {
  const el = orbitalElements(rel, vRel, body.mu);
  return mod(el.trueAnomaly, Math.PI * 2);
}
