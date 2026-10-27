import { G0 } from './math';

export type PartKind = 'pod' | 'tank' | 'engine' | 'decoupler' | 'chute' | 'sas' | 'rcs' | 'fins' | 'legs' | 'nose' | 'srb';

export interface PartDef {
  id: string;
  name: string;
  kind: PartKind;
  radius: number; // 0 = auto-fit collar
  height: number;
  dryMass: number; // kg
  fuel: number; // kg of liquid fuel / solid propellant
  thrust: number; // N, vacuum
  thrustSL?: number;
  ispVac: number;
  ispSL?: number;
  torque: number; // reaction wheel / RCS torque, N m
  monoprop: number; // kg
  gimbal: number; // degrees
  crew: number;
  cost: number;
  dragArea: number; // m^2 added
  stability: number;
  description: string;
  solid?: boolean;
  chuteArea?: number;
  radialCount?: number;
  tier: number;
}

export interface PartInstance {
  uid: number;
  defId: string;
  fuel: number;
}

export interface RocketDesign {
  name: string;
  stack: PartInstance[]; // top -> bottom
  version: number;
}

export const PARTS: PartDef[] = [
  {
    id: 'pod_mk1', name: 'Mk1 Catpod', kind: 'pod', radius: 0.625, height: 1.55, dryMass: 950, fuel: 0, thrust: 0, ispVac: 0, torque: 9000, monoprop: 0, gimbal: 0, crew: 1, cost: 1800, dragArea: 1.4, stability: 0.2,
    description: 'A one-cat capsule with a big round window, velcro paw-hooks, and a very serious antenna.', tier: 1,
  },
  {
    id: 'pod_mk2', name: 'Mk2 Twin Catpod', kind: 'pod', radius: 1.25, height: 2.5, dryMass: 2400, fuel: 0, thrust: 0, ispVac: 0, torque: 24000, monoprop: 0, gimbal: 0, crew: 3, cost: 4200, dragArea: 5.2, stability: 0.25,
    description: 'Room for three cats, a snack drawer, and one (1) extremely important nap nook.', tier: 2,
  },
  {
    id: 'nose', name: 'Whisker Nose Cone', kind: 'nose', radius: 0.625, height: 1.35, dryMass: 90, fuel: 0, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 140, dragArea: 0.1, stability: 0.4,
    description: 'Sleek aerodynamic cap. Improves style by at least forty percent.', tier: 1,
  },
  {
    id: 'chute_s', name: 'Paw-Chute', kind: 'chute', radius: 0.625, height: 0.6, dryMass: 90, fuel: 0, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 750, dragArea: 0, stability: 0, chuteArea: 650,
    description: 'A striped emergency parachute. Rated for one capsule and any number of cats.', tier: 1,
  },
  {
    id: 'chute_l', name: 'Big Paw-Chute', kind: 'chute', radius: 1.25, height: 0.75, dryMass: 150, fuel: 0, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 1300, dragArea: 0, stability: 0, chuteArea: 1450,
    description: 'Three canopies, one very relaxed descent. Slows heavy capsules with ease.', tier: 2,
  },
  {
    id: 'sas_s', name: 'SAS Wheel', kind: 'sas', radius: 0.625, height: 0.5, dryMass: 420, fuel: 0, thrust: 0, ispVac: 0, torque: 18000, monoprop: 0, gimbal: 0, crew: 0, cost: 700, dragArea: 0.55, stability: 0,
    description: 'Reaction wheels that keep the nose where you left it. The autopilot loves these.', tier: 1,
  },
  {
    id: 'sas_l', name: 'Heavy SAS Ring', kind: 'sas', radius: 1.25, height: 0.7, dryMass: 900, fuel: 0, thrust: 0, ispVac: 0, torque: 62000, monoprop: 0, gimbal: 0, crew: 0, cost: 2100, dragArea: 2.2, stability: 0,
    description: 'A fat ring of gyros for a fat rocket. Turns a wobbling tower into a ballerina.', tier: 2,
  },
  {
    id: 'rcs', name: 'RCS Thruster Block', kind: 'rcs', radius: 0, height: 0.55, dryMass: 340, fuel: 0, thrust: 0, ispVac: 0, torque: 42000, monoprop: 280, gimbal: 0, crew: 0, cost: 900, dragArea: 0.3, stability: 0, radialCount: 4,
    description: 'Four tiny puffers for delicate translation. Essential for docking and gentle landings.', tier: 2,
  },
  {
    id: 'tank_s', name: 'Kitten Tank', kind: 'tank', radius: 0.625, height: 1.8, dryMass: 160, fuel: 1400, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 520, dragArea: 0.7, stability: 0,
    description: 'A slim fuel tank for small upper stages and very optimistic plans.', tier: 1,
  },
  {
    id: 'tank_m', name: 'Tabby Tank', kind: 'tank', radius: 1.25, height: 3.8, dryMass: 720, fuel: 14400, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 2100, dragArea: 3.4, stability: 0,
    description: 'The dependable middle child. Holds 14.4 tonnes of cryogenic catnip (fuel).', tier: 1,
  },
  {
    id: 'tank_l', name: 'Maine Coon Tank', kind: 'tank', radius: 1.875, height: 5.6, dryMass: 1650, fuel: 36000, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 5600, dragArea: 8.5, stability: 0,
    description: 'A huge fluffball of propellant. The backbone of any serious lunar attempt.', tier: 2,
  },
  {
    id: 'tank_xl', name: 'Titan Tank', kind: 'tank', radius: 1.875, height: 8.3, dryMass: 2300, fuel: 56000, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 8200, dragArea: 12, stability: 0,
    description: 'For when the mission planner says "more fuel" and you take it personally.', tier: 3,
  },
  {
    id: 'engine_s', name: 'Puff Engine', kind: 'engine', radius: 0.625, height: 1.25, dryMass: 400, fuel: 0, thrust: 65000, thrustSL: 52000, ispVac: 350, ispSL: 260, torque: 0, monoprop: 0, gimbal: 5, crew: 0, cost: 1200, dragArea: 0.55, stability: 0,
    description: 'A small, cheerful vacuum engine. Sips fuel and hums a little tune.', tier: 1,
  },
  {
    id: 'engine_m', name: 'Maine Coon Engine', kind: 'engine', radius: 1.25, height: 1.75, dryMass: 1500, fuel: 0, thrust: 340000, thrustSL: 285000, ispVac: 330, ispSL: 270, torque: 0, monoprop: 0, gimbal: 6, crew: 0, cost: 3600, dragArea: 1.8, stability: 0,
    description: 'A versatile mid-size lifter with a generous bell and a warm orange plume.', tier: 2,
  },
  {
    id: 'engine_vac', name: 'Void Kitten Engine', kind: 'engine', radius: 1.25, height: 2.05, dryMass: 950, fuel: 0, thrust: 130000, thrustSL: 92000, ispVac: 385, ispSL: 300, torque: 0, monoprop: 0, gimbal: 4, crew: 0, cost: 3400, dragArea: 2.1, stability: 0,
    description: 'A high-efficiency vacuum bell. Terrible at sea level, magnificent everywhere else.', tier: 3,
  },
  {
    id: 'engine_l', name: 'Tiger Engine', kind: 'engine', radius: 1.875, height: 2.45, dryMass: 4800, fuel: 0, thrust: 1450000, thrustSL: 1240000, ispVac: 305, ispSL: 265, torque: 0, monoprop: 0, gimbal: 7, crew: 0, cost: 8200, dragArea: 4.2, stability: 0,
    description: 'A thunderous cluster of bells. The launch pad will remember this one.', tier: 3,
  },
  {
    id: 'decoupler_s', name: 'Tiny Decoupler', kind: 'decoupler', radius: 0.625, height: 0.35, dryMass: 70, fuel: 0, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 220, dragArea: 0.3, stability: 0,
    description: 'Pushes stages apart with a satisfying pop. Contains no cats.', tier: 1,
  },
  {
    id: 'decoupler_m', name: 'Standard Decoupler', kind: 'decoupler', radius: 1.25, height: 0.45, dryMass: 150, fuel: 0, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 420, dragArea: 0.8, stability: 0,
    description: 'Separates your rocket into two rockets, which is usually an improvement.', tier: 1,
  },
  {
    id: 'decoupler_l', name: 'Heavy Decoupler', kind: 'decoupler', radius: 1.875, height: 0.55, dryMass: 300, fuel: 0, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 760, dragArea: 1.4, stability: 0,
    description: 'A big, bolted ring with explosive bolts and a very loud countdown.', tier: 2,
  },
  {
    id: 'fins', name: 'Stabilizer Fins (4)', kind: 'fins', radius: 0, height: 0.65, dryMass: 280, fuel: 0, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 380, dragArea: 0.4, stability: 1.8, radialCount: 4,
    description: 'Four swept fins. Keeps the pointy end forward, which is traditionally preferred.', tier: 1,
  },
  {
    id: 'legs', name: 'Landing Legs (4)', kind: 'legs', radius: 0, height: 0.55, dryMass: 420, fuel: 0, thrust: 0, ispVac: 0, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 650, dragArea: 0.2, stability: 0, radialCount: 4,
    description: 'Springy legs with big round feet. Turns a crash into a landing, most of the time.', tier: 2,
  },
  {
    id: 'srb', name: 'Catnip Booster', kind: 'srb', radius: 1.25, height: 4.2, dryMass: 1400, fuel: 9000, thrust: 700000, thrustSL: 620000, ispVac: 220, ispSL: 200, torque: 0, monoprop: 0, gimbal: 0, crew: 0, cost: 2600, dragArea: 3.2, stability: 0, solid: true,
    description: 'A solid rocket booster. Cannot be turned off. This is either a feature or a warning.', tier: 2,
  },
];

export const PART: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]));
export const PART_CATEGORIES: { id: string; name: string; icon: string; kinds: PartKind[] }[] = [
  { id: 'command', name: 'Cats & Command', icon: 'pod', kinds: ['pod', 'nose'] },
  { id: 'fuel', name: 'Fuel', icon: 'tank', kinds: ['tank'] },
  { id: 'engines', name: 'Engines', icon: 'engine', kinds: ['engine', 'srb'] },
  { id: 'structure', name: 'Structure', icon: 'decoupler', kinds: ['decoupler', 'sas'] },
  { id: 'aero', name: 'Aero & Landing', icon: 'fins', kinds: ['fins', 'legs', 'chute'] },
  { id: 'utility', name: 'Utility', icon: 'rcs', kinds: ['rcs'] },
];

let nextUid = 1;
export function makePart(defId: string, fuelFraction = 1): PartInstance {
  const def = PART[defId];
  return { uid: nextUid++, defId, fuel: def.fuel * fuelFraction };
}

export function cloneDesign(design: RocketDesign): RocketDesign {
  return {
    name: design.name,
    version: design.version,
    stack: design.stack.map((p) => ({ uid: nextUid++, defId: p.defId, fuel: p.fuel })),
  };
}

export function newDesign(name: string, stackIds: string[]): RocketDesign {
  return { name, version: 1, stack: stackIds.map((id) => makePart(id)) };
}

export const PRESET_DESIGNS: { id: string; name: string; subtitle: string; stack: string[]; accent: string }[] = [
  {
    id: 'mooncat', name: 'Moon Cat Mk II', subtitle: 'The full Terra → Luna → Terra mission ship', accent: '#FF8A6A',
    stack: ['pod_mk1', 'chute_s', 'sas_s', 'rcs', 'tank_s', 'tank_s', 'tank_s', 'tank_m', 'legs', 'engine_vac', 'decoupler_m', 'tank_l', 'tank_l', 'engine_l', 'fins', 'legs'],
  },
  {
    id: 'orbiter', name: 'Kitten Orbiter', subtitle: 'A light, friendly first-orbit rocket', accent: '#55C9C6',
    stack: ['pod_mk1', 'chute_s', 'sas_s', 'rcs', 'tank_m', 'engine_vac', 'decoupler_m', 'tank_m', 'engine_m', 'engine_m', 'fins', 'legs'],
  },
  {
    id: 'mochi', name: 'Mochi Runner', subtitle: 'A big tank for the little moon', accent: '#B9A3F7',
    stack: ['pod_mk1', 'chute_s', 'sas_l', 'rcs', 'tank_m', 'legs', 'engine_vac', 'decoupler_m', 'tank_xl', 'engine_l', 'fins', 'legs'],
  },
  {
    id: 'heavy', name: 'Chonk Heavy', subtitle: 'Absurd lift capacity. Very cat.', accent: '#F5B942',
    stack: ['pod_mk2', 'chute_l', 'sas_l', 'rcs', 'tank_l', 'legs', 'engine_vac', 'decoupler_l', 'tank_xl', 'tank_xl', 'engine_l', 'engine_l', 'fins', 'legs'],
  },
];

export interface StageInfo {
  index: number;
  parts: PartInstance[];
  engines: PartInstance[];
  tanks: PartInstance[];
  ispVac: number;
  ispSL: number;
  thrustVac: number;
  thrustSL: number;
  fuelMass: number;
  wetMass: number;
  dryMass: number;
  deltaV: number;
  twr: number;
  hasSAS: boolean;
  hasRCS: boolean;
  hasLegs: boolean;
  hasChute: boolean;
  hasPod: boolean;
}

export interface RocketStats {
  totalMass: number;
  dryMass: number;
  fuelMass: number;
  height: number;
  maxRadius: number;
  totalDeltaV: number;
  stages: StageInfo[];
  cost: number;
  crew: number;
  hasPod: boolean;
  hasEngine: boolean;
  hasChute: boolean;
  hasLegs: boolean;
  hasSAS: boolean;
  hasRCS: boolean;
  canLaunch: boolean;
  warnings: string[];
}

export function groupStages(design: RocketDesign): PartInstance[][] {
  const stages: PartInstance[][] = [];
  let current: PartInstance[] = [];
  for (let i = design.stack.length - 1; i >= 0; i--) {
    const p = design.stack[i];
    current.push(p);
    if (PART[p.defId]?.kind === 'decoupler') {
      stages.push(current);
      current = [];
    }
  }
  if (current.length) stages.push(current);
  return stages;
}

export function totalMassOf(design: RocketDesign, stageFrom = 0): number {
  let m = 0;
  for (let i = 0; i < design.stack.length; i++) {
    const p = design.stack[i];
    const def = PART[p.defId];
    if (!def) continue;
    m += def.dryMass + p.fuel + def.monoprop;
  }
  // stageFrom only filters by stage grouping, not by index in stack.
  if (stageFrom > 0) {
    const stages = groupStages(design);
    let keep = 0;
    for (let i = stageFrom; i < stages.length; i++) for (const p of stages[i]) {
      const def = PART[p.defId];
      keep += def.dryMass + p.fuel + def.monoprop;
    }
    return keep;
  }
  return m;
}

export function computeStats(design: RocketDesign): RocketStats {
  const warnings: string[] = [];
  const stageParts = groupStages(design);
  let totalMass = 0, dryMass = 0, fuelMass = 0, height = 0, maxRadius = 0, cost = 0, crew = 0;
  let hasPod = false, hasEngine = false, hasChute = false, hasLegs = false, hasSAS = false, hasRCS = false;
  for (const p of design.stack) {
    const d = PART[p.defId];
    if (!d) continue;
    totalMass += d.dryMass + p.fuel + d.monoprop;
    dryMass += d.dryMass + d.monoprop;
    fuelMass += p.fuel;
    height += d.height;
    maxRadius = Math.max(maxRadius, d.radius);
    cost += d.cost;
    crew += d.crew;
    if (d.kind === 'pod') hasPod = true;
    if (d.kind === 'engine' || d.kind === 'srb') hasEngine = true;
    if (d.kind === 'chute') hasChute = true;
    if (d.kind === 'legs') hasLegs = true;
    if (d.kind === 'sas') hasSAS = true;
    if (d.kind === 'rcs') hasRCS = true;
  }
  if (!hasPod) warnings.push('Add a catpod so someone can steer.');
  if (!hasEngine) warnings.push('Add at least one engine.');
  if (!hasChute) warnings.push('No parachute — re-entry will be extremely free-form.');
  if (design.stack.length < 2) warnings.push('That is less a rocket and more a hat.');

  const stages: StageInfo[] = [];
  for (let i = 0; i < stageParts.length; i++) {
    const parts = stageParts[i];
    const engines = parts.filter((p) => PART[p.defId]?.kind === 'engine' || PART[p.defId]?.kind === 'srb');
    const tanks = parts.filter((p) => PART[p.defId]?.kind === 'tank');
    let thrustVac = 0, thrustSL = 0, mdotVac = 0, mdotSL = 0, fuel = 0;
    for (const e of engines) {
      const d = PART[e.defId];
      thrustVac += d.thrust;
      thrustSL += d.thrustSL ?? d.thrust;
      mdotVac += d.thrust / (d.ispVac * G0);
      mdotSL += (d.thrustSL ?? d.thrust) / ((d.ispSL ?? d.ispVac) * G0);
    }
    for (const t of tanks) fuel += t.fuel;
    const ispVac = mdotVac > 0 ? thrustVac / (mdotVac * G0) : 0;
    const ispSL = mdotSL > 0 ? thrustSL / (mdotSL * G0) : 0;
    // All remaining stages ride on this stage.
    let remaining = 0;
    for (let k = i; k < stageParts.length; k++) for (const p of stageParts[k]) {
      const d = PART[p.defId];
      remaining += d.dryMass + p.fuel + d.monoprop;
    }
    const mf = remaining - fuel;
    const dv = mdotVac > 0 && mf > 0 ? ispVac * G0 * Math.log(remaining / mf) : 0;
    const twr = remaining > 0 ? thrustSL / (remaining * G0) : 0;
    stages.push({
      index: i, parts, engines, tanks, ispVac, ispSL, thrustVac, thrustSL, fuelMass: fuel,
      wetMass: remaining, dryMass: mf, deltaV: dv, twr,
      hasSAS: parts.some((p) => PART[p.defId].kind === 'sas'),
      hasRCS: parts.some((p) => PART[p.defId].kind === 'rcs'),
      hasLegs: parts.some((p) => PART[p.defId].kind === 'legs'),
      hasChute: parts.some((p) => PART[p.defId].kind === 'chute'),
      hasPod: parts.some((p) => PART[p.defId].kind === 'pod'),
    });
  }
  const totalDeltaV = stages.reduce((a, s) => a + s.deltaV, 0);
  return {
    totalMass, dryMass, fuelMass, height, maxRadius, totalDeltaV, stages, cost, crew,
    hasPod, hasEngine, hasChute, hasLegs, hasSAS, hasRCS,
    canLaunch: hasPod && hasEngine && design.stack.length >= 2 && stages[0]?.twr > 1.02,
    warnings,
  };
}

export function findPart(design: RocketDesign, uid: number): PartInstance | undefined {
  return design.stack.find((p) => p.uid === uid);
}

export function stageOfPart(design: RocketDesign, uid: number): number {
  const groups = groupStages(design);
  for (let i = 0; i < groups.length; i++) if (groups[i].some((p) => p.uid === uid)) return i;
  return -1;
}
