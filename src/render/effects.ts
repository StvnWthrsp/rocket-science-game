import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, PointsMaterial,
  ShaderMaterial, Vector3, Group,
} from 'three';
import { makeGlowTexture } from './toon';
import { PALETTE } from './toon';

interface Particle {
  pos: Vector3;
  vel: Vector3;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  alpha: number;
  color: Color;
  gravity: number;
  drag: number;
}

const vert = [
  'attribute float size;',
  'attribute float alpha;',
  'attribute vec3 color;',
  'varying float vAlpha;',
  'varying vec3 vColor;',
  'void main(){',
  '  vAlpha=alpha; vColor=color;',
  '  vec4 mv=modelViewMatrix*vec4(position,1.0);',
  '  gl_PointSize=max(1.0, size * 650.0 / max(1.0, -mv.z));',
  '  gl_Position=projectionMatrix*mv;',
  '}',
].join('\n');

const frag = [
  'varying float vAlpha;',
  'varying vec3 vColor;',
  'void main(){',
  '  vec2 c=gl_PointCoord-0.5;',
  '  float d=length(c);',
  '  if(d>0.5) discard;',
  '  float a=smoothstep(0.5,0.12,d)*vAlpha;',
  '  gl_FragColor=vec4(vColor,a);',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

export class ParticleSystem {
  points: Points;
  geom: BufferGeometry;
  mat: ShaderMaterial;
  particles: Particle[] = [];
  max = 420;

  constructor() {
    this.geom = new BufferGeometry();
    this.geom.setAttribute('position', new BufferAttribute(new Float32Array(this.max * 3), 3));
    this.geom.setAttribute('size', new BufferAttribute(new Float32Array(this.max), 1));
    this.geom.setAttribute('alpha', new BufferAttribute(new Float32Array(this.max), 1));
    this.geom.setAttribute('color', new BufferAttribute(new Float32Array(this.max * 3), 3));
    this.geom.setDrawRange(0, 0);
    this.mat = new ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.points = new Points(this.geom, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  spawn(pos: Vector3, vel: Vector3, life: number, size: number, color: Color, grow = 1.6, gravity = 0, drag = 0.6): void {
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push({
      pos: pos.clone(), vel: vel.clone(), life, maxLife: life, size, grow,
      alpha: 0.85, color: color.clone(), gravity, drag,
    });
  }

  update(dt: number, sceneOrigin: Vector3): void {
    const pos = this.geom.getAttribute('position') as BufferAttribute;
    const size = this.geom.getAttribute('size') as BufferAttribute;
    const alpha = this.geom.getAttribute('alpha') as BufferAttribute;
    const color = this.geom.getAttribute('color') as BufferAttribute;
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.size += p.grow * dt;
      p.alpha = Math.max(0, Math.min(1, p.life / p.maxLife)) * 0.9;
    }
    for (const p of this.particles) {
      if (n >= this.max) break;
      pos.setXYZ(n, p.pos.x - sceneOrigin.x, p.pos.y - sceneOrigin.y, p.pos.z - sceneOrigin.z);
      size.setX(n, p.size);
      alpha.setX(n, p.alpha);
      color.setXYZ(n, p.color.r, p.color.g, p.color.b);
      n++;
    }
    this.geom.setDrawRange(0, n);
    pos.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    color.needsUpdate = true;
  }

  clear(): void {
    this.particles.length = 0;
    this.geom.setDrawRange(0, 0);
  }
}

export class Effects {
  particles = new ParticleSystem();
  group = new Group();
  shake = 0;
  private exhaustAcc = 0;
  private rcsAcc = 0;
  private reentryAcc = 0;
  private dustAcc = 0;

  constructor() {
    this.group.add(this.particles.points);
  }

  update(dt: number, ship: { pos: Vector3; quat: { x: number; y: number; z: number; w: number }; lastThrustForFx: number; lastAirSpeed: number; lastPressure: number; rcsEnabled: boolean }, engineAnchors: { pos: Vector3; radius: number }[], t: number): void {
    this.particles.update(dt, ship.pos);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const alt = ship.lastPressure;
    // Engine exhaust puffs.
    if (ship.lastThrustForFx > 1000) {
      this.exhaustAcc += dt;
      const rate = 0.016;
      while (this.exhaustAcc > rate) {
        this.exhaustAcc -= rate;
        for (const a of engineAnchors) {
          const p = a.pos.clone().applyQuaternion(ship.quat as never).add(ship.pos);
          const jitter = new Vector3((Math.random() - 0.5) * 1.3, -3 - Math.random() * 3, (Math.random() - 0.5) * 1.3);
          const col = new Color().setHSL(0.08 + Math.random() * 0.03, 0.95, 0.62);
          this.particles.spawn(p, jitter, 1.2 + Math.random() * 0.9, a.radius * 0.9, col, 2.6, -0.4, 0.7);
          if (alt > 0.4) {
            const smoke = new Color(0xf2eadf);
            this.particles.spawn(p, jitter.clone().multiplyScalar(0.6), 2.4 + Math.random() * 1.8, a.radius * 1.7, smoke, 4.2, -0.2, 0.8);
          }
        }
      }
    }
    // Reentry sparks.
    if (ship.lastAirSpeed > 900 && ship.lastPressure > 0.02) {
      this.reentryAcc += dt;
      while (this.reentryAcc > 0.025) {
        this.reentryAcc -= 0.025;
        const p = ship.pos.clone().add(new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6));
        const col = new Color().setHSL(0.05 + Math.random() * 0.04, 1, 0.65);
        this.particles.spawn(p, new Vector3((Math.random() - 0.5) * 8, -12, (Math.random() - 0.5) * 8), 0.7, 0.5, col, 1.2, 0, 0.1);
      }
      this.shake = Math.max(this.shake, Math.min(0.6, ship.lastAirSpeed / 6000));
    }
  }

  launchDust(padPos: Vector3, up: Vector3): void {
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 18;
      const p = padPos.clone().addScaledVector(up, 0.8).add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      const v = new Vector3(Math.cos(a) * (2 + Math.random() * 7), 1 + Math.random() * 4, Math.sin(a) * (2 + Math.random() * 7));
      this.particles.spawn(p, v, 2.6 + Math.random() * 2.4, 3 + Math.random() * 4, new Color(0xf3e4d6), 3.4, -0.4, 0.7);
    }
  }

  landingDust(padPos: Vector3, up: Vector3): void {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 8;
      const p = padPos.clone().addScaledVector(up, 0.5).add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      const v = new Vector3(Math.cos(a) * (1 + Math.random() * 4), 0.4 + Math.random() * 2, Math.sin(a) * (1 + Math.random() * 4));
      this.particles.spawn(p, v, 1.8 + Math.random() * 1.5, 2 + Math.random() * 2, new Color(0xe7d9c9), 2.6, -0.2, 0.8);
    }
  }

  rcsPuff(worldPos: Vector3, dir: Vector3): void {
    const p = worldPos.clone();
    const col = new Color(0xffffff);
    this.particles.spawn(p, dir.clone().multiplyScalar(4).add(new Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)), 0.55, 0.35, col, 1.4, 0, 1.2);
  }

  explode(pos: Vector3): void {
    this.shake = 1.4;
    const colors = [0xff806a, 0xffe27a, 0xffb13c, 0xffffff, 0x54c8c2];
    for (let i = 0; i < 90; i++) {
      const d = new Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize();
      this.particles.spawn(pos.clone(), d.multiplyScalar(3 + Math.random() * 14), 1.2 + Math.random() * 2.4, 1.5 + Math.random() * 3, new Color(colors[i % colors.length]), 2.4, 3.0, 0.5);
    }
  }

  smoke(pos: Vector3): void {
    for (let i = 0; i < 16; i++) {
      const d = new Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).normalize();
      this.particles.spawn(pos.clone(), d.multiplyScalar(2 + Math.random() * 4), 2 + Math.random() * 2, 2 + Math.random() * 3, new Color(0xd7c9c3), 3, -0.1, 0.7);
    }
  }
}
