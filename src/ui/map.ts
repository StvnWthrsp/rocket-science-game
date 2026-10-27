import { Vector3 } from 'three';
import { BODY, BODIES, type Body } from '../game/bodies';
import type { Ship } from '../game/ship';
import { formatDistance, orbitalElements, sampleOrbit, TWO_PI } from '../game/math';

interface ScreenBody { body: Body; x: number; y: number; r: number; }

export class MapView {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  view: 'local' | 'system' = 'local';
  targetId = 'luna';
  zoom = 1;
  panX = 0;
  panY = 0;
  onTarget: (id: string) => void = () => {};
  private bodies: ScreenBody[] = [];
  private stars: { x: number; y: number; r: number; a: number }[] = [];
  private drag = false;
  private last = { x: 0, y: 0 };
  private moved = false;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private ship: Ship | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.bind();
    for (let i = 0; i < 220; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.2, a: Math.random() * 0.6 + 0.15 });
    }
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  private bind(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = true;
      this.moved = false;
      this.last = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
      this.panX += dx;
      this.panY += dy;
      this.last = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      this.drag = false;
      if (!this.moved) {
        let best: ScreenBody | null = null;
        let bestD = 26;
        for (const b of this.bodies) {
          const d = Math.hypot(b.x - e.clientX, b.y - e.clientY);
          if (d < Math.max(bestD, b.r + 8) && d < bestD + b.r) { best = b; bestD = d; }
        }
        if (best) this.onTarget(best.body.id);
      }
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.25, Math.min(14, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    }, { passive: false });
  }

  setView(v: 'local' | 'system'): void {
    this.view = v;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  draw(ship: Ship, targetId: string): void {
    this.ship = ship;
    this.targetId = targetId;
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Background.
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    grad.addColorStop(0, '#141c3b');
    grad.addColorStop(0.55, '#0c1226');
    grad.addColorStop(1, '#070b16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (const s of this.stars) {
      ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(s.x * 30));
      ctx.fillStyle = '#dceaff';
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.bodies = [];

    if (this.view === 'system') this.drawSystem(ctx, ship, w, h);
    else this.drawLocal(ctx, ship, w, h);

    // Header meta handled by DOM.
  }

  private drawLocal(ctx: CanvasRenderingContext2D, ship: Ship, w: number, h: number): void {
    const body = ship.currentBody;
    const bs = body.globalState(ship.time);
    const shipRel = ship.pos.clone().sub(bs.pos);
    const shipEl = orbitalElements(shipRel, ship.bodyRelativeVelocity(), body.mu);
    const target = BODY[this.targetId as keyof typeof BODY] ?? BODY.luna;
    const targetOrbit = target.parent === body ? target.orbit : null;
    const children = BODIES.filter((b) => b.parent === body);
    let extent = body.radius * 2.4;
    if (shipEl.isElliptic) extent = Math.max(extent, shipEl.apoapsis * 1.16);
    for (const c of children) {
      if (c.orbit) extent = Math.max(extent, c.orbit.a * 1.15);
    }
    if (target.parent === body && target.orbit) extent = Math.max(extent, target.orbit.a * 1.18);
    if (body.id !== 'terra' && body.id !== 'sol') extent = Math.max(extent, body.soiRadius * 0.9);
    const zoom = this.zoom;
    const scale = (Math.min(w, h) * 0.36 / extent) * zoom;
    const cx = w * 0.5 + this.panX;
    const cy = h * 0.5 + this.panY;
    const project = (v: Vector3) => ({ x: cx + v.x * scale, y: cy + v.z * scale });

    // Orbit grid rings.
    for (let i = 1; i <= 3; i++) {
      const r = (extent * i) / 3.2;
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(150,190,255,0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 9]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Child orbits.
    for (const c of children) {
      if (!c.orbit) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, c.orbit.a * scale, 0, Math.PI * 2);
      ctx.strokeStyle = c.id === target.id ? 'rgba(255,128,106,0.56)' : 'rgba(205,187,255,0.24)';
      ctx.lineWidth = c.id === target.id ? 1.6 : 1.2;
      ctx.setLineDash(c.id === target.id ? [] : [3, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Body position.
      const cp = c.globalState(ship.time).pos.clone().sub(bs.pos);
      const sp = project(cp);
      this.drawBodyDot(ctx, c, sp.x, sp.y, Math.max(4, c.radius * scale), c.id === target.id);
    }

    // Ship orbit.
    if (shipEl.isElliptic) {
      const pts = sampleOrbit(shipEl, 180);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = project(pts[i]);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(85,201,198,0.18)';
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = '#7DE1DA';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      // Ap/Pe markers.
      const apPt = project(shipEl.eHat.clone().multiplyScalar(-shipEl.apoapsis));
      const pePt = project(shipEl.eHat.clone().multiplyScalar(shipEl.periapsis));
      this.drawApPe(ctx, apPt.x, apPt.y, 'Ap', '#FFE27A');
      this.drawApPe(ctx, pePt.x, pePt.y, 'Pe', '#FF9C8A');
    }

    // SOI of target or current body.
    const soiBody = target.parent === body ? target : (body.parent ? body : null);
    if (soiBody) {
      const r = soiBody.soiRadius * scale;
      if (r < Math.max(w, h) * 2.2) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(205,187,255,0.22)';
        ctx.setLineDash([5, 8]);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Body.
    const br = Math.max(12, body.radius * scale);
    const bgrad = ctx.createRadialGradient(cx - br * 0.35, cy - br * 0.35, br * 0.1, cx, cy, br);
    bgrad.addColorStop(0, this.color(body.appearance.primary));
    bgrad.addColorStop(0.7, this.color(body.appearance.secondary));
    bgrad.addColorStop(1, this.color(body.appearance.ocean));
    ctx.fillStyle = bgrad;
    ctx.beginPath(); ctx.arc(cx, cy, br, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,247,225,0.35)'; ctx.lineWidth = 1.4; ctx.stroke();
    this.drawLabel(ctx, body.name.toUpperCase(), cx, cy + br + 15, '#FFF7E9', 'rgba(20,28,59,0.85)');
    this.bodies.push({ body, x: cx, y: cy, r: br });

    // Target body.
    if (target !== body && target.parent === body) {
      const tp = target.globalState(ship.time).pos.clone().sub(bs.pos);
      const sp = project(tp);
      this.drawTargetReticle(ctx, sp.x, sp.y);
      this.bodies.push({ body: target, x: sp.x, y: sp.y, r: 8 });
    }

    // Ship marker.
    const sp = project(shipRel);
    this.drawShipMarker(ctx, sp.x, sp.y, ship);
    // Velocity vector.
    const v = ship.bodyRelativeVelocity().normalize();
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(sp.x + v.x * 38, sp.y + v.z * 38);
    ctx.strokeStyle = 'rgba(125,255,178,0.75)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sp.x + v.x * 38, sp.y + v.z * 38, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = '#7DFFB2'; ctx.fill();
    this.drawLabel(ctx, 'SHIP', sp.x, sp.y - 16, '#7DFFB2', 'rgba(10,20,35,0.75)');

    // Center crosshair.
    ctx.strokeStyle = 'rgba(255,247,233,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10); ctx.stroke();
  }

  private drawSystem(ctx: CanvasRenderingContext2D, ship: Ship, w: number, h: number): void {
    const sun = BODY.sol;
    const planets = BODIES.filter((b) => b.parent === sun);
    const extent = Math.max(...planets.map((p) => p.orbit?.a ?? 0)) * 1.12;
    const scale = (Math.min(w, h) * 0.34 / extent) * this.zoom;
    const cx = w * 0.5 + this.panX;
    const cy = h * 0.5 + this.panY;
    const project = (v: Vector3) => ({ x: cx + v.x * scale, y: cy + v.z * scale });
    const sunPos = sun.globalState(ship.time).pos;
    for (const p of planets) {
      if (!p.orbit) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, p.orbit.a * scale, 0, Math.PI * 2);
      ctx.strokeStyle = p.id === this.targetId ? 'rgba(255,128,106,0.6)' : 'rgba(205,187,255,0.18)';
      ctx.setLineDash(p.id === this.targetId ? [] : [3, 8]);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      const pp = p.globalState(ship.time).pos.clone().sub(sunPos);
      const sp = project(pp);
      const r = Math.max(4, Math.min(12, p.radius * scale * 4));
      this.drawBodyDot(ctx, p, sp.x, sp.y, r, p.id === this.targetId);
    }
    // Sun.
    const sg = ctx.createRadialGradient(cx, cy, 2, cx, cy, 30);
    sg.addColorStop(0, '#FFF8D6'); sg.addColorStop(0.4, '#FFD36E'); sg.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFF3C4'; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
    this.drawLabel(ctx, 'SOL', cx, cy + 30, '#FFE27A', 'rgba(20,28,59,0.85)');
    this.bodies.push({ body: sun, x: cx, y: cy, r: 8 });

    // Ship current body.
    const cb = ship.currentBody;
    for (const p of planets) {
      if (p.id !== cb.id) continue;
      const pp = p.globalState(ship.time).pos.clone().sub(sunPos);
      const sp = project(pp);
      this.drawShipMarker(ctx, sp.x, sp.y, ship);
    }
    if (cb.id === 'sol') this.drawShipMarker(ctx, cx, cy, ship);

    // Target line.
    const target = BODY[this.targetId as keyof typeof BODY];
    if (target && target.parent === sun) {
      const tp = target.globalState(ship.time).pos.clone().sub(sunPos);
      const sp = project(tp);
      this.drawTargetReticle(ctx, sp.x, sp.y);
    }
    ctx.fillStyle = 'rgba(255,247,233,0.3)';
    ctx.font = '700 10px Nunito';
    ctx.textAlign = 'center';
    ctx.fillText('SOL SYSTEM · schematic', cx, h - 50);
  }

  private drawBodyDot(ctx: CanvasRenderingContext2D, b: Body, x: number, y: number, r: number, active: boolean): void {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
    g.addColorStop(0, this.color(b.appearance.primary));
    g.addColorStop(0.75, this.color(b.appearance.secondary));
    g.addColorStop(1, this.color(b.appearance.ocean));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (active) {
      ctx.strokeStyle = '#FF806A';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
    }
    this.drawLabel(ctx, b.name.toUpperCase(), x, y + r + 13, active ? '#FFD2C8' : '#D9D2EF', 'rgba(15,22,45,0.8)');
    this.bodies.push({ body: b, x, y, r });
  }

  private drawTargetReticle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.strokeStyle = '#FF806A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 17, y); ctx.lineTo(x - 7, y);
    ctx.moveTo(x + 7, y); ctx.lineTo(x + 17, y);
    ctx.moveTo(x, y - 17); ctx.lineTo(x, y - 7);
    ctx.moveTo(x, y + 7); ctx.lineTo(x, y + 17);
    ctx.stroke();
  }

  private drawShipMarker(ctx: CanvasRenderingContext2D, x: number, y: number, ship: Ship): void {
    const q = ship.quat;
    const fwd = new Vector3(0, 1, 0).applyQuaternion(q);
    const ang = Math.atan2(fwd.z, fwd.x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = '#7DE1DA';
    ctx.strokeStyle = '#0C1226';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-6, 6); ctx.lineTo(-3, 0); ctx.lineTo(-6, -6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // pulse
    ctx.strokeStyle = 'rgba(125,225,218,0.35)';
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
  }

  private drawApPe(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.font = '800 9px Nunito';
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.fillText(label, x + 5, y - 4);
  }

  private drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, bg: string): void {
    ctx.font = '800 9px Nunito, sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = bg;
    const r = 6;
    const pw = tw + 10, ph = 15;
    const px = x - pw / 2, py = y - ph / 2;
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, r);
    ctx.arcTo(px + pw, py + ph, px, py + ph, r);
    ctx.arcTo(px, py + ph, px, py, r);
    ctx.arcTo(px, py, px + pw, py, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  private color(hex: number): string {
    return '#' + hex.toString(16).padStart(6, '0');
  }

  get dvToTarget(): number {
    const s = this.ship;
    if (!s) return 0;
    const target = BODY[this.targetId as keyof typeof BODY];
    if (!target) return 0;
    const body = s.currentBody;
    if (target.parent !== body || !target.orbit) return 0;
    const r1 = s.pos.clone().sub(body.globalState(s.time).pos).length();
    const r2 = target.orbit.a;
    if (r2 <= r1) return 0;
    const at = (r1 + r2) / 2;
    const v1 = Math.sqrt(body.mu * (2 / r1 - 1 / at));
    const vc = Math.sqrt(body.mu / r1);
    return Math.abs(v1 - vc);
  }
}
