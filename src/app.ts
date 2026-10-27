import {
  Color, NoToneMapping, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { FlightScene, makePreviewShip } from './render/flightScene';
import { VabScene } from './render/vabScene';
import { BODY, BODIES } from './game/bodies';
import type { Body } from './game/bodies';
import {
  PART, PART_CATEGORIES, PRESET_DESIGNS, cloneDesign, computeStats, groupStages,
  newDesign,
} from './game/parts';
import type { RocketDesign, RocketStats } from './game/parts';
import { Ship } from './game/ship';
import type { Controls, FlightEvent, SasMode as ShipSasMode } from './game/ship';
import { FlightComputer } from './game/autopilot';
import type { AutoMode } from './game/autopilot';
import { Navball } from './ui/navball';
import { MapView } from './ui/map';
import { AudioEngine } from './ui/audio';
import { partIcon } from './ui/icons';
import { clamp, formatTime } from './game/math';

const SAVE_KEY = 'rocket-science-cats.save.v2';
const WARP_LEVELS = [1, 2, 4, 10, 50, 100, 1000, 10000, 100000];

type AppState = 'menu' | 'vab' | 'flight' | 'map' | 'paused';
type ScreenName = 'menu' | 'vab' | 'flight';

interface Progress {
  started: boolean;
  orbit: boolean;
  luna: boolean;
  mochi: boolean;
  returned: boolean;
  complete: boolean;
  launched: boolean;
  bestTime: number;
  missions: string[];
}

interface Settings {
  volume: number;
  quality: number;
  autoWarp: boolean;
  sound: boolean;
}

interface SaveData {
  version: number;
  name: string;
  stack: string[];
  progress: Progress;
  settings: Settings;
  target: string;
}

const DEFAULT_PROGRESS: Progress = {
  started: false, orbit: false, luna: false, mochi: false, returned: false, complete: false, launched: false, bestTime: 0, missions: [],
};
const DEFAULT_SETTINGS: Settings = { volume: 0.45, quality: 1.6, autoWarp: true, sound: true };

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error('Missing element #' + id);
  return e as T;
}
function maybe<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
function pct(v: number): string { return (clamp(v, 0, 1) * 100).toFixed(0) + '%'; }
function one(v: number, digits = 1): string { return v.toFixed(digits); }
function int(v: number): string { return Math.round(v).toLocaleString('en-US'); }
function kg(v: number): string { return v >= 1000 ? (v / 1000).toFixed(2) + ' t' : Math.round(v) + ' kg'; }
function alt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(Math.abs(v) > 100000 ? 0 : 1) + ' km';
  return v.toFixed(0) + ' m';
}
function speed(v: number): string { return v.toFixed(0) + ' m/s'; }

export class GameApp {
  renderer: WebGLRenderer;
  menuFlight: FlightScene;
  flightScene: FlightScene;
  vab: VabScene;
  navball: Navball;
  map: MapView;
  audio = new AudioEngine();
  state: AppState = 'menu';
  screen: ScreenName = 'menu';
  design!: RocketDesign;
  stats!: RocketStats;
  selectedUid: number | null = null;
  activeCategory = 'command';
  undo: RocketDesign[] = [];
  ship: Ship | null = null;
  autopilot = new FlightComputer();
  targetId = 'luna';
  warpIndex = 0;
  currentWarp = 1;
  autoWarp = true;
  progress: Progress = { ...DEFAULT_PROGRESS, missions: [] };
  settings: Settings = { ...DEFAULT_SETTINGS };
  throttle = 0;
  sasMode: ShipSasMode = 'stability';
  sasEnabled = true;
  rcsEnabled = false;
  gearDeployed = true;
  stageRequested = false;
  chuteRequested = false;
  pressed = new Set<string>();
  hudAccum = 0;
  mapAccum = 0;
  clock = 0;
  previewShip: Ship | null = null;
  modalOpen = false;
  modalPause = false;
  crashShown = false;
  landedShown = false;
  flagPlanted = false;
  orbitToastShown = false;
  completedShown = false;
  autoFailShown = false;
  testing = false;
  audioReady = false;
  declare resize: () => void;
  declare showHelp: () => void;
  declare showSettings: () => void;
  declare showCredits: () => void;
  declare abortToVab: () => void;
  declare abortToMenu: () => void;
  declare showModal: (title: string, bodyHtml: string, actions: { label: string; kind?: 'primary' | 'ghost' | 'coral'; action: () => void }[], closeable?: boolean) => void;
  declare hideModal: () => void;
  declare toast: (message: string, icon?: string, kind?: 'good' | 'warn' | 'bad' | '') => void;
  declare hideLanded: () => void;
  declare updateMenuProgress: () => void;
  declare updateMenuButtons: () => void;
  declare showLoading: (ms?: number) => void;
  declare hideLoadingSoon: () => void;
  declare exposeDebug: () => void;
  declare debugSimulate: (seconds: number) => { met: number; phase: string; body: string; landed: boolean; crashed: boolean; fuel: number; progress: Progress };
  private lastFrame = performance.now();
  private saveTimer = 0;
  private resizeTimer = 0;
  private menuPreviewDesign = '';
  private flightPaused = false;
  private pausedFrom: AppState = 'flight';
  private canvas: HTMLCanvasElement;
  private targetMenuOpen = false;

  constructor() {
    this.canvas = el<HTMLCanvasElement>('view');
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(new Color(0x0a1024), 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.settings.quality));

    this.menuFlight = new FlightScene();
    this.flightScene = new FlightScene();
    this.vab = new VabScene();
    this.navball = new Navball(el<HTMLCanvasElement>('navball'));
    this.map = new MapView(el<HTMLCanvasElement>('map-canvas'));
    this.map.onTarget = (id) => this.setTarget(id, true);

    this.loadSave();
    if (!this.design) {
      this.design = newDesign(PRESET_DESIGNS[0].name, PRESET_DESIGNS[0].stack);
    }
    this.stats = computeStats(this.design);
    this.selectedUid = this.design.stack[0]?.uid ?? null;
    this.autoWarp = this.settings.autoWarp;
    this.buildPartTabs();
    this.renderPartList();
    this.bindUI();
    this.vab.setDesign(this.design);
    this.updateBuilderUI();
    this.resize();
    this.showMenu();
    requestAnimationFrame(this.loop);
    this.hideLoadingSoon();
    (window as unknown as { __game: unknown }).__game = this;
    this.exposeDebug();
  }

  // ------------------------------------------------------------ persistence

  private loadSave(): void {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        this.design = newDesign(PRESET_DESIGNS[0].name, PRESET_DESIGNS[0].stack);
        return;
      }
      const data = JSON.parse(raw) as SaveData;
      this.progress = { ...DEFAULT_PROGRESS, ...(data.progress ?? {}), missions: data.progress?.missions ?? [] };
      this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
      this.targetId = data.target ?? 'luna';
      if (Array.isArray(data.stack) && data.stack.length && data.stack.every((id) => !!PART[id])) {
        this.design = newDesign(data.name || 'Moon Cat Mk II', data.stack);
      } else {
        this.design = newDesign(PRESET_DESIGNS[0].name, PRESET_DESIGNS[0].stack);
      }
    } catch {
      this.design = newDesign(PRESET_DESIGNS[0].name, PRESET_DESIGNS[0].stack);
    }
    this.audio.volume = this.settings.volume;
    this.audio.enabled = this.settings.sound;
  }

  save(): void {
    try {
      const data: SaveData = {
        version: 1,
        name: this.design.name,
        stack: this.design.stack.map((p) => p.defId),
        progress: this.progress,
        settings: this.settings,
        target: this.targetId,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch { /* storage can be unavailable in private mode */ }
  }

  private queueSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 240);
  }

  // ------------------------------------------------------------ screens

  showMenu(): void {
    this.state = 'menu';
    this.screen = 'menu';
    this.hideAllScreens();
    el('screen-menu').classList.remove('hidden');
    this.updateMenuProgress();
    this.menuFlight.setShip(this.previewForMenu(), true);
    this.audio.setEngine(0, 0);
    this.hideLanded();
    this.updateMenuButtons();
  }

  private previewForMenu(): Ship {
    const key = this.design.stack.map((p) => p.defId).join('|') + this.design.name;
    if (!this.previewShip || key !== this.menuPreviewDesign) {
      this.previewShip = makePreviewShip(cloneDesign(this.design));
      this.menuPreviewDesign = key;
    }
    return this.previewShip;
  }

  showVab(): void {
    this.state = 'vab';
    this.screen = 'vab';
    this.hideAllScreens();
    el('screen-vab').classList.remove('hidden');
    this.previewShip = null;
    this.menuPreviewDesign = '';
    this.vab.setDesign(this.design);
    this.updateBuilderUI();
    this.audio.setEngine(0, 0);
    this.audio.click(620);
  }

  launch(): void {
    const stats = computeStats(this.design);
    if (!stats.canLaunch) {
      this.toast(stats.warnings[0] ?? 'This rocket needs a command pod, an engine, and a liftoff TWR above 1.', '⚠️', 'warn');
      return;
    }
    this.save();
    const ship = new Ship(cloneDesign(this.design), 0);
    ship.init();
    this.ship = ship;
    this.flightScene.setShip(ship, false);
    this.autopilot.disengage();
    this.throttle = 0;
    this.sasEnabled = true;
    this.rcsEnabled = false;
    this.gearDeployed = true;
    this.sasMode = 'stability';
    this.warpIndex = 0;
    this.currentWarp = 1;
    this.autoWarp = this.settings.autoWarp;
    this.targetId = this.targetId === 'terra' ? 'luna' : this.targetId;
    this.crashShown = false;
    this.landedShown = false;
    this.flagPlanted = false;
    this.orbitToastShown = false;
    this.completedShown = false;
    this.flightPaused = false;
    this.progress.started = true;
    this.progress.launched = true;
    this.state = 'flight';
    this.screen = 'flight';
    this.hideAllScreens();
    el('screen-flight').classList.remove('hidden');
    this.updateHUD(true);
    this.showLoading(520);
    this.audio.resume();
    this.audio.chime('good');
    this.toast('Liftoff checklist complete. Press SPACE to stage, SHIFT for throttle.', '🚀', 'good');
    this.startEngineAudio();
    this.queueSave();
  }

  private hideAllScreens(): void {
    for (const id of ['screen-menu', 'screen-vab', 'screen-flight', 'screen-map', 'pause']) {
      maybe(id)?.classList.add('hidden');
    }
    if (this.state !== 'map') maybe('screen-map')?.classList.add('hidden');
  }

  // ------------------------------------------------------------ builder

  private buildPartTabs(): void {
    const tabs = el('part-tabs');
    tabs.innerHTML = PART_CATEGORIES.map((cat) => {
      const icon = partIcon(cat.kinds[0]);
      return `<button class="part-tab ${cat.id === this.activeCategory ? 'active' : ''}" data-cat="${cat.id}"><span class="pt-icon">${icon}</span><span>${cat.name.split(' ')[0]}</span></button>`;
    }).join('');
    tabs.querySelectorAll<HTMLButtonElement>('.part-tab').forEach((b) => {
      b.addEventListener('click', () => {
        this.activeCategory = b.dataset.cat ?? 'command';
        tabs.querySelectorAll('.part-tab').forEach((x) => x.classList.toggle('active', x === b));
        this.renderPartList();
        this.audio.click(520);
      });
    });
  }

  private renderPartList(): void {
    const cat = PART_CATEGORIES.find((c) => c.id === this.activeCategory) ?? PART_CATEGORIES[0];
    const parts = Object.values(PART).filter((p) => cat.kinds.includes(p.kind));
    const list = el('part-list');
    list.innerHTML = parts.map((p) => {
      const fuel = p.fuel > 0 ? `${(p.fuel / 1000).toFixed(1)} t fuel` : p.thrust > 0 ? `${(p.thrust / 1000).toFixed(0)} kN` : p.kind;
      return `<button class="part-card" data-part="${p.id}" title="${p.description}">
        <span class="pc-icon" style="color:${p.kind === 'engine' ? '#7F8F9E' : p.kind === 'tank' ? '#E0A23A' : p.kind === 'pod' ? '#E2675C' : '#55C9C6'}">${partIcon(p.kind)}</span>
        <span class="pc-body"><strong>${p.name}</strong><span>${fuel}</span></span>
        <span class="pc-mass">${(p.dryMass / 1000).toFixed(2)}t</span>
      </button>`;
    }).join('');
    list.querySelectorAll<HTMLButtonElement>('.part-card').forEach((b) => {
      b.addEventListener('click', () => {
        this.addPart(b.dataset.part!);
        this.audio.click(660);
      });
    });
    const count = maybe('palette-count');
    if (count) count.textContent = parts.length + ' parts';
  }

  private snapshot(): RocketDesign {
    return cloneDesign(this.design);
  }

  private pushUndo(): void {
    this.undo.push(this.snapshot());
    if (this.undo.length > 24) this.undo.shift();
  }

  addPart(defId: string): void {
    const def = PART[defId];
    if (!def) return;
    this.pushUndo();
    const sel = this.design.stack.findIndex((p) => p.uid === this.selectedUid);
    const newPart = { uid: Math.max(0, ...this.design.stack.map((p) => p.uid)) + 1, defId, fuel: def.fuel };
    let index: number;
    if (def.kind === 'pod' || def.kind === 'nose') {
      index = 0;
    } else if (def.kind === 'engine' || def.kind === 'srb') {
      if (sel >= 0 && ['tank', 'decoupler', 'sas', 'rcs', 'fins', 'legs'].includes(this.design.stack[sel].defId ? PART[this.design.stack[sel].defId].kind : '')) {
        index = sel + 1;
      } else {
        index = this.design.stack.length;
      }
    } else {
      const selKind = sel >= 0 ? PART[this.design.stack[sel].defId]?.kind : undefined;
      index = sel >= 0 ? (selKind === 'engine' || selKind === 'srb' ? sel : sel + 1) : 0;
    }
    this.design.stack.splice(index, 0, newPart);
    this.selectedUid = newPart.uid;
    this.afterDesignChange();
  }

  private removeSelected(): void {
    if (!this.selectedUid) return;
    const idx = this.design.stack.findIndex((p) => p.uid === this.selectedUid);
    if (idx < 0) return;
    this.pushUndo();
    this.design.stack.splice(idx, 1);
    this.selectedUid = this.design.stack[Math.max(0, idx - 1)]?.uid ?? this.design.stack[0]?.uid ?? null;
    this.afterDesignChange();
  }

  private moveSelected(dir: number): void {
    if (!this.selectedUid) return;
    const idx = this.design.stack.findIndex((p) => p.uid === this.selectedUid);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= this.design.stack.length) return;
    this.pushUndo();
    const [p] = this.design.stack.splice(idx, 1);
    this.design.stack.splice(target, 0, p);
    this.afterDesignChange();
  }

  private undoLast(): void {
    const prev = this.undo.pop();
    if (!prev) { this.toast('Nothing to undo.', '↶'); return; }
    this.design = prev;
    this.selectedUid = this.design.stack[0]?.uid ?? null;
    this.afterDesignChange();
    this.toast('Undone.', '↶');
  }

  private afterDesignChange(): void {
    this.stats = computeStats(this.design);
    this.updateBuilderUI();
    this.vab.setDesign(this.design);
    this.queueSave();
  }

  private updateBuilderUI(): void {
    const stats = this.stats;
    el<HTMLInputElement>('design-name').value = this.design.name;
    const set = (id: string, text: string) => { const e = maybe(id); if (e) e.textContent = text; };
    set('stat-dv', int(stats.totalDeltaV));
    set('stat-twr', one(stats.stages[0]?.twr ?? 0, 2));
    set('stat-mass', (stats.totalMass / 1000).toFixed(1) + ' t');
    set('stat-height', stats.height.toFixed(1) + ' m');
    set('stat-crew', stats.crew + (stats.crew === 1 ? ' cat' : ' cats'));
    set('stat-cost', '⌾ ' + int(stats.cost));
    const dvBars = [0, 1, 2].map((i) => stats.stages[i]?.deltaV ?? 0);
    const maxDv = Math.max(4000, ...dvBars);
    ['bar-s1', 'bar-s2', 'bar-s3'].forEach((id, i) => {
      const bar = maybe(id);
      if (bar) bar.style.width = Math.min(100, (dvBars[i] / maxDv) * 100) + '%';
      set(id + 'v', int(dvBars[i]));
    });
    const warnings: string[] = [];
    if (!stats.hasPod) warnings.push('Add a Catpod so a cat can fly this thing.');
    if (!stats.hasEngine) warnings.push('Add at least one engine.');
    if (!stats.hasChute) warnings.push('No parachute. Re-entry will be free-form.');
    if (!stats.hasSAS && !stats.hasRCS) warnings.push('No SAS or RCS. Steering will be very manual.');
    if ((stats.stages[0]?.twr ?? 0) < 1.02) warnings.push('Liftoff TWR is below 1.00 — this rocket is a very expensive bench.');
    if (stats.totalDeltaV < 6500 && stats.canLaunch) warnings.push('Δv is below the ~6.5 km/s needed for a Luna round trip.');
    const warnEl = el('vab-warnings');
    warnEl.innerHTML = warnings.map((w) => `<div class="warn ${w.includes('TWR') ? 'bad' : ''}">⚠ ${w}</div>`).join('');
    const valid = maybe('vab-validity');
    if (valid) {
      valid.textContent = stats.canLaunch ? 'FLIGHT READY' : 'NOT FLIGHT READY';
      valid.className = 'tag ' + (stats.canLaunch ? 'green' : 'coral');
    }
    const launchBtns = ['btn-vab-launch', 'btn-vab-launch2'];
    for (const id of launchBtns) {
      const b = maybe<HTMLButtonElement>(id);
      if (b) { b.disabled = !stats.canLaunch; b.title = stats.canLaunch ? 'Send this rocket to the pad' : 'Fix the warnings first'; }
    }
    this.renderStack();
    this.renderStageMini();
    const tipTitle = warnings.length ? 'Purrcy is concerned' : stats.totalDeltaV >= 7500 ? 'Purrcy approves' : 'Purrcy\'s advice';
    const tip = warnings[0] ?? (stats.totalDeltaV >= 7500 ? 'Plenty of Δv. The Moon is within reach, commander.' : 'This can reach orbit. A bigger upper stage would reach Luna.');
    set('vab-tip-title', tipTitle);
    set('vab-tip-text', tip);
    const catBubble = document.querySelector('.vab-cat-bubble');
    if (catBubble) catBubble.innerHTML = warnings.length ? `“${warnings[0]}”` : `“${tip}”`;
  }

  private renderStack(): void {
    const holder = el('stack-parts');
    if (!this.design.stack.length) {
      holder.innerHTML = '<div class="warn" style="margin:auto">Empty stack. Pick a pod, tank, and engine from the palette.</div>';
      return;
    }
    const stageGroups = groupStages(this.design);
    const stageOf = new Map<number, number>();
    stageGroups.forEach((g, i) => g.forEach((p) => stageOf.set(p.uid, i)));
    const html: string[] = [];
    this.design.stack.forEach((p, i) => {
      const def = PART[p.defId];
      const fuel = def.fuel > 0 ? `${(p.fuel / 1000).toFixed(1)}t` : def.thrust > 0 ? `${(def.thrust / 1000).toFixed(0)}kN` : '';
      html.push(`<button class="stack-chip ${p.uid === this.selectedUid ? 'selected' : ''}" data-uid="${p.uid}">
        <span class="sc-kind">${def.kind}</span><strong>${def.name}</strong><span class="sc-fuel">${fuel}</span></button>`);
      if (def.kind === 'decoupler' && i < this.design.stack.length - 1) {
        html.push(`<div class="stage-divider"><span>STAGE ${this.design.stack.length ? stageGroups.length : 1}</span></div>`);
      }
    });
    holder.innerHTML = html.join('');
    holder.querySelectorAll<HTMLButtonElement>('.stack-chip').forEach((b) => {
      b.addEventListener('click', () => {
        this.selectedUid = Number(b.dataset.uid);
        this.renderStack();
        this.audio.click(480);
      });
    });
  }

  private renderStageMini(): void {
    const holder = el('stage-mini');
    holder.innerHTML = this.stats.stages.map((s, i) => `<div class="stage-mini-row"><span>S${i + 1}</span><div class="sm-bar"><i style="width:${Math.min(100, (s.deltaV / Math.max(1, this.stats.totalDeltaV)) * 100)}%"></i></div><b>${int(s.deltaV)} m/s</b></div>`).join('');
  }

  private showPresets(): void {
    const body = PRESET_DESIGNS.map((p) => `<div style="margin-bottom:8px"><button class="btn btn-ghost btn-block preset-btn" data-preset="${p.id}" style="justify-content:flex-start;text-align:left"><span style="width:9px;height:32px;border-radius:99px;background:${p.accent};display:inline-block"></span><span style="display:flex;flex-direction:column"><strong style="font-size:14px">${p.name}</strong><small style="font-family:Nunito;font-weight:700;opacity:.7">${p.subtitle}</small></span></button></div>`).join('');
    this.showModal('Rocket Presets', body + '<p class="small muted">Presets are starting points. Edit them freely; the Moon Cat Mk II is tuned for a full Luna round trip.</p>', [{ label: 'Close', kind: 'ghost', action: () => this.hideModal() }]);
    document.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const preset = PRESET_DESIGNS.find((p) => p.id === b.dataset.preset);
        if (!preset) return;
        this.pushUndo();
        this.design = newDesign(preset.name, preset.stack);
        this.selectedUid = this.design.stack[0]?.uid ?? null;
        this.afterDesignChange();
        this.hideModal();
        this.toast(preset.name + ' loaded.', '🚀', 'good');
      });
    });
  }

  // ------------------------------------------------------------ loop / render

  private loop = (now: number): void => {
    try {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.clock += dt;
    this.audio.musicTick(dt);
    if (this.state === 'menu') {
      this.menuFlight.update(dt);
      this.menuFlight.render(this.renderer);
    } else if (this.state === 'vab') {
      this.vab.update(dt);
      this.vab.render(this.renderer, new Color(0x140f18));
    } else if (this.state === 'flight' || this.state === 'map') {
      if (!this.flightPaused && !this.modalPause && !this.modalOpen) this.updateFlight(dt);
      if (this.state === 'map') this.updateMap(dt);
      else { this.flightScene.update(dt); this.flightScene.render(this.renderer); }
    } else if (this.state === 'paused') {
      this.flightScene.render(this.renderer);
    }
    if (this.state === 'flight') {
      this.hudAccum += dt;
      if (this.hudAccum > 0.06) { this.hudAccum = 0; this.updateHUD(); }
    }
    } catch (e) { console.error('LOOP-ERROR', e); }
    requestAnimationFrame(this.loop);
  };

  private startEngineAudio(): void {
    this.audio.resume();
    if (!this.audioReady) {
      this.audioReady = true;
    }
  }

  // ------------------------------------------------------------ UI binding

  private bindUI(): void {
    const on = (id: string, ev: string, fn: (e: Event) => void) => {
      const node = maybe(id);
      if (node) node.addEventListener(ev, fn);
    };
    const click = (id: string, fn: () => void) => on(id, 'click', () => { this.audio.resume(); this.audio.click(); fn(); });

    click('btn-continue', () => this.showVab());
    click('btn-menu-start', () => this.showVab());
    click('btn-menu-lab', () => this.showVab());
    click('btn-menu-help', () => this.showHelp());
    click('btn-menu-settings', () => this.showSettings());
    click('btn-menu-credits', () => this.showCredits());

    click('btn-vab-back', () => this.showMenu());
    click('btn-vab-presets', () => this.showPresets());
    click('btn-vab-save', () => { this.save(); this.toast('Design saved to the hangar.', '💾', 'good'); });
    click('btn-vab-launch', () => this.launch());
    click('btn-vab-launch2', () => this.launch());
    click('btn-undo', () => this.undoLast());
    click('btn-stack-up', () => this.moveSelected(-1));
    click('btn-stack-down', () => this.moveSelected(1));
    click('btn-stack-remove', () => this.removeSelected());
    const nameInput = el<HTMLInputElement>('design-name');
    nameInput.addEventListener('input', () => {
      this.design.name = nameInput.value.trim() || 'Untitled Cat Rocket';
      this.queueSave();
    });

    click('btn-flight-map', () => this.toggleMap());
    click('btn-flight-help', () => this.showHelp());
    click('btn-flight-pause', () => this.pause());
    click('btn-sas', () => { this.sasEnabled = !this.sasEnabled; this.audio.click(560); });
    click('btn-rcs', () => { this.rcsEnabled = !this.rcsEnabled; this.audio.click(500); });
    click('btn-gear', () => { this.gearDeployed = !this.gearDeployed; this.audio.click(420); });
    click('btn-chute', () => { this.chuteRequested = true; this.audio.click(600); });
    document.querySelectorAll<HTMLButtonElement>('#sas-modes [data-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        this.abortAuto('Manual attitude control');
        this.sasMode = (b.dataset.mode ?? 'stability') as ShipSasMode;
        this.sasEnabled = true;
        this.audio.click(600);
      });
    });
    click('btn-throttle-zero', () => { this.abortAuto('Manual throttle'); this.throttle = 0; });
    click('btn-throttle-full', () => { this.abortAuto('Manual throttle'); this.throttle = 1; });
    click('btn-stage', () => { this.stageRequested = true; });
    const track = maybe('throttle-track');
    if (track) {
      let dragging = false;
      const setFromEvent = (e: PointerEvent) => {
        const r = track.getBoundingClientRect();
        this.abortAuto('Manual throttle');
        this.throttle = clamp((e.clientX - r.left) / r.width, 0, 1);
        this.updateThrottleUI();
      };
      track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); setFromEvent(e); });
      track.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
      track.addEventListener('pointerup', () => { dragging = false; });
    }
    document.querySelectorAll<HTMLButtonElement>('.warp-buttons [data-warp]').forEach((b) => {
      b.addEventListener('click', () => {
        const v = Number(b.dataset.warp);
        if (v === 0) this.setWarpIndex(0);
        else if (v === -1) this.warpStep(-1);
        else if (v === 1) this.warpStep(1);
        else this.setWarpIndex(Math.min(WARP_LEVELS.length - 1, this.warpIndex + 2));
        this.audio.click(700);
      });
    });
    document.querySelectorAll<HTMLButtonElement>('.auto-buttons [data-auto]').forEach((b) => {
      b.addEventListener('click', () => this.engageAuto((b.dataset.auto ?? 'off') as AutoMode));
    });
    const autoWarp = maybe<HTMLInputElement>('auto-warp');
    if (autoWarp) {
      autoWarp.checked = this.autoWarp;
      autoWarp.addEventListener('change', () => { this.autoWarp = autoWarp.checked; this.settings.autoWarp = autoWarp.checked; this.queueSave(); });
    }
    const targetSelect = maybe<HTMLSelectElement>('target-select');
    if (targetSelect) targetSelect.addEventListener('change', () => this.setTarget(targetSelect.value, false));
    click('btn-plant-flag', () => {
      this.flagPlanted = true;
      this.audio.chime('good');
      this.toast('Flag planted. The Moon is now 0.0001% cat.', '🚩', 'good');
      this.updateHUD();
    });
    click('btn-recover', () => this.recover());
    click('btn-map-close', () => this.closeMap());
    click('btn-map-local', () => { this.map.setView('local'); this.refreshMapButtons(); });
    click('btn-map-system', () => { this.map.setView('system'); this.refreshMapButtons(); });
    click('btn-map-warp', () => {
      const t = this.ship?.telemetry();
      if (!t || t.periapsis < 70000) {
        this.toast('Reach a stable orbit first, then the computer can plan a transfer.', '!', 'warn');
        return;
      }
      this.engageAuto('transfer');
      this.audio.chime('good');
      this.toast('Flight computer is waiting for the transfer window. Auto-warp is on.', '✦', 'good');
    });
    click('btn-resume', () => this.resume());
    click('btn-pause-map', () => { this.resume(); this.openMap(); });
    click('btn-pause-settings', () => this.showSettings());
    click('btn-pause-vab', () => this.abortToVab());
    click('btn-pause-menu', () => this.abortToMenu());
    click('btn-modal-close', () => this.hideModal());

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    window.addEventListener('blur', () => this.pressed.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'flight' || this.state === 'map')) this.pause();
    });
    window.addEventListener('resize', () => this.resize());
    const firstGesture = () => { this.audio.resume(); window.removeEventListener('pointerdown', firstGesture); };
    window.addEventListener('pointerdown', firstGesture);
    this.bindCanvas();
    this.buildWarpList();
    this.refreshMapTargets();
    this.setTarget(this.targetId, false);
  }

  private bindCanvas(): void {
    const canvas = this.canvas;
    let drag = false;
    let lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.state === 'map') return;
      drag = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (this.state === 'vab') this.vab.orbitInput(dx, dy);
      else if (this.state === 'menu') this.menuFlight.orbitInput(dx, dy);
      else this.flightScene.orbitInput(dx, dy);
    });
    const up = (e: PointerEvent) => {
      drag = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.state === 'vab') this.vab.zoomInput(e.deltaY);
      else if (this.state === 'menu') this.menuFlight.zoomInput(e.deltaY);
      else if (this.state === 'flight' || this.state === 'paused') this.flightScene.zoomInput(e.deltaY);
    }, { passive: false });
  }

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.code === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    if (this.modalOpen) {
      if (e.code === 'Escape') { e.preventDefault(); this.hideModal(); }
      return;
    }
    if (this.state === 'menu' || this.state === 'vab') {
      if (e.code === 'Escape' && this.state === 'vab') this.showMenu();
      return;
    }
    if (this.state === 'paused') {
      if (e.code === 'Escape') this.resume();
      return;
    }
    const movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyH', 'KeyN'];
    if (movement.indexOf(e.code) >= 0 && this.autopilot.active) this.abortAuto('Manual input');
    if (movement.indexOf(e.code) >= 0) this.pressed.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case 'Escape': e.preventDefault(); this.pause(); break;
      case 'KeyM': e.preventDefault(); this.toggleMap(); break;
      case 'KeyT': this.sasEnabled = !this.sasEnabled; this.audio.click(560); break;
      case 'KeyR': this.rcsEnabled = !this.rcsEnabled; this.audio.click(500); break;
      case 'KeyG': this.gearDeployed = !this.gearDeployed; this.audio.click(420); break;
      case 'KeyP': this.chuteRequested = true; break;
      case 'Space': e.preventDefault(); this.stageRequested = true; break;
      case 'KeyZ': this.abortAuto('Manual throttle'); this.throttle = 1; break;
      case 'KeyX': this.abortAuto('Manual throttle'); this.throttle = 0; break;
      case 'ShiftLeft': case 'ShiftRight': case 'ControlLeft': case 'ControlRight': e.preventDefault(); break;
      case 'Comma': this.warpStep(-1); break;
      case 'Period': this.warpStep(1); break;
      case 'KeyH': this.showHelp(); break;
    }
  }

  // ------------------------------------------------------------ flight loop

  private makeControls(dt: number): Controls {
    const manual: Controls = {
      throttle: this.throttle,
      pitch: (this.pressed.has('KeyS') ? 1 : 0) - (this.pressed.has('KeyW') ? 1 : 0),
      yaw: (this.pressed.has('KeyD') ? 1 : 0) - (this.pressed.has('KeyA') ? 1 : 0),
      roll: (this.pressed.has('KeyE') ? 1 : 0) - (this.pressed.has('KeyQ') ? 1 : 0),
      translate: new Vector3(
        (this.pressed.has('KeyL') ? 1 : 0) - (this.pressed.has('KeyJ') ? 1 : 0),
        (this.pressed.has('KeyH') ? 1 : 0) - (this.pressed.has('KeyN') ? 1 : 0),
        (this.pressed.has('KeyI') ? 1 : 0) - (this.pressed.has('KeyK') ? 1 : 0),
      ),
      stage: this.stageRequested,
      sas: this.sasEnabled,
      sasMode: this.sasMode,
      rcs: this.rcsEnabled,
      gear: this.gearDeployed,
      chute: this.chuteRequested,
    };
    this.stageRequested = false;
    this.chuteRequested = false;
    if (!this.ship) return manual;
    if (!this.autopilot.active) {
      if (this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight')) {
        this.throttle = clamp(this.throttle + dt * 0.8, 0, 1);
        manual.throttle = this.throttle;
      }
      if (this.pressed.has('ControlLeft') || this.pressed.has('ControlRight')) {
        this.throttle = clamp(this.throttle - dt * 0.8, 0, 1);
        manual.throttle = this.throttle;
      }
      return manual;
    }
    const auto = this.autopilot.update(this.ship, dt);
    auto.stage = auto.stage || manual.stage;
    auto.chute = auto.chute || manual.chute;
    this.throttle = auto.throttle;
    return auto;
  }

  private updateFlight(dt: number): void {
    const ship = this.ship;
    if (!ship) return;
    if (ship.crashed) { this.audio.setEngine(0, 0); return; }
    const controls = this.makeControls(dt);
    const tel = ship.telemetry();
    const body = ship.currentBody;
    const altitude = tel.altitude;
    const safeRail = !ship.landed && tel.periapsis > (body.atmosphere ? body.atmosphere.height + 5000 : 5000)
      && (!body.atmosphere || altitude > body.atmosphere.height + 3000);
    let warp = 1;
    if (this.autopilot.active && this.autoWarp) {
      warp = this.autopilot.warpRequest > 1 ? Math.max(this.warpRequestManual(), this.autopilot.warpRequest) : 1;
    } else {
      warp = this.warpRequestManual();
    }
    if (ship.landed) warp = 1;
    if (controls.throttle > 0.001) warp = Math.min(warp, 1);
    if (warp > 4 && !safeRail) warp = 1;
    warp = clamp(warp, 1, 100000);
    this.currentWarp = warp;
    if (warp > 4) {
      const before = ship.events.length;
      ship.railsStep(dt * warp);
      if (ship.warpStopRequested) {
        ship.warpStopRequested = false;
        this.warpIndex = 0;
        this.currentWarp = 1;
        this.toast('Time warp stopped at a manoeuvre point.', '⏱️', 'warn');
      }
      if (ship.events.length > before) this.processEvents(ship.events.splice(before));
    } else {
      ship.update(dt * warp, controls);
      this.processEvents(ship.events.splice(0));
    }
    if (ship.landed || ship.crashed) this.currentWarp = 1;
    if (this.progress.launched && !this.progress.orbit) {
      const t = ship.telemetry();
      if (t.periapsis > 70000 && t.apoapsis > 70000 && t.ecc < 0.25 && !ship.landed) {
        this.progress.orbit = true;
        if (!this.orbitToastShown) {
          this.orbitToastShown = true;
          this.toast('Stable orbit achieved. Welcome to the club, kitten.', '🌍', 'good');
          this.audio.chime('good');
        }
        this.queueSave();
      }
    }
    if (this.autopilot.active && this.autopilot.phase === 'failed' && !this.autoFailShown) {
      this.autoFailShown = true;
      this.toast(this.autopilot.failure || 'Flight computer aborted.', '!', 'warn');
    }
    this.audio.setEngine(ship.lastThrustForFx > 1000 ? this.throttle : 0, ship.lastPressure);
    this.flightScene.update(dt);
    this.flightScene.camera.aspect = this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
    this.flightScene.camera.updateProjectionMatrix();
  }

  private warpRequestManual(): number {
    return WARP_LEVELS[this.warpIndex] ?? 1;
  }

  private processEvents(events: FlightEvent[]): void {
    const ship = this.ship;
    if (!ship) return;
    for (const e of events) {
      switch (e.type) {
        case 'launch':
          this.audio.chime('good');
          this.toast('Liftoff! The cats are officially in the sky.', '🚀', 'good');
          this.progress.started = true;
          this.progress.launched = true;
          this.queueSave();
          break;
        case 'stage':
          this.audio.stage();
          this.toast(e.title ?? 'Stage separation', '⚡');
          this.stats = computeStats(ship.design);
          break;
        case 'soi':
          this.audio.chime('warn');
          this.toast(e.title ?? 'Sphere of influence changed', '🪐', 'good');
          break;
        case 'chute':
          this.audio.chime('good');
          this.toast(e.title ?? 'Parachute', '🪂', 'good');
          break;
        case 'fuelout':
          this.toast(e.title ?? 'Stage fuel depleted', '⛽', 'warn');
          break;
        case 'landed':
          this.handleLanded(e);
          break;
        case 'crashed':
          this.audio.boom();
          this.showCrash();
          break;
        case 'milestone':
          this.toast(e.title ?? 'Milestone', '⭐', 'good');
          break;
        case 'recovered':
          this.recover();
          break;
      }
    }
  }

  private handleLanded(_e: FlightEvent): void {
    const ship = this.ship;
    if (!ship || !ship.landedInfo) return;
    const body = ship.landedInfo.bodyId;
    this.landedShown = true;
    this.gearDeployed = true;
    this.flagPlanted = false;
    this.audio.chime('good');
    if (body === 'luna') {
      this.progress.luna = true;
      this.queueSave();
      this.toast('Luna touchdown! A new pawprint in the dust.', '🌙', 'good');
    } else if (body === 'mochi') {
      this.progress.mochi = true;
      this.queueSave();
      this.toast('Mochi touchdown! The little moon has a visitor.', '🍡', 'good');
    } else if (body === 'terra') {
      if (this.progress.luna || this.progress.mochi) {
        this.progress.returned = true;
        this.queueSave();
        if (!this.completedShown) {
          this.completedShown = true;
          this.showMissionComplete();
        }
      } else {
        this.toast('Safe landing on Terra. A good first hop.', '🌱', 'good');
      }
    } else {
      this.toast('Touchdown on ' + (BODY[body as keyof typeof BODY]?.name ?? body), '🚩', 'good');
    }
    this.updateHUD(true);
  }

  private showMissionComplete(): void {
    const ship = this.ship;
    if (!ship) return;
    this.progress.complete = true;
    this.progress.returned = true;
    if (!this.progress.bestTime || ship.met < this.progress.bestTime) this.progress.bestTime = ship.met;
    this.queueSave();
    this.audio.chime('good');
    if (this.testing) return;
    const stats = computeStats(ship.design);
    const body = '<div style="text-align:center"><div style="font-size:54px;line-height:1;color:#FFB03A">★</div>' +
      '<h3 style="font-family:Baloo 2;font-size:26px;margin:4px 0">Lunar Pawprint complete</h3>' +
      '<p>Commander Mochi and crew are home. The flag on Luna is still standing.</p></div>' +
      '<div class="kbd-grid"><div><span>Mission time</span><b>' + formatTime(ship.met) + '</b></div>' +
      '<div><span>Best time</span><b>' + formatTime(this.progress.bestTime) + '</b></div>' +
      '<div><span>Rocket</span><b>' + ship.design.name + '</b></div>' +
      '<div><span>Stages flown</span><b>' + stats.stages.length + '</b></div></div>' +
      '<p class="small muted">Mochi is available as a second moon target. Rusty and Verdant are waiting farther out. The flight computer can take you there.</p>';
    this.showModal('Mission Complete', body, [
      { label: 'Keep Flying', kind: 'ghost', action: () => this.hideModal() },
      { label: 'New Mission', kind: 'primary', action: () => { this.hideModal(); this.showVab(); } },
      { label: 'Main Menu', kind: 'ghost', action: () => { this.hideModal(); this.showMenu(); } },
    ], false);
  }

  private showCrash(): void {
    if (this.crashShown) return;
    this.crashShown = true;
    if (this.testing) return;
    const ship = this.ship;
    const why = ship?.events.find((e) => e.type === 'crashed')?.detail ?? 'Rapid unplanned disassembly.';
    this.showModal('Rocket Lost', '<div style="text-align:center"><div style="font-size:50px;color:#E2675C">✹</div></div><p>' + why + '</p><p class="small muted">The cats are fine. Their snacks survived. The rocket is confetti.</p>', [
      { label: 'Revert to Launch', kind: 'primary', action: () => { this.hideModal(); this.launch(); } },
      { label: 'Rocket Lab', kind: 'ghost', action: () => { this.hideModal(); this.showVab(); } },
      { label: 'Keep Watching', kind: 'ghost', action: () => this.hideModal() },
    ], false);
    this.modalPause = true;
  }

  private recover(): void {
    const ship = this.ship;
    if (!ship?.landed) return;
    this.progress.returned = true;
    if (ship.met > 0) this.progress.bestTime = this.progress.bestTime ? Math.min(this.progress.bestTime, ship.met) : ship.met;
    this.queueSave();
    this.audio.chime('good');
    this.toast('Crew recovered. Snacks distributed. Mission logged.', '🏡', 'good');
    this.showMissionComplete();
  }

  // ------------------------------------------------------------ HUD

  private updateHUD(_force = false): void {
    const ship = this.ship;
    if (!ship) return;
    const t = ship.telemetry();
    const stats = computeStats(ship.design);
    const set = (id: string, text: string) => { const e = maybe(id); if (e) e.textContent = text; };
    set('flight-met', formatTime(ship.met));
    set('flight-warp', this.currentWarp + '×');
    set('flight-body', t.bodyName.toUpperCase());
    set('flight-soi', bodySoiLabel(ship.currentBody));
    set('flight-tag', this.autopilot.active ? 'AUTO · ' + this.targetId.toUpperCase() : 'LUNAR PAWPRINT');
    set('t-ap', t.apoapsis > 0 && Number.isFinite(t.apoapsis) ? alt(t.apoapsis) : '—');
    set('t-pe', t.periapsis > 0 && Number.isFinite(t.periapsis) ? alt(t.periapsis) : '—');
    set('t-alt', alt(t.altitude));
    set('t-speed', speed(t.speed));
    set('t-inc', t.inclination.toFixed(1) + '°');
    set('t-period', t.period > 0 && Number.isFinite(t.period) ? duration(t.period) : '—');
    const target = BODY[this.targetId as keyof typeof BODY] ?? BODY.luna;
    set('t-target', target.name);
    set('t-dist', (t.distanceToTarget / 1000).toFixed(0) + ' km');
    set('orbit-body', t.bodyName.toUpperCase());
    set('res-stage', 'STAGE ' + (ship.activeStage + 1) + ' / ' + ship.stageCount);
    const fuelEl = maybe('res-fuel'); if (fuelEl) fuelEl.style.width = pct(t.fuelStageMax ? t.fuelStage / t.fuelStageMax : 0);
    set('res-fuel-num', pct(t.fuelStageMax ? t.fuelStage / t.fuelStageMax : 0));
    const monoEl = maybe('res-mono'); if (monoEl) monoEl.style.width = pct(ship.monopropTotal ? t.monoprop / ship.monopropTotal : 0);
    set('res-mono-num', Math.round(t.monoprop) + ' kg');
    set('res-twr', t.twr.toFixed(2));
    set('res-mass', (t.mass / 1000).toFixed(1) + ' t');
    set('res-thrust', (t.thrust / 1000).toFixed(0) + ' kN');
    set('stage-num', String(ship.activeStage + 1));
    set('stage-dv', int(stats.stages[ship.activeStage]?.deltaV ?? 0) + ' m/s');
    set('stage-fuel', pct(t.fuelStageMax ? t.fuelStage / t.fuelStageMax : 0));
    const stageBtn = maybe<HTMLButtonElement>('btn-stage');
    if (stageBtn) stageBtn.disabled = ship.stageCount <= 1;
    const pips = maybe('stage-pips');
    if (pips) pips.innerHTML = Array.from({ length: ship.stageCount }, (_, i) => '<span class="stage-pip ' + (i === 0 ? 'current' : '') + '"></span>').join('');
    const dots = maybe('stage-dots');
    if (dots) dots.innerHTML = Array.from({ length: ship.stageCount }, (_, i) => '<span class="stage-dot ' + (i === 0 ? 'active' : 'spent') + '"></span>').join('');
    set('throttle-num', pct(this.throttle));
    const fill = maybe('throttle-fill'); if (fill) fill.style.width = pct(this.throttle);
    const knob = maybe('throttle-knob'); if (knob) knob.style.left = pct(this.throttle);
    const toggle = (id: string, on: boolean, warn = false) => {
      const b = maybe(id); if (!b) return;
      b.classList.toggle('on', on);
      b.classList.toggle('warn-on', warn && on);
    };
    toggle('btn-sas', this.sasEnabled);
    toggle('btn-rcs', this.rcsEnabled);
    toggle('btn-gear', this.gearDeployed);
    toggle('btn-chute', ship.chuteState === 'deployed' || ship.chuteState === 'deploying', true);
    document.querySelectorAll<HTMLButtonElement>('#sas-modes [data-mode]').forEach((b) => {
      b.classList.toggle('active', !this.autopilot.active && this.sasEnabled && b.dataset.mode === this.sasMode);
    });
    this.navball.draw(ship, this.targetId);
    set('nb-heading', String(Math.round(this.navball.last.heading)).padStart(3, '0') + '°');
    set('nb-pitch', (this.navball.last.pitch >= 0 ? '+' : '') + this.navball.last.pitch.toFixed(0) + '°');
    set('nb-roll', (this.navball.last.roll >= 0 ? '+' : '') + this.navball.last.roll.toFixed(0) + '°');
    const autoTag = maybe('auto-state');
    if (autoTag) {
      autoTag.textContent = this.autopilot.active ? (this.autopilot.phase === 'failed' ? 'FAILED' : 'AUTO') : 'IDLE';
      autoTag.className = 'tag ' + (this.autopilot.active ? (this.autopilot.phase === 'failed' ? 'coral' : 'green') : '');
    }
    set('auto-label', this.autopilot.active ? this.autopilot.statusLabel : 'Manual control');
    set('auto-detail', this.autopilot.active ? this.autopilot.statusDetail : 'SAS and RCS are yours, captain.');
    document.querySelectorAll<HTMLButtonElement>('.auto-buttons [data-auto]').forEach((b) => {
      b.classList.toggle('active', this.autopilot.active && b.dataset.auto === this.autopilot.mode);
    });
    if (ship.landed && !ship.crashed && ship.met > 20) {
      const banner = maybe('landed-banner');
      banner?.classList.remove('hidden');
      set('lb-title', 'Touchdown on ' + t.bodyName);
      const li = ship.landedInfo;
      set('lb-detail', (li?.speed.toFixed(1) ?? '—') + ' m/s · ' + (li?.lat.toFixed(1) ?? '—') + '°, ' + (li?.lon.toFixed(1) ?? '—') + '°' + (li?.zone ? ' · ' + li.zone : ''));
      const plant = maybe('btn-plant-flag');
      if (plant) plant.classList.toggle('hidden', !(t.currentBody === 'luna' || t.currentBody === 'mochi') || this.flagPlanted);
      const rec = maybe('btn-recover');
      if (rec) rec.classList.toggle('hidden', !(t.currentBody === 'terra' && (this.progress.luna || this.progress.mochi) && !this.completedShown));
    } else {
      maybe('landed-banner')?.classList.add('hidden');
    }
    maybe('flight-center-hint')?.classList.toggle('hidden', ship.landed);
    const sel = maybe<HTMLSelectElement>('target-select');
    if (sel && sel.value !== this.targetId) sel.value = this.targetId;
    if (ship.landed && ship.landedInfo?.bodyId === 'terra' && (this.progress.luna || this.progress.mochi) && !this.completedShown && ship.met > 600) {
      this.completedShown = true;
      this.showMissionComplete();
    }
  }

  private updateThrottleUI(): void {
    const fill = maybe('throttle-fill'); if (fill) fill.style.width = pct(this.throttle);
    const knob = maybe('throttle-knob'); if (knob) knob.style.left = pct(this.throttle);
    const num = maybe('throttle-num'); if (num) num.textContent = pct(this.throttle);
  }

  private buildWarpList(): void {
    const holder = maybe('warp-list');
    if (!holder) return;
    holder.innerHTML = WARP_LEVELS.map((v, i) => '<button data-wi="' + i + '" class="' + (i === this.warpIndex ? 'active' : '') + '">' + (v >= 1000 ? v / 1000 + 'k' : v) + '×</button>').join('');
    holder.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('click', () => { this.setWarpIndex(Number(b.dataset.wi)); this.audio.click(700); });
    });
  }

  private setWarpIndex(i: number): void {
    this.warpIndex = clamp(i, 0, WARP_LEVELS.length - 1);
    this.currentWarp = WARP_LEVELS[this.warpIndex];
    document.querySelectorAll<HTMLButtonElement>('#warp-list button').forEach((b) => b.classList.toggle('active', Number(b.dataset.wi) === this.warpIndex));
  }

  private warpStep(dir: number): void { this.setWarpIndex(this.warpIndex + dir); }

  // ------------------------------------------------------------ map

  private toggleMap(): void {
    if (this.state === 'flight') this.openMap();
    else if (this.state === 'map') this.closeMap();
  }

  private openMap(): void {
    if (this.state !== 'flight') return;
    this.state = 'map';
    maybe('screen-flight')?.classList.add('hidden');
    maybe('screen-map')?.classList.remove('hidden');
    this.map.resize();
    this.refreshMapButtons();
    this.refreshMapTargets();
    this.audio.click(680);
    if (this.ship) this.map.draw(this.ship, this.targetId);
    this.updateMap(0.2);
  }

  private closeMap(): void {
    if (this.state !== 'map') return;
    this.state = 'flight';
    maybe('screen-map')?.classList.add('hidden');
    maybe('screen-flight')?.classList.remove('hidden');
    this.audio.click(600);
    this.updateHUD(true);
    this.flightScene.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.flightScene.camera.updateProjectionMatrix();
  }

  private updateMap(dt: number): void {
    const ship = this.ship;
    if (!ship) return;
    this.mapAccum += dt;
    if (this.mapAccum < 0.06) return;
    this.mapAccum = 0;
    this.map.draw(ship, this.targetId);
    const t = ship.telemetry();
    const set = (id: string, text: string) => { const e = maybe(id); if (e) e.textContent = text; };
    set('map-ap', t.apoapsis > 0 ? alt(t.apoapsis) : '—');
    set('map-pe', t.periapsis > 0 ? alt(t.periapsis) : '—');
    set('map-period', t.period > 0 && Number.isFinite(t.period) ? duration(t.period) : '—');
    const dv = this.map.dvToTarget;
    set('map-dv', dv > 0 ? int(dv) + ' m/s' : '—');
    set('map-zoom-label', this.map.zoom.toFixed(2) + '×');
    this.updateMapTargets();
  }

  private refreshMapButtons(): void {
    maybe('btn-map-local')?.classList.toggle('active', this.map.view === 'local');
    maybe('btn-map-system')?.classList.toggle('active', this.map.view === 'system');
  }

  private refreshMapTargets(): void {
    const holder = maybe('map-targets');
    if (!holder) return;
    const ids = ['luna', 'mochi', 'rusty', 'verdant', 'terra'];
    holder.innerHTML = ids.map((id) => {
      const b = BODY[id as keyof typeof BODY];
      return '<button class="map-target ' + (id === this.targetId ? 'active' : '') + '" data-target="' + id + '"><span class="mt-dot" style="background:#' + b.appearance.primary.toString(16).padStart(6, '0') + '"></span><span>' + b.name + '</span><small>' + (b.parent?.name ?? 'SOL') + '</small></button>';
    }).join('');
    holder.querySelectorAll<HTMLButtonElement>('.map-target').forEach((b) => {
      b.addEventListener('click', () => this.setTarget(b.dataset.target!, true));
    });
  }

  private updateMapTargets(): void {
    document.querySelectorAll<HTMLButtonElement>('.map-target').forEach((b) => b.classList.toggle('active', b.dataset.target === this.targetId));
  }

  private setTarget(id: string, fromMap: boolean): void {
    if (!BODY[id as keyof typeof BODY]) return;
    this.targetId = id;
    const sel = maybe<HTMLSelectElement>('target-select');
    if (sel) sel.value = id;
    this.refreshMapTargets();
    this.refreshMapButtons();
    this.queueSave();
    if (fromMap) {
      this.audio.click(620);
      this.toast('Target set: ' + BODY[id as keyof typeof BODY].name, '🎯');
    }
  }

  // ------------------------------------------------------------ autopilot / pause

  declare engageAuto: (mode: AutoMode) => void;  declare abortAuto: (reason: string) => void;
  declare pause: () => void;
  declare resume: () => void;
}

function bodySoiLabel(body: Body): string {
  if (body.id === 'terra') return 'TERRA SOI';
  if (body.id === 'luna' || body.id === 'mochi') return body.name.toUpperCase() + ' SOI';
  if (body.id === 'sol') return 'SOL SYSTEM';
  return body.name.toUpperCase() + ' SOI';
}

function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's';
  return Math.floor(seconds / 3600) + 'h ' + Math.round((seconds % 3600) / 60) + 'm';
}
