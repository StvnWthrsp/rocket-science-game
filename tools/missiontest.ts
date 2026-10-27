import { Ship } from '../src/game/ship';
import { FlightComputer } from '../src/game/autopilot';
import { PRESET_DESIGNS, newDesign } from '../src/game/parts';
import { altitudeOf, globalToBodyFixedDir } from '../src/game/bodies';

const preset = PRESET_DESIGNS.find(p => p.id === 'mooncat')!;
const ship = new Ship(newDesign(preset.name, preset.stack), 0);
ship.init();
const ap = new FlightComputer();
ap.engage('mission', ship, 'luna');
let sim = 0, lastPhase = '', logT = 0;
const dt = 0.05;
let steps = 0;
while (sim < 12 * 86400 && steps < 2_000_000) {
  const controls = ap.update(ship, dt);
  const alt = ship.telemetry().altitude;
  let warp = 1;
  const tel0 = ship.telemetry();
  const safe = tel0.periapsis > 5000 && (!ship.currentBody.atmosphere || alt > 85000);
  if (ap.warpRequest >= 5 && safe && controls.throttle < 0.001 && !ship.landed && !ship.crashed) {
    warp = Math.min(ap.warpRequest, 1000);
  }
  if (warp > 1) {
    ship.railsStep(warp * 0.15);
    sim += warp * 0.15;
  } else {
    ship.update(dt, controls);
    sim += dt;
  }
  steps++;
  if (ship.events.length) {
    for (const e of ship.events) {
      if (e.type !== 'warpstop') console.log(`[${(sim/3600).toFixed(2)}h] EVENT ${e.type}: ${e.title} ${e.detail ?? ''}`);
    }
    ship.events.length = 0;
  }
  if (ap.phase !== lastPhase) {
    if (Object.keys(ap.debugInfo).length) console.log('DEBUG transfer', ap.debugInfo, 'closest', ap.closestTarget);
    console.log(`[${(sim/3600).toFixed(2)}h] PHASE ${ap.phase} :: ${ap.statusLabel} :: ${ap.statusDetail}`);
    lastPhase = ap.phase;
  }
  if (sim - logT > 1800) {
    logT = sim;
    const t = ship.telemetry();
    console.log(`[${(sim/3600).toFixed(2)}h] ${ap.phase} alt=${(t.altitude/1000).toFixed(0)}km ap=${(t.apoapsis/1000).toFixed(0)} pe=${(t.periapsis/1000).toFixed(0)} spd=${t.speed.toFixed(0)} fuel=${t.fuelStage.toFixed(0)}/${t.fuelStageMax.toFixed(0)} mono=${t.monoprop.toFixed(0)} stg=${ship.stages.length} body=${t.bodyName} mass=${(t.mass/1000).toFixed(1)}t`);
  }
  if (ap.phase === 'transfer-coast' && Math.round(sim/600) !== Math.round((sim-dt)/600)) console.log('CLOSEST?', (ap.closestTarget/1000).toFixed(0), 'km at', (ap.closestAt/3600).toFixed(2), 'h; ship', (ship.telemetry().altitude/1000).toFixed(0), 'km', ship.telemetry().bodyName);
  const tlow = ship.telemetry();
  if (!ship.landed && tlow.altitude < 900 && ship.currentBody.id === 'luna') console.log('LOW', (sim/3600).toFixed(5), 'alt', tlow.altitude.toFixed(1), 'v', tlow.verticalSpeed.toFixed(1), 'phase', ap.phase, 'warp', ap.warpRequest, 'thr', controls.throttle.toFixed(2), 'fuel', tlow.fuelStage.toFixed(0), 'crashed', ship.crashed, 'body', ship.currentBody.id, '|v|', ship.vel.length().toFixed(0), '|bv|', ship.currentBody.globalState(ship.time).vel.length().toFixed(0), 'rel', ship.pos.clone().sub(ship.currentBody.globalState(ship.time).pos).length().toFixed(0), 'surf', ship.currentBody.surfaceRadiusAt(globalToBodyFixedDir(ship.currentBody, ship.pos.clone().sub(ship.currentBody.globalState(ship.time).pos).normalize(), ship.time)).toFixed(0));
  if ((ap.phase === 'descent') && Math.floor(sim*2) !== Math.floor((sim-dt)*2)) console.log('DESC', (sim/3600).toFixed(4), JSON.stringify(ap.descentDebug), 'landed', ship.landed, 'clear', (ship.pos.clone().sub(ship.currentBody.globalState(ship.time).pos).length() - ship.currentBody.surfaceRadiusAt(globalToBodyFixedDir(ship.currentBody, ship.pos.clone().sub(ship.currentBody.globalState(ship.time).pos).normalize(), ship.time)) - ship.computeLayout().comHeight).toFixed(2));
  if (ap.phase === 'complete' || ap.phase === 'failed' || ship.crashed) {
    console.log('END', ap.phase, ap.failure, 'sim', (sim/3600).toFixed(2)+'h', 'met', (ship.met/3600).toFixed(2)+'h');
    break;
  }
}
const t = ship.telemetry();
console.log('FINAL', { phase: ap.phase, label: ap.statusLabel, detail: ap.statusDetail, failure: ap.failure, met: ship.met, body: t.bodyName, alt: t.altitude, landed: ship.landed, crashed: ship.crashed, stages: ship.stages.length, mass: t.mass, fuel: t.fuelStage, mono: t.monoprop });
console.log('events history:', ap.history);
