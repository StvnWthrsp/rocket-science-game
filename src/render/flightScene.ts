import {
  BufferGeometry, Camera, CanvasTexture, Color, Float32BufferAttribute, Group, Matrix4, PerspectiveCamera, Points, PointsMaterial, Scene, Sprite,
  SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three';
import { BODY, LAUNCH_BODY, LAUNCH_LAT, LAUNCH_LON, surfacePoint } from '../game/bodies';
import type { Body } from '../game/bodies';
import type { Ship } from '../game/ship';
import { Ship as ShipClass } from '../game/ship';
import { PRESET_DESIGNS, newDesign } from '../game/parts';
import type { RocketDesign } from '../game/parts';
import { PlanetSystem } from './planet';
import { TerrainPatch } from './terrain';
import { SkyDome, skyForAltitude } from './sky';
import { RocketView, CatModel, makeLaunchPad, makeFlag, makePadGroundShadow } from './models';
import { Effects } from './effects';
import { glowUniforms } from './toon';

const Y = new Vector3(0, 1, 0);

export class FlightScene {
  scene = new Scene();
  camera = new PerspectiveCamera(52, 1, 0.35, 2e9);
  sky = new SkyDome();
  planets: PlanetSystem;
  terrain = new TerrainPatch(BODY.terra);
  rocket = new RocketView();
  effects = new Effects();
  pad = makeLaunchPad();
  cat = new CatModel({ helmet: false, wave: true, scale: 1.05 });
  ship: Ship | null = null;
  flag: Group | null = null;
  flagCat: CatModel | null = null;
  menuMode = false;
  cam = { yaw: 0.6, pitch: 0.22, distance: 62, targetDist: 62 };
  private clock = 0;
  private lastDesignRef: unknown = null;
  private lastStackCount = -1;
  private lastCrashed = false;
  private flagBody: Body | null = null;
  private shake = new Vector3();
  private padShadow = makePadGroundShadow(28);
  private stars: Points;

  constructor() {
    this.planets = new PlanetSystem([BODY.sol, BODY.terra, BODY.luna, BODY.mochi, BODY.rusty, BODY.verdant]);
    this.scene.add(this.planets.group);
    this.scene.add(this.terrain.group);
    this.scene.add(this.pad);
    this.scene.add(this.padShadow);
    this.padShadow.name = 'pad-shadow';
    this.scene.add(this.rocket.group);
    this.scene.add(this.cat.group);
    this.scene.add(this.effects.group);
    const starGeo = new BufferGeometry();
    const starPos: number[] = [];
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 1300; i++) {
      const z = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(1 - z * z);
      const radius = 6e6;
      starPos.push(rr * Math.cos(a) * radius, z * radius, rr * Math.sin(a) * radius);
    }
    starGeo.setAttribute('position', new Float32BufferAttribute(starPos, 3));
    this.stars = new Points(starGeo, new PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    this.camera.up.copy(Y);
  }

  setShip(ship: Ship, menuMode = false): void {
    this.ship = ship;
    this.menuMode = menuMode;
    this.rocket.rebuild(ship.design, ship.computeLayout());
    this.lastDesignRef = ship.design;
    this.lastStackCount = ship.design.stack.length;
    if (this.flag) this.scene.remove(this.flag);
    if (this.flagCat) this.scene.remove(this.flagCat.group);
    this.flag = null;
    this.flagCat = null;
    this.lastCrashed = false;
    this.terrain.setBody(ship.currentBody);
    this.cam.targetDist = this.menuMode ? 44 : 62;
    this.cam.distance = this.cam.targetDist;
    this.cam.yaw = this.menuMode ? -0.95 : 0.6;
    this.cam.pitch = this.menuMode ? 0.15 : 0.22;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  orbitInput(dx: number, dy: number): void {
    this.cam.yaw -= dx * 0.005;
    this.cam.pitch = Math.max(-1.25, Math.min(1.3, this.cam.pitch + dy * 0.004));
  }

  zoomInput(delta: number): void {
    this.cam.targetDist = Math.max(8, Math.min(1800, this.cam.targetDist * (delta > 0 ? 1.12 : 0.89)));
  }

  update(dt: number): void {
    this.clock += dt;
    const ship = this.ship;
    if (!ship) return;
    const t = ship.time;
    const body = ship.currentBody;
    const bs = body.globalState(t);
    const rel = ship.pos.clone().sub(bs.pos);
    const up = rel.clone().normalize();
    const altitude = rel.length() - body.radius;

    const sun = this.menuMode ? new Vector3(0.52, 0.66, 0.54).normalize() : BODY.sol.globalState(t).pos.clone().sub(ship.pos).normalize();
    glowUniforms.uSunDir.value.copy(sun);
    glowUniforms.uTime.value = this.clock;
    const sky = skyForAltitude(body, Math.max(0, altitude));
    if (this.menuMode) {
      sky.atmo = 1;
      sky.dusk = 0.32;
      sky.horizon = new Color(0xffc59a);
      sky.zenith = new Color(0x79b4e0);
    }
    this.sky.set({ ...sky, sunDir: sun, up, time: this.clock });
    this.stars.visible = sky.atmo < 0.18;
    this.sky.updateCamera(this.camera as unknown as { projectionMatrix: Matrix4; matrixWorld: Matrix4 });

    for (const v of this.planets.views.values()) {
      const bodyAlt = v.body.globalState(t).pos.distanceTo(ship.pos) - v.body.radius;
      v.update(ship.pos, sun, t, this.cam.distance, bodyAlt);
    }

    this.terrain.update(ship.pos, body, t, altitude);

    const padPoint = surfacePoint(BODY.terra, LAUNCH_LAT, LAUNCH_LON, 0, t);
    const padVisible = body.id === 'terra' && altitude < 20000 && ship.pos.distanceTo(padPoint) < 40000;
    this.pad.visible = padVisible;
    this.padShadow.visible = padVisible;
    if (padVisible) {
      const fixed = BODY.terra.surfaceDirection(LAUNCH_LAT, LAUNCH_LON, 0);
      const gdir = fixed.clone().applyAxisAngle(Y, BODY.terra.rotationAngle(t));
      const base = BODY.terra.globalState(t).pos.clone().addScaledVector(gdir, BODY.terra.surfaceRadiusAt(fixed) + 0.25);
      const east = new Vector3().crossVectors(Y, gdir).normalize();
      const north = new Vector3().crossVectors(gdir, east).normalize();
      const basis = new Matrix4().makeBasis(east, gdir, north.clone().negate());
      this.pad.position.copy(base).sub(ship.pos);
      this.pad.quaternion.setFromRotationMatrix(basis);
      this.padShadow.position.copy(base).sub(ship.pos).addScaledVector(gdir, 0.02);
      this.padShadow.quaternion.copy(this.pad.quaternion);
      const ce = this.menuMode ? 9 : 15;
      const cn = this.menuMode ? 14 : 18;
      const catPos = base.clone().addScaledVector(east, ce).addScaledVector(north, cn).addScaledVector(gdir, 0.6);
      this.cat.group.position.copy(catPos).sub(ship.pos);
      this.cat.group.scale.setScalar(this.menuMode ? 2.15 : 1.25);
      this.cat.group.quaternion.copy(this.pad.quaternion);
      this.cat.group.visible = true;
      this.cat.update(dt, this.clock);
    } else {
      this.cat.group.visible = false;
    }

    if (!this.flag && ship.landedInfo && (ship.landedInfo.bodyId === 'luna' || ship.landedInfo.bodyId === 'mochi')) {
      this.spawnFlag(ship);
    }
    if (this.flag && this.flagBody && ship.landedInfo) {
      const fb = this.flagBody;
      const li = ship.landedInfo;
      const gdir = li.unitFixed.clone().applyAxisAngle(Y, fb.rotationAngle(t));
      const base = fb.globalState(t).pos.clone().addScaledVector(gdir, fb.surfaceRadiusAt(li.unitFixed));
      const east = new Vector3().crossVectors(Y, gdir).normalize();
      const north = new Vector3().crossVectors(gdir, east).normalize();
      const basis = new Matrix4().makeBasis(east, gdir, north.clone().negate());
      this.flag.position.copy(base).sub(ship.pos).addScaledVector(east, 8).addScaledVector(north, 2);
      this.flag.quaternion.setFromRotationMatrix(basis);
      if (this.flagCat) {
        this.flagCat.group.position.copy(base).sub(ship.pos).addScaledVector(east, 10.5).addScaledVector(north, 3.2).addScaledVector(gdir, 0.05);
        this.flagCat.group.quaternion.setFromRotationMatrix(basis);
        this.flagCat.update(1 / 60, this.clock);
      }
    }

    if (this.lastDesignRef !== ship.design || this.lastStackCount !== ship.design.stack.length) {
      this.rocket.rebuild(ship.design, ship.computeLayout());
      this.lastDesignRef = ship.design;
      this.lastStackCount = ship.design.stack.length;
      this.effects.smoke(ship.pos.clone());
    }
    this.rocket.group.position.set(0, 0, 0);
    this.rocket.group.quaternion.copy(ship.quat);
    this.rocket.group.visible = !ship.crashed;
    this.rocket.updateVisuals({
      gearDeployed: ship.gearDeployed,
      chuteState: ship.chuteState,
      chuteProgress: ship.chuteProgress,
      throttle: ship.throttle,
      engineGlow: ship.lastThrustForFx > 1000 && ship.throttle > 0.01,
      t: this.clock,
    });
    this.effects.update(dt, ship, this.rocket.engineAnchorWorld(ship.quat), t);
    if (this.effects.shake > 0) {
      this.shake.set(
        (Math.random() - 0.5) * this.effects.shake,
        (Math.random() - 0.5) * this.effects.shake,
        (Math.random() - 0.5) * this.effects.shake,
      );
    } else this.shake.set(0, 0, 0);

    if (!this.lastCrashed && ship.crashed) {
      this.effects.explode(ship.pos.clone());
      this.lastCrashed = true;
    }

    this.cam.distance += (this.cam.targetDist - this.cam.distance) * Math.min(1, dt * 8);
    const east = new Vector3().crossVectors(Y, up).normalize();
    const north = new Vector3().crossVectors(up, east).normalize();
    const horiz = east.multiplyScalar(Math.sin(this.cam.yaw)).addScaledVector(north, Math.cos(this.cam.yaw));
    const cp = Math.cos(this.cam.pitch);
    const cameraPos = up.clone().multiplyScalar(Math.sin(this.cam.pitch) * this.cam.distance)
      .addScaledVector(horiz, cp * this.cam.distance)
      .add(this.shake);
    this.camera.position.copy(cameraPos);
    this.camera.up.copy(up);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  private spawnFlag(ship: Ship): void {
    const li = ship.landedInfo;
    if (!li) return;
    const body = BODY[li.bodyId as keyof typeof BODY];
    this.flagBody = body;
    this.flag = makeFlag(body.id === 'mochi' ? 'MOCHI' : 'LUNA');
    this.flag.scale.setScalar(0.85);
    this.scene.add(this.flag);
    this.flagCat = new CatModel({ helmet: true, wave: true, scale: 1.15, suit: 0xfff8e9 });
    this.flagCat.group.visible = true;
    this.scene.add(this.flagCat.group);
  }

  render(renderer: { render: (scene: Scene, camera: Camera) => void; autoClear: boolean; clear: () => void }): void {
    renderer.autoClear = false;
    renderer.clear();
    renderer.render(this.sky.scene, this.sky.camera);
    renderer.render(this.scene, this.camera);
  }
}

export function makePreviewShip(design?: RocketDesign): Ship {
  const preset = PRESET_DESIGNS[0];
  const ship = new ShipClass(design ?? newDesign(preset.name, preset.stack), 0);
  ship.init();
  return ship;
}

export function makeCatLabel(text: string): Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,251,240,0.92)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 56, 22);
  ctx.fill();
  ctx.fillStyle = '#3C2F2B';
  ctx.font = '800 34px "Baloo 2", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 43);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(8, 2, 1);
  return sprite;
}
