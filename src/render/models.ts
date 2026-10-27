import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, IcosahedronGeometry,
  LatheGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, Shape, SphereGeometry,
  TorusGeometry, TubeGeometry, Vector2, Vector3, AdditiveBlending, CanvasTexture,
  RepeatWrapping, SRGBColorSpace,
} from 'three';
import type { Side } from 'three';
import type { PartDef, RocketDesign } from '../game/parts';
import type { VesselLayout } from '../game/ship';
import type { Ship } from '../game/ship';
import { createToonMaterial, addOutline, PALETTE, makeDecalTexture, makeGlowTexture } from './toon';

const V = Vector3;
const Y = new V(0, 1, 0);

function toonMesh(geo: BufferGeometry, color: number, opts: { shade?: number; rim?: number; spec?: number; outline?: boolean; opacity?: number; transparent?: boolean; side?: number; emissive?: number } = {}): Mesh {
  const mat = createToonMaterial({
    color,
    shade: opts.shade ?? new Color(color).lerp(new Color(0xb9aecb), 0.32).getHex(),
    rim: opts.rim ?? 0.22,
    spec: opts.spec ?? 0,
    opacity: opts.opacity ?? 1,
    transparent: opts.transparent ?? false,
    side: opts.side as Side | undefined,
    emissive: opts.emissive ?? 0,
  });
  const mesh = new Mesh(geo, mat);
  if (opts.outline !== false) addOutline(mesh, 1.009);
  return mesh;
}

function ring(radius: number, tube: number, color: number, y = 0, seg = 28): Mesh {
  const m = toonMesh(new TorusGeometry(radius, tube, 8, seg), color, { rim: 0.18 });
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  return m;
}

function band(radius: number, height: number, color: number, y = 0): Mesh {
  return toonMesh(new CylinderGeometry(radius, radius, height, 28, 1, true), color, { outline: false });
}

function decal(text: string, radius: number, y: number, color = '#FF806A', scale = 1): Mesh {
  const tex = makeDecalTexture(text, color);
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide });
  const m = new Mesh(new PlaneGeometry(radius * 1.6 * scale, radius * 0.8 * scale), mat);
  m.position.set(0, y, radius + 0.012);
  m.renderOrder = 2;
  return m;
}

function roundProfile(r: number, h: number): Vector2[] {
  const p: Vector2[] = [];
  const n = 12;
  const cap = Math.min(r * 0.42, h * 0.16);
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    p.push(new Vector2(r + Math.cos(a) * 0.001, -h / 2 + cap + Math.sin(a) * cap));
  }
  p.push(new Vector2(r, -h / 2 + cap));
  p.push(new Vector2(r, h / 2 - cap));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    p.push(new Vector2(r * Math.cos(a) + r * 0.0, h / 2 - cap + Math.sin(a) * cap));
  }
  return p;
}

function checkerTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  const cols = 8, rows = 2;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#2F2830' : '#FFF2D2';
      ctx.fillRect((x / cols) * c.width, (y / rows) * c.height, c.width / cols + 1, c.height / rows + 1);
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

function makeTank(def: PartDef): Group {
  const g = new Group();
  const r = def.radius;
  const h = def.height;
  const body = toonMesh(new LatheGeometry(roundProfile(r, h), 32), PALETTE.cream, { rim: 0.25 });
  g.add(body);
  // Coral bands and mint pinstripes.
  g.add(band(r + 0.012, h * 0.09, PALETTE.coral, h * 0.27));
  g.add(band(r + 0.012, h * 0.035, PALETTE.teal, h * 0.22));
  g.add(band(r + 0.012, h * 0.05, PALETTE.mint, -h * 0.33));
  g.add(ring(r + 0.01, 0.045, PALETTE.orange, -h / 2 + 0.18));
  if (r > 1.5) {
    const checker = new Mesh(
      new CylinderGeometry(r + 0.008, r + 0.008, 0.9, 32, 1, true),
      new MeshBasicMaterial({ map: checkerTexture(), side: DoubleSide }),
    );
    checker.position.y = h * 0.18;
    g.add(checker);
    g.add(band(r + 0.011, h * 0.06, 0xffcf6a, -h * 0.42));
  }
  if (r > 1) {
    g.add(decal('MEOW', r, 0.15, '#FF806A', 1));
    // A few riveted panel lines.
    for (let i = 0; i < 3; i++) {
      const line = toonMesh(new TorusGeometry(r + 0.008, 0.012, 5, 32), PALETTE.metalDark, { outline: false });
      line.rotation.x = Math.PI / 2;
      line.position.y = -h / 2 + (h / 3) * (i + 1);
      g.add(line);
    }
  } else {
    g.add(decal('PAW', r, 0.1, '#54C8C2', 0.9));
  }
  return g;
}

function makeEngine(def: PartDef): Group {
  const g = new Group();
  const r = def.radius;
  const h = def.height;
  const metal = PALETTE.metal;
  const dark = PALETTE.metalDark;
  // Bell profile, flared at the bottom.
  const pts: Vector2[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -h / 2 + t * h * 0.72;
    const rr = r * (0.72 - 0.42 * Math.pow(1 - t, 2.3));
    pts.push(new Vector2(rr, y));
  }
  pts.push(new Vector2(r * 0.38, h / 2 - 0.15));
  pts.push(new Vector2(r * 0.48, h / 2));
  const bell = toonMesh(new LatheGeometry(pts, 28), metal, { rim: 0.4, spec: 0.45 });
  g.add(bell);
  const inner = toonMesh(new ConeGeometry(r * 0.66, h * 0.55, 24, 1, true), 0x3d3a48, { outline: false });
  inner.position.y = -h * 0.18;
  g.add(inner);
  // Exit lip and gimbal ring.
  g.add(ring(r * 0.7, 0.055, PALETTE.coral, -h / 2 + 0.05));
  g.add(ring(r * 0.42, 0.07, PALETTE.metalDark, h / 2 - 0.1));
  // Turbopump and pipes.
  const pump = toonMesh(new SphereGeometry(r * 0.18, 12, 8), PALETTE.coral, { rim: 0.3, spec: 0.2 });
  pump.position.set(r * 0.3, h * 0.32, r * 0.05);
  g.add(pump);
  const pipeCurve = new CatmullRomCurve3([
    new V(r * 0.3, h * 0.25, 0.02), new V(r * 0.38, h * 0.05, 0.1), new V(r * 0.58, -h * 0.16, 0.1), new V(r * 0.55, -h * 0.32, 0.02),
  ]);
  g.add(toonMesh(new TubeGeometry(pipeCurve, 10, 0.035, 5, false), PALETTE.metalDark, { outline: false }));
  // Accent stripe around the upper bell.
  g.add(band(r * 0.48, 0.09, PALETTE.orange, h * 0.18));
  if (def.id === 'engine_l') {
    for (const side of [-1, 1]) {
      const pts2: Vector2[] = [];
      const rr = r * 0.42;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts2.push(new Vector2(rr * (0.75 - 0.42 * Math.pow(1 - t, 2.2)), -h * 0.42 + t * h * 0.7));
      }
      const mini = toonMesh(new LatheGeometry(pts2, 18), PALETTE.metal, { rim: 0.3, spec: 0.4 });
      mini.position.set(side * r * 0.52, -h * 0.08, 0);
      g.add(mini);
      const glowRing = toonMesh(new TorusGeometry(rr * 0.72, 0.025, 4, 16), PALETTE.coral, { outline: false });
      glowRing.rotation.x = Math.PI / 2;
      glowRing.position.set(side * r * 0.52, -h * 0.46, 0);
      g.add(glowRing);
    }
  }
  return g;
}

function makePod(def: PartDef, crew = 1): Group {
  const g = new Group();
  const r = def.radius;
  const h = def.height;
  const body = toonMesh(new LatheGeometry(roundProfile(r, h), 32), 0xfff7e8, { rim: 0.3 });
  g.add(body);
  // Cat ears on the capsule.
  for (const side of [-1, 1]) {
    const ear = toonMesh(new ConeGeometry(r * 0.26, r * 0.5, 4), PALETTE.coral, { rim: 0.22 });
    ear.position.set(side * r * 0.45, h * 0.53, 0);
    ear.rotation.z = side * -0.18;
    ear.rotation.y = Math.PI / 4;
    g.add(ear);
    const inner = toonMesh(new ConeGeometry(r * 0.15, r * 0.3, 3), 0xffc2b5, { outline: false });
    inner.position.set(side * r * 0.45, h * 0.55, r * 0.06);
    inner.rotation.z = side * -0.18;
    inner.rotation.y = Math.PI / 4;
    g.add(inner);
  }
  // Big round observation window with a cat inside.
  const windowGroup = new Group();
  const frame = toonMesh(new TorusGeometry(r * 0.42, r * 0.06, 8, 28), PALETTE.teal, { rim: 0.25 });
  frame.position.set(0, h * 0.05, r * 0.92);
  windowGroup.add(frame);
  const glass = toonMesh(new CircleGeometry(r * 0.42, 32), PALETTE.glass, { transparent: true, opacity: 0.42, outline: false, rim: 0.6, side: DoubleSide });
  glass.position.set(0, h * 0.05, r * 0.97);
  windowGroup.add(glass);
  const cat = makeCatHead(0.72);
  cat.position.set(0, h * 0.02, r * 0.95);
  cat.scale.setScalar(r * 0.55);
  windowGroup.add(cat);
  g.add(windowGroup);
  // Hull details.
  g.add(band(r + 0.012, 0.09, PALETTE.coral, -h * 0.34));
  g.add(ring(r * 0.93, 0.03, PALETTE.orange, -h * 0.4));
  const hatch = toonMesh(new CircleGeometry(r * 0.18, 16), PALETTE.mint, { outline: false });
  hatch.position.set(-r * 0.62, -h * 0.06, r * 0.62);
  hatch.rotation.y = -0.75;
  g.add(hatch);
  const antenna = toonMesh(new CylinderGeometry(0.018, 0.018, r * 0.5, 5), PALETTE.metalDark, { outline: false });
  antenna.position.set(r * 0.2, h * 0.7, 0);
  g.add(antenna);
  const antennaTip = toonMesh(new SphereGeometry(r * 0.045, 8, 6), PALETTE.coral, { outline: false });
  antennaTip.position.set(r * 0.2, h * 0.95, 0);
  g.add(antennaTip);
  if (crew > 1) {
    const hatch2 = toonMesh(new CircleGeometry(r * 0.16, 16), PALETTE.mint, { outline: false });
    hatch2.position.set(r * 0.62, -h * 0.06, r * 0.62);
    hatch2.rotation.y = 0.75;
    g.add(hatch2);
  }
  return g;
}

function makeCatHead(s = 1): Group {
  const g = new Group();
  const fur = 0xf2a25c;
  const cream = 0xfff2d8;
  const dark = 0x6a4437;
  const head = toonMesh(new SphereGeometry(0.34, 20, 16), fur, { rim: 0.2 });
  head.scale.set(1.05, 0.98, 0.92);
  g.add(head);
  // Ears.
  for (const side of [-1, 1]) {
    const ear = toonMesh(new ConeGeometry(0.14, 0.25, 4), fur, { rim: 0.2 });
    ear.position.set(side * 0.21, 0.28, 0);
    ear.rotation.z = side * -0.25;
    ear.rotation.y = Math.PI / 4;
    g.add(ear);
    const inner = toonMesh(new ConeGeometry(0.075, 0.15, 3), 0xffb6b0, { outline: false });
    inner.position.set(side * 0.21, 0.29, 0.03);
    inner.rotation.z = side * -0.25;
    inner.rotation.y = Math.PI / 4;
    g.add(inner);
  }
  // Muzzle and nose.
  for (const side of [-1, 1]) {
    const cheek = toonMesh(new SphereGeometry(0.12, 12, 10), cream, { outline: false });
    cheek.position.set(side * 0.075, -0.075, 0.29);
    cheek.scale.set(1, 0.8, 0.7);
    g.add(cheek);
  }
  const nose = toonMesh(new ConeGeometry(0.035, 0.055, 5), 0xff8f9a, { outline: false });
  nose.position.set(0, -0.02, 0.36);
  nose.rotation.x = Math.PI / 2;
  g.add(nose);
  // Eyes, with toon highlights.
  for (const side of [-1, 1]) {
    const eye = toonMesh(new SphereGeometry(0.075, 14, 12), 0x2a2836, { outline: false });
    eye.position.set(side * 0.14, 0.075, 0.285);
    eye.scale.set(0.82, 1.15, 0.55);
    g.add(eye);
    const shine = new Mesh(new SphereGeometry(0.022, 8, 6), new MeshBasicMaterial({ color: 0xffffff }));
    shine.position.set(side * 0.115, 0.11, 0.355);
    g.add(shine);
  }
  // Stripes on the forehead.
  for (let i = 0; i < 3; i++) {
    const stripe = toonMesh(new SphereGeometry(0.05, 8, 6), 0xc97738, { outline: false });
    stripe.position.set((i - 1) * 0.085, 0.25, 0.24);
    stripe.scale.set(0.55, 1.7, 0.3);
    g.add(stripe);
  }
  // Whiskers.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const w = toonMesh(new CylinderGeometry(0.005, 0.003, 0.2, 3), dark, { outline: false });
      w.position.set(side * 0.17, -0.06 + i * 0.03, 0.31);
      w.rotation.z = Math.PI / 2 + side * (0.15 + i * 0.08);
      g.add(w);
    }
  }
  const smile = toonMesh(new TorusGeometry(0.045, 0.006, 4, 10, Math.PI), dark, { outline: false });
  smile.position.set(0, -0.12, 0.325);
  smile.rotation.z = Math.PI;
  g.add(smile);
  // Blush.
  for (const side of [-1, 1]) {
    const b = new Mesh(new CircleGeometry(0.045, 12), new MeshBasicMaterial({ color: 0xffa6a6, transparent: true, opacity: 0.6 }));
    b.position.set(side * 0.23, -0.06, 0.255);
    b.rotation.y = side * 0.2;
    g.add(b);
  }
  g.scale.setScalar(s);
  return g;
}

export interface CatOptions {
  fur?: number;
  suit?: number;
  helmet?: boolean;
  scale?: number;
  wave?: boolean;
}

export class CatModel {
  group = new Group();
  private armR = new Group();
  private armL = new Group();
  private tail = new Group();
  private eyes: Mesh[] = [];
  private earL = new Group();
  private earR = new Group();
  private blink = 0;
  private t = 0;
  wave: boolean;
  private baseY = 0;

  constructor(opts: CatOptions = {}) {
    this.wave = opts.wave ?? false;
    const fur = opts.fur ?? 0xf2a25c;
    const suit = opts.suit ?? 0xfff8e9;
    const coral = PALETTE.coral;
    const cream = 0xfff2d8;
    const g = this.group;

    // Legs and boots.
    for (const side of [-1, 1]) {
      const leg = toonMesh(new CylinderGeometry(0.095, 0.11, 0.36, 10), suit, { rim: 0.2 });
      leg.position.set(side * 0.13, 0.27, 0);
      g.add(leg);
      const boot = toonMesh(new SphereGeometry(0.135, 12, 10), coral, { rim: 0.2 });
      boot.position.set(side * 0.13, 0.11, 0.035);
      boot.scale.set(1, 0.7, 1.25);
      g.add(boot);
      const sole = toonMesh(new BoxGeometry(0.22, 0.045, 0.28), 0x4b3d4a, { outline: false });
      sole.position.set(side * 0.13, 0.055, 0.04);
      g.add(sole);
    }
    // Torso.
    const torso = toonMesh(new SphereGeometry(0.27, 20, 16), suit, { rim: 0.22 });
    torso.position.set(0, 0.68, 0);
    torso.scale.set(0.95, 1.22, 0.8);
    g.add(torso);
    const belly = toonMesh(new SphereGeometry(0.17, 16, 12), suit, { outline: false });
    belly.position.set(0, 0.58, 0.16);
    belly.scale.set(1, 1.15, 0.5);
    g.add(belly);
    const chest = toonMesh(new BoxGeometry(0.22, 0.1, 0.03), coral, { outline: false });
    chest.position.set(0, 0.78, 0.225);
    g.add(chest);
    const patch = new Mesh(new CircleGeometry(0.045, 12), new MeshBasicMaterial({ color: PALETTE.yellow }));
    patch.position.set(0.1, 0.72, 0.23);
    g.add(patch);
    // Collar.
    const collar = ring(0.2, 0.035, coral, 0.94);
    g.add(collar);
    // Backpack.
    const pack = toonMesh(new BoxGeometry(0.34, 0.38, 0.16), 0xe8ddc5, { rim: 0.2 });
    pack.position.set(0, 0.7, -0.24);
    g.add(pack);
    for (const side of [-1, 1]) {
      const tank = toonMesh(new CylinderGeometry(0.06, 0.06, 0.3, 8), PALETTE.teal, { outline: false });
      tank.position.set(side * 0.1, 0.7, -0.35);
      g.add(tank);
    }
    // Head (big!).
    const head = makeCatHead(1.0);
    head.position.set(0, 1.16, 0);
    head.scale.setScalar(1.45);
    g.add(head);
    // Keep references to eyes for blinking.
    head.traverse((o) => {
      if (o instanceof Mesh && o.geometry instanceof SphereGeometry && (o.material as MeshBasicMaterial).color?.getHex() === 0x2a2836) {
        this.eyes.push(o);
      }
    });
    // Helmet.
    if (opts.helmet) {
      const helmet = toonMesh(new SphereGeometry(0.55, 28, 20), 0xc9f4ff, { transparent: true, opacity: 0.22, rim: 0.8, outline: false, spec: 0.6, side: DoubleSide });
      helmet.position.set(0, 1.2, 0);
      g.add(helmet);
      const rim = ring(0.38, 0.04, coral, 0.9);
      g.add(rim);
      const helmetTop = toonMesh(new SphereGeometry(0.56, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), 0xffffff, { transparent: true, opacity: 0.12, outline: false, side: DoubleSide });
      helmetTop.position.set(0, 1.2, 0);
      g.add(helmetTop);
    }
    // Arms.
    this.armL.position.set(-0.28, 0.84, 0);
    this.armR.position.set(0.28, 0.84, 0);
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as [Group, number][]) {
      const upper = toonMesh(new CylinderGeometry(0.065, 0.075, 0.3, 10), suit, { rim: 0.2 });
      upper.position.set(0, -0.13, 0);
      arm.add(upper);
      const paw = toonMesh(new SphereGeometry(0.11, 12, 10), fur, { rim: 0.2 });
      paw.position.set(0, -0.31, 0.03);
      arm.add(paw);
      arm.rotation.z = side * 0.18;
      g.add(arm);
    }
    // Tail.
    const curve = new CatmullRomCurve3([
      new V(0, 0.52, -0.18), new V(0.12, 0.42, -0.45), new V(-0.08, 0.6, -0.68), new V(0.12, 0.8, -0.82),
    ]);
    const tailMesh = toonMesh(new TubeGeometry(curve, 18, 0.055, 6, false), fur, { rim: 0.2 });
    this.tail.add(tailMesh);
    const tip = toonMesh(new SphereGeometry(0.075, 8, 6), cream, { outline: false });
    tip.position.set(0.12, 0.8, -0.82);
    this.tail.add(tip);
    g.add(this.tail);
    // Scale and ground clearance.
    g.scale.setScalar(opts.scale ?? 1);
    this.baseY = 0;
    g.position.y = this.baseY;
    this.earL.visible = false;
    this.earR.visible = false;
  }

  update(dt: number, time: number): void {
    this.t += dt;
    const t = time;
    this.group.position.y = this.baseY + Math.sin(t * 2.1) * 0.008;
    this.group.rotation.y = Math.sin(t * 0.6) * 0.03;
    this.tail.rotation.y = Math.sin(t * 1.6) * 0.22;
    this.tail.rotation.x = Math.sin(t * 1.2) * 0.1;
    if (this.wave) {
      this.armR.rotation.z = 0.18 + Math.sin(t * 6.5) * 0.9;
      this.armR.rotation.x = Math.sin(t * 6.5) * 0.25;
    }
    this.armL.rotation.x = Math.sin(t * 1.9) * 0.06;
    // Blink roughly every 4 seconds.
    this.blink += dt;
    const blink = this.blink % 4.3 > 4.12;
    for (const e of this.eyes) e.scale.y = blink ? 0.18 : 1.15;
  }
}

function makeChute(def: PartDef): { group: Group; canopy: Group } {
  const g = new Group();
  const r = def.radius;
  const pack = toonMesh(new CylinderGeometry(r * 0.75, r * 0.85, def.height * 0.8, 16), PALETTE.coral, { rim: 0.25 });
  g.add(pack);
  const cap = toonMesh(new ConeGeometry(r * 0.7, def.height * 0.6, 16), PALETTE.cream, { rim: 0.2 });
  cap.position.y = def.height * 0.55;
  g.add(cap);
  g.add(ring(r * 0.8, 0.03, PALETTE.yellow, 0));
  const canopy = new Group();
  canopy.position.y = 7.5;
  const profile: Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    profile.push(new Vector2(Math.sin(a) * 3.3, Math.cos(a) * 1.8));
  }
  const dome = toonMesh(new LatheGeometry(profile, 24), 0xffb0a0, { rim: 0.35 });
  canopy.add(dome);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const gore = toonMesh(new SphereGeometry(0.16, 6, 5), PALETTE.cream, { outline: false });
    gore.position.set(Math.cos(a) * 3.2, 0.2, Math.sin(a) * 3.2);
    gore.scale.set(1, 1, 0.2);
    canopy.add(gore);
  }
  // Suspension lines.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const top = new V(Math.cos(a) * 2.9, 0.2, Math.sin(a) * 2.9);
    const bottom = new V(Math.cos(a) * r * 0.5, -7.2, Math.sin(a) * r * 0.5);
    const curve = new CatmullRomCurve3([top, new V(top.x * 0.7, -3.4, top.z * 0.7), bottom]);
    const tube = new Mesh(new TubeGeometry(curve, 6, 0.012, 3, false), new MeshBasicMaterial({ color: 0xefe1c9 }));
    canopy.add(tube);
  }
  canopy.scale.setScalar(0.01);
  canopy.visible = false;
  g.add(canopy);
  return { group: g, canopy };
}

function makePart(def: PartDef): { group: Group; canopy?: Group; legPivots: Group[] } {
  if (def.kind === 'tank') return { group: makeTank(def), legPivots: [] };
  if (def.kind === 'engine' || def.kind === 'srb') {
    const g = makeEngine(def);
    if (def.kind === 'srb') {
      const tank = makeTank({ ...def, kind: 'tank', height: def.height * 0.72 });
      tank.position.y = -def.height * 0.12;
      g.add(tank);
    }
    return { group: g, legPivots: [] };
  }
  if (def.kind === 'pod') return { group: makePod(def, def.crew), legPivots: [] };
  if (def.kind === 'chute') {
    const c = makeChute(def);
    return { group: c.group, canopy: c.canopy, legPivots: [] };
  }
  if (def.kind === 'fins') {
    const g = new Group();
    const rr = 1.75;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const shape = new Shape();
      shape.moveTo(0, 0);
      shape.lineTo(rr * 1.05, -0.55);
      shape.lineTo(rr * 1.35, -0.3);
      shape.lineTo(rr * 0.55, 0.55);
      shape.lineTo(0, 0.65);
      const geo = new ExtrudeGeometry(shape, { depth: 0.075, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
      const fin = toonMesh(geo, i % 2 === 0 ? PALETTE.coral : PALETTE.teal, { rim: 0.25 });
      fin.rotation.y = Math.PI / 2;
      fin.position.set(Math.cos(a) * rr * 0.62, 0, Math.sin(a) * rr * 0.62);
      fin.rotation.z = a;
      g.add(fin);
    }
    return { group: g, legPivots: [] };
  }
  if (def.kind === 'legs') {
    const g = new Group();
    const pivots: Group[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pivot = new Group();
      pivot.position.set(Math.cos(a) * 1.5, 0.1, Math.sin(a) * 1.5);
      pivot.rotation.y = -a;
      const strut = toonMesh(new CylinderGeometry(0.07, 0.09, 1.55, 8), PALETTE.metal, { rim: 0.2 });
      strut.position.set(0, -0.7, 0.3);
      strut.rotation.x = -0.45;
      pivot.add(strut);
      const foot = toonMesh(new CylinderGeometry(0.36, 0.3, 0.12, 12), PALETTE.coral, { rim: 0.25 });
      foot.position.set(0, -1.42, 0.73);
      pivot.add(foot);
      const pad = toonMesh(new SphereGeometry(0.24, 10, 8), 0x4b3d4a, { outline: false });
      pad.position.set(0, -1.5, 0.73);
      pad.scale.set(1, 0.3, 1);
      pivot.add(pad);
      pivots.push(pivot);
      g.add(pivot);
    }
    return { group: g, legPivots: pivots };
  }
  if (def.kind === 'sas') {
    const g = new Group();
    const r = Math.max(1.0, def.radius);
    g.add(toonMesh(new CylinderGeometry(r, r, def.height, 24), PALETTE.metal, { rim: 0.25 }));
    g.add(ring(r + 0.02, 0.06, PALETTE.teal, def.height * 0.28));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const gyro = toonMesh(new SphereGeometry(r * 0.22, 10, 8), PALETTE.coral, { rim: 0.25 });
      gyro.position.set(Math.cos(a) * r * 0.88, 0, Math.sin(a) * r * 0.88);
      g.add(gyro);
    }
    for (let i = 0; i < 3; i++) {
      const light = new Mesh(new SphereGeometry(0.06, 8, 6), new MeshBasicMaterial({ color: i === 0 ? 0xff6b6b : 0x7fffd4 }));
      light.position.set(r * 0.5, def.height * 0.4, 0.3 + i * 0.06);
      g.add(light);
    }
    return { group: g, legPivots: [] };
  }
  if (def.kind === 'rcs') {
    const g = new Group();
    const r = 1.75;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const pod = new Group();
      pod.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      pod.rotation.y = -a;
      const body = toonMesh(new BoxGeometry(0.32, def.height * 0.7, 0.28), PALETTE.metal, { rim: 0.2 });
      pod.add(body);
      for (let k = 0; k < 3; k++) {
        const n = toonMesh(new ConeGeometry(0.055, 0.16, 8), PALETTE.metalDark, { outline: false });
        n.position.set(0, 0.1 - k * 0.16, 0.21);
        n.rotation.x = Math.PI / 2;
        pod.add(n);
      }
      g.add(pod);
    }
    return { group: g, legPivots: [] };
  }
  if (def.kind === 'decoupler') {
    const g = new Group();
    const r = Math.max(0.7, def.radius);
    g.add(toonMesh(new CylinderGeometry(r, r, def.height, 28), PALETTE.cream, { rim: 0.2 }));
    g.add(band(r + 0.02, def.height * 0.4, PALETTE.orange, 0));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const bolt = toonMesh(new CylinderGeometry(0.045, 0.045, 0.08, 6), PALETTE.metalDark, { outline: false });
      bolt.position.set(Math.cos(a) * r * 0.92, def.height * 0.3, Math.sin(a) * r * 0.92);
      g.add(bolt);
    }
    return { group: g, legPivots: [] };
  }
  if (def.kind === 'nose') {
    const g = new Group();
    const cone = toonMesh(new ConeGeometry(def.radius, def.height, 20), PALETTE.cream, { rim: 0.3 });
    g.add(cone);
    g.add(ring(def.radius * 0.75, 0.025, PALETTE.coral, -def.height * 0.26));
    return { group: g, legPivots: [] };
  }
  const g = new Group();
  g.add(toonMesh(new CylinderGeometry(def.radius || 0.5, def.radius || 0.5, def.height, 12), PALETTE.cream));
  return { group: g, legPivots: [] };
}

export class RocketView {
  group = new Group();
  design: RocketDesign | null = null;
  layout: VesselLayout | null = null;
  partGroups = new Map<number, Group>();
  private chuteCanopy: Group | null = null;
  private legPivots: Group[] = [];
  private plumes: { group: Group; radius: number }[] = [];
  private decals: Mesh[] = [];
  private engineAnchors: { pos: Vector3; radius: number }[] = [];

  rebuild(design: RocketDesign, layout: VesselLayout): void {
    this.design = design;
    this.layout = layout;
    this.clear();
    this.partGroups.clear();
    this.legPivots = [];
    this.plumes = [];
    this.engineAnchors = [];
    this.chuteCanopy = null;
    const com = layout.comHeight;
    const ordered = [...layout.parts].sort((a, b) => a.yBottom - b.yBottom);
    for (const p of ordered) {
      const built = makePart(p.def);
      const g = built.group;
      g.position.y = p.yCenter - com;
      g.userData.partUid = p.inst.uid;
      this.group.add(g);
      this.partGroups.set(p.inst.uid, g);
      if (built.canopy) this.chuteCanopy = built.canopy;
      for (const lp of built.legPivots) this.legPivots.push(lp);
      if (p.def.kind === 'engine' || p.def.kind === 'srb') {
        const plume = this.makePlume(p.def.radius * 0.65, p.def.height * 0.9);
        plume.position.y = p.yBottom - com - p.def.height * 0.15;
        this.group.add(plume);
        this.plumes.push({ group: plume, radius: p.def.radius });
        this.engineAnchors.push({ pos: new V(0, p.yBottom - com - p.def.height * 0.4, 0), radius: p.def.radius });
      }
    }
    // Adapter rings between different radii.
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (a.def.radius && b.def.radius && Math.abs(a.def.radius - b.def.radius) > 0.05) {
        const h = 0.55;
        const geo = new CylinderGeometry(b.def.radius, a.def.radius, h, 24, 1, true);
        const adapter = toonMesh(geo, PALETTE.cream, { rim: 0.2 });
        adapter.position.y = a.yBottom + a.def.height - com + h / 2;
        this.group.add(adapter);
      }
    }
    // Soft contact shadow.
    const shadow = new Mesh(new PlaneGeometry(layout.maxRadius * 4.2, layout.maxRadius * 4.2), new MeshBasicMaterial({
      map: makeGlowTexture('rgba(45,35,50,0.45)', 'rgba(45,35,50,0)'), transparent: true, depthWrite: false,
    }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -com + 0.03;
    this.group.add(shadow);
  }

  private makePlume(radius: number, length: number): Group {
    const g = new Group();
    const geo = new ConeGeometry(radius * 1.2, length, 16, 1, true);
    const mat = new MeshBasicMaterial({
      color: 0xffb45e, transparent: true, opacity: 0.72, depthWrite: false,
      blending: AdditiveBlending, side: DoubleSide,
    });
    const cone = new Mesh(geo, mat);
    cone.position.y = -length / 2;
    g.add(cone);
    const core = new Mesh(new ConeGeometry(radius * 0.55, length * 0.72, 12, 1, true), new MeshBasicMaterial({
      color: 0xfff6cf, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    }));
    core.position.y = -length * 0.36;
    g.add(core);
    const glow = new Mesh(new SphereGeometry(radius * 1.15, 12, 8), new MeshBasicMaterial({
      color: 0xffa34a, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending,
    }));
    g.add(glow);
    g.visible = false;
    return g;
  }

  clear(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    this.group.clear();
    this.partGroups.clear();
    this.plumes = [];
    this.engineAnchors = [];
    this.legPivots = [];
    this.chuteCanopy = null;
  }

  updateVisuals(opts: {
    gearDeployed: boolean;
    chuteState: string;
    chuteProgress: number;
    throttle: number;
    engineGlow: boolean;
    t: number;
  }): void {
    const legTarget = opts.gearDeployed ? 0.42 : 0.02;
    for (const p of this.legPivots) {
      p.rotation.z += (legTarget - p.rotation.z) * 0.12;
    }
    if (this.chuteCanopy) {
      const deploying = opts.chuteState === 'deploying';
      const deployed = opts.chuteState === 'deployed';
      this.chuteCanopy.visible = deploying || deployed;
      if (deployed) {
        const s = 1 + Math.sin(opts.t * 2.3) * 0.025;
        this.chuteCanopy.scale.setScalar(s);
      } else if (deploying) {
        this.chuteCanopy.scale.setScalar(Math.max(0.01, opts.chuteProgress));
      }
      this.chuteCanopy.rotation.y = Math.sin(opts.t * 0.8) * 0.08;
    }
    for (const p of this.plumes) {
      p.group.visible = opts.engineGlow && opts.throttle > 0.01;
      if (p.group.visible) {
        const flick = 0.92 + Math.sin(opts.t * 43 + p.radius) * 0.05 + Math.sin(opts.t * 71) * 0.03;
        p.group.scale.set(1 + opts.throttle * 0.15, opts.throttle * flick, 1 + opts.throttle * 0.15);
        const m0 = (p.group.children[0] as Mesh).material as MeshBasicMaterial;
        const m1 = (p.group.children[1] as Mesh).material as MeshBasicMaterial;
        m0.opacity = 0.35 + opts.throttle * 0.5;
        m1.opacity = 0.4 + opts.throttle * 0.5;
        (p.group.children[2] as Mesh).scale.setScalar(0.7 + opts.throttle * 0.5);
      }
    }
  }

  engineAnchorWorld(shipQuat: { x: number; y: number; z: number; w: number }): { pos: Vector3; radius: number }[] {
    return this.engineAnchors.map((a) => ({ pos: a.pos.clone().applyQuaternion(shipQuat as never), radius: a.radius }));
  }
}

export function makeRocketStatic(design: RocketDesign, layout: VesselLayout): RocketView {
  const view = new RocketView();
  view.rebuild(design, layout);
  return view;
}

// ---------------------------------------------------------------- pad and gantry

function makeTree(scale = 1): Group {
  const g = new Group();
  const trunk = toonMesh(new CylinderGeometry(0.34 * scale, 0.52 * scale, 4.4 * scale, 7), 0xa9744b, { rim: 0.15 });
  trunk.position.y = 2.2 * scale;
  g.add(trunk);
  const colors = [0x65c978, 0x86d98c, 0x4fb977];
  for (let i = 0; i < 3; i++) {
    const canopy = toonMesh(new IcosahedronGeometry((2.2 + i * 0.35) * scale, 1), colors[i], { rim: 0.26 });
    canopy.position.set((i - 1) * 0.8 * scale, (4.7 + (i === 1 ? 1.3 : 0)) * scale, (i % 2 === 0 ? 0.4 : -0.4) * scale);
    canopy.scale.set(1.1, 0.95, 1.05);
    g.add(canopy);
  }
  return g;
}

export function makeLaunchPad(): Group {
  const g = new Group();
  const concrete = createToonMaterial({ color: 0xd9d3c4, shade: 0x8a8798, rim: 0.2 });
  const pad = new Mesh(new CylinderGeometry(31, 33, 2.2, 6), concrete);
  pad.position.y = -1.1;
  g.add(pad);
  const rim = new Mesh(new TorusGeometry(31.2, 0.65, 6, 6), createToonMaterial({ color: 0xffd25e, shade: 0xac8a4e, rim: 0.2 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.02;
  g.add(rim);
  // Pad markings.
  const lineMat = new MeshBasicMaterial({ color: 0xfff2c6 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bar = new Mesh(new BoxGeometry(10, 0.08, 1.3), lineMat);
    bar.position.set(Math.cos(a) * 19, 0.04, Math.sin(a) * 19);
    bar.rotation.y = -a;
    g.add(bar);
  }
  const center = new Mesh(new CylinderGeometry(8, 8, 0.1, 32), new MeshBasicMaterial({ color: 0x4d4656 }));
  center.position.y = 0.03;
  g.add(center);
  // Launch clamps.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const clamp = new Group();
    clamp.position.set(Math.cos(a) * 6.2, 0, Math.sin(a) * 6.2);
    const arm = toonMesh(new BoxGeometry(1.6, 3.4, 1.2), PALETTE.orange, { rim: 0.2 });
    arm.position.y = 1.7;
    clamp.add(arm);
    const jaw = toonMesh(new BoxGeometry(1.9, 0.7, 2.6), PALETTE.metalDark, { rim: 0.2 });
    jaw.position.set(0, 3.1, -0.4);
    clamp.add(jaw);
    g.add(clamp);
  }
  // Gantry tower.
  const tower = makeGantry();
  tower.position.set(32, 0, -26);
  tower.scale.setScalar(0.8);
  g.add(tower);
  // Fuel tanks.
  for (let i = 0; i < 2; i++) {
    const tank = new Group();
    tank.position.set(-34 - i * 10, 3.4, -20 - i * 9);
    const sphere = toonMesh(new SphereGeometry(4.2, 20, 14), PALETTE.cream, { rim: 0.3 });
    sphere.scale.set(1, 1.25, 1);
    tank.add(sphere);
    tank.add(ring(4.2, 0.16, PALETTE.coral, 0));
    const leg = toonMesh(new CylinderGeometry(0.2, 0.23, 8, 8), PALETTE.metalDark, { outline: false });
    leg.position.y = -4;
    tank.add(leg);
    g.add(tank);
  }
  // A little mission control hut.
  const hut = new Group();
  hut.position.set(36, 2.2, 16);
  const base = toonMesh(new BoxGeometry(14, 4.4, 9), PALETTE.cream, { rim: 0.2 });
  hut.add(base);
  const roof = toonMesh(new ConeGeometry(10, 3.5, 4), PALETTE.coral, { rim: 0.2 });
  roof.position.y = 3.9;
  roof.rotation.y = Math.PI / 4;
  hut.add(roof);
  const window = new Mesh(new PlaneGeometry(6, 2), new MeshBasicMaterial({ color: 0x6ecfd2 }));
  window.position.set(0, 0.4, 4.52);
  hut.add(window);
  g.add(hut);
  // A sandy ring and a little grove around the pad, so the diorama feels alive.
  const path = new Mesh(new RingGeometry(31.5, 38.5, 40), createToonMaterial({ color: 0xd8c19c, shade: 0x9f876f, rim: 0.1 }));
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.16;
  g.add(path);
  const spots: [number, number, number][] = [
    [40, 8, 1.0], [44, -18, 0.86], [-38, 28, 1.15], [-46, -14, 0.9],
    [18, 46, 1.2], [-12, 52, 0.82], [55, 4, 1.05], [-30, -42, 0.95],
    [35, 32, 0.7], [-52, 6, 0.75],
  ];
  for (const [x, z, s] of spots) {
    const tree = makeTree(s);
    tree.position.set(x, 0.15, z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    g.add(tree);
  }
  const flowerColors = [0xff8fa3, 0xffe06e, 0xffffff, 0xc7a7ff];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 35 + (i % 3) * 1.2;
    const flower = new Mesh(new SphereGeometry(0.28, 8, 6), new MeshBasicMaterial({ color: flowerColors[i % 4] }));
    flower.position.set(Math.cos(a) * r, 0.45, Math.sin(a) * r);
    g.add(flower);
  }
  return g;
}

function makeGantry(): Group {
  const g = new Group();
  const red = PALETTE.coral;
  const cream = PALETTE.cream;
  const metal = createToonMaterial({ color: 0xc9c1b3, shade: 0x7e7787, rim: 0.2 });
  const levels = 8;
  const spacing = 3.6;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(0.28, 0.32, levels * spacing + 2, 8), metal);
      post.position.set(sx * 2.2, (levels * spacing) / 2, sz * 2.2);
      g.add(post);
    }
  }
  for (let l = 0; l < levels; l++) {
    const y = l * spacing + 1.5;
    for (const sx of [-1, 1]) {
      const brace = new Mesh(new CylinderGeometry(0.11, 0.11, 4.6, 6), metal);
      brace.position.set(sx * 2.2, y, 0);
      brace.rotation.z = Math.PI / 2;
      brace.rotation.y = Math.PI / 4;
      g.add(brace);
    }
    for (const sz of [-1, 1]) {
      const brace = new Mesh(new CylinderGeometry(0.11, 0.11, 4.6, 6), metal);
      brace.position.set(0, y, sz * 2.2);
      brace.rotation.x = Math.PI / 2;
      brace.rotation.z = Math.PI / 4;
      g.add(brace);
    }
    if (l % 2 === 0) {
      const ring = new Mesh(new BoxGeometry(5.2, 0.2, 5.2), metal);
      ring.position.y = y;
      g.add(ring);
    }
  }
  const top = new Mesh(new BoxGeometry(7, 0.5, 7), createToonMaterial({ color: red, shade: 0x9f4d4a, rim: 0.2 }));
  top.position.y = levels * spacing + 1.5;
  g.add(top);
  const boom = new Mesh(new BoxGeometry(16, 0.5, 0.8), createToonMaterial({ color: cream, shade: 0x9a9085, rim: 0.2 }));
  boom.position.set(-6, levels * spacing + 1.7, 0);
  g.add(boom);
  const counter = new Mesh(new BoxGeometry(3, 2.2, 2.2), createToonMaterial({ color: PALETTE.orange, shade: 0x9a6a2d, rim: 0.2 }));
  counter.position.set(5.5, levels * spacing + 0.8, 0);
  g.add(counter);
  return g;
}

function flagTexture(text: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFF2D6';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#FF806A';
  ctx.lineWidth = 14;
  ctx.strokeRect(10, 10, 492, 236);
  ctx.fillStyle = '#FF806A';
  ctx.beginPath();
  ctx.ellipse(84, 168, 24, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI * 0.8 + i * 0.36;
    ctx.beginPath();
    ctx.ellipse(84 + Math.cos(a) * 34, 168 + Math.sin(a) * 26, 8, 10, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#3C2F2B';
  ctx.font = '800 88px "Baloo 2", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 300, 150);
  ctx.fillStyle = '#2F9E9E';
  ctx.font = '700 24px Nunito, sans-serif';
  ctx.fillText('CAT SPACE AGENCY', 300, 198);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function makeFlag(text = 'PAW'): Group {
  const g = new Group();
  const pole = new Mesh(new CylinderGeometry(0.06, 0.08, 4.4, 8), new MeshBasicMaterial({ color: 0x9aa3ad }));
  pole.position.y = 2.2;
  g.add(pole);
  const tex = flagTexture(text);
  const mat = new MeshBasicMaterial({ map: tex, side: DoubleSide });
  const flag = new Mesh(new PlaneGeometry(2.6, 1.3), mat);
  flag.position.set(1.25, 3.7, 0);
  g.add(flag);
  const back = new Mesh(new PlaneGeometry(2.6, 1.3), mat);
  back.position.set(1.25, 3.7, -0.012);
  back.rotation.y = Math.PI;
  g.add(back);
  return g;
}

export function makeVabRoom(): Group {
  const g = new Group();
  const floorMat = createToonMaterial({ color: 0xd9c9b1, shade: 0x9d8c83, rim: 0.15 });
  const floor = new Mesh(new BoxGeometry(100, 1, 100), floorMat);
  floor.position.y = -0.5;
  g.add(floor);
  const wallMat = createToonMaterial({ color: 0xf4e7d1, shade: 0xb7a99c, rim: 0.15 });
  const back = new Mesh(new BoxGeometry(100, 34, 1), wallMat);
  back.position.set(0, 17, -48);
  g.add(back);
  const left = new Mesh(new BoxGeometry(1, 34, 100), wallMat);
  left.position.set(-48, 17, 0);
  g.add(left);
  const right = new Mesh(new BoxGeometry(1, 34, 100), wallMat);
  right.position.set(48, 17, 0);
  g.add(right);
  // Big hangar doors / windows.
  const sky = new Mesh(new PlaneGeometry(50, 22), new MeshBasicMaterial({ color: 0x9edcff }));
  sky.position.set(0, 16, -47.4);
  g.add(sky);
  for (let i = 0; i < 5; i++) {
    const bar = new Mesh(new BoxGeometry(0.7, 22, 0.7), new MeshBasicMaterial({ color: 0x8a7a6c }));
    bar.position.set(-20 + i * 10, 16, -46.9);
    g.add(bar);
  }
  // Ceiling beams.
  for (let i = 0; i < 6; i++) {
    const beam = new Mesh(new BoxGeometry(96, 0.9, 1.2), new MeshBasicMaterial({ color: 0xb49d86 }));
    beam.position.set(0, 33, -40 + i * 16);
    g.add(beam);
  }
  // Scaffolding around the rocket.
  const scaffoldMat = new MeshBasicMaterial({ color: 0xf0b24f });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const post = new Mesh(new CylinderGeometry(0.12, 0.12, 22, 6), scaffoldMat);
      post.position.set(side * (10 + i * 4), 11, -11 + i * 2);
      g.add(post);
    }
  }
  for (let i = 1; i < 8; i++) {
    const plank = new Mesh(new BoxGeometry(18, 0.22, 1.6), new MeshBasicMaterial({ color: 0xb98c5f }));
    plank.position.set(-8, i * 2.7, -8 + i * 0.4);
    g.add(plank);
  }
  // Floor grid.
  for (let i = -4; i <= 4; i++) {
    const line = new Mesh(new BoxGeometry(96, 0.02, 0.12), new MeshBasicMaterial({ color: 0xb9a48c }));
    line.position.set(0, 0.01, i * 10);
    g.add(line);
    const line2 = new Mesh(new BoxGeometry(0.12, 0.02, 96), new MeshBasicMaterial({ color: 0xb9a48c }));
    line2.position.set(i * 10, 0.01, 0);
    g.add(line2);
  }
  return g;
}

export function makePadGroundShadow(radius: number): Mesh {
  const shadow = new Mesh(new PlaneGeometry(radius * 2, radius * 2), new MeshBasicMaterial({
    map: makeGlowTexture('rgba(32,26,40,0.55)', 'rgba(32,26,40,0)'), transparent: true, depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  return shadow;
}

export { makeCatHead };
