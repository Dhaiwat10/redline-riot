/** All sound is synthesised: no audio files. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engine!: Voice;
  private rival!: Voice;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private scrapeGain!: GainNode;
  /** Starts muted; press M to turn sound on. */
  muted = true;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const cycle = engineCycle(ctx);
    this.engine = new Voice(ctx, cycle, this.master, 0.55);
    this.rival = new Voice(ctx, cycle, this.master, 0);

    const wind = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    const scrape = this.loopNoise();
    const sf = ctx.createBiquadFilter();
    sf.type = "bandpass";
    sf.frequency.value = 3200;
    sf.Q.value = 2;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    scrape.connect(sf).connect(this.scrapeGain).connect(this.master);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  update(p: { rpm: number; throttle: number; speed: number; riding: boolean; scrape: number; rivalRpm: number; rivalDist: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.engine.set(t, p.riding ? p.rpm : 0.12, p.riding ? 0.35 + p.throttle * 0.65 : 0.25, p.riding ? 0.5 : 0.15);
    const rv = p.rivalDist < 40 ? (1 - p.rivalDist / 40) ** 2 * 0.35 : 0;
    this.rival.set(t, p.rivalRpm, 0.8, rv);
    const w = Math.min(1, p.speed / 65);
    this.windGain.gain.setTargetAtTime(w * w * 0.22, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(400 + w * 1600, t, 0.1);
    this.scrapeGain.gain.setTargetAtTime(p.scrape * 0.25, t, 0.05);
  }

  /** A short noise burst through a filter with a pitched thump underneath. */
  private hit(freq: number, dur: number, gain: number, noiseFreq: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.35, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(gain, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + dur);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = noiseFreq;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.8, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.7);
    n.connect(f).connect(ng).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + dur);
  }

  punch(volume = 1): void {
    this.hit(140, 0.18, 0.9 * volume, 1800);
  }
  kick(volume = 1): void {
    this.hit(95, 0.24, 1.0 * volume, 1200);
  }
  crash(volume = 1): void {
    this.hit(70, 0.7, 1.2 * volume, 700);
    setTimeout(() => this.hit(110, 0.4, 0.6 * volume, 2600), 90);
  }
  bump(volume = 1): void {
    this.hit(180, 0.1, 0.35 * volume, 900);
  }

  beep(high: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = high ? 1320 : 660;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.6 : 0.25));
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.6);
  }
}

/** One engine: a looped firing-cycle sample, pitch from rpm, brightness from throttle. */
class Voice {
  private readonly src: AudioBufferSourceNode;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;

  constructor(ctx: AudioContext, cycle: AudioBuffer, out: AudioNode, vol: number) {
    this.src = ctx.createBufferSource();
    this.src.buffer = cycle;
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 1.5;
    this.gain = ctx.createGain();
    this.gain.gain.value = vol;
    this.src.connect(this.filter).connect(this.gain).connect(out);
    this.src.start();
  }

  set(t: number, rpm: number, throttle: number, vol: number): void {
    this.src.playbackRate.setTargetAtTime(0.9 + rpm * 4.6, t, 0.04);
    this.filter.frequency.setTargetAtTime(500 + rpm * 2200 * (0.4 + throttle * 0.6), t, 0.05);
    this.gain.gain.setTargetAtTime(vol, t, 0.08);
  }
}

/** A V-twin-ish firing cycle: two uneven pulses per loop. */
function engineCycle(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.08);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const pulses = [0, 0.43];
  for (let i = 0; i < len; i++) {
    const t = i / len;
    let v = 0;
    for (const p of pulses) {
      let dt = t - p;
      if (dt < 0) dt += 1;
      const env = Math.exp(-dt * 26);
      v += env * (Math.sin(dt * Math.PI * 2 * 7) * 0.8 + (Math.random() * 2 - 1) * 0.35);
    }
    d[i] = Math.tanh(v * 1.6) * 0.7;
  }
  return buf;
}
