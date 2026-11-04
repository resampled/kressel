// Loads a project (game.json): compiles every script, resolves names to indices and loads textures.
// The result is what the runtime works with; the JSON tree is not touched again.

import type { Hat, Krpj, Layer, Node } from '../krpj.ts';
import type { Platform, TextureId } from '../platform/types.ts';
import type { Block } from '../compile/bytecode.ts';
import { compileScript, CompileError, type CompileEnv } from '../compile/compiler.ts';
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
}

/** Event slots. Collision, key and alarm/user events are keyed separately. */
export const EV = {
  create: 0, destroy: 1, cleanup: 2, step_begin: 3, step: 4, step_end: 5,
  draw_begin: 6, draw: 7, draw_end: 8, drawgui_begin: 9, drawgui: 10, drawgui_end: 11, draw_pre: 12, draw_post: 13,
  outside_room: 14, intersect_boundary: 15, game_start: 16, game_end: 17, room_start: 18, room_end: 19,
  animation_end: 20, path_end: 21, resize: 22,
} as const;
const N_EV = 23;

export interface Events {
  simple: (Block[] | null)[];
  alarm: (Block[] | null)[];
  user: (Block[] | null)[];
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
  visible: boolean; persistent: boolean; solid: boolean;
  /** Indices of this object and all its ancestors (for "is a" checks: with, collisions, counts). */
  isA: Set<number>;
  ev: Events;
  hasDraw: boolean;
}

export interface RoomDef {
  index: number; name: string; width: number; height: number; persistent: boolean;
  layers: Layer[];
  /** Per instance-layer, per instance: compiled creation code. */
  creation: Map<object, Block>;
  create: Block[];
}

export interface Assets {
  sprites: SpriteDef[]; fonts: FontDef[]; objects: ObjectDef[]; rooms: RoomDef[];
  objectByName: Map<string, ObjectDef>;
  varNames: string[];
  initRoom: number; fps: number; width: number; height: number; title: string;
  /** Room indices in game order (room_goto_next etc.). */
  roomOrder: number[];
}

export const emptyEvents = (): Events => ({
  simple: new Array(N_EV).fill(null), alarm: new Array(12).fill(null), user: new Array(16).fill(null),
  collision: new Map(), keyHeld: new Map(), keyPressed: new Map(), keyReleased: new Map(),
  colObj: [], colBlocks: [], keyCode: [[], [], []], keyBlocks: [[], [], []],
});

function flatten(ev: Events): void {
  ev.colObj = [...ev.collision.keys()]; ev.colBlocks = [...ev.collision.values()];
  [ev.keyHeld, ev.keyPressed, ev.keyReleased].forEach((m, i) => { ev.keyCode[i] = [...m.keys()]; ev.keyBlocks[i] = [...m.values()]; });
}

function push(arr: (Block[] | null)[], i: number, b: Block) { (arr[i] ??= []).push(b); }
function pushMap(m: Map<number, Block[]>, k: number, b: Block) { const l = m.get(k); if (l) l.push(b); else m.set(k, [b]); }

export async function loadAssets(pj: Krpj, url: (path: string) => string, platform: Platform): Promise<Assets> {
  const sprites: SpriteDef[] = [], fonts: FontDef[] = [], objects: ObjectDef[] = [], rooms: RoomDef[] = [];
  const index = new Map<string, number>();
  const varSlots = new Map<string, number>(), varNames: string[] = [];
  const env: CompileEnv = {
    asset: (n) => index.get(n),
    userVar: (n) => {
      let s = varSlots.get(n);
      if (s === undefined) { s = varNames.length; varSlots.set(n, s); varNames.push(n); }
      return s;
    },
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

  await Promise.all(spriteEntries.map(async ([k, s], i) => {
    const frames = await Promise.all(s.frames.map((f) => platform.renderer.loadTexture(url(f))));
    const size = await platform.renderer.textureSize(frames[0] ?? -1);
    sprites[i] = {
      index: i, name: k, frames, width: size[0], height: size[1], ox: s.origin[0], oy: s.origin[1],
      bbox: s.bbox ?? [0, 0, size[0] - 1, size[1] - 1], maskKind: s.mask === 'rotated' ? 1 : s.mask === 'precise' ? 2 : 0,
      fpsDiv: s.speed_type !== 'frame', speed: s.speed,
    };
  }));
  await Promise.all(Object.entries(pj.fonts).map(async ([k, f], i) => {
    const glyphs = new Map<number, readonly number[]>();
    for (const [c, g] of Object.entries(f.glyphs)) glyphs.set(Number(c), g);
    fonts[i] = { index: i, name: k, tex: await platform.renderer.loadTexture(url(f.atlas)), lineHeight: f.line_height, glyphs };
  }));

  const sprite = (n: string | null | undefined, where: string): SpriteDef | null => {
    if (n == null) return null;
    const i = index.get(n);
    if (i === undefined || !sprites[i] || sprites[i].name !== n) throw new CompileError(`${where}: unknown sprite "${n}"`);
    return sprites[i];
  };

  // Objects: compile own events, then inherit missing ones from parents.
  const own: Events[] = objEntries.map(([name, o]) => {
    const ev = emptyEvents();
    o.scripts.forEach((hat, h) => addHat(ev, hat, `${name}/scripts/${h}`, env, index));
    return ev;
  });
  objEntries.forEach(([name, o], i) => {
    objects[i] = {
      index: i, name, sprite: sprite(o.sprite, name), mask: sprite(o.mask, name), parent: null,
      visible: o.visible, persistent: o.persistent, solid: o.solid ?? false, isA: new Set([i]), ev: own[i], hasDraw: false,
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
    rooms[i] = { index: i, name, width: r.width, height: r.height, persistent: r.persistent ?? false, layers: r.layers, creation, create };
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
  return {
    sprites, fonts, objects, rooms, objectByName: new Map(objects.map((o) => [o.name, o])), varNames, initRoom, fps: d.fps,
    width: d.width === 'default' ? first.width : d.width, height: d.height === 'default' ? first.height : d.height,
    title: d.window_title, roomOrder,
  };
}

const SIMPLE: Record<string, number> = {
  evt_create: EV.create, evt_destroy: EV.destroy, evt_cleanup: EV.cleanup, evt_step_begin: EV.step_begin, evt_step: EV.step,
  evt_step_end: EV.step_end, evt_draw_begin: EV.draw_begin, evt_draw: EV.draw, evt_draw_end: EV.draw_end,
  evt_drawgui_begin: EV.drawgui_begin, evt_drawgui: EV.drawgui, evt_drawgui_end: EV.drawgui_end, evt_draw_pre: EV.draw_pre,
  evt_draw_post: EV.draw_post, evt_outside_room: EV.outside_room, evt_intersect_boundary: EV.intersect_boundary,
  evt_game_start: EV.game_start, evt_game_end: EV.game_end, evt_room_start: EV.room_start, evt_room_end: EV.room_end,
  evt_animation_end: EV.animation_end, evt_path_end: EV.path_end, evt_resize: EV.resize,
};

function addHat(ev: Events, hat: Hat, where: string, env: CompileEnv, index: Map<string, number>): void {
  const head = hat[0];
  if (typeof head !== 'string') throw new CompileError(`${where}: event hat must start with a name`);
  const body = hat[hat.length - 1];
  if (!Array.isArray(body)) throw new CompileError(`${where}: event ${head} has no script`);
  const b = compileScript(body, `${where.replace(/\/scripts\/\d+$/, '')}/${head}`, env);
  if (head in SIMPLE) return push(ev.simple, SIMPLE[head], b);
  const arg = hat[1];
  const num = (max: number) => {
    if (typeof arg !== 'number' || arg < 0 || arg > max || !Number.isInteger(arg)) throw new CompileError(`${where}: ${head} needs a number 0-${max}`);
    return arg;
  };
  switch (head) {
    case 'evt_alarm': return push(ev.alarm, num(11), b);
    case 'evt_user': return push(ev.user, num(15), b);
    case 'evt_collision': {
      const o = Array.isArray(arg) && arg[0] === '_as' && typeof arg[1] === 'string' ? index.get(arg[1]) : undefined;
      if (o === undefined) throw new CompileError(`${where}: evt_collision needs an object`);
      return pushMap(ev.collision, o, b);
    }
    case 'evt_key': {
      const key = hat[2];
      if (typeof key !== 'number') throw new CompileError(`${where}: evt_key needs a key code`);
      const m = arg === 'held' ? ev.keyHeld : arg === 'pressed' ? ev.keyPressed : arg === 'released' ? ev.keyReleased : null;
      if (!m) throw new CompileError(`${where}: evt_key kind must be held/pressed/released`);
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
  for (const [m, f] of [[ev.collision, from.collision], [ev.keyHeld, from.keyHeld], [ev.keyPressed, from.keyPressed], [ev.keyReleased, from.keyReleased]] as const) {
    for (const [k, b] of f) if (!m.has(k)) m.set(k, b);
  }
}
