import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { RocketDesign } from '../game/parts';
import { Ship } from '../game/ship';
import { makeVabRoom, CatModel, RocketView } from './models';
import { glowUniforms, createToonMaterial } from './toon';

const Y = new Vector3(0, 1, 0);

export class VabScene {
  scene = new Scene();
  camera = new PerspectiveCamera(45, 1, 0.1, 2000);
  room: Group;
  rocket = new RocketView();
  cat = new CatModel({ helmet: false, wave: false, scale: 1.15, suit: 0xdff3ec });
  design: RocketDesign | null = null;
  height = 0;
  radius = 1;
  cam = { yaw: 0.7, pitch: 0.16, distance: 50, targetDist: 50 };
  private clock = 0;
  private target = new Vector3(0, 8, 0);
  private autoOrbit = true;

  constructor() {
    this.room = makeVabRoom();
    this.scene.add(this.room);
    this.scene.add(this.rocket.group);
    this.scene.add(this.cat.group);
    // A little crate stack for the engineer cat to supervise from.
    const crates = new Group();
    const crateMat = createToonMaterial({ color: 0xd8b98e, shade: 0x9c7c60, rim: 0.2 });
    const crateMat2 = createToonMaterial({ color: 0xffc27a, shade: 0xb07b45, rim: 0.2 });
    const c1 = new Mesh(new BoxGeometry(5.2, 4.0, 4.4), crateMat);
    c1.position.set(7.5, 2.0, 7.5);
    crates.add(c1);
    const c2 = new Mesh(new BoxGeometry(3.6, 2.0, 3.2), crateMat2);
    c2.position.set(7.2, 5.0, 7.2);
    crates.add(c2);
    const c3 = new Mesh(new BoxGeometry(2.2, 1.0, 2.0), crateMat);
    c3.position.set(7.0, 6.6, 7.0);
    crates.add(c3);
    this.scene.add(crates);
    const stand = new Group();
    this.scene.add(stand);
    this.camera.up.copy(Y);
    glowUniforms.uSunDir.value.set(0.5, 0.86, 0.35).normalize();
  }

  setDesign(design: RocketDesign): void {
    this.design = design;
    const temp = new Ship(design, 0);
    temp.init();
    const layout = temp.computeLayout();
    this.height = layout.height;
    this.radius = layout.maxRadius;
    this.rocket.rebuild(design, layout);
    this.rocket.group.position.y = layout.comHeight;
    this.rocket.group.quaternion.identity();
    this.cat.group.position.set(7.0, 7.25, 7.0);
    this.cat.group.scale.setScalar(1.65);
    this.cat.group.rotation.y = -0.5;
    this.cat.update(0.016, this.clock);
    this.target.set(0, layout.height * 0.48, 0);
    this.cam.targetDist = Math.max(24, layout.height * 1.12 + layout.maxRadius * 6);
    this.cam.distance = this.cam.targetDist;
    this.cam.pitch = 0.06;
    this.addStand(layout.height, layout.comHeight);
  }

  private addStand(height: number, com: number): void {
    const old = this.scene.getObjectByName('vab-stand');
    if (old) this.scene.remove(old);
    const g = new Group();
    g.name = 'vab-stand';
    const mat = createToonMaterial({ color: 0xd8b98e, shade: 0x9c7c60, rim: 0.2 });
    const ring = new CylinderGeometry(Math.max(4, this.radius * 1.9), Math.max(4.2, this.radius * 2), 0.9, 6);
    const m = new Mesh(ring, mat);
    m.position.y = 0.45;
    g.add(m);
    const strutMat = createToonMaterial({ color: 0xf0b24f, shade: 0x9e7037, rim: 0.2 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const legGeo = new CylinderGeometry(0.15, 0.2, 4.5, 6);
      const leg = new Mesh(legGeo, strutMat);
      leg.position.set(Math.cos(a) * this.radius * 1.4, -1.4, Math.sin(a) * this.radius * 1.4);
      // The stand sits on the floor; legs angle in slightly.
      leg.rotation.z = Math.cos(a) * 0.25;
      leg.rotation.x = Math.sin(a) * -0.25;
      g.add(leg);
    }
    this.scene.add(g);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  orbitInput(dx: number, dy: number): void {
    this.autoOrbit = false;
    this.cam.yaw -= dx * 0.005;
    this.cam.pitch = Math.max(-0.3, Math.min(1.2, this.cam.pitch + dy * 0.004));
  }

  zoomInput(delta: number): void {
    this.cam.targetDist = Math.max(18, Math.min(220, this.cam.targetDist * (delta > 0 ? 1.12 : 0.89)));
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.autoOrbit) this.cam.yaw += dt * 0.03;
    this.cat.update(dt, this.clock);
    this.cam.distance += (this.cam.targetDist - this.cam.distance) * Math.min(1, dt * 8);
    const cp = Math.cos(this.cam.pitch);
    const pos = new Vector3(
      Math.sin(this.cam.yaw) * this.cam.distance * cp,
      this.target.y + Math.sin(this.cam.pitch) * this.cam.distance,
      Math.cos(this.cam.yaw) * this.cam.distance * cp,
    );
    this.camera.position.copy(pos);
    this.camera.up.copy(Y);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  render(renderer: { render: (scene: Scene, camera: PerspectiveCamera) => void; autoClear: boolean; clear: () => void }, bg: Color): void {
    renderer.autoClear = true;
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }
}

