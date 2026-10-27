import {
  BufferGeometry, BufferAttribute, Color, CylinderGeometry, DodecahedronGeometry,
  Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, Object3D, Vector3,
} from 'three';
import type { Body } from '../game/bodies';
import { globalToBodyFixedDir } from '../game/bodies';
import { createToonMaterial } from './toon';
import { fbm } from '../game/bodies';

const Y = new Vector3(0, 1, 0);

export class TerrainPatch {
  group = new Group();
  mesh: Mesh | null = null;
  body: Body;
  centerFixed = new Vector3(1, 0, 0);
  centerHeight = 0;
  private lastCenter = new Vector3();
  private lastBuild = -1;
  private scatter = new Group();
  private radius = 28000;
  private rings = 104;
  private segs = 144;

  constructor(body: Body) {
    this.body = body;
    this.group.name = 'terrain-patch';
    this.group.add(this.scatter);
    this.group.visible = false;
  }

  setBody(body: Body): void {
    if (this.body === body) return;
    this.body = body;
    this.lastBuild = -1;
    this.clear();
  }

  clear(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as { dispose: () => void }).dispose();
      this.group.remove(this.mesh);
      this.mesh = null;
    }
    this.scatter.clear();
  }

  update(shipPos: Vector3, body: Body, time: number, altitude: number): void {
    this.setBody(body);
    this.group.visible = altitude < 150000;
    if (!this.group.visible) return;
    const bs = body.globalState(time);
    const rel = shipPos.clone().sub(bs.pos);
    const fixed = globalToBodyFixedDir(body, rel.clone().normalize(), time);
    const moved = this.lastBuild < 0 || fixed.angleTo(this.lastCenter) * body.radius > Math.max(350, altitude * 0.8);
    if (moved && (this.lastBuild < 0 || time - this.lastBuild > 0.35)) {
      this.rebuild(fixed, time);
      this.lastBuild = time;
    }
    if (!this.mesh) return;
    const sdir = this.centerFixed.clone().applyAxisAngle(Y, body.rotationAngle(time));
    const surf = body.surfaceRadiusAt(this.centerFixed);
    const up = sdir.clone().normalize();
    let east = new Vector3().crossVectors(Y, up);
    if (east.lengthSq() < 1e-9) east = new Vector3(0, 0, 1);
    east.normalize();
    const north = new Vector3().crossVectors(up, east).normalize();
    const pos = bs.pos.clone().addScaledVector(up, surf + this.centerHeight);
    this.group.position.copy(pos).sub(shipPos);
    const m = new Matrix4().makeBasis(east, up, north.clone().negate());
    this.group.quaternion.setFromRotationMatrix(m);
    this.group.scale.setScalar(1);
  }

  private rebuild(center: Vector3, time: number): void {
    this.centerFixed.copy(center);
    this.lastCenter.copy(center);
    this.centerHeight = this.body.terrainHeight(center);
    this.clear();

    const ringCount = this.rings;
    const segCount = this.segs;
    const verts = (ringCount + 1) * (segCount + 1);
    const positions = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
    const indices: number[] = [];
    const up = center.clone();
    let east = new Vector3().crossVectors(Y, up).normalize();
    if (east.lengthSq() < 1e-9) east.set(0, 0, 1);
    const north = new Vector3().crossVectors(up, east).normalize();
    const R = this.body.radius;
    const c = this.body.appearance;
    const base = new Color(c.primary);
    const alt = new Color(c.secondary);
    const accent = new Color(c.accent);
    const ice = new Color(c.ice);
    const dark = new Color(c.secondary).multiplyScalar(0.72);
    const tmpColor = new Color();
    const dir = new Vector3();
    const p = new Vector3();
    const heights = new Float32Array(verts);
    let vi = 0;
    for (let r = 0; r <= ringCount; r++) {
      const rr = this.radius * Math.pow(r / ringCount, 2.05);
      for (let s = 0; s <= segCount; s++) {
        const a = (s / segCount) * Math.PI * 2;
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        dir.copy(up).addScaledVector(east, x / R).addScaledVector(north, z / R).normalize();
        const h = this.body.terrainHeight(dir);
        heights[vi] = h;
        const curve = Math.sqrt(R * R + rr * rr) - R;
        p.set(x, curve + h - this.centerHeight, -z);
        positions[vi * 3] = p.x;
        positions[vi * 3 + 1] = p.y;
        positions[vi * 3 + 2] = p.z;

        // Color by biome, elevation, and a little noise.
        const n = fbm(dir.x * 22 + 9, dir.y * 22, dir.z * 22, 3);
        const patch = fbm(dir.x * 55 + 3, dir.y * 55, dir.z * 55, 2);
        if (this.body.id === 'terra') {
          tmpColor.copy(base);
          tmpColor.lerp(alt, Math.max(0, Math.min(1, (h / 420) * 0.6 + n * 0.25)));
          if (h > 260) tmpColor.lerp(accent, Math.min(0.45, (h - 260) / 350));
          if (patch > 0.66) tmpColor.offsetHSL(0.01, 0.06, 0.035);
          if (patch < 0.34) tmpColor.offsetHSL(-0.015, -0.03, -0.02);
        } else if (this.body.id === 'luna') {
          tmpColor.copy(base).lerp(alt, Math.max(0, Math.min(1, n * 0.8)));
          if (h < -20) tmpColor.copy(dark);
          if (h > 120) tmpColor.lerp(ice, Math.min(0.4, (h - 120) / 350));
        } else if (this.body.id === 'mochi') {
          tmpColor.copy(base).lerp(alt, n * 0.45);
          if (patch > 0.7) tmpColor.lerp(ice, 0.6);
        } else if (this.body.id === 'rusty') {
          tmpColor.copy(base).lerp(alt, Math.max(0, Math.min(1, n * 0.7)));
          if (h > 300) tmpColor.lerp(accent, 0.35);
        } else {
          tmpColor.copy(base);
        }
        const shade = 0.93 + (fbm(dir.x * 130, dir.y * 130, dir.z * 130, 2) - 0.5) * 0.12;
        tmpColor.multiplyScalar(shade);
        colors[vi * 3] = tmpColor.r;
        colors[vi * 3 + 1] = tmpColor.g;
        colors[vi * 3 + 2] = tmpColor.b;
        vi++;
      }
    }
    for (let r = 0; r < ringCount; r++) {
      for (let s = 0; s < segCount; s++) {
        const a = r * (segCount + 1) + s;
        const b = a + segCount + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const uvs = new Float32Array(verts * 2);
    for (let i = 0; i < verts; i++) { uvs[i * 2] = 0.5; uvs[i * 2 + 1] = 0.5; }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('uv', new BufferAttribute(uvs, 2));
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = createToonMaterial({
      color: 0xffffff, vertexColors: true, shade: 0x56506a,
      rim: 0.1, rimColor: 0xffefd0, fog: true,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);

    this.buildScatter();
  }

  private buildScatter(): void {
    const body = this.body;
    const rand = mulberry32(body.terrainSeed * 991 + 7);
    const count = body.id === 'terra' ? 150 : 80;
    if (body.id === 'terra') {
      const trunkGeo = new CylinderGeometry(0.42, 0.62, 5.2, 6);
      const canopyGeo = new IcosahedronGeometry(3.4, 1);
      const trunkMat = createToonMaterial({ color: 0xa9744b, shade: 0x6b4d3d, rim: 0.15 });
      const canopyMats = [
        createToonMaterial({ color: 0x6acb7c, shade: 0x3c8c62, rim: 0.25 }),
        createToonMaterial({ color: 0x8cdc8e, shade: 0x4d9e64, rim: 0.25 }),
        createToonMaterial({ color: 0x51b97a, shade: 0x357a5e, rim: 0.25 }),
      ];
      const trunks = new InstancedMesh(trunkGeo, trunkMat, count);
      const canopies = canopyMats.map((m) => new InstancedMesh(canopyGeo, m, Math.ceil(count / 3) + 2));
      const counts = [0, 0, 0];
      const mtx = new Matrix4();
      const obj = new Object3D();
      for (let i = 0; i < count; i++) {
        const r = i < 18 ? 50 + i * 9 + rand() * 18 : 60 + Math.pow(rand(), 2.2) * 2200;
        const a = rand() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = this.heightAtLocal(x, z);
        const scale = 0.85 + rand() * 0.9;
        obj.position.set(x, y + 2.5 * scale, -z);
        obj.rotation.y = rand() * Math.PI * 2;
        obj.scale.set(scale, scale, scale);
        obj.updateMatrix();
        mtx.copy(obj.matrix);
        trunks.setMatrixAt(i, mtx);
        const ci = i % 3;
        obj.position.y = y + (5.2 + 1.2) * scale;
        obj.scale.set(scale * (0.9 + rand() * 0.2), scale * (0.9 + rand() * 0.2), scale * (0.9 + rand() * 0.2));
        obj.updateMatrix();
        canopies[ci].setMatrixAt(counts[ci]++, obj.matrix);
      }
      trunks.instanceMatrix.needsUpdate = true;
      trunks.frustumCulled = false;
      this.scatter.add(trunks);
      for (let i = 0; i < 3; i++) {
        canopies[i].count = counts[i];
        canopies[i].instanceMatrix.needsUpdate = true;
        canopies[i].frustumCulled = false;
        this.scatter.add(canopies[i]);
      }
      this.addFlowers(rand, 170);
      this.addRocks(rand, 38, 1.1, 0xb5c2a8);
    } else if (body.id === 'luna') {
      this.addRocks(rand, 150, 3.0, 0x9a91b0);
      this.addRocks(rand, 30, 7.0, 0x81779c, true);
    } else if (body.id === 'mochi') {
      this.addRocks(rand, 70, 1.8, 0xc8f0e2);
      this.addCrystals(rand, 28);
    } else if (body.id === 'rusty') {
      this.addRocks(rand, 85, 3.0, 0xc98267);
    }
  }

  private addFlowers(rand: () => number, count: number): void {
    const colors = [0xff8fa3, 0xffe06e, 0xffffff, 0xc7a7ff, 0xffa46e];
    const geo = new IcosahedronGeometry(0.24, 0);
    for (let ci = 0; ci < colors.length; ci++) {
      const n = Math.ceil(count / colors.length);
      const mesh = new InstancedMesh(geo, createToonMaterial({ color: colors[ci], shade: 0x8d6570, rim: 0.25 }), n);
      let used = 0;
      for (let i = 0; i < n; i++) {
        const r = 40 + Math.pow(rand(), 1.8) * 700;
        const a = rand() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = this.heightAtLocal(x, z);
        const obj = new Object3D();
        obj.position.set(x, y + 0.2, -z);
        const s = 0.7 + rand() * 0.8;
        obj.scale.setScalar(s);
        obj.updateMatrix();
        mesh.setMatrixAt(used++, obj.matrix);
      }
      mesh.count = used;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.scatter.add(mesh);
    }
  }

  private addRocks(rand: () => number, count: number, maxSize: number, color: number, boulder = false): void {
    const geo = new DodecahedronGeometry(1, 0);
    const mesh = new InstancedMesh(geo, createToonMaterial({ color, shade: 0x5b526d, rim: 0.18 }), count);
    const obj = new Object3D();
    for (let i = 0; i < count; i++) {
      const r = i < 20 ? 30 + i * 5 + rand() * 12 : 55 + Math.pow(rand(), 2.0) * 1400;
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.heightAtLocal(x, z);
      const s = (boulder ? 1.4 : 0.25) + rand() * maxSize;
      obj.position.set(x, y + s * 0.45, -z);
      obj.rotation.set(rand() * 0.5, rand() * Math.PI * 2, rand() * 0.5);
      obj.scale.set(s * (0.8 + rand() * 0.8), s * (0.55 + rand() * 0.55), s * (0.8 + rand() * 0.8));
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scatter.add(mesh);
  }

  private addCrystals(rand: () => number, count: number): void {
    const geo = new CylinderGeometry(0.1, 0.9, 6, 5);
    const mesh = new InstancedMesh(geo, createToonMaterial({ color: 0xb9f4ff, shade: 0x5b9fae, rim: 0.5, spec: 0.4 }), count);
    const obj = new Object3D();
    for (let i = 0; i < count; i++) {
      const r = 80 + Math.sqrt(rand()) * this.radius * 0.6;
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.heightAtLocal(x, z);
      obj.position.set(x, y + 2, -z);
      obj.rotation.set((rand() - 0.5) * 0.5, rand() * Math.PI, (rand() - 0.5) * 0.5);
      const s = 0.4 + rand() * 1.2;
      obj.scale.set(s, s, s);
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scatter.add(mesh);
  }

  private heightAtLocal(x: number, z: number): number {
    const up = this.centerFixed;
    let east = new Vector3().crossVectors(Y, up).normalize();
    if (east.lengthSq() < 1e-9) east.set(0, 0, 1);
    const north = new Vector3().crossVectors(up, east).normalize();
    const R = this.body.radius;
    const dir = up.clone().addScaledVector(east, x / R).addScaledVector(north, z / R).normalize();
    const h = this.body.terrainHeight(dir);
    const rr = Math.sqrt(x * x + z * z);
    return Math.sqrt(R * R + rr * rr) - R + h - this.centerHeight;
  }
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
