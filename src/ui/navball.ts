import { Quaternion, Vector3 } from 'three';
import type { Ship } from '../game/ship';
import { BODY } from '../game/bodies';
import { clamp, orbitalElements } from '../game/math';

const Y = new Vector3(0, 1, 0);

export class Navball {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  size = 380;
  last = { heading: 0, pitch: 0, roll: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    const css = Math.max(180, rect.width || 380);
    this.size = Math.round(css * this.dpr);
    this.canvas.width = this.size;
    this.canvas.height = this.size;
  }

  draw(ship: Ship, targetId: string): void {
    const ctx = this.ctx;
    const S = this.size;
    const c = S / 2;
    const R = S * 0.43;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(c, c);

    // Outer bezel.
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.09, 0, Math.PI * 2);
    ctx.fillStyle = '#FFF7E6';
    ctx.fill();
    ctx.lineWidth = S * 0.012;
    ctx.strokeStyle = '#E7CEAA';
    ctx.stroke();
    // Tick marks.
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r0 = R * 1.0;
      const r1 = i % 3 === 0 ? R * 1.075 : R * 1.045;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.strokeStyle = i % 3 === 0 ? '#8F766A' : '#C7AF93';
      ctx.lineWidth = i % 3 === 0 ? S * 0.008 : S * 0.004;
      ctx.stroke();
    }
    // North marker (top).
    ctx.beginPath();
    ctx.moveTo(0, -R * 1.075);
    ctx.lineTo(-S * 0.022, -R * 1.125);
    ctx.lineTo(S * 0.022, -R * 1.125);
    ctx.closePath();
    ctx.fillStyle = '#FF806A';
    ctx.fill();

    // Ball.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.clip();
    const bg = ctx.createRadialGradient(-R * 0.2, -R * 0.3, R * 0.1, 0, 0, R);
    bg.addColorStop(0, '#29486F');
    bg.addColorStop(1, '#0F182B');
    ctx.fillStyle = bg;
    ctx.fillRect(-R, -R, R * 2, R * 2);

    const shipUp = new Vector3(0, 0, 1).applyQuaternion(ship.quat);
    const qInv = ship.quat.clone().invert();
    const fwd = new Vector3(0, 1, 0).applyQuaternion(ship.quat);
    const bs = ship.currentBody.globalState(ship.time);
    const rel = ship.pos.clone().sub(bs.pos);
    const up = rel.clone().normalize();
    const east = new Vector3().crossVectors(Y, up).normalize();
    const north = new Vector3().crossVectors(up, east).normalize();
    const pitch = Math.asin(clamp(fwd.dot(up), -1, 1)) * 180 / Math.PI;
    const heading = (Math.atan2(fwd.dot(east), fwd.dot(north)) * 180 / Math.PI + 360) % 360;

    // Roll: angle from world up to the ship's local up around the nose.
    const projUp = up.clone().addScaledVector(fwd, -up.dot(fwd));
    const projShipUp = shipUp.clone().addScaledVector(fwd, -shipUp.dot(fwd));
    let roll = 0;
    if (projUp.lengthSq() > 1e-8 && projShipUp.lengthSq() > 1e-8) {
      projUp.normalize(); projShipUp.normalize();
      roll = Math.atan2(fwd.dot(new Vector3().crossVectors(projUp, projShipUp)), projUp.dot(projShipUp));
    }
    const rollDeg = roll * 180 / Math.PI;

    ctx.save();
    ctx.rotate(-roll);
    // Horizon offset: positive pitch = nose up = horizon below.
    const hy = clamp(pitch / 90, -1.3, 1.3) * R * 1.1;
    // Ground.
    ctx.fillStyle = '#C99B6D';
    ctx.fillRect(-R * 2, hy, R * 4, R * 4);
    // Sky is the ball background; add a subtle band.
    const skyBand = ctx.createLinearGradient(0, -R, 0, hy);
    skyBand.addColorStop(0, 'rgba(86,166,220,0)');
    skyBand.addColorStop(1, 'rgba(86,166,220,0.28)');
    ctx.fillStyle = skyBand;
    ctx.fillRect(-R, -R, R * 2, hy + R);
    // Horizon line.
    ctx.strokeStyle = '#FFF5DC';
    ctx.lineWidth = S * 0.006;
    ctx.beginPath();
    ctx.moveTo(-R * 2, hy);
    ctx.lineTo(R * 2, hy);
    ctx.stroke();
    // Pitch ladder.
    ctx.font = `700 ${Math.round(S * 0.027)}px Nunito, sans-serif`;
    ctx.fillStyle = 'rgba(255,247,230,0.82)';
    ctx.strokeStyle = 'rgba(255,247,230,0.5)';
    ctx.lineWidth = S * 0.003;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const spacing = R * 1.1 / 90;
    for (let d = -80; d <= 80; d += 10) {
      if (d === 0) continue;
      const yy = hy - d * spacing;
      if (Math.abs(yy) > R * 1.2) continue;
      const len = (d % 30 === 0 ? R * 0.26 : R * 0.15);
      ctx.beginPath();
      ctx.moveTo(-len, yy);
      ctx.lineTo(0, yy);
      ctx.moveTo(len * 0.6, yy);
      ctx.lineTo(len, yy);
      ctx.stroke();
      if (d % 30 === 0) ctx.fillText(String(Math.abs(d)), len + S * 0.012, yy);
    }
    ctx.restore();

    // Compass tape.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.999, Math.PI * 1.08, Math.PI * 1.92);
    ctx.strokeStyle = 'rgba(255,247,230,0.24)';
    ctx.lineWidth = S * 0.005;
    ctx.stroke();
    for (let d = 0; d < 360; d += 15) {
      const relA = (d - heading) * Math.PI / 180;
      if (Math.abs(relA) > Math.PI * 0.44) continue;
      const a = -Math.PI / 2 + relA;
      const r0 = R * 0.94;
      const r1 = R * (d % 45 === 0 ? 0.88 : 0.91);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.strokeStyle = d % 90 === 0 ? 'rgba(255,224,122,0.9)' : 'rgba(255,247,230,0.55)';
      ctx.lineWidth = d % 45 === 0 ? S * 0.006 : S * 0.003;
      ctx.stroke();
      if (d % 90 === 0) {
        ctx.fillStyle = 'rgba(255,247,230,0.8)';
        ctx.font = `700 ${Math.round(S * 0.024)}px Nunito`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(d).padStart(3, '0'), Math.cos(a) * R * 0.81, Math.sin(a) * R * 0.81);
      }
    }
    ctx.restore();

    // Markers.
    const marker = (dir: Vector3, color: string, label: string, dotOnly = false) => {
      const local = dir.clone().normalize().applyQuaternion(qInv);
      const front = local.y;
      let x = local.x;
      let y = -local.z;
      const len = Math.hypot(x, y);
      if (len < 1e-5) { x = 0; y = 0; } else { x /= len; y /= len; }
      const ang = Math.acos(clamp(front, -1, 1));
      const rad = Math.min(1, ang / (Math.PI / 2)) * R * 0.86;
      const px = x * rad;
      const py = y * rad;
      const alpha = front < -0.1 ? 0.28 : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      if (dotOnly) {
        ctx.beginPath(); ctx.arc(px, py, S * 0.014, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(px, py, S * 0.017, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = S * 0.006;
        ctx.beginPath(); ctx.arc(px, py, S * 0.033, 0, Math.PI * 2); ctx.stroke();
        if (label) {
          ctx.font = `800 ${Math.round(S * 0.024)}px Nunito`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, px + S * 0.045, py);
        }
      }
      ctx.globalAlpha = 1;
    };

    const vSurf = ship.vel.clone().sub(ship.currentBody.globalState(ship.time).vel);
    if (vSurf.lengthSq() > 4) {
      marker(vSurf.clone().normalize(), '#7DFFB2', '');
      marker(vSurf.clone().normalize().negate(), '#FF9C8A', '');
    }
    const el = orbitalElements(rel, vSurf, ship.currentBody.mu);
    marker(el.hHat, '#D4B6FF', '', true);
    marker(el.hHat.clone().negate(), '#D4B6FF', '', true);
    marker(up, '#8FE6FF', '', true);
    marker(up.clone().negate(), '#8FE6FF', '', true);
    const tgt = BODY[targetId as keyof typeof BODY] ?? BODY.luna;
    const tdir = tgt.globalState(ship.time).pos.clone().sub(ship.pos).normalize();
    marker(tdir, '#FFE27A', 'TGT');

    // Ship reference symbol at center.
    ctx.strokeStyle = '#FFB03A';
    ctx.fillStyle = 'rgba(255,176,58,0.2)';
    ctx.lineWidth = S * 0.006;
    ctx.beginPath();
    ctx.moveTo(0, -S * 0.045);
    ctx.lineTo(S * 0.032, S * 0.028);
    ctx.lineTo(0, S * 0.014);
    ctx.lineTo(-S * 0.032, S * 0.028);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-S * 0.055, 0); ctx.lineTo(-S * 0.028, 0);
    ctx.moveTo(S * 0.028, 0); ctx.lineTo(S * 0.055, 0);
    ctx.stroke();

    // Roll pointer on the bezel.
    const ra = -Math.PI / 2 + roll;
    ctx.save();
    ctx.translate(Math.cos(ra) * R * 1.02, Math.sin(ra) * R * 1.02);
    ctx.rotate(ra + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -S * 0.025);
    ctx.lineTo(-S * 0.016, S * 0.008);
    ctx.lineTo(S * 0.016, S * 0.008);
    ctx.closePath();
    ctx.fillStyle = '#FFB03A';
    ctx.fill();
    ctx.restore();

    ctx.restore();
    ctx.restore();

    this.last.heading = heading;
    this.last.pitch = pitch;
    this.last.roll = rollDeg;
  }
}
