// Sounds and voices. GM audio functions take either a sound (asset or stream index) or a voice id
// (what audio_play_sound returns); voice ids start at VOICE_BASE so the two never collide.
// Sounds decode asynchronously: a sound played before it has loaded starts as soon as it is ready.

import type { Platform, SoundId, VoiceId } from '../platform/types.ts';
import type { Assets } from './assets.ts';

export const VOICE_BASE = 200000;

interface Snd { name: string; url: string; stream: boolean; volume: number; pitch: number; group: number; id: SoundId | null; loading: Promise<void> | null; gain: number; destroyed: boolean }
interface Voice { id: number; snd: number; handle: VoiceId | null; gain: number; pitch: number; loop: boolean; paused: boolean; stopped: boolean; offset: number }

export class Sounds {
  private readonly p: Platform;
  private readonly sounds: Snd[] = [];
  private readonly voices = new Map<number, Voice>();
  private nextVoice = VOICE_BASE;
  readonly groupGain: number[] = [];
  master = 1;

  constructor(p: Platform, a: Assets) {
    this.p = p;
    for (const s of a.sounds) this.sounds.push({ name: s.name, url: s.src ? a.url(s.src) : '', stream: s.stream, volume: s.volume, pitch: s.pitch, group: s.group, id: null, loading: null, gain: 1, destroyed: false });
  }

  /** Starts decoding every (non-streamed) sound in the background. */
  preload(): Promise<void> { return Promise.all(this.sounds.filter((s) => !s.stream).map((_, i) => this.load(i))).then(() => {}); }

  private load(i: number): Promise<void> {
    const s = this.sounds[i];
    if (!s.url) { s.loading ??= Promise.resolve(this.p.log(`audio: ${s.name} has no audio data`)); return s.loading; }
    s.loading ??= this.p.audio.load(s.url, s.stream).then((id) => { s.id = id; }, (e) => { this.p.log(`audio: couldn't load ${s.name}: ${(e as Error).message}`); });
    return s.loading;
  }

  /** audio_create_stream: a new sound for a file, decoded on demand. */
  createStream(url: string, name: string): number {
    this.sounds.push({ name, url, stream: true, volume: 1, pitch: 1, group: 0, id: null, loading: null, gain: 1, destroyed: false });
    const i = this.sounds.length - 1;
    void this.load(i);
    return i;
  }
  destroyStream(i: number): void {
    const s = this.sounds[i];
    if (!s) return;
    this.stopSound(i);
    s.destroyed = true;
  }

  exists(i: number): boolean { return !!this.sounds[i] && !this.sounds[i].destroyed; }
  /** A live sound asset. GM ignores a missing or destroyed one: play gives -1, setters do nothing, gain reads 0 and pitch 1 (error_audit.md). */
  private snd(i: number): Snd | undefined {
    const s = this.sounds[i];
    return s && !s.destroyed ? s : undefined;
  }

  private effective(v: Voice): number {
    const s = this.sounds[v.snd];
    return v.gain * s.gain * s.volume * (this.groupGain[s.group] ?? 1);
  }

  play(i: number, loop: boolean, gain = 1, offset = 0, pitch = 1): number {
    const s = this.snd(i);
    if (!s) return -1;
    const id = this.nextVoice++;
    const v: Voice = { id, snd: i, handle: null, gain, pitch: pitch * s.pitch, loop, paused: false, stopped: false, offset };
    this.voices.set(id, v);
    const start = () => {
      if (v.stopped || s.id === null) return;
      v.handle = this.p.audio.play(s.id, loop, this.effective(v), v.pitch, v.offset);
      if (v.paused) this.p.audio.pause(v.handle, true);
    };
    if (s.id !== null) start(); else void this.load(i).then(start);
    return id;
  }

  /** Voices of a sound, or the one voice an id names. */
  private each(target: number, fn: (v: Voice) => void): void {
    if (target >= VOICE_BASE) { const v = this.voices.get(target); if (v) fn(v); return; }
    for (const v of this.voices.values()) if (v.snd === target) fn(v);
  }

  private alive(v: Voice): boolean {
    if (v.stopped) return false;
    if (v.handle === null) return this.sounds[v.snd].id === null; // still loading counts as playing
    if (v.paused || this.p.audio.isPlaying(v.handle)) return true;
    this.voices.delete(v.id);
    return false;
  }

  stop(target: number): void {
    this.each(target, (v) => { v.stopped = true; if (v.handle !== null) this.p.audio.stop(v.handle); this.voices.delete(v.id); });
  }
  private stopSound(i: number): void { this.stop(i); }
  stopAll(): void { for (const v of [...this.voices.values()]) this.stop(v.id); }

  isPlaying(target: number): boolean {
    let any = false;
    this.each(target, (v) => { if (this.alive(v) && !v.paused) any = true; });
    return any;
  }
  isPaused(target: number): boolean {
    let any = false;
    this.each(target, (v) => { if (v.paused && !v.stopped) any = true; });
    return any;
  }
  pause(target: number, on: boolean): void {
    this.each(target, (v) => { v.paused = on; if (v.handle !== null) this.p.audio.pause(v.handle, on); });
  }
  pauseAll(on: boolean): void { for (const v of this.voices.values()) this.pause(v.id, on); }

  /** audio_sound_gain: a voice ramps; a sound sets the gain of all its voices (and future ones). */
  setGain(target: number, gain: number, ms: number): void {
    if (target < VOICE_BASE) { const s = this.snd(target); if (!s) return; s.gain = gain; }
    this.each(target, (v) => {
      if (target >= VOICE_BASE) v.gain = gain;
      if (v.handle !== null) this.p.audio.setGain(v.handle, this.effective(v), ms);
    });
  }
  getGain(target: number): number {
    if (target < VOICE_BASE) return this.snd(target)?.gain ?? 0;
    return this.voices.get(target)?.gain ?? 0;
  }
  setPitch(target: number, pitch: number): void {
    if (target < VOICE_BASE) { const s = this.snd(target); if (!s) return; s.pitch = pitch; }
    this.each(target, (v) => { v.pitch = pitch; if (v.handle !== null) this.p.audio.setPitch(v.handle, pitch); });
  }
  getPitch(target: number): number {
    if (target < VOICE_BASE) return this.snd(target)?.pitch ?? 1;
    return this.voices.get(target)?.pitch ?? 1;
  }
  position(target: number): number {
    const v = this.voices.get(target);
    return v?.handle != null ? this.p.audio.position(v.handle) : 0;
  }
  seek(target: number, t: number): void {
    this.each(target, (v) => { if (v.handle !== null) this.p.audio.seek(v.handle, t); else v.offset = t; });
  }
  length(target: number): number {
    const i = target >= VOICE_BASE ? this.voices.get(target)?.snd ?? -1 : target;
    const s = this.sounds[i];
    return s?.id != null ? this.p.audio.length(s.id) : 0;
  }
  setLoop(target: number, loop: boolean): void {
    this.each(target, (v) => { v.loop = loop; if (v.handle !== null) this.p.audio.setLoop(v.handle, loop); });
  }
  setGroupGain(group: number, gain: number, ms: number): void {
    this.groupGain[group] = gain;
    for (const v of this.voices.values()) if (this.sounds[v.snd].group === group && v.handle !== null) this.p.audio.setGain(v.handle, this.effective(v), ms);
  }
  setMaster(gain: number): void { this.master = gain; this.p.audio.setMasterGain(gain); }
  /** Drops finished voices (called once a step). */
  sweep(): void { for (const v of this.voices.values()) this.alive(v); } // deleting while iterating a Map is safe
}
