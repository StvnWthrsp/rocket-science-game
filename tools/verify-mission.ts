import { FlightComputer } from '../src/game/autopilot';
import { PRESET_DESIGNS, newDesign } from '../src/game/parts';
import { Ship } from '../src/game/ship';

const preset = PRESET_DESIGNS.find((p) => p.id === 'mooncat');
if (!preset) throw new Error('Moon Cat preset missing');
const ship = new Ship(newDesign(preset.name, preset.stack), 0);
ship.init();
const ap = new FlightComputer();
ap.engage('mission', ship, 'luna');

let sim = 0;
let lunaLanded = false;
let lunaMet = 0;
let lastPhase = '';
const step = 0.05;
let steps = 0;
const limit = 600000;
while (sim < limit && steps < 1500000) {
  const controls = ap.update(ship, step);
  const t = ship.telemetry();
  let warp = 1;
  if (ap.warpRequest > 1 && controls.throttle < 0.001 && !ship.landed) {
    warp = Math.min(10000, ap.warpRequest);
  }
  const safe = !ship.landed
    && t.periapsis > (ship.currentBody.atmosphere ? ship.currentBody.atmosphere.height + 5000 : 5000)
    && (!ship.currentBody.atmosphere || t.altitude > ship.currentBody.atmosphere.height + 3000);
  if (warp > 4 && safe) {
    ship.railsStep(warp * 0.1);
    sim += warp * 0.1;
  } else {
    ship.update(step, controls);
    sim += step;
  }
  ship.events.length = 0;
  steps++;
  if (ship.landed && ship.currentBody.id === 'luna') {
    lunaLanded = true;
    lunaMet = ship.met;
  }
  if (ap.phase !== lastPhase) {
    lastPhase = ap.phase;
    if (['capture', 'descent', 'landed', 'escape-burn', 'return-cruise', 'reentry', 'complete', 'failed'].includes(ap.phase)) {
      console.log((ship.met / 3600).toFixed(2) + 'h', ap.phase, ap.statusLabel, '| alt', (ship.telemetry().altitude / 1000).toFixed(0) + 'km', '| fuel', ship.stageFuel(0).toFixed(0) + 'kg');
    }
  }
  if (ship.crashed) break;
  if (ap.phase === 'complete') break;
  if (ship.landed && ship.currentBody.id === 'terra' && lunaLanded) break;
}
const final = ship.telemetry();
const ok = lunaLanded && ship.landed && ship.currentBody.id === 'terra' && !ship.crashed;
console.log(JSON.stringify({
  ok,
  lunaLanded,
  lunaMetHours: +(lunaMet / 3600).toFixed(2),
  missionHours: +(ship.met / 3600).toFixed(2),
  body: final.bodyName,
  altitude: +final.altitude.toFixed(1),
  crashed: ship.crashed,
  phase: ap.phase,
  fuelKg: +ship.stageFuel(0).toFixed(0),
  steps,
}, null, 2));
if (!ok) {
  console.error('MISSION FAILED');
  process.exit(1);
}
console.log('MISSION OK: launch → orbit → Luna landing → return → Terra landing');
