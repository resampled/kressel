// The running game: rooms, instances, the per-step event order and drawing.
// Instance creation/iteration order lives here (see architecture.md "GML semantics").

import type { Platform } from '../platform/types.ts';
import type { BackgroundLayer, InstanceLayer } from '../krpj.ts';
import type { Block } from '../compile/bytecode.ts';
import { GV, IV } from '../compile/names.ts';
import { GmlError, real, type Value } from '../value.ts';
import { VM } from '../vm/vm.ts';
import { EV, emptyEvents, type Assets, type ObjectDef } from './assets.ts';
import { Instance, NOI, UNSET } from './instance.ts';
import { overlaps, shape } from './collision.ts';
import { Effects } from './effects.ts';

const FIRST_ID = 100000;

/** mulberry32: deterministic by default like GM (fixed seed until randomize), but not GM's sequence. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byDepth = (a: Instance, b: Instance) => b.depth - a.depth || a.order - b.order;

export class Game {
  readonly a: Assets;
  readonly p: Platform;
  readonly vm: VM;
  readonly fx: Effects;
  readonly random: () => number = rng(0);
  /** All instances in creation order (dead ones are compacted out at the end of each step). */
  instances: Instance[] = [];
  readonly globals: Value[];
  roomIndex = -1;
  /** Room to switch to at the end of the step, or -1. */
  pendingRoom = -1;
  self: Instance;
  other: Instance | null = null;
  // draw state
  colour = 0xffffff; alpha = 1; font = -1; halign = 0; valign = 0;
  /** Set by game_end; the host stops the loop. */
  ended = false;

  private nextId = FIRST_ID;
  private nextOrder = 0;
  private readonly byId = new Map<number, Instance>();
  private readonly drawList: Instance[] = [];
  private readonly sa = new Float64Array(12);
  private readonly sb = new Float64Array(12);
  private readonly global: Instance;
  /** The room's background layers, back to front. */
  private backgrounds: BackgroundLayer[] = [];
  private bgNext = 0;

  constructor(a: Assets, p: Platform) {
    this.a = a; this.p = p;
    this.vm = new VM(this);
    this.fx = new Effects(this.random);
    this.globals = new Array(a.varNames.length).fill(UNSET);
    // Room creation code runs as a dummy instance, like GM's global scope.
    const dummy: ObjectDef = { index: -1, name: '<global>', sprite: null, mask: null, parent: null, visible: false, persistent: true, solid: false, isA: new Set(), ev: emptyEvents(), hasDraw: false };
    this.global = new Instance(0, dummy, a.varNames.length);
    this.self = this.global;
  }

  get room() { return this.a.rooms[this.roomIndex]; }

  start(): void { this.enterRoom(this.a.initRoom, true); }

  /** One game frame: a step, then drawing, then any room change. */
  frame(): void {
    this.step();
    this.draw();
    if (this.pendingRoom >= 0) {
      const r = this.pendingRoom;
      this.pendingRoom = -1;
      this.leaveRoom();
      this.enterRoom(r, false);
    }
  }

  // ---------------------------------------------------------------- instances

  create(obj: ObjectDef, x: number, y: number, depth: number): Instance {
    const inst = new Instance(this.nextId++, obj, this.a.varNames.length);
    inst.order = this.nextOrder++;
    inst.x = inst.xstart = inst.xprevious = x;
    inst.y = inst.ystart = inst.yprevious = y;
    inst.depth = depth;
    inst.sprite = obj.sprite; inst.mask = obj.mask;
    inst.visible = obj.visible; inst.solid = obj.solid; inst.persistent = obj.persistent;
    this.instances.push(inst);
    this.byId.set(inst.id, inst);
    return inst;
  }

  /** instance_create_*: creates and runs the create event straight away. */
  spawn(obj: ObjectDef, x: number, y: number, depth: number): Instance {
    const inst = this.create(obj, x, y, depth);
    this.event(inst, EV.create, null);
    return inst;
  }

  destroy(inst: Instance, runDestroy: boolean): void {
    if (!inst.alive) return;
    if (runDestroy) this.event(inst, EV.destroy, null);
    this.event(inst, EV.cleanup, null);
    inst.alive = false;
    this.byId.delete(inst.id);
  }

  /** An instance id, object (first instance), or self/other keyword -> instance. */
  first(t: number): Instance | null {
    if (t >= FIRST_ID) return this.byId.get(t) ?? null;
    if (t === -1) return this.self;
    if (t === -2) return this.other;
    if (t < 0 && t !== -3) return null;
    for (const inst of this.instances) if (inst.alive && (t === -3 || inst.obj.isA.has(t))) return inst;
    return null;
  }

  /** Instances matching a `with`/target value, in iteration order, into out. */
  collect(t: Value, out: Instance[]): void {
    out.length = 0;
    const n = real(t);
    if (n === -5) throw new GmlError('with (global) is not supported');
    if (n >= FIRST_ID || n === -1 || n === -2) { const i = this.first(n); if (i?.alive) out.push(i); return; }
    if (n === -4) return;
    for (const inst of this.instances) if (inst.alive && (n === -3 || inst.obj.isA.has(n))) out.push(inst);
  }

  count(obj: number): number {
    let n = 0;
    for (const inst of this.instances) if (inst.alive && inst.obj.isA.has(obj)) n++;
    return n;
  }

  describe(t: number): string {
    if (t >= FIRST_ID) return `instance ${t}`;
    if (t >= 0) return `object ${this.a.objects[t]?.name ?? t}`;
    return ({ [-1]: 'self', [-2]: 'other', [-3]: 'all', [-4]: 'noone' } as Record<number, string>)[t] ?? String(t);
  }

  object(v: Value): ObjectDef {
    const o = this.a.objects[real(v)];
    if (!o) throw new GmlError(`${String(v)} is not an object`);
    return o;
  }

  layerDepth(layer: Value): number {
    if (typeof layer === 'string') {
      const l = this.room.layers.find((x) => x.name === layer);
      if (!l) throw new GmlError(`layer "${layer}" does not exist`);
      return l.depth;
    }
    throw new GmlError('layer ids are not supported yet; use the layer name');
  }

  // ---------------------------------------------------------------- built-in variables

  getIV(inst: Instance, id: number, index: Value): Value {
    if (id === IV.alarm) return inst.alarm[this.alarmIndex(index)];
    if (index !== NOI) throw new GmlError('built-in variable is not an array');
    if (id >= IV.bbox_left && id <= IV.bbox_bottom) {
      const k = shape(inst, inst.x, inst.y, this.sa);
      if (!k) return id === IV.bbox_left || id === IV.bbox_right ? inst.x : inst.y;
      return id === IV.bbox_left ? Math.floor(this.sa[8]) : id === IV.bbox_top ? Math.floor(this.sa[9])
        : id === IV.bbox_right ? Math.ceil(this.sa[10]) - 1 : Math.ceil(this.sa[11]) - 1;
    }
    return inst.get(id);
  }

  setIV(inst: Instance, id: number, v: Value, index: Value): void {
    if (id === IV.alarm) { inst.alarm[this.alarmIndex(index)] = real(v); return; }
    if (index !== NOI) throw new GmlError('built-in variable is not an array');
    inst.set(id, v, this.a.sprites);
  }

  private alarmIndex(index: Value): number {
    if (index === NOI) throw new GmlError('alarm is an array');
    const i = Math.trunc(real(index));
    if (i < 0 || i > 11) throw new GmlError(`alarm index ${i} out of range`);
    return i;
  }

  getGV(id: number): Value {
    switch (id) {
      case GV.room: return this.roomIndex;
      case GV.room_width: return this.room.width;
      case GV.room_height: return this.room.height;
      case GV.room_speed: case GV.fps: return this.a.fps;
      case GV.current_time: return Math.floor(this.p.now());
      case GV.mouse_x: return this.p.input.mouseX;
      case GV.mouse_y: return this.p.input.mouseY;
      case GV.instance_count: { let n = 0; for (const i of this.instances) if (i.alive) n++; return n; }
    }
    throw new GmlError(`global ${id} can't be read`);
  }

  setGV(id: number, v: Value): void {
    if (id === GV.room) { this.goto(real(v)); return; }
    if (id === GV.room_speed) throw new GmlError('room_speed assignment not supported yet');
    throw new GmlError(`global ${id} can't be assigned`);
  }

  goto(room: number): void {
    if (!this.a.rooms[room]) throw new GmlError(`room ${room} does not exist`);
    this.pendingRoom = room;
  }

  // ---------------------------------------------------------------- collisions

  /** Would inst at (x, y) touch target (instance, object or all)? Returns the first instance hit. */
  placeMeeting(inst: Instance, x: number, y: number, target: number): Instance | null {
    const ka = shape(inst, x, y, this.sa);
    if (!ka) return null;
    for (const o of this.instances) {
      if (!o.alive || o === inst) continue;
      if (target >= FIRST_ID ? o.id !== target : target !== -3 && !o.obj.isA.has(target)) continue;
      if (overlaps(ka, this.sa, shape(o, o.x, o.y, this.sb), this.sb)) return o;
    }
    return null;
  }

  // ---------------------------------------------------------------- events

  run(blocks: Block[] | null, inst: Instance, other: Instance | null): void {
    if (!blocks) return;
    // destroy() runs the destroy/cleanup events before marking the instance dead.
    for (const b of blocks) { if (!inst.alive) return; this.vm.run(b, inst, other); }
  }

  event(inst: Instance, ev: number, other: Instance | null): void { this.run(inst.obj.ev.simple[ev], inst, other); }

  /** Runs one event for every live instance that existed when the phase began. */
  private phase(ev: number): void {
    const list = this.instances, n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i];
      if (inst.alive && inst.obj.ev.simple[ev]) this.run(inst.obj.ev.simple[ev], inst, null);
    }
  }

  private enterRoom(index: number, first: boolean): void {
    this.roomIndex = index;
    const room = this.room;
    this.backgrounds = room.layers.filter((l): l is BackgroundLayer => l.type === 'background').sort((a, b) => b.depth - a.depth);
    for (const l of room.layers) {
      if (l.type !== 'instances') continue;
      for (const def of (l as InstanceLayer).instances) {
        const inst = this.create(this.a.objectByName.get(def.object)!, def.x, def.y, l.depth);
        if (def.scale_x !== undefined) inst.image_xscale = def.scale_x;
        if (def.scale_y !== undefined) inst.image_yscale = def.scale_y;
        if (def.angle !== undefined) inst.image_angle = def.angle;
        if (def.colour !== undefined) inst.image_blend = def.colour;
        if (def.alpha !== undefined) inst.image_alpha = def.alpha;
        if (def.image_index !== undefined) inst.image_index = def.image_index;
        if (def.image_speed !== undefined) inst.image_speed = def.image_speed;
        // GM order: create event, then that instance's creation code, instance by instance.
        this.event(inst, EV.create, null);
        const cc = room.creation.get(def);
        if (cc && inst.alive) this.vm.run(cc, inst, null);
      }
    }
    if (first) this.phase(EV.game_start);
    for (const b of room.create) this.vm.run(b, this.global, null);
    this.phase(EV.room_start);
  }

  private leaveRoom(): void {
    this.phase(EV.room_end);
    for (const inst of this.instances) {
      if (!inst.alive || inst.persistent) continue;
      this.event(inst, EV.cleanup, null);
      inst.alive = false;
      this.byId.delete(inst.id);
    }
    this.compact();
    this.fx.clear();
  }

  private compact(): void {
    let w = 0;
    for (const inst of this.instances) if (inst.alive) this.instances[w++] = inst;
    this.instances.length = w;
  }

  // ---------------------------------------------------------------- the step

  step(): void {
    const list = this.instances, input = this.p.input;
    for (const inst of list) { inst.xprevious = inst.x; inst.yprevious = inst.y; }

    this.phase(EV.step_begin);

    let n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i];
      for (let k = 0; k < 12; k++) {
        if (!inst.alive || inst.alarm[k] <= 0) continue;
        if (--inst.alarm[k] <= 0) { inst.alarm[k] = -1; this.run(inst.obj.ev.alarm[k], inst, null); }
      }
    }

    n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i], ev = inst.obj.ev;
      for (let kind = 0; kind < 3; kind++) {
        const codes = ev.keyCode[kind], state = kind === 0 ? input.keys : kind === 1 ? input.pressed : input.released;
        for (let c = 0; c < codes.length; c++) if (keyState(state, codes[c])) this.run(ev.keyBlocks[kind][c], inst, null);
      }
    }

    this.phase(EV.step);

    // Built-in motion, then outside-room checks.
    const room = this.room;
    n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i];
      if (!inst.alive) continue;
      if (inst.friction !== 0 && inst.speed !== 0) {
        const s = inst.speed > 0 ? Math.max(0, inst.speed - inst.friction) : Math.min(0, inst.speed + inst.friction);
        inst.setSpeed(s);
      }
      if (inst.gravity !== 0) {
        const d = inst.gravity_direction * Math.PI / 180;
        inst.setHV(inst.hspeed + inst.gravity * Math.cos(d), inst.vspeed - inst.gravity * Math.sin(d));
      }
      inst.x += inst.hspeed; inst.y += inst.vspeed;
      const out = inst.obj.ev.simple[EV.outside_room];
      if (out) {
        const k = shape(inst, inst.x, inst.y, this.sa);
        const l = k ? this.sa[8] : inst.x, t = k ? this.sa[9] : inst.y, r = k ? this.sa[10] : inst.x, b = k ? this.sa[11] : inst.y;
        const outside = r < 0 || b < 0 || l > room.width || t > room.height;
        // TODO: verify against GM whether this fires every step while outside or only on leaving.
        if (outside && !inst.wasOutside) this.run(out, inst, null);
        inst.wasOutside = outside;
      }
    }

    this.collisions();
    this.phase(EV.step_end);

    // Animation.
    n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i], spr = inst.sprite;
      if (!inst.alive || !spr) continue;
      inst.image_index += inst.image_speed * (spr.fpsDiv ? spr.speed / this.a.fps : spr.speed);
      const frames = spr.frames.length;
      if (inst.image_index >= frames || inst.image_index < 0) {
        inst.image_index = ((inst.image_index % frames) + frames) % frames;
        this.event(inst, EV.animation_end, null);
      }
    }

    this.fx.step();
    input.pressed.fill(0); input.released.fill(0);
    this.compact();
  }

  private collisions(): void {
    const list = this.instances, n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i];
      const ev = inst.obj.ev;
      for (let c = 0; c < ev.colObj.length && inst.alive; c++) {
        const obj = ev.colObj[c], blocks = ev.colBlocks[c];
        for (let j = 0; j < n && inst.alive; j++) {
          const o = list[j];
          if (o === inst || !o.alive || !o.obj.isA.has(obj)) continue;
          const ka = shape(inst, inst.x, inst.y, this.sa), kb = shape(o, o.x, o.y, this.sb);
          if (!overlaps(ka, this.sa, kb, this.sb)) continue;
          if (o.solid) { inst.x = inst.xprevious; inst.y = inst.yprevious; }
          this.run(blocks, inst, o);
        }
      }
    }
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    const r = this.p.renderer, room = this.room;
    r.beginFrame(room.width, room.height);
    r.clear(0, 1);
    this.phase(EV.draw_pre);
    this.phase(EV.draw_begin);

    const dl = this.drawList;
    dl.length = 0;
    for (const inst of this.instances) if (inst.alive && inst.visible) dl.push(inst);
    dl.sort(byDepth);
    this.bgNext = 0;
    this.backgroundsDownTo(Infinity);
    this.fx.draw(r, false);
    for (const inst of dl) {
      if (!inst.alive) continue;
      this.backgroundsDownTo(inst.depth);
      if (inst.obj.hasDraw) this.run(inst.obj.ev.simple[EV.draw], inst, null);
      else this.drawSelf(inst);
    }
    this.backgroundsDownTo(-Infinity);
    this.fx.draw(r, true);

    this.phase(EV.draw_end);
    this.phase(EV.draw_post);
    this.phase(EV.drawgui_begin);
    this.phase(EV.drawgui);
    this.phase(EV.drawgui_end);
    r.endFrame();
  }

  drawSelf(inst: Instance): void {
    const spr = inst.sprite;
    if (!spr || !spr.frames.length) return;
    const f = spr.frames[Math.floor(inst.image_index) % spr.frames.length];
    this.p.renderer.drawImage(f, 0, 0, spr.width, spr.height, inst.x, inst.y, spr.ox, spr.oy,
      inst.image_xscale, inst.image_yscale, inst.image_angle, inst.image_blend, inst.image_alpha * this.alpha);
  }

  /** Draws the not-yet-drawn background layers at or behind `depth` (higher depth = further back). */
  private backgroundsDownTo(depth: number): void {
    const bgs = this.backgrounds;
    for (; this.bgNext < bgs.length && bgs[this.bgNext].depth >= depth; this.bgNext++) this.drawBackground(bgs[this.bgNext]);
  }

  private drawBackground(l: BackgroundLayer): void {
    if (l.visible === false) return;
    if (l.sprite !== null) throw new GmlError(`background layer "${l.name}": sprites not supported yet`);
    this.p.renderer.rect(0, 0, this.room.width, this.room.height, l.color, 1, false);
  }
}

/** vk_anykey (1) / vk_nokey (0) / a key code. */
function keyState(keys: Uint8Array, k: number): boolean {
  if (k > 1) return keys[k] !== 0;
  let any = false;
  for (let i = 2; i < keys.length; i++) if (keys[i]) { any = true; break; }
  return k === 1 ? any : !any;
}
