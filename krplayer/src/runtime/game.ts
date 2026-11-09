// The running game: rooms, instances, the per-step event order and drawing.
// Instance creation/iteration order lives here (see architecture.md "GML semantics").

import { WINDOW, type Platform } from '../platform/types.ts';
import type { RoomInstance } from '../krpj.ts';
import { EK, type Block } from '../compile/bytecode.ts';
import { GV, IV } from '../compile/names.ts';
import { GmlError, GmStruct, real, Scope, truthy, NotImplemented, Unverified, type GArray, type Value } from '../value.ts';
import { VM } from '../vm/vm.ts';
import { ASYNC, EV, emptyEvents, type Assets, type Events, type ObjectDef } from './assets.ts';
import { Instance, NOI } from './instance.ts';
import { newShape, overlaps, shape } from './collision.ts';
import { Effects } from './effects.ts';
import { Layers, ELEM, newCamera, viewFrom, type Camera, type Element, type RtLayer, type RtView } from './layers.ts';
import { Sounds } from './sound.ts';
import { Paths } from './paths.ts';
import { Data, DsMap, Files, type Ini, type TextFile } from './data.ts';
import { drawSprite, frameOf, quadC } from './draw.ts';

const FIRST_ID = 100000;
const APP_SURFACE = 0;

/** mulberry32: deterministic by default like GM (fixed seed until randomize), but not GM's sequence. */
export class Rng {
  seed: number;
  private s: number;
  constructor(seed: number) { this.seed = seed >>> 0; this.s = this.seed; }
  set(seed: number): void { this.seed = seed >>> 0; this.s = this.seed; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

interface Surface { tex: number; w: number; h: number }
interface SavedRoom { instances: Instance[]; layers: RtLayer[] }

export class Game {
  readonly a: Assets;
  readonly p: Platform;
  readonly vm: VM;
  readonly fx: Effects;
  readonly rng = new Rng(0);
  readonly random: () => number = () => this.rng.next();
  readonly snd: Sounds;
  readonly data = new Data();
  readonly files: Files;
  readonly layers = new Layers();
  readonly paths: Paths;
  /** All instances in creation order (dead ones are compacted out at the end of each step). */
  instances: Instance[] = [];
  /** The global scope: global.x lives in its vars. GM 2.3 global script code runs with it as self. */
  readonly globalScope = new GmStruct(null);
  roomIndex = -1;
  /** Room to switch to at the end of the step, or -1. */
  pendingRoom = -1;
  self: Scope;
  other: Scope | null = null;
  // draw state
  colour = 0xffffff; alpha = 1; font = -1; halign = 0; valign = 0;
  /** draw_set_circle_precision: segments per circle/ellipse. */
  circlePrecision = 24;
  /** matrix_get/matrix_set (view, projection, world); krplayer only accepts identity. */
  readonly matrices: GArray[] = [0, 1, 2].map(() => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  /** Set by game_end; the host stops the loop. */
  ended = false;
  endMessage = '';
  /** Steps per second (room_speed / game_set_speed). */
  speed: number;
  frameCount = 0;
  // views and cameras
  cameras: (Camera | null)[] = [];
  views: RtView[] = [];
  viewCurrent = 0;
  viewsEnabled = false;
  // surfaces (0 is the application surface)
  readonly surfaces = new Map<number, Surface>();
  private nextSurface = 1;
  appSurfaceDraw = true;
  private targetStack: number[] = [];
  guiW = 0; guiH = 0;
  // files and async events
  ini: { path: string; ini: Ini; dirty: boolean } | null = null;
  readonly textFiles = new Map<number, TextFile>();
  nextFile = 1;
  asyncLoad = -1;
  private readonly asyncQueue: { kind: number; map: number }[] = [];
  /** Current event (for event_type / event_inherited); see EK. */
  eventKey = -1;
  readonly persistentRooms = new Map<number, SavedRoom>();
  keyboardString = '';
  lastKey = 0;
  readonly startTime: number;

  private nextId = FIRST_ID;
  private nextOrder = 0;
  private readonly byId = new Map<number, Instance>();
  private readonly drawList: Instance[] = [];
  private readonly layerOrder: RtLayer[] = [];
  readonly sa = newShape();
  readonly sb = newShape();
  private readonly global: Instance;

  constructor(a: Assets, p: Platform) {
    this.a = a; this.p = p;
    this.vm = new VM(this);
    this.fx = new Effects(this.random);
    this.snd = new Sounds(p, a);
    this.paths = new Paths(a.paths);
    this.files = new Files(p.storage, a.files);
    this.speed = a.fps;
    this.startTime = p.now();
    // Room creation code runs as a dummy instance, like GM's.
    const dummy: ObjectDef = { index: -1, name: '<room>', sprite: null, mask: null, parent: null, visible: false, persistent: true, solid: false, depth: 0, isA: new Set(), own: emptyEvents(), ev: emptyEvents(), hasDraw: false };
    this.global = new Instance(0, dummy);
    this.self = this.globalScope;
    // Room instances keep their ids; runtime ones start after the largest.
    for (const r of a.rooms) for (const l of r.layers) if (l.type === 'instances') for (const i of l.instances) if (i.id && i.id >= this.nextId) this.nextId = i.id + 1;
    const [w, h] = [a.width, a.height];
    this.surfaces.set(APP_SURFACE, { tex: p.renderer.createSurface(w, h), w, h });
    p.renderer.setWindowSize(w, h);
  }

  get room() { return this.a.rooms[this.roomIndex]; }

  /** Debug warp: the room the game's first room change goes to instead (-1 = off). */
  private warpRoom = -1;
  /** Debug: runs just before the warp room is entered (see runtime/debug.ts). */
  private warpInit: (() => void) | null = null;
  /** Debug: only warp on a room change out of this room (-1: the first room change). */
  private warpAfter = -1;

  /**
   * Runs global init and enters the first room. With `warp` (a room index), the first room change
   * goes there instead, so the init room still sets the game up; with `direct` the game enters it straight away.
   * `init` runs right before the warp room is entered. With `after` (a room index), the warp waits for the
   * first room change out of that room instead, for games whose setup room isn't the first (Deltarune Ch2).
   */
  start(warp = -1, direct = false, init: (() => void) | null = null, after = -1): void {
    if (warp >= 0 && !this.a.rooms[warp]) throw new Error(`start room ${warp} does not exist`);
    void this.snd.preload();
    for (const b of this.a.globalInit) this.vm.run(b, this.globalScope, null);
    if (direct && warp >= 0) { init?.(); return this.enterRoom(warp, true); }
    this.warpRoom = warp;
    this.warpAfter = after;
    if (warp >= 0) this.warpInit = init;
    this.enterRoom(this.a.initRoom, true);
  }

  /** Room index for a room name or index string, or -1. */
  findRoom(q: string): number {
    const i = this.a.rooms.findIndex((r) => r.name === q);
    return i >= 0 || !/^\d+$/.test(q) ? i : this.a.rooms[+q] ? +q : -1;
  }

  /** One game frame: a step, then drawing, then any room change. */
  frame(): void {
    this.vm.budget = 50_000_000;
    this.frameCount++;
    this.step();
    if (this.pendingRoom < 0 && !this.ended) this.draw();
    if (this.pendingRoom >= 0 && !this.ended) {
      let r = this.pendingRoom;
      const warping = this.warpRoom >= 0 && (this.warpAfter < 0 || this.roomIndex === this.warpAfter);
      this.pendingRoom = -1;
      if (warping) { r = this.warpRoom; this.warpRoom = -1; }
      this.leaveRoom(r);
      if (warping && this.warpInit) { const f = this.warpInit; this.warpInit = null; f(); }
      this.enterRoom(r, false);
    }
  }

  // ---------------------------------------------------------------- instances

  create(obj: ObjectDef, x: number, y: number, depth: number, id?: number): Instance {
    const inst = new Instance(id ?? this.nextId++, obj);
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
  spawn(obj: ObjectDef, x: number, y: number, depth: number, layer = -1): Instance {
    const inst = this.create(obj, x, y, depth);
    inst.layer = layer;
    this.runCreate(inst);
    return inst;
  }

  /** The create event, preceded by GMS2's pre-create event and (room instances) the instance's variable overrides. */
  runCreate(inst: Instance, pre?: Block): void {
    this.event(inst, EV.pre_create, null);
    if (pre && inst.alive) this.vm.run(pre, inst, null);
    if (inst.alive) this.event(inst, EV.create, null);
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
    if (t >= FIRST_ID) { const i = this.byId.get(t); return i && i.active ? i : null; }
    if (t === -1) return this.self instanceof Instance ? this.self : null;
    if (t === -2) return this.other instanceof Instance ? this.other : null;
    if (t < 0 && t !== -3) return null;
    for (const inst of this.instances) if (inst.alive && inst.active && (t === -3 || inst.obj.isA.has(t))) return inst;
    return null;
  }
  /** The instance with this id even if deactivated (instance_activate_object etc.). */
  byIdAny(id: number): Instance | undefined { return this.byId.get(id); }

  /** Instances (or a struct) matching a `with`/target value, in iteration order, into out. */
  collect(t: Value, out: Scope[]): void {
    out.length = 0;
    if (t instanceof Scope) { out.push(t); return; }
    const n = real(t);
    if (n === -5) { out.push(this.globalScope); return; }
    if (n >= FIRST_ID) { const i = this.first(n); if (i?.alive) out.push(i); return; }
    if (n === -1 || n === -2) { const s = n === -1 ? this.self : this.other; if (s) out.push(s); return; }
    if (n === -4) return;
    for (const inst of this.instances) if (inst.alive && inst.active && (n === -3 || inst.obj.isA.has(n))) out.push(inst);
  }

  count(obj: number): number {
    if (obj >= FIRST_ID) return this.first(obj) ? 1 : 0;
    let n = 0;
    for (const inst of this.instances) if (inst.alive && inst.active && (obj === -3 || inst.obj.isA.has(obj))) n++;
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

  instanceOf(v: Value): Instance {
    const i = this.first(real(v));
    if (!i) throw new GmlError(`unable to find an instance for ${this.describe(real(v))}`);
    return i;
  }

  /** The function a script index (script_execute, script ids as values) names. */
  scriptFunction(id: number): number {
    const f = this.a.scripts[Math.trunc(id)] ?? -1;
    if (f < 0) throw new GmlError(`script ${id} is not a function`);
    return f;
  }

  ivName(id: number): string { return Object.entries(IV).find(([, v]) => v === id)?.[0] ?? String(id); }

  // ---------------------------------------------------------------- built-in variables

  getIV(inst: Instance, id: number, index: Value): Value {
    if (id === IV.alarm) return inst.alarm[this.alarmIndex(index)];
    if (index !== NOI) throw new Unverified(`built-in variable ${this.ivName(id)} is not an array`);
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
    if (index !== NOI) throw new Unverified(`built-in variable ${this.ivName(id)} is not an array`);
    if (id === IV.layer) {
      const l = this.layers.get(real(v));
      inst.layer = l.id; inst.depth = l.depth;
      return;
    }
    if (id === IV.depth) { inst.depth = real(v); inst.layer = -1; return; }
    inst.set(id, v, this.a.sprites);
  }

  private alarmIndex(index: Value): number {
    if (index === NOI) throw new Unverified('alarm is an array');
    const i = Math.trunc(real(index));
    if (i < 0 || i > 11) throw new Unverified(`alarm index ${i} out of range`);
    return i;
  }

  getGV(id: number, index: Value): Value {
    if (index !== NOI) {
      const i = Math.trunc(real(index));
      if (i < 0 || i > 7) throw new Unverified(`view index ${i} out of range`);
      const v = this.views[i];
      switch (id) {
        case GV.view_camera: return v.camera;
        case GV.view_visible: return v.visible;
        case GV.view_xport: return v.px; case GV.view_yport: return v.py;
        case GV.view_wport: return v.pw; case GV.view_hport: return v.ph;
        case GV.view_surface_id: return v.surface;
      }
      const c = this.cameras[v.camera];
      switch (id) {
        case GV.view_xview: return c?.x ?? 0; case GV.view_yview: return c?.y ?? 0;
        case GV.view_wview: return c?.w ?? 0; case GV.view_hview: return c?.h ?? 0;
        case GV.view_angle: return c?.angle ?? 0; case GV.view_object: return c?.target ?? -1;
      }
      throw new Unverified('built-in global is not an array');
    }
    const d = new Date();
    switch (id) {
      case GV.room: return this.roomIndex;
      case GV.room_width: return this.room.width;
      case GV.room_height: return this.room.height;
      case GV.room_speed: return this.speed;
      case GV.fps: case GV.fps_real: return this.speed;
      case GV.current_time: return Math.floor(this.p.now() - this.startTime);
      case GV.delta_time: return Math.round(1e6 / this.speed);
      case GV.mouse_x: return this.p.input.mouseX;
      case GV.mouse_y: return this.p.input.mouseY;
      case GV.instance_count: { let n = 0; for (const i of this.instances) if (i.alive && i.active) n++; return n; }
      case GV.undefined: return undefined;
      case GV.application_surface: return APP_SURFACE;
      case GV.async_load: return this.asyncLoad;
      case GV.event_type: return gmEventType(this.eventKey);
      case GV.event_number: return gmEventNumber(this.eventKey);
      case GV.event_object: return (this.self instanceof Instance) ? this.self.obj.index : -1;
      case GV.keyboard_key: return this.currentKey();
      case GV.keyboard_lastkey: return this.lastKey;
      case GV.keyboard_string: return this.keyboardString;
      case GV.keyboard_lastchar: return this.keyboardString.slice(-1);
      case GV.os_type: return 0; // os_windows: games branch on it, and the browser build behaves like the PC one
      case GV.os_browser: return -1; // browser_not_a_browser, matching os_type
      case GV.os_device: return 0;
      case GV.os_version: return 655360;
      case GV.room_persistent: return this.room.persistent;
      case GV.view_current: return this.viewCurrent;
      case GV.view_enabled: return this.viewsEnabled;
      case GV.working_directory: case GV.program_directory: case GV.temp_directory: return './';
      case GV.game_save_id: return './';
      case GV.debug_mode: return false;
      case GV.game_display_name: case GV.game_project_name: return this.a.title;
      case GV.game_id: return 0;
      case GV.room_first: return this.a.roomOrder[0] ?? -1;
      case GV.room_last: return this.a.roomOrder.at(-1) ?? -1;
      case GV.room_caption: return this.a.title;
      case GV.browser_width: case GV.browser_height: return id === GV.browser_width ? this.p.renderer.windowSize()[0] : this.p.renderer.windowSize()[1];
      case GV.current_year: return d.getFullYear(); case GV.current_month: return d.getMonth() + 1; case GV.current_day: return d.getDate();
      case GV.current_weekday: return d.getDay(); case GV.current_hour: return d.getHours(); case GV.current_minute: return d.getMinutes();
      case GV.current_second: return d.getSeconds();
      case GV.mouse_button: case GV.mouse_lastbutton: return this.p.input.mouseButtons & 1 ? 1 : this.p.input.mouseButtons & 2 ? 2 : this.p.input.mouseButtons & 4 ? 3 : 0;
      case GV.pointer_null: return 0; case GV.pointer_invalid: return -1;
      case GV.background_colour: case GV.background_color: return this.room.colour;
      case GV.background_showcolour: case GV.background_showcolor: return this.room.showColour;
      case GV.display_aa: return 0;
      case GV.health: case GV.score: case GV.lives: return this.globalScope.vars.get(this.a.varSlot(`<${id}>`)) ?? 0;
    }
    throw new Unverified(`global ${id} can't be read`);
  }

  setGV(id: number, v: Value, index: Value): void {
    if (index !== NOI) {
      const i = Math.trunc(real(index)), view = this.views[i];
      if (!view) throw new Unverified(`view index ${i} out of range`);
      switch (id) {
        case GV.view_camera: view.camera = real(v); return;
        case GV.view_visible: view.visible = truthy(v); return;
        case GV.view_xport: view.px = real(v); return; case GV.view_yport: view.py = real(v); return;
        case GV.view_wport: view.pw = real(v); return; case GV.view_hport: view.ph = real(v); return;
        case GV.view_surface_id: view.surface = real(v); return;
      }
      const c = this.cameras[view.camera];
      switch (id) {
        case GV.view_xview: if (c) c.x = real(v); return; case GV.view_yview: if (c) c.y = real(v); return;
        case GV.view_wview: if (c) c.w = real(v); return; case GV.view_hview: if (c) c.h = real(v); return;
        case GV.view_angle: if (c) c.angle = real(v); return; case GV.view_object: if (c) c.target = real(v); return;
      }
      throw new Unverified('built-in global is not an array');
    }
    switch (id) {
      case GV.room: this.goto(real(v)); return;
      case GV.room_speed: this.speed = Math.max(1, real(v)); return;
      case GV.keyboard_string: this.keyboardString = String(v).slice(0, 1024); return;
      case GV.keyboard_key: case GV.keyboard_lastkey: this.lastKey = real(v); return;
      case GV.keyboard_lastchar: return;
      case GV.room_persistent: this.room.persistent = truthy(v); return;
      case GV.view_enabled: this.viewsEnabled = truthy(v); return;
      case GV.room_caption: this.p.setTitle(String(v)); return;
      case GV.mouse_button: return;
      case GV.background_colour: case GV.background_color: this.room.colour = real(v); return;
      case GV.background_showcolour: case GV.background_showcolor: this.room.showColour = truthy(v); return;
      case GV.health: case GV.score: case GV.lives: this.globalScope.vars.set(this.a.varSlot(`<${id}>`), v); return;
    }
    throw new Unverified(`global ${id} can't be assigned`);
  }

  private currentKey(): number {
    const k = this.p.input.keys;
    for (let i = 255; i > 1; i--) if (k[i]) return i;
    return 0;
  }

  goto(room: number): void {
    if (!this.a.rooms[room]) throw new Unverified(`room ${room} does not exist`);
    this.pendingRoom = room;
  }

  // ---------------------------------------------------------------- collisions

  /** Would inst at (x, y) touch target (instance, object or all)? Returns the first instance hit. */
  placeMeeting(inst: Instance, x: number, y: number, target: number, solidOnly = false): Instance | null {
    const ka = shape(inst, x, y, this.sa);
    if (!ka) return null;
    for (const o of this.instances) {
      if (!o.alive || !o.active || o === inst || (solidOnly && !o.solid)) continue;
      if (target >= FIRST_ID ? o.id !== target : target !== -3 && !o.obj.isA.has(target)) continue;
      if (overlaps(ka, this.sa, shape(o, o.x, o.y, this.sb), this.sb)) return o;
    }
    return null;
  }

  /** collision_* / position_*: the first instance of target whose mask overlaps the given shape (in sa), or null. */
  collideShape(ka: number, target: number, notme: Instance | null, test?: (o: Instance) => boolean): Instance | null {
    for (const o of this.instances) {
      if (!o.alive || !o.active || o === notme) continue;
      if (target >= FIRST_ID ? o.id !== target : target !== -3 && !o.obj.isA.has(target)) continue;
      const kb = shape(o, o.x, o.y, this.sb);
      if (!kb) continue;
      if (test ? test(o) : overlaps(ka, this.sa, kb, this.sb)) return o;
    }
    return null;
  }

  // ---------------------------------------------------------------- events

  run(blocks: Block[] | null, inst: Instance, other: Scope | null): void {
    if (!blocks) return;
    const saved = this.eventKey;
    // destroy() runs the destroy/cleanup events before marking the instance dead.
    // Outside collisions and with, `other` is the instance itself (gm_gotchas.md).
    try {
      for (const b of blocks) { if (!inst.alive) return; this.eventKey = b.ev ?? -1; this.vm.run(b, inst, other ?? inst); }
    } finally { this.eventKey = saved; }
  }

  event(inst: Instance, ev: number, other: Scope | null): void { this.run(inst.obj.ev.simple[ev], inst, other); }

  userEvent(inst: Instance, n: number): void { this.run(inst.obj.ev.user[n], inst, this.other); }

  /** event_perform(type, number) with GM's ev_* numbering. Kinds krplayer has no key for fail loudly. */
  performEvent(inst: Instance, type: number, num: number): void {
    const key = gmEventKey(type, num);
    if (key < 0) throw new NotImplemented(`event_perform(${type}, ${num}) is not supported yet`);
    this.run(eventBlocks(inst.obj.ev, key), inst, this.other);
  }

  /** event_inherited: the running event's code as defined by the nearest ancestor of the object that defined it. */
  inherited(): void {
    const b = this.vm.current;
    if (!b || b.owner === undefined || b.ev === undefined) return;
    const inst = this.self;
    if (!(inst instanceof Instance)) return;
    for (let p = this.a.objects[b.owner].parent; p; p = p.parent) {
      const blocks = eventBlocks(p.own, b.ev);
      if (blocks) { this.run(blocks, inst, this.other); return; }
    }
  }

  /** Runs one event for every live instance that existed when the phase began. */
  private phase(ev: number): void {
    const list = this.instances, n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i];
      if (inst.alive && inst.active && inst.obj.ev.simple[ev]) this.run(inst.obj.ev.simple[ev], inst, null);
    }
  }

  /** Queues an async event (async_load is a ds_map built by the caller). */
  queueAsync(kind: string, map: DsMap | Record<string, Value>): void {
    const m = map instanceof DsMap ? map : Object.assign(new DsMap(), {});
    if (!(map instanceof DsMap)) for (const [k, v] of Object.entries(map)) m.m.set(k, v);
    this.asyncQueue.push({ kind: ASYNC.indexOf(kind), map: this.data.maps.add(m) });
  }

  private fireAsync(): void {
    while (this.asyncQueue.length) {
      const { kind, map } = this.asyncQueue.shift()!;
      this.asyncLoad = map;
      const list = this.instances, n = list.length;
      for (let i = 0; i < n; i++) {
        const inst = list[i];
        if (inst.alive && inst.active && inst.obj.ev.async[kind]) this.run(inst.obj.ev.async[kind], inst, null);
      }
      this.data.maps.free(map);
      this.asyncLoad = -1;
    }
  }

  // ---------------------------------------------------------------- rooms

  private enterRoom(index: number, first: boolean): void {
    this.roomIndex = index;
    const room = this.room, saved = this.persistentRooms.get(index);
    this.persistentRooms.delete(index);
    if (room.speed > 0 && first) this.speed = room.speed;
    this.setupViews();
    if (saved) {
      // A persistent room comes back as it was left: no create events.
      this.layers.list = saved.layers; this.layers.version++;
      for (const inst of saved.instances) { inst.alive = true; this.instances.push(inst); this.byId.set(inst.id, inst); }
      this.phase(EV.room_start);
      return;
    }
    this.layers.load(room.layers, this.a);
    for (const inst of this.instances) if (inst.alive && inst.layer >= 0) {
      // Persistent instances keep their depth; they join the new room's layer of that name if any.
      inst.layer = -1;
    }
    // Every room instance exists (built-ins set) before the first create event runs; then, in creation
    // order, each runs its create event and creation code (create code may read later instances' x/y).
    const created: [Instance, RoomInstance][] = [];
    for (const { def, layer: l } of room.order) {
      if (def.id && this.byId.has(def.id)) continue; // a persistent instance from an earlier visit already exists
      const inst = this.create(this.a.objectByName.get(def.object)!, def.x, def.y, l.depth, def.id);
      inst.layer = (this.layers.find(l.id ?? l.name) ?? this.layers.find(l.name)!).id;
      if (def.scale_x !== undefined) inst.image_xscale = def.scale_x;
      if (def.scale_y !== undefined) inst.image_yscale = def.scale_y;
      if (def.angle !== undefined) inst.image_angle = def.angle;
      if (def.colour !== undefined) inst.image_blend = def.colour;
      if (def.alpha !== undefined) inst.image_alpha = def.alpha;
      if (def.image_index !== undefined) inst.image_index = def.image_index;
      if (def.image_speed !== undefined) inst.image_speed = def.image_speed;
      created.push([inst, def]);
    }
    for (const [inst, def] of created) {
      if (!inst.alive) continue;
      this.runCreate(inst, room.preCreate.get(def));
      const cc = room.creation.get(def);
      if (cc && inst.alive) this.vm.run(cc, inst, null);
    }
    if (first) this.phase(EV.game_start);
    for (const b of room.create) this.vm.run(b, this.global, null);
    this.phase(EV.room_start);
  }

  private leaveRoom(next: number): void {
    this.phase(EV.room_end);
    const room = this.room;
    if (room.persistent && next !== this.roomIndex) {
      const keep = this.instances.filter((i) => i.alive && !i.persistent);
      for (const i of keep) { this.byId.delete(i.id); i.alive = false; }
      this.persistentRooms.set(this.roomIndex, { instances: keep, layers: this.layers.list });
    } else {
      for (const inst of this.instances) {
        if (!inst.alive || inst.persistent) continue;
        this.event(inst, EV.cleanup, null);
        inst.alive = false;
        this.byId.delete(inst.id);
      }
    }
    this.compact();
    this.fx.clear();
  }

  private setupViews(): void {
    const room = this.room;
    this.viewsEnabled = room.viewsEnabled;
    this.views = [];
    for (let i = 0; i < 8; i++) {
      const v = viewFrom(room.views[i]);
      const d = room.views[i];
      const cam = newCamera(i);
      if (d) {
        [cam.x, cam.y, cam.w, cam.h] = d.view;
        if (d.border) [cam.bx, cam.by] = d.border;
        if (d.speed) [cam.sx, cam.sy] = d.speed;
        cam.target = d.follow ? this.a.objectByName.get(d.follow)?.index ?? -1 : -1;
      } else { cam.w = room.width; cam.h = room.height; }
      this.cameras[i] = cam;
      v.camera = i;
      this.views.push(v);
    }
    // The application surface keeps its size across rooms (see gm_gotchas.md); draw() stretches the first port to fill it.
  }

  private compact(): void {
    let w = 0;
    for (const inst of this.instances) if (inst.alive) this.instances[w++] = inst;
    this.instances.length = w;
  }

  // ---------------------------------------------------------------- the step

  step(): void {
    const list = this.instances, input = this.p.input;
    this.fireAsync();
    if (input.typed) { this.keyboardString = (this.keyboardString + input.typed).slice(-1024); input.typed = ''; }
    if (input.lastKey) { this.lastKey = input.lastKey; input.lastKey = 0; }
    for (const inst of list) { inst.xprevious = inst.x; inst.yprevious = inst.y; }

    this.phase(EV.step_begin);
    if (this.pendingRoom >= 0) return this.endStep();

    let n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i];
      for (let k = 0; k < 12; k++) {
        if (!inst.alive || !inst.active || inst.alarm[k] <= 0) continue;
        if (--inst.alarm[k] <= 0) { inst.alarm[k] = -1; this.run(inst.obj.ev.alarm[k], inst, null); }
      }
    }
    if (this.pendingRoom >= 0) return this.endStep();

    n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i], ev = inst.obj.ev;
      if (!inst.active) continue;
      for (let kind = 0; kind < 3; kind++) {
        const codes = ev.keyCode[kind], state = kind === 0 ? input.keys : kind === 1 ? input.pressed : input.released;
        for (let c = 0; c < codes.length; c++) if (keyState(state, codes[c])) this.run(ev.keyBlocks[kind][c], inst, null);
      }
      if (ev.mouseKind.length && inst.alive) this.mouseEvents(inst, ev);
    }

    this.phase(EV.step);
    if (this.pendingRoom >= 0) return this.endStep();

    // Built-in motion, then outside-room checks.
    const room = this.room;
    n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i];
      if (!inst.alive || !inst.active) continue;
      if (inst.friction !== 0 && inst.speed !== 0) {
        const s = inst.speed > 0 ? Math.max(0, inst.speed - inst.friction) : Math.min(0, inst.speed + inst.friction);
        inst.setSpeed(s);
      }
      if (inst.gravity !== 0) {
        const d = inst.gravity_direction * Math.PI / 180;
        inst.setHV(inst.hspeed + inst.gravity * Math.cos(d), inst.vspeed - inst.gravity * Math.sin(d));
      }
      inst.x += inst.hspeed; inst.y += inst.vspeed;
      if (inst.path >= 0 && this.paths.step(inst)) this.event(inst, EV.path_end, null);
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
      if (!inst.alive || !inst.active || !spr) continue;
      inst.image_index += inst.image_speed * (spr.fpsDiv ? spr.speed / this.speed : spr.speed);
      const frames = spr.frames.length;
      if (inst.image_index >= frames || inst.image_index < 0) {
        inst.image_index = frames ? ((inst.image_index % frames) + frames) % frames : 0;
        this.event(inst, EV.animation_end, null);
      }
    }
    this.layers.step();
    for (const l of this.layers.list) for (const e of l.elements) if (e.speed && (e.kind === ELEM.sprite || e.kind === ELEM.background)) {
      const s = this.a.sprites[e.asset];
      if (s) e.index += e.speed * (s.fpsDiv ? s.speed / this.speed : s.speed);
    }
    this.followViews();
    this.endStep();
  }

  /** An instance's mouse events. Non-global ones need the mouse over its mask (room coordinates, like mouse_x). */
  private mouseEvents(inst: Instance, ev: Events): void {
    const input = this.p.input, kinds = ev.mouseKind;
    const k = shape(inst, inst.x, inst.y, this.sb);
    let over = false;
    if (k) {
      const a = this.sa, x = input.mouseX, y = input.mouseY;
      a[0] = a[6] = a[8] = x; a[1] = a[3] = a[9] = y; a[2] = a[4] = a[10] = x + 1e-6; a[5] = a[7] = a[11] = y + 1e-6;
      over = overlaps(1, a, k, this.sb);
    }
    const was = inst.mouseOver;
    inst.mouseOver = over;
    for (let j = 0; j < kinds.length; j++) {
      const m = kinds[j];
      let fire: boolean;
      if (m === 3) fire = over && input.mouseButtons === 0;
      else if (m === 10) fire = over && !was;
      else if (m === 11) fire = !over && was;
      else if (m === 21) fire = input.wheel > 0;
      else if (m === 22) fire = input.wheel < 0;
      else {
        const global = m >= 12, r = global ? m - 12 : m < 3 ? m : m - 1, bit = 1 << (r % 3), kind = Math.floor(r / 3);
        const state = kind === 0 ? input.mouseButtons : kind === 1 ? input.mousePressed : input.mouseReleased;
        fire = (state & bit) !== 0 && (global || over);
      }
      if (fire) this.run(ev.mouse[m], inst, null);
    }
  }

  private endStep(): void {
    this.fx.step();
    this.snd.sweep();
    const input = this.p.input;
    input.pressed.fill(0); input.released.fill(0); input.mousePressed = 0; input.mouseReleased = 0; input.wheel = 0;
    this.compact();
  }

  private collisions(): void {
    const list = this.instances, n = list.length;
    for (let i = 0; i < n; i++) {
      const inst = list[i];
      const ev = inst.obj.ev;
      for (let c = 0; c < ev.colObj.length && inst.alive && inst.active; c++) {
        const obj = ev.colObj[c], blocks = ev.colBlocks[c];
        for (let j = 0; j < n && inst.alive; j++) {
          const o = list[j];
          if (o === inst || !o.alive || !o.active || !o.obj.isA.has(obj)) continue;
          const ka = shape(inst, inst.x, inst.y, this.sa), kb = shape(o, o.x, o.y, this.sb);
          if (!overlaps(ka, this.sa, kb, this.sb)) continue;
          if (o.solid) { inst.x = inst.xprevious; inst.y = inst.yprevious; }
          this.run(blocks, inst, o);
        }
      }
    }
  }

  /** Visible views whose camera follows an instance, as GM's CCamera.Update (see gm_gotchas.md). */
  private followViews(): void {
    const rw = this.room.width, rh = this.room.height;
    for (const v of this.views) {
      const c = v.visible ? this.cameras[v.camera] : null;
      if (!c || c.target < 0) continue;
      const t = this.first(c.target);
      if (!t) continue;
      c.x = follow(c.x, Math.floor(t.x), c.w, c.bx, c.sx, rw);
      c.y = follow(c.y, Math.floor(t.y), c.h, c.by, c.sy, rh);
    }
  }

  // ---------------------------------------------------------------- surfaces

  surface(id: Value): Surface {
    const s = this.surfaces.get(real(id));
    if (!s) throw new GmlError(`surface ${String(id)} does not exist`);
    return s;
  }
  createSurface(w: number, h: number): number {
    const id = this.nextSurface++;
    this.surfaces.set(id, { tex: this.p.renderer.createSurface(w, h), w, h });
    return id;
  }
  freeSurface(id: number): void {
    const s = this.surfaces.get(id);
    if (!s || id === APP_SURFACE) return;
    this.p.renderer.freeSurface(s.tex);
    this.surfaces.delete(id);
  }
  pushTarget(id: number): void {
    const s = this.surface(id);
    this.targetStack.push(id);
    this.p.renderer.setTarget(s.tex);
  }
  popTarget(): void {
    this.targetStack.pop();
    this.restoreTarget();
  }
  /** Re-applies the current draw target and view (after surface_reset_target or a phase change). */
  private restoreTarget(): void {
    const r = this.p.renderer, top = this.targetStack.at(-1);
    if (top !== undefined) { r.setTarget(this.surface(top).tex); return; }
    r.setTarget(this.baseTarget);
    this.applyView();
  }

  // ---------------------------------------------------------------- drawing

  /** Where drawing goes outside surface_set_target: the app surface (room draw) or the window. */
  private baseTarget = WINDOW;
  /** The world rectangle drawn in the current view pass: x, y, w, h. */
  private readonly vr = [0, 0, 640, 480];
  private viewPort = [0, 0, 640, 480];
  private viewAngle = 0;
  viewRect(): readonly number[] { return this.vr; }

  private applyView(): void {
    this.p.renderer.setView(this.vr[0], this.vr[1], this.vr[2], this.vr[3], this.viewAngle, this.viewPort[0], this.viewPort[1], this.viewPort[2], this.viewPort[3]);
  }

  private setPass(target: number, x: number, y: number, w: number, h: number, angle: number, px: number, py: number, pw: number, ph: number): void {
    this.baseTarget = target; this.targetStack.length = 0;
    this.vr[0] = x; this.vr[1] = y; this.vr[2] = w; this.vr[3] = h; this.viewAngle = angle;
    this.viewPort = [px, py, pw, ph];
    this.p.renderer.setTarget(target);
    this.applyView();
  }

  private draw(): void {
    const r = this.p.renderer, app = this.surface(APP_SURFACE), room = this.room;
    const [ww, wh] = r.windowSize();
    r.beginFrame();
    r.setBlend(5, 6, 5, 6); r.setFog(false, 0);
    // Pre-draw goes straight to the window.
    this.setPass(WINDOW, 0, 0, ww, wh, 0, 0, 0, ww, wh);
    r.clear(0, 1);
    this.phase(EV.draw_pre);

    // The room, once per visible view, into the application surface.
    r.setTarget(app.tex);
    r.clear(room.showColour ? room.colour : 0, 1);
    const passes = this.viewsEnabled ? this.views.map((v, i) => [v, i] as const).filter(([v]) => v.visible) : [];
    if (!passes.length) this.drawRoom(app.tex, 0, 0, room.width, room.height, 0, 0, 0, app.w, app.h);
    for (const [v, i] of passes) {
      const c = this.cameras[v.camera] ?? newCamera(-1);
      this.viewCurrent = i;
      // Ports are in window coordinates, scaled so the first port fills the app surface (even if their aspects differ).
      const sx = app.w / (passes[0][0].pw || app.w), sy = app.h / (passes[0][0].ph || app.h);
      this.drawRoom(app.tex, c.x, c.y, c.w, c.h, c.angle, (v.px - passes[0][0].px) * sx, (v.py - passes[0][0].py) * sy, v.pw * sx, v.ph * sy);
    }
    this.viewCurrent = 0;

    // Post-draw, then the application surface onto the window (letterboxed), then the GUI.
    this.setPass(WINDOW, 0, 0, ww, wh, 0, 0, 0, ww, wh);
    this.phase(EV.draw_post);
    const k = Math.min(ww / app.w, wh / app.h), dw = app.w * k, dh = app.h * k, dx = (ww - dw) / 2, dy = (wh - dh) / 2;
    if (this.appSurfaceDraw) {
      r.setBlend(2, 1, 2, 1);
      r.drawImage(app.tex, 0, 0, app.w, app.h, dx, dy, 0, 0, k, k, 0, 0xffffff, 1);
      r.setBlend(5, 6, 5, 6);
    }
    const gw = this.guiW || app.w, gh = this.guiH || app.h;
    this.setPass(WINDOW, 0, 0, gw, gh, 0, dx, dy, dw, dh);
    this.phase(EV.drawgui_begin);
    this.phase(EV.drawgui);
    this.phase(EV.drawgui_end);
    r.endFrame();
  }

  /** Draws the room (layers and instances by depth) through one view. */
  private drawRoom(target: number, x: number, y: number, w: number, h: number, angle: number, px: number, py: number, pw: number, ph: number): void {
    this.setPass(target, x, y, w, h, angle, px, py, pw, ph);
    this.phase(EV.draw_begin);
    const dl = this.drawList;
    dl.length = 0;
    for (const inst of this.instances) if (inst.alive && inst.active && inst.visible) dl.push(inst);
    dl.sort(byDepth);
    const layers = this.layerOrder;
    layers.length = 0;
    for (const l of this.layers.list) if (l.visible && l.elements.length && !l.instances) layers.push(l);
    layers.sort((a, b) => b.depth - a.depth);
    let li = 0;
    this.fx.draw(this.p.renderer, false);
    for (const inst of dl) {
      if (!inst.alive) continue;
      while (li < layers.length && layers[li].depth >= inst.depth) this.drawLayer(layers[li++]);
      if (inst.obj.hasDraw) this.run(inst.obj.ev.simple[EV.draw], inst, null);
      else this.drawSelf(inst);
    }
    while (li < layers.length) this.drawLayer(layers[li++]);
    this.fx.draw(this.p.renderer, true);
    this.phase(EV.draw_end);
  }

  drawSelf(inst: Instance): void {
    const spr = inst.sprite;
    if (!spr || !spr.frames.length) return;
    drawSprite(this, spr, inst.image_index, inst.x, inst.y, inst.image_xscale, inst.image_yscale, inst.image_angle, inst.image_blend, inst.image_alpha * this.alpha);
  }

  private drawLayer(l: RtLayer): void {
    if (l.scriptBegin != null) this.vm.callValue(l.scriptBegin, this.globalScope, NO_ARGS);
    for (const e of l.elements) if (e.visible) this.drawElement(e, l);
    if (l.scriptEnd != null) this.vm.callValue(l.scriptEnd, this.globalScope, NO_ARGS);
  }

  private drawElement(e: Element, l: RtLayer): void {
    const r = this.p.renderer;
    switch (e.kind) {
      case ELEM.background: return this.drawBackground(e, l);
      case ELEM.sprite: {
        const s = this.a.sprites[e.asset];
        if (s) drawSprite(this, s, e.index, e.x + l.x, e.y + l.y, e.xscale, e.yscale, e.angle, e.colour, e.alpha);
        return;
      }
      case ELEM.tile: {
        const s = this.a.sprites[e.asset], f = s ? frameOf(s, 0) : -1;
        if (f >= 0) r.drawImage(s.frames[f], e.sx, e.sy, e.w, e.h, e.x + l.x, e.y + l.y, 0, 0, e.xscale, e.yscale, 0, e.colour, e.alpha);
        return;
      }
      case ELEM.tilemap: return this.drawTilemap(e, l.x + e.x, l.y + e.y);
    }
  }

  private drawBackground(e: Element, l: RtLayer): void {
    const room = this.room, r = this.p.renderer;
    const spr = this.a.sprites[e.asset];
    if (!spr) { // a colour fills the view
      const [vx, vy, vw, vh] = this.vr, c = e.colour;
      if (e.alpha > 0) quadC(this, vx - vw, vy - vh, vx + 2 * vw, vy - vh, vx + 2 * vw, vy + 2 * vh, vx - vw, vy + 2 * vh, c, c, c, c, e.alpha);
      return;
    }
    const col = e.colour, a = e.alpha;
    if (e.stretch) {
      drawSprite(this, spr, e.index, l.x + spr.ox * room.width / spr.width, l.y + spr.oy * room.height / spr.height, room.width / spr.width, room.height / spr.height, 0, col, a);
      return;
    }
    const w = spr.width * e.xscale, h = spr.height * e.yscale;
    if (w <= 0 || h <= 0) return;
    const [vx, vy, vw, vh] = this.vr;
    const xs = e.htiled ? [l.x + Math.floor((vx - l.x) / w) * w, vx + vw] : [l.x, l.x + 1];
    const ys = e.vtiled ? [l.y + Math.floor((vy - l.y) / h) * h, vy + vh] : [l.y, l.y + 1];
    for (let ty = ys[0]; ty < ys[1]; ty += h) for (let tx = xs[0]; tx < xs[1]; tx += w) {
      drawSprite(this, spr, e.index, tx + spr.ox * e.xscale, ty + spr.oy * e.yscale, e.xscale, e.yscale, 0, col, a);
    }
  }

  /** Draws a tile map element with its top-left at (ox, oy): the layer's offset plus the element's, or draw_tilemap's x/y. */
  drawTilemap(e: Element, ox: number, oy: number): void {
    const ts = this.a.tilesets[e.asset], cells = e.cells;
    if (!ts || !cells) return;
    const r = this.p.renderer, [vx, vy, vw, vh] = this.vr;
    const c0 = Math.max(0, Math.floor((vx - ox) / ts.tw)), c1 = Math.min(e.w, Math.ceil((vx + vw - ox) / ts.tw));
    const r0 = Math.max(0, Math.floor((vy - oy) / ts.th)), r1 = Math.min(e.h, Math.ceil((vy + vh - oy) / ts.th));
    const frame = ts.frames > 1 && ts.frameTime > 0 ? Math.floor(((this.p.now() - this.startTime) * 1000) / ts.frameTime) % ts.frames : 0;
    for (let row = r0; row < r1; row++) for (let col = c0; col < c1; col++) {
      const cell = cells[row * e.w + col], t0 = cell & 0x7ffff;
      if (!t0) continue;
      const t = ts.ids && ts.frames > 1 ? ts.ids[t0 * ts.frames + frame] ?? t0 : t0;
      const sx = (t % ts.columns) * (ts.tw + 2 * ts.bx) + ts.bx, sy = Math.floor(t / ts.columns) * (ts.th + 2 * ts.by) + ts.by;
      const mirror = (cell >> 28) & 1, flip = (cell >> 29) & 1;
      const x = ox + col * ts.tw + (mirror ? ts.tw : 0), y = oy + row * ts.th + (flip ? ts.th : 0);
      r.drawImage(ts.tex, sx, sy, ts.tw, ts.th, x, y, 0, 0, mirror ? -1 : 1, flip ? -1 : 1, 0, 0xffffff, 1);
    }
  }
}

const NO_ARGS: Value[] = [];

/** Deepest first; at equal depth the newest instance draws first (GM adds new layer elements at the front). */
const byDepth = (a: Instance, b: Instance) => b.depth - a.depth || b.order - a.order;

/**
 * One axis of GM's camera follow: a border of at least half the view centres the target; otherwise the
 * view scrolls only when the target crosses the border. Clamped to the room (left/top first, so a view
 * larger than the room ends up negative), then limited to the speed (speed < 0: no limit).
 */
export function follow(pos: number, at: number, size: number, border: number, speed: number, roomSize: number): number {
  let l = pos;
  if (2 * border >= size) l = at - size / 2;
  else if (at - border < pos) l = at - border;
  else if (at + border > pos + size) l = at + border - size;
  if (l < 0) l = 0;
  if (l + size > roomSize) l = roomSize - size;
  if (speed >= 0) {
    if (l < pos && pos - l > speed) l = pos - speed;
    if (l > pos && l - pos > speed) l = pos + speed;
  }
  return l;
}

/** vk_anykey (1) / vk_nokey (0) / a key code. */
export function keyState(keys: Uint8Array, k: number): boolean {
  if (k > 1) return k < keys.length && keys[k] !== 0;
  let any = false;
  for (let i = 2; i < keys.length; i++) if (keys[i]) { any = true; break; }
  return k === 1 ? any : !any;
}

function eventBlocks(ev: Events, key: number): Block[] | null {
  if (key < EK.alarm) return ev.simple[key];
  if (key < EK.user) return ev.alarm[key - EK.alarm];
  if (key < EK.async) return ev.user[key - EK.user];
  if (key < EK.mouse) return ev.async[key - EK.async];
  if (key < EK.collision) return ev.mouse[key - EK.mouse] ?? null;
  if (key < EK.key) return ev.collision.get(key - EK.collision) ?? null;
  const k = key - EK.key, m = [ev.keyHeld, ev.keyPressed, ev.keyReleased][k % 3];
  return m.get(Math.floor(k / 3)) ?? null;
}

/** An event key for GM's (event type, number), or -1. */
function gmEventKey(type: number, num: number): number {
  switch (type) {
    case 0: return EV.create;
    case 1: return EV.destroy;
    case 2: return num >= 0 && num < 12 ? EK.alarm + num : -1;
    case 3: return [EV.step, EV.step_begin, EV.step_end][num] ?? -1;
    case 4: return num >= 0 ? EK.collision + num : -1;
    case 5: case 9: case 10: return num >= 0 && num < 256 ? EK.key + num * 3 + (type === 5 ? 0 : type === 9 ? 1 : 2) : -1;
    case 7:
      if (num >= 10 && num <= 25) return EK.user + num - 10;
      switch (num) {
        case 0: return EV.outside_room; case 1: return EV.intersect_boundary; case 2: return EV.game_start; case 3: return EV.game_end;
        case 4: return EV.room_start; case 5: return EV.room_end; case 7: return EV.animation_end; case 8: return EV.path_end;
      }
      return -1;
    case 8:
      switch (num) {
        case 0: return EV.draw; case 64: return EV.drawgui; case 65: return EV.resize; case 72: return EV.draw_begin; case 73: return EV.draw_end;
        case 74: return EV.drawgui_begin; case 75: return EV.drawgui_end; case 76: return EV.draw_pre; case 77: return EV.draw_post;
      }
      return -1;
    case 12: return EV.cleanup;
    case 14: return EV.pre_create;
  }
  return -1;
}

/** GM's event_type for an event key (ev_create 0 ... ev_draw 8). */
function gmEventType(key: number): number {
  if (key < 0) return -1;
  if (key < EK.alarm) {
    const t: Record<number, number> = { [EV.create]: 0, [EV.pre_create]: 14, [EV.destroy]: 1, [EV.cleanup]: 12, [EV.step_begin]: 3, [EV.step]: 3, [EV.step_end]: 3 };
    return t[key] ?? (key >= EV.draw_begin && key <= EV.draw_post ? 8 : 7);
  }
  if (key < EK.user) return 2;
  if (key >= EK.mouse && key < EK.collision) return 6;
  if (key < EK.collision) return 7;
  if (key < EK.key) return 4;
  return [5, 9, 10][(key - EK.key) % 3];
}
function gmEventNumber(key: number): number {
  if (key < 0) return -1;
  if (key < EK.alarm) return ({ [EV.step]: 0, [EV.step_begin]: 1, [EV.step_end]: 2, [EV.draw]: 0, [EV.drawgui]: 64, [EV.draw_begin]: 72, [EV.draw_end]: 73, [EV.drawgui_begin]: 74, [EV.drawgui_end]: 75, [EV.draw_pre]: 76, [EV.draw_post]: 77 } as Record<number, number>)[key] ?? 0;
  if (key < EK.user) return key - EK.alarm;
  if (key < EK.async) return key - EK.user + 10;
  if (key < EK.collision) return 60 + key - EK.async;
  if (key < EK.key) return key - EK.collision;
  return Math.floor((key - EK.key) / 3);
}

export type { GArray };
