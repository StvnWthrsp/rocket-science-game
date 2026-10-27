export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  musicGain: GainNode | null = null;
  engineGain: GainNode | null = null;
  engineFilter: BiquadFilterNode | null = null;
  engineSource: AudioBufferSourceNode | null = null;
  enabled = true;
  volume = 0.45;
  private musicStarted = false;
  private musicTimer = 0;
  private nextNote = 0;

  init(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.035;
    this.musicGain.connect(this.master);
    this.startAmbient();
    this.startEngine();
  }

  resume(): void {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
    return this.enabled;
  }

  click(freq = 540): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }

  stage(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 240; f.Q.value = 0.7;
    const g = this.ctx.createGain(); g.gain.value = 0.6;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  chime(kind: 'good' | 'warn' = 'good'): void {
    if (!this.ctx || !this.master) return;
    const notes = kind === 'good' ? [523.25, 659.25, 783.99] : [392, 466.16];
    const t0 = this.ctx.currentTime;
    notes.forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.45);
      o.connect(g).connect(this.master!);
      o.start(t0 + i * 0.09); o.stop(t0 + i * 0.09 + 0.5);
    });
  }

  boom(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.6, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 0.6);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(90, t + 1.2);
    const g = this.ctx.createGain(); g.gain.value = 0.8;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  setEngine(throttle: number, pressure: number): void {
    if (!this.engineGain || !this.engineFilter) return;
    const target = Math.min(1, throttle) * (0.11 + 0.05 * (1 - pressure));
    this.engineGain.gain.setTargetAtTime(target, this.ctx!.currentTime, 0.12);
    this.engineFilter.frequency.setTargetAtTime(180 + throttle * 420 + pressure * 180, this.ctx!.currentTime, 0.2);
  }

  private startEngine(): void {
    if (!this.ctx || !this.master) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5 + white * 0.15;
    }
    this.engineSource = this.ctx.createBufferSource();
    this.engineSource.buffer = buf;
    this.engineSource.loop = true;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineSource.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineSource.start();
  }

  private startAmbient(): void {
    if (!this.ctx || !this.musicGain) return;
    this.musicStarted = true;
    const ctx = this.ctx;
    const notes = [130.81, 196.0, 261.63, 329.63];
    for (const n of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = n === 130.81 ? 'sine' : 'triangle';
      o.frequency.value = n;
      g.gain.value = n === 130.81 ? 0.2 : 0.08;
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 0.05 + Math.random() * 0.04;
      lg.gain.value = 0.035;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(this.musicGain);
      o.start();
      lfo.start();
    }
  }

  musicTick(dt: number): void {
    if (!this.ctx || !this.musicStarted || !this.enabled) return;
    this.musicTimer += dt;
    if (this.musicTimer < this.nextNote) return;
    this.musicTimer = 0;
    this.nextNote = 5 + Math.random() * 7;
    const scale = [523.25, 587.33, 659.25, 783.99, 880];
    const f = scale[Math.floor(Math.random() * scale.length)];
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * (Math.random() < 0.2 ? 0.5 : 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g).connect(this.musicGain!);
    o.start(t); o.stop(t + 1.7);
  }
}
