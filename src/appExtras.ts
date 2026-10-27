import { formatTime } from './game/math';
import { PRESET_DESIGNS, newDesign } from './game/parts';

type Ctor = { prototype: Record<string, unknown> };

function maybe(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function installAppExtras(GameApp: Ctor): void {
  const P = GameApp.prototype as Record<string, unknown> as {
    [key: string]: (this: AppLike, ...args: never[]) => unknown;
  };

  P.resize = function (this: AppLike): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.settings.quality));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.menuFlight.resize(w, h);
    this.flightScene.resize(w, h);
    this.vab.resize(w, h);
    this.navball.resize();
    this.map.resize();
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.updateHUD(true), 120);
  };

  P.showLoading = function (this: AppLike, ms = 650): void {
    const loading = maybe('loading');
    if (!loading) return;
    loading.classList.remove('hidden');
    const text = maybe('loading-text');
    if (text) text.textContent = ['Packing the snacks…', 'Checking the whiskers…', 'Polishing the helmet…'][Math.floor(Math.random() * 3)];
    window.setTimeout(() => loading.classList.add('hidden'), ms);
  };

  P.hideLoadingSoon = function (this: AppLike): void {
    window.setTimeout(() => maybe('loading')?.classList.add('hidden'), 700);
  };

  P.engageAuto = function (this: AppLike, mode: string): void {
    if (!this.ship) return;
    if (mode === 'off') {
      this.autopilot.disengage();
      this.toast('Flight computer disengaged. Paws on the stick.', '🐾');
      return;
    }
    if (this.ship.crashed) return;
    this.autopilot.engage(mode, this.ship, this.targetId);
    this.autoFailShown = false;
    this.autoWarp = this.settings.autoWarp;
    this.warpIndex = 0;
    this.audio.chime('good');
    this.toast('Flight computer: ' + this.autopilot.statusLabel, '🛰️', 'good');
  };

  P.abortAuto = function (this: AppLike, reason: string): void {
    if (!this.autopilot.active) return;
    this.autopilot.disengage();
    this.toast('Autopilot off — ' + reason, '🐾');
  };

  P.pause = function (this: AppLike): void {
    if (this.state !== 'flight' && this.state !== 'map') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    maybe('pause')?.classList.remove('hidden');
    this.audio.setEngine(0, 0);
  };

  P.resume = function (this: AppLike): void {
    if (this.state !== 'paused') return;
    maybe('pause')?.classList.add('hidden');
    this.state = this.pausedFrom;
    if (this.state === 'map') {
      maybe('screen-map')?.classList.remove('hidden');
      maybe('screen-flight')?.classList.add('hidden');
    } else {
      maybe('screen-map')?.classList.add('hidden');
      maybe('screen-flight')?.classList.remove('hidden');
    }
  };

  P.abortToVab = function (this: AppLike): void {
    maybe('pause')?.classList.add('hidden');
    this.modalOpen = false;
    this.modalPause = false;
    this.showVab();
  };

  P.abortToMenu = function (this: AppLike): void {
    maybe('pause')?.classList.add('hidden');
    this.modalOpen = false;
    this.modalPause = false;
    this.showMenu();
  };

  P.showModal = function (this: AppLike, title: string, bodyHtml: string, actions: { label: string; kind?: 'primary' | 'ghost' | 'coral'; action: () => void }[], closeable = true): void {
    this.modalOpen = true;
    this.modalPause = this.state === 'flight' || this.state === 'map';
    maybe('modal')?.classList.remove('hidden');
    const titleEl = maybe('modal-title');
    if (titleEl) titleEl.textContent = title;
    const bodyEl = maybe('modal-body');
    if (bodyEl) bodyEl.innerHTML = bodyHtml;
    const actionsEl = maybe('modal-actions');
    if (actionsEl) {
      actionsEl.innerHTML = '';
      for (const a of actions) {
        const b = document.createElement('button');
        b.className = 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'coral' ? 'btn-coral' : 'btn-ghost');
        b.textContent = a.label;
        b.addEventListener('click', () => { this.audio.click(); a.action(); });
        actionsEl.appendChild(b);
      }
    }
    const close = maybe('btn-modal-close') as HTMLButtonElement | null;
    if (close) close.style.visibility = closeable ? 'visible' : 'hidden';
  };

  P.hideModal = function (this: AppLike): void {
    maybe('modal')?.classList.add('hidden');
    this.modalOpen = false;
    this.modalPause = false;
  };

  P.toast = function (this: AppLike, message: string, icon = '🐾', kind = ''): void {
    const glyphs: Record<string, string> = { '🚀': '▲', '⚠️': '!', '🛰️': '✦', '🌍': '○', '🌙': '☾', '🍡': '○', '🌱': '✿', '🚩': '⚑', '🏡': '⌂', '⏱️': '◷', '⚡': 'ϟ', '🪂': '☂', '⛽': '▮', '🪐': '◍', '🎯': '◎', '💾': '▣', '🐾': '•' };
    icon = glyphs[icon] ?? icon;
    const holder = maybe('toasts');
    if (!holder) return;
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = '<span class="ti">' + icon + '</span><span>' + message + '</span>';
    holder.appendChild(t);
    while (holder.children.length > 3) holder.removeChild(holder.firstElementChild!);
    window.setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-6px)'; t.style.transition = 'all .3s'; }, 3400);
    window.setTimeout(() => t.remove(), 3800);
  };

  P.hideLanded = function (): void {
    maybe('landed-banner')?.classList.add('hidden');
  };

  P.updateMenuProgress = function (this: AppLike): void {
    const steps = (this.progress.orbit ? 1 : 0) + (this.progress.luna ? 1 : 0) + (this.progress.returned ? 1 : 0);
    const title = maybe('menu-progress-title');
    const sub = maybe('menu-progress-sub');
    const paws = maybe('menu-paws');
    if (paws) paws.innerHTML = '<span class="paw-dot"></span>'.repeat(Math.max(1, Math.min(4, steps)));
    if (title) title.textContent = this.progress.complete ? 'Lunar Pawprint complete!' : this.progress.started ? 'Space program in progress' : 'Space program not started';
    if (sub) sub.textContent = this.progress.complete ? 'Home safe · best time ' + formatTime(this.progress.bestTime) + ' · Mochi, Rusty and Verdant await.' : this.progress.luna ? 'Luna flag planted. Bring the crew home for the full mission.' : this.progress.orbit ? 'Stable orbit reached. Next stop: Luna.' : 'A full Terra → Luna → Terra mission awaits.';
    const status = maybe('menu-mission-status');
    if (status) status.textContent = this.progress.complete ? 'COMPLETE' : this.progress.luna ? 'RETURN' : this.progress.orbit ? 'ORBIT' : 'READY';
    const cont = maybe('btn-continue') as HTMLButtonElement | null;
    if (cont) {
      const strong = cont.querySelector('strong');
      const small = cont.querySelector('small');
      if (strong) strong.textContent = this.progress.started ? 'Continue Program' : 'Start Mission';
      if (small) small.textContent = this.progress.started ? (this.progress.complete ? 'Fly again' : 'Resume in the Rocket Lab') : 'New space program';
    }
  };

  P.updateMenuButtons = function (this: AppLike): void { this.updateMenuProgress(); };

  P.showHelp = function (this: AppLike): void {
    const body = '<p>Build a rocket in the <strong>Rocket Lab</strong>, launch it from Mewport, then fly it like a real spacecraft. Every orbit is computed with patched-conic gravity; every tank burns real propellant.</p>' +
      '<div class="kbd-grid"><div><span>Rotate</span><b>W A S D</b></div><div><span>Roll</span><b>Q E</b></div>' +
      '<div><span>Throttle</span><b>Shift / Ctrl</b></div><div><span>Full / cut</span><b>Z / X</b></div>' +
      '<div><span>Stage</span><b>Space</b></div><div><span>SAS</span><b>T</b></div>' +
      '<div><span>RCS</span><b>R</b></div><div><span>Gear</span><b>G</b></div>' +
      '<div><span>Parachute</span><b>P</b></div><div><span>Map</span><b>M</b></div>' +
      '<div><span>Warp</span><b>, / .</b></div><div><span>Pause</span><b>Esc</b></div></div>' +
      '<h3>Your first mission</h3><p>1. Open the Rocket Lab and load the <strong>Moon Cat Mk II</strong> preset.<br/>' +
      '2. Launch, press <strong>Space</strong> once for liftoff staging, and point the nose east with <strong>D</strong>.<br/>' +
      '3. When the apoapsis reaches ~90 km, cut throttle and coast. At apoapsis, burn prograde until the periapsis is above 70 km.<br/>' +
      '4. Open the map, set <strong>Luna</strong> as target, and let the Flight Computer plan the transfer if you like.<br/>' +
      '5. Land gently, plant a flag, then launch and burn for home.</p>' +
      '<h3>Real rocket science</h3><p>Δv from Tsiolkovsky, Isp that changes with atmospheric pressure, patched conics, sphere-of-influence transitions, prograde/retrograde/normal/radial SAS modes, RCS translation, and a rotating launch site. The Moon is 12,000 km away and always moving.</p>' +
      '<h3>Other destinations</h3><p>Mochi is on a 6.2° inclined orbit: match planes with Normal +/− SAS at the node, then transfer. Rusty and Verdant are interplanetary — escape Terra manually, then plan a heliocentric burn. The map system view shows their orbits.</p>' +
      '<p class="small muted">Tip: the <strong>Full Mission (Auto)</strong> button demonstrates the entire Terra → Luna → Terra flight using the same physics.</p>';
    this.showModal('How to Play', body, [{ label: 'Got it', kind: 'primary', action: () => this.hideModal() }]);
  };

  P.showCredits = function (this: AppLike): void {
    const body = '<p><strong>Rocket Science: Cats in Space</strong> is a procedural, cel-shaded orbital sandbox built with Three.js, TypeScript and Vite.</p>' +
      '<h3>Physics</h3><p>Two-body patched conics, Tsiolkovsky Δv, pressure-dependent Isp, atmospheric drag, reaction-wheel / RCS attitude control, SOI transitions and Keplerian time warp. Mission design is tuned to a KSP-scale Terra (600 km radius) and Luna (12,000 km orbit).</p>' +
      '<h3>Art direction</h3><p>Soft cel shading, 3-band toon ramps, pastel palette, chunky contours, procedural cat and rocket geometry. No external game art is bundled; every model is generated in code. Reference boards were gathered from NASA Apollo photography, Saturn V launch images, domestic cat anatomy photos, KSP navball/rocket references and Nintendo Animal Crossing New Horizons screenshots.</p>' +
      '<h3>Special thanks</h3><p>To every cat who has ever knocked a pencil off a desk and watched it fall — you taught us orbital mechanics.</p>';
    this.showModal('Credits', body, [{ label: 'Close', kind: 'primary', action: () => this.hideModal() }]);
  };

  P.showSettings = function (this: AppLike): void {
    const progressText = this.progress.complete ? 'Lunar Pawprint complete.' : this.progress.luna ? 'Luna flag planted; bring the crew home.' : 'Mission in progress.';
    const body = '<h3>Sound & visuals</h3>' +
      '<p style="display:flex;align-items:center;gap:10px"><span style="width:110px">Volume</span><input id="set-volume" type="range" min="0" max="1" step="0.05" value="' + this.settings.volume + '" style="flex:1"></p>' +
      '<p style="display:flex;align-items:center;gap:10px"><span style="width:110px">Quality</span><select id="set-quality" style="flex:1;border:2px solid var(--line);border-radius:8px;padding:6px"><option value="1">Cozy (fast)</option><option value="1.6">Soft</option><option value="2">Crisp</option></select></p>' +
      '<p><label><input id="set-sound" type="checkbox" ' + (this.settings.sound ? 'checked' : '') + '> Sound effects and music</label></p>' +
      '<p><label><input id="set-autowarp" type="checkbox" ' + (this.settings.autoWarp ? 'checked' : '') + '> Auto-warp during autopilot coasts</label></p>' +
      '<h3>Space program</h3><p class="muted">' + progressText + ' Best mission time: ' + (this.progress.bestTime ? formatTime(this.progress.bestTime) : '—') + '.</p>' +
      '<button id="btn-reset-progress" class="btn btn-ghost btn-sm" style="color:#B34234">Reset mission progress</button>';
    this.showModal('Settings', body, [{ label: 'Close', kind: 'primary', action: () => this.hideModal() }]);
    const vol = maybe('set-volume') as HTMLInputElement | null;
    if (vol) vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value);
      this.audio.setVolume(this.settings.volume);
      this.audio.resume();
      this.queueSave();
    });
    const q = maybe('set-quality') as HTMLSelectElement | null;
    if (q) { q.value = String(this.settings.quality); q.addEventListener('change', () => { this.settings.quality = Number(q.value); this.resize(); this.queueSave(); }); }
    const snd = maybe('set-sound') as HTMLInputElement | null;
    if (snd) snd.addEventListener('change', () => { this.settings.sound = snd.checked; this.audio.enabled = snd.checked; if (snd.checked) this.audio.resume(); this.queueSave(); });
    const aw = maybe('set-autowarp') as HTMLInputElement | null;
    if (aw) aw.addEventListener('change', () => { this.settings.autoWarp = aw.checked; this.autoWarp = aw.checked; this.queueSave(); });
    const reset = maybe('btn-reset-progress') as HTMLButtonElement | null;
    if (reset) reset.addEventListener('click', () => {
      this.progress = { started: false, orbit: false, luna: false, mochi: false, returned: false, complete: false, launched: false, bestTime: 0, missions: [] };
      this.save();
      this.updateMenuProgress();
      this.hideModal();
      this.toast('Space program reset. Fresh pawprints.', '🐾');
    });
  };

  P.exposeDebug = function (this: AppLike): void {
    const app = this;
    const debug = {
      app,
      startVab: () => app.showVab(),
      launch: () => app.launch(),
      auto: (mode: string) => app.engageAuto(mode),
      setTarget: (id: string) => app.setTarget(id, false),
      warp: (i: number) => app.setWarpIndex(i),
      state: () => app.state,
      ship: () => app.ship,
      telemetry: () => app.ship?.telemetry(),
      simulate: (seconds: number) => app.debugSimulate(seconds),
      builder: () => app.design,
      stats: () => app.stats,
      addPart: (id: string) => app.addPart(id),
      preset: (id: string) => { const p = PRESET_DESIGNS.find((x) => x.id === id); if (p) { app.design = newDesign(p.name, p.stack); app.selectedUid = app.design.stack[0]?.uid ?? null; app.afterDesignChange(); } },
      map: () => app.toggleMap(),
      hud: () => app.updateHUD(true),
    };
    (window as unknown as { __rs?: unknown }).__rs = debug;
  };

  P.debugSimulate = function (this: AppLike, seconds: number): { met: number; phase: string; body: string; landed: boolean; crashed: boolean; fuel: number; progress: unknown } {
    const ship = this.ship;
    if (!ship) return { met: 0, phase: 'no-ship', body: '', landed: false, crashed: false, fuel: 0, progress: this.progress };
    this.testing = true;
    let sim = 0;
    let steps = 0;
    const step = 0.05;
    while (sim < seconds && steps < 400000) {
      const controls = this.autopilot.active ? this.autopilot.update(ship, step) : this.makeControls(step);
      const t = ship.telemetry();
      let warp = 1;
      if (this.autopilot.active && this.autoWarp && this.autopilot.warpRequest > 1 && controls.throttle < 0.001 && !ship.landed) warp = Math.min(10000, this.autopilot.warpRequest);
      const safe = !ship.landed && t.periapsis > (ship.currentBody.atmosphere ? ship.currentBody.atmosphere.height + 5000 : 5000) && (!ship.currentBody.atmosphere || t.altitude > ship.currentBody.atmosphere.height + 3000);
      if (warp > 4 && safe) {
        ship.railsStep(warp * 0.05);
        sim += warp * 0.05;
        if (ship.warpStopRequested) { ship.warpStopRequested = false; continue; }
        this.processEvents(ship.events.splice(0));
      } else {
        ship.update(step, controls);
        sim += step;
        this.processEvents(ship.events.splice(0));
      }
      steps++;
      if (this.progress.launched && !this.progress.orbit) {
        const tt = ship.telemetry();
        if (tt.periapsis > 70000 && tt.apoapsis > 70000 && tt.ecc < 0.25 && !ship.landed) { this.progress.orbit = true; this.orbitToastShown = true; }
      }
      if (ship.crashed || this.completedShown) break;
    }
    this.testing = false;
    this.updateHUD(true);
    return { met: ship.met, phase: this.autopilot.phase, body: ship.currentBody.id, landed: ship.landed, crashed: ship.crashed, fuel: ship.stageFuel(0), progress: this.progress };
  };
}

interface AppLike {
  renderer: { setPixelRatio: (r: number) => void; setSize: (w: number, h: number, updateStyle?: boolean) => void; domElement: HTMLCanvasElement };
  settings: { quality: number; volume: number; autoWarp: boolean; sound: boolean };
  menuFlight: { resize: (w: number, h: number) => void };
  flightScene: { resize: (w: number, h: number) => void };
  vab: { resize: (w: number, h: number) => void };
  navball: { resize: () => void };
  map: { resize: () => void };
  resizeTimer: number;
  updateHUD: (force?: boolean) => void;
  resize: () => void;
  stats: any;
  addPart: (id: string) => void;
  toggleMap: () => void;
  ship: any;
  autopilot: any;
  toast: (message: string, icon?: string, kind?: string) => void;
  audio: any;
  targetId: string;
  autoWarp: boolean;
  warpIndex: number;
  state: string;
  pausedFrom: string;
  modalOpen: boolean;
  modalPause: boolean;
  showVab: () => void;
  showMenu: () => void;
  hideModal: () => void;
  showModal: (title: string, body: string, actions: { label: string; kind?: string; action: () => void }[], closeable?: boolean) => void;
  progress: any;
  queueSave: () => void;
  updateMenuProgress: () => void;
  engageAuto: (mode: string) => void;
  setTarget: (id: string, fromMap: boolean) => void;
  setWarpIndex: (i: number) => void;
  debugSimulate: (seconds: number) => { met: number; phase: string; body: string; landed: boolean; crashed: boolean; fuel: number; progress: unknown };
  design: any;
  selectedUid: number | null;
  afterDesignChange: () => void;
  launch: () => void;
  testing: boolean;
  makeControls: (dt: number) => any;
  processEvents: (events: any[]) => void;
  completedShown: boolean;
  autoFailShown: boolean;
  orbitToastShown: boolean;
  save: () => void;
  updateHUDTop?: never;
}
