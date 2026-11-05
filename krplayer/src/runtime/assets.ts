// Loads a project (game.json): compiles every script, resolves names to indices and loads textures.
// The result is what the runtime works with; the JSON tree is not touched again.

import type { Hat, Krpj, Layer, Node, RoomInstance, View } from '../krpj.ts';
import type { Platform, SoundId, TextureId } from '../platform/types.ts';
import { EK, type Block } from '../compile/bytecode.ts';
import { compileScript, CompileError, type CompileEnv } from '../compile/compiler.ts';
import { GmMethod } from '../value.ts';
import '../builtins/index.ts';

export interface SpriteDef {
  index: number; name: string; frames: TextureId[]; width: number; height: number;
  ox: number; oy: number;
  /** left, top, right, bottom (inclusive pixels). */
  bbox: [number, number, number, number];
  /** 0 rect, 1 rotated rect, 2 precise (treated as rotated rect for now). */
  maskKind: number;
  /** Frames per step (already divided by the game speed for "fps" sprites). */
  fpsDiv: boolean; speed: number;
}
export interface FontDef {
  index: number; name: string; tex: TextureId; lineHeight: number;
  /** char code -> [x, y, w, h, shift, offset] */
  glyphs: Map<number, readonly number[]>;
  /** Sprite fonts (font_add_sprite_ext): each glyph is a frame of this sprite. */
  sprite?: SpriteDef; sep?: number; proportional?: boolean;
}
export interface SoundDef { index: number; name: string; src: string; volume: number; pitch: number; stream: boolean; group: number; id: SoundId | null }
export interface TilesetDef {
  index: number; name: string; tex: TextureId; tw: number; th: number; bx: number; by: number; columns: number;
  frames: number; frameTime: number; ids: number[] | null;
}
export interface FuncDef { index: number; name: string; block: Block; argc: number; ctor: boolean }

/** Event slots. Collision, key and alarm/user events are keyed separately. */
export const EV = {
  create: 0, destroy: 1, cleanup: 2, step_begin: 3, step: 4, step_end: 5,
  draw_begin: 6, draw: 7, draw_end: 8, drawgui_begin: 9, drawgui: 10, drawgui_end: 11, draw_pre: 12, draw_post: 13,
  outside_room: 14, intersect_boundary: 15, game_start: 16, game_end: 17, room_start: 18, room_end: 19,
  animation_end: 20, path_end: 21, resize: 22,
} as const;
const N_EV = 23;
/** evt_async kinds krplayer can fire. */
export const ASYNC = ['save_load', 'dialog', 'audio_playback', 'system', 'image_loaded'];

export interface Events {
  simple: (Block[] | null)[];
  alarm: (Block[] | null)[];
  user: (Block[] | null)[];
  async: (Block[] | null)[];
  /** object index -> blocks */
  collision: Map<number, Block[]>;
  keyHeld: Map<number, Block[]>; keyPressed: Map<number, Block[]>; keyReleased: Map<number, Block[]>;
  /** The maps above flattened after loading, so the step loop iterates arrays (no iterator allocations). */
  colObj: number[]; colBlocks: Block[][];
  /** [held, pressed, released] -> key codes / blocks. */
  keyCode: number[][]; keyBlocks: Block[][][];
}

export interface ObjectDef {
  index: number; name: string; sprite: SpriteDef | null; mask: SpriteDef | null; parent: ObjectDef | null;
  visible: boolean; persistent: boolean; solid: boolean; depth: number;
  /** Indices of this object and all its ancestors (for "is a" checks: with, collisions, counts). */
  isA: Set<number>;
  /** The object's own events (event_inherited runs the parent's own, then up the chain). */
  own: Events;
  ev: Events;
  hasDraw: boolean;
}

export interface RoomDef {
  index: number; name: string; width: number; height: number; persistent: boolean;
  colour: number; showColour: boolean; speed: number;
  viewsEnabled: boolean; views: View[];
  layers: Layer[];
  /** Instance definitions with their layer, in creation order. */
  order: { def: RoomInstance; layer: Layer }[];
  /** Instance definition -> compiled creation code. */
  creation: Map<object, Block>;
  create: Block[];
}

export interface Assets {
  sprites: SpriteDef[]; fonts: FontDef[]; objects: ObjectDef[]; rooms: RoomDef[]; sounds: SoundDef[]; tilesets: TilesetDef[];
  functions: FuncDef[];
  /** Script asset index -> function index (-1: not a function). */
  scripts: number[];
  globalInit: Block[];
  objectByName: Map<string, ObjectDef>;
  /** Asset name -> index within its kind (asset_get_index); scripts by their script index. */
  assetIndex: Map<string, number>;
  varNames: string[];
  /** Slot for a variable name, allocated on first use (structs and variable_* functions use it at runtime). */
  varSlot(name: string): number;
  initRoom: number; fps: number; width: number; height: number; title: string;
  /** Room indices in game order (room_goto_next etc.). */
  roomOrder: number[];
  /** Included files: path -> bytes (preloaded), or a URL for audio (streamed on demand). */
  files: Map<string, Uint8Array>;
  fileUrls: Map<string, string>;
  url(path: string): string;
}

export const emptyEvents = (): Events => ({
  simple: new Array(N_EV).fill(null), alarm: new Array(12).fill(null), user: new Array(16).fill(null), async: new Array(ASYNC.length).fill(null),
  collision: new Map(), keyHeld: new Map(), keyPressed: new Map(), keyReleased: new Map(),
  colObj: [], colBlocks: [], keyCode: [[], [], []], keyBlocks: [[], [], []],
});

function flatten(ev: Events): void {
  ev.colObj = [...ev.collision.keys()]; ev.colBlocks = [...ev.collision.values()];
  [ev.keyHeld, ev.keyPressed, ev.keyReleased].forEach((m, i) => { ev.keyCode[i] = [...m.keys()]; ev.keyBlocks[i] = [...m.values()]; });
}

function push(arr: (Block[] | null)[], i: number, b: Block) { (arr[i] ??= []).push(b); }
function pushMap(m: Map<number, Block[]>, k: number, b: Block) { const l = m.get(k); if (l) l.push(b); else m.set(k, [b]); }

const AUDIO = /\.(ogg|wav|mp3)$/i;

export async function loadAssets(pj: Krpj, url: (path: string) => string, platform: Platform, progress: (msg: string) => void = () => {}): Promise<Assets> {
  const sprites: SpriteDef[] = [], fonts: FontDef[] = [], objects: ObjectDef[] = [], rooms: RoomDef[] = [];
  const sounds: SoundDef[] = [], tilesets: TilesetDef[] = [], functions: FuncDef[] = [];
  const index = new Map<string, number>();
  const varSlots = new Map<string, number>(), varNames: string[] = [];
  const varSlot = (n: string) => {
    let s = varSlots.get(n);
    if (s === undefined) { s = varNames.length; varSlots.set(n, s); varNames.push(n); }
    return s;
  };
  const fnEntries = Object.entries(pj.functions ?? {});
  const fnIndex = new Map(fnEntries.map(([k], i) => [k, i]));
  const scriptOf = new Map<string, number>();
  (pj.scripts ?? []).forEach((f, i) => { if (f !== null && !scriptOf.has(f)) scriptOf.set(f, i); });
  const fnValues = new Map<string, unknown>();
  let owners = 1 << 28;
  const env: CompileEnv = {
    asset: (n) => index.get(n),
    userVar: varSlot,
    func: (n) => fnIndex.get(n),
    fnValue: (n) => {
      let v = fnValues.get(n);
      if (v === undefined) { v = scriptOf.get(n) ?? new GmMethod(fnIndex.get(n)!, null, n); fnValues.set(n, v); }
      return v;
    },
    owners: (n) => { const o = owners; owners += n; return o; },
  };
  const claim = (name: string, i: number) => {
    if (index.has(name)) throw new CompileError(`asset name "${name}" is used twice`);
    index.set(name, i);
  };

  const spriteEntries = Object.entries(pj.sprites);
  spriteEntries.forEach(([k], i) => claim(k, i));
  Object.keys(pj.fonts).forEach((k, i) => claim(k, i));
  const objEntries = Object.entries(pj.objects ?? {});
  objEntries.forEach(([k], i) => claim(k, i));
  const roomEntries = Object.entries(pj.rooms ?? {});
  roomEntries.forEach(([k], i) => claim(k, i));
  const soundEntries = Object.entries(pj.sounds);
  soundEntries.forEach(([k], i) => claim(k, i));
  const tsEntries = Object.entries(pj.tilesets ?? {});
  tsEntries.forEach(([k], i) => claim(k, i));

  // Textures load in parallel, a bounded number at a time.
  let done = 0;
  const total = spriteEntries.reduce((n, [, s]) => n + s.frames.length, 0) + tsEntries.length + Object.keys(pj.fonts).length;
  const tex = async (path: string) => {
    const t = await platform.renderer.loadTexture(url(path));
    if (++done % 200 === 0) progress(`textures ${done}/${total}`);
    return t;
  };
  await pool(spriteEntries.map(([k, s], i) => async () => {
    const frames: TextureId[] = [];
    for (const f of s.frames) frames.push(await tex(f));
    const size = frames.length ? platform.renderer.textureSize(frames[0]) : [1, 1];
    sprites[i] = {
      index: i, name: k, frames, width: size[0], height: size[1], ox: s.origin[0], oy: s.origin[1],
      bbox: s.bbox ?? [0, 0, size[0] - 1, size[1] - 1], maskKind: s.mask === 'rotated' ? 1 : s.mask === 'precise' ? 2 : 0,
      fpsDiv: s.speed_type !== 'frame', speed: s.speed,
    };
  }), 16);
  await Promise.all(Object.entries(pj.fonts).map(async ([k, f], i) => {
    const glyphs = new Map<number, readonly number[]>();
    for (const [c, g] of Object.entries(f.glyphs)) glyphs.set(Number(c), g);
    fonts[i] = { index: i, name: k, tex: await tex(f.atlas), lineHeight: f.line_height, glyphs };
  }));
  await Promise.all(tsEntries.map(async ([k, t], i) => {
    tilesets[i] = {
      index: i, name: k, tex: await tex(t.image), tw: t.tile_w, th: t.tile_h, bx: t.border_x, by: t.border_y, columns: t.columns,
      frames: t.frames ?? 1, frameTime: t.frame_time ?? 0, ids: t.ids ?? null,
    };
  }));
  soundEntries.forEach(([k, s], i) => {
    sounds[i] = { index: i, name: k, src: s.src, volume: s.volume, pitch: s.pitch ?? 1, stream: s.stream, group: s.group ?? 0, id: null };
  });

  // Included files: everything but audio is read up front (file_text_* and friends are synchronous).
  const files = new Map<string, Uint8Array>(), fileUrls = new Map<string, string>();
  await Promise.all(Object.entries(pj.included_files ?? {}).map(async ([path, src]) => {
    const key = path.toLowerCase(), u = url(src);
    fileUrls.set(key, u);
    if (AUDIO.test(path)) return;
    files.set(key, await platform.fetchBytes(u));
  }));
  progress('compiling');

  fnEntries.forEach(([k, f], i) => {
    functions[i] = { index: i, name: k, block: compileScript(f.body, `function ${k}`, env, f.args), argc: f.argc ?? f.args.length, ctor: f.ctor === true };
  });
  const globalInit = (pj.global_init ?? []).map((s, i) => compileScript(s, `global_init/${i}`, env));

  const sprite = (n: string | null | undefined, where: string): SpriteDef | null => {
    if (n == null) return null;
    const i = index.get(n);
    if (i === undefined || !sprites[i] || sprites[i].name !== n) throw new CompileError(`${where}: unknown sprite "${n}"`);
    return sprites[i];
  };

  // Objects: compile own events, then inherit missing ones from parents.
  const own: Events[] = objEntries.map(([name, o], i) => {
    const ev = emptyEvents();
    o.scripts.forEach((hat, h) => addHat(ev, hat, `${name}/scripts/${h}`, env, index, i));
    return ev;
  });
  objEntries.forEach(([name, o], i) => {
    const ev = emptyEvents();
    inherit(ev, own[i]);
    objects[i] = {
      index: i, name, sprite: sprite(o.sprite, name), mask: sprite(o.mask, name), parent: null, depth: o.depth ?? 0,
      visible: o.visible, persistent: o.persistent, solid: o.solid ?? false, isA: new Set([i]), own: own[i], ev, hasDraw: false,
    };
  });
  objEntries.forEach(([name, o], i) => {
    if (o.parent == null) return;
    const p = index.get(o.parent);
    if (p === undefined || objects[p]?.name !== o.parent) throw new CompileError(`${name}: unknown parent "${o.parent}"`);
    objects[i].parent = objects[p];
  });
  for (const o of objects) {
    const seen = new Set<ObjectDef>();
    for (let p = o.parent; p; p = p.parent) {
      if (seen.has(p)) throw new CompileError(`${o.name}: parent loop`);
      seen.add(p); o.isA.add(p.index);
      inherit(o.ev, own[p.index]);
    }
  }
  for (const o of objects) {
    flatten(o.ev);
    o.hasDraw = !!o.ev.simple[EV.draw];
  }

  roomEntries.forEach(([name, r], i) => {
    const creation = new Map<object, Block>();
    r.layers.forEach((l, li) => {
      if (l.type !== 'instances') return;
      l.instances.forEach((inst, ii) => {
        if (!index.has(inst.object) || objects[index.get(inst.object)!]?.name !== inst.object) throw new CompileError(`${name}: unknown object "${inst.object}"`);
        if (inst.creation) creation.set(inst, compileScript(inst.creation, `${name}/layers/${li}/instances/${ii}`, env));
      });
    });
    const create: Block[] = [];
    r.scripts.forEach((hat, h) => {
      if (hat[0] !== 'evt_create') throw new CompileError(`${name}/scripts/${h}: room event ${String(hat[0])} not supported yet`);
      create.push(compileScript(hat[hat.length - 1] as Node[], `${name}/scripts/${h}`, env));
    });
    const order = r.layers.flatMap((l) => (l.type === 'instances' ? l.instances.map((def) => ({ def, layer: l as Layer })) : []));
    if (r.instance_order) {
      const at = new Map(r.instance_order.map((id, k) => [id, k]));
      order.sort((x, y) => (at.get(x.def.id ?? -1) ?? Infinity) - (at.get(y.def.id ?? -1) ?? Infinity));
    }
    rooms[i] = {
      index: i, name, width: r.width, height: r.height, persistent: r.persistent ?? false, layers: r.layers, creation, create, order,
      colour: r.colour ?? 0, showColour: r.show_colour ?? true, speed: r.speed ?? 0, viewsEnabled: r.views_enabled ?? false, views: r.views ?? [],
    };
  });

  const roomOrder = (pj.room_order ?? roomEntries.map(([k]) => k)).map((n) => {
    const i = rooms.findIndex((r) => r.name === n);
    if (i < 0) throw new CompileError(`room_order: unknown room "${n}"`);
    return i;
  });
  const init = pj.cfg_project.init_room;
  const initRoom = init == null ? -1 : rooms.findIndex((r) => r.name === init);
  if (initRoom < 0) throw new CompileError(`init_room ${JSON.stringify(init)} is not a room`);
  const first = rooms[initRoom];
  const d = pj.cfg_defaults;
  const assetIndex = new Map(index);
  scriptOf.forEach((i, n) => { if (!assetIndex.has(n)) assetIndex.set(n, i); });
  return {
    sprites, fonts, objects, rooms, sounds, tilesets, functions, globalInit,
    scripts: (pj.scripts ?? []).map((f) => (f === null ? -1 : fnIndex.get(f) ?? -1)),
    objectByName: new Map(objects.map((o) => [o.name, o])), assetIndex, varNames, varSlot, initRoom, fps: d.fps,
    width: d.width === 'default' ? first.width : d.width, height: d.height === 'default' ? first.height : d.height,
    title: d.window_title, roomOrder, files, fileUrls, url,
  };
}

/** Runs async jobs with at most n in flight. */
async function pool(jobs: (() => Promise<void>)[], n: number): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) await jobs[next++](); }));
}

const SIMPLE: Record<string, number> = {
  evt_create: EV.create, evt_destroy: EV.destroy, evt_cleanup: EV.cleanup, evt_step_begin: EV.step_begin, evt_step: EV.step,
  evt_step_end: EV.step_end, evt_draw_begin: EV.draw_begin, evt_draw: EV.draw, evt_draw_end: EV.draw_end,
  evt_drawgui_begin: EV.drawgui_begin, evt_drawgui: EV.drawgui, evt_drawgui_end: EV.drawgui_end, evt_draw_pre: EV.draw_pre,
  evt_draw_post: EV.draw_post, evt_outside_room: EV.outside_room, evt_intersect_boundary: EV.intersect_boundary,
  evt_game_start: EV.game_start, evt_game_end: EV.game_end, evt_room_start: EV.room_start, evt_room_end: EV.room_end,
  evt_animation_end: EV.animation_end, evt_path_end: EV.path_end, evt_resize: EV.resize,
};

function addHat(ev: Events, hat: Hat, where: string, env: CompileEnv, index: Map<string, number>, owner: number): void {
  const head = hat[0];
  if (typeof head !== 'string') throw new CompileError(`${where}: event hat must start with a name`);
  const body = hat[hat.length - 1];
  if (!Array.isArray(body)) throw new CompileError(`${where}: event ${head} has no script`);
  const label = head === 'evt_alarm' || head === 'evt_user' || head === 'evt_async' ? `${head}_${String(hat[1])}` : head;
  const b = compileScript(body, `${where.replace(/\/scripts\/\d+$/, '')}/${label}`, env);
  b.owner = owner;
  if (head in SIMPLE) { b.ev = SIMPLE[head]; return push(ev.simple, SIMPLE[head], b); }
  const arg = hat[1];
  const num = (max: number) => {
    if (typeof arg !== 'number' || arg < 0 || arg > max || !Number.isInteger(arg)) throw new CompileError(`${where}: ${head} needs a number 0-${max}`);
    return arg;
  };
  switch (head) {
    case 'evt_alarm': b.ev = EK.alarm + num(11); return push(ev.alarm, num(11), b);
    case 'evt_user': b.ev = EK.user + num(15); return push(ev.user, num(15), b);
    case 'evt_async': {
      const k = ASYNC.indexOf(String(arg));
      if (k < 0) return; // async kinds krplayer never fires (http, networking, social...): never run, like GM without them
      b.ev = EK.async + k;
      return push(ev.async, k, b);
    }
    case 'evt_outside_view': case 'evt_boundary_view': return; // views' outside events: not fired yet
    case 'evt_collision': {
      const o = Array.isArray(arg) && arg[0] === '_as' && typeof arg[1] === 'string' ? index.get(arg[1]) : undefined;
      if (o === undefined) throw new CompileError(`${where}: evt_collision needs an object`);
      b.ev = EK.collision + o;
      return pushMap(ev.collision, o, b);
    }
    case 'evt_key': {
      const key = hat[2];
      if (typeof key !== 'number') throw new CompileError(`${where}: evt_key needs a key code`);
      const m = arg === 'held' ? ev.keyHeld : arg === 'pressed' ? ev.keyPressed : arg === 'released' ? ev.keyReleased : null;
      if (!m) throw new CompileError(`${where}: evt_key kind must be held/pressed/released`);
      b.ev = EK.key + key * 3 + (arg === 'held' ? 0 : arg === 'pressed' ? 1 : 2);
      return pushMap(m, key, b);
    }
  }
  throw new CompileError(`${where}: event ${head} not supported yet`);
}

/** Fills events the child doesn't define from an ancestor's own events. */
function inherit(ev: Events, from: Events): void {
  from.simple.forEach((b, i) => { if (b && !ev.simple[i]) ev.simple[i] = b; });
  from.alarm.forEach((b, i) => { if (b && !ev.alarm[i]) ev.alarm[i] = b; });
  from.user.forEach((b, i) => { if (b && !ev.user[i]) ev.user[i] = b; });
  from.async.forEach((b, i) => { if (b && !ev.async[i]) ev.async[i] = b; });
  for (const [m, f] of [[ev.collision, from.collision], [ev.keyHeld, from.keyHeld], [ev.keyPressed, from.keyPressed], [ev.keyReleased, from.keyReleased]] as const) {
    for (const [k, b] of f) if (!m.has(k)) m.set(k, b);
  }
}
