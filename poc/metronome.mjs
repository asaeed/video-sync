import { beatAt, epochMsAtBeat, nowEpochMs, positiveModulo } from "./scheduler.mjs";

export function tickFrequency(absoluteBeat) {
  return positiveModulo(Math.round(absoluteBeat), 4) === 0 ? 1560 : 980;
}

export class LinkMetronome {
  constructor(getClock, onChange = () => {}) {
    this.getClock = getClock;
    this.onChange = onChange;
    this.context = null;
    this.timer = null;
    this.nextBeat = null;
    this.enabled = false;
  }

  async toggle() {
    if (this.enabled) this.stop();
    else await this.start();
  }

  async start() {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not available in this browser");
    this.context ??= new AudioContextClass({ latencyHint: "interactive" });
    await this.context.resume();
    this.enabled = true;
    this.nextBeat = null;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.onChange(true);
  }

  stop() {
    this.enabled = false;
    this.nextBeat = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.onChange(false);
  }

  schedule() {
    if (!this.enabled || !this.context) return;
    const clock = this.getClock();
    if (!clock?.playing || !(clock.bpm > 0)) {
      this.nextBeat = null;
      return;
    }
    const epochMs = nowEpochMs();
    const currentBeat = beatAt(clock, epochMs);
    if (this.nextBeat === null || this.nextBeat < currentBeat - 0.25 || this.nextBeat > currentBeat + 4) {
      this.nextBeat = Math.ceil(currentBeat + 0.02);
    }
    const horizonBeat = currentBeat + (0.12 * clock.bpm) / 60;
    while (this.nextBeat <= horizonBeat) {
      const targetEpochMs = epochMsAtBeat(clock, this.nextBeat);
      const audioTime = this.context.currentTime + Math.max(0.005, (targetEpochMs - epochMs) / 1000);
      this.playTick(audioTime, tickFrequency(this.nextBeat));
      this.nextBeat += 1;
    }
  }

  playTick(audioTime, frequency) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, audioTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.72, audioTime + 0.035);
    gain.gain.setValueAtTime(0.0001, audioTime);
    gain.gain.exponentialRampToValueAtTime(frequency > 1200 ? 0.16 : 0.1, audioTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioTime + 0.045);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(audioTime);
    oscillator.stop(audioTime + 0.05);
  }
}
