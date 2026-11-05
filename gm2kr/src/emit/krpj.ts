// GmModel -> game.json + asset files (zipped together, they make a .krpj).

import type {
  AssetLayer, Font, Hat, KrFunction, KrObject, Krpj, Layer, LegacyTile, Room, Script, Sound, Sprite, Tileset, View,
} from '../../../krplayer/src/krpj.ts';
import type { GmModel } from '../model.ts';
import type { GmEvent } from '../chunks/objt.ts';
import { decompileAll, assetNames } from '../decompile/program.ts';
import { fnName, type AssetNames } from '../decompile/structure.ts';
import { tpagAt } from '../chunks/tpag.ts';
import { audioExt, readAudioGroupFile } from '../chunks/audio.ts';
import { cropItem, decodePage, encodePng, sourceRect, type Image } from './textures.ts';

const DRAW: Record<number, string> = { 0: 'evt_draw', 64: 'evt_drawgui', 65: 'evt_resize', 72: 'evt_draw_begin', 73: 'evt_draw_end', 74: 'evt_drawgui_begin', 75: 'evt_drawgui_end', 76: 'evt_draw_pre', 77: 'evt_draw_post' };
const OTHER: Record<number, string> = { 0: 'evt_outside_room', 1: 'evt_intersect_boundary', 2: 'evt_game_start', 3: 'evt_game_end', 4: 'evt_room_start', 5: 'evt_room_end', 7: 'evt_animation_end', 8: 'evt_path_end' };
const ASYNC: Record<number, string> = { 60: 'image_loaded', 62: 'http', 63: 'dialog', 66: 'iap', 67: 'cloud', 68: 'networking', 69: 'steam', 70: 'social', 71: 'push_notification', 72: 'save_load', 73: 'audio_recording', 74: 'audio_playback', 75: 'system' };
const STEP = ['evt_step', 'evt_step_begin', 'evt_step_end'];
const KEY: Record<number, string> = { 5: 'held', 9: 'pressed', 10: 'released' };
const AUDIO_EXT = /\.(ogg|wav|mp3)$/i;
/** Files next to data.win that are the runner's, not the game's. */
const RUNNER_FILE = /(^|\/)(data\.win|audiogroup\d+\.dat|options\.ini|[^/]+\.(exe|dll|so|dylib|pdb))$/i;

/** The hat for a GM event, minus its body. */
function hat(e: GmEvent, assets: AssetNames, where: string): Hat {
  const s = e.subtype;
  switch (e.type) {
    case 0: return ['evt_create'];
    case 1: return ['evt_destroy'];
    case 2: return ['evt_alarm', s];
    case 3: if (STEP[s]) return [STEP[s]]; break;
    case 4: if (assets.objects[s]) return ['evt_collision', ['_as', assets.objects[s]]]; break;
    case 5: case 9: case 10: return ['evt_key', KEY[e.type], s];
    case 7:
      if (OTHER[s]) return [OTHER[s]];
      if (s >= 10 && s <= 25) return ['evt_user', s - 10];
      if (s >= 40 && s <= 47) return ['evt_outside_view', s - 40];
      if (s >= 50 && s <= 57) return ['evt_boundary_view', s - 50];
      if (ASYNC[s]) return ['evt_async', ASYNC[s]];
      break;
    case 8: if (DRAW[s]) return [DRAW[s]]; break;
    case 12: return ['evt_cleanup'];
  }
  throw new Error(`${where}: event type ${e.type} subtype ${s} not supported yet`);
}

/** Files of the game folder other than data.win, by path relative to it ("mus/x.ogg"). Read on demand. */
export type GameFiles = Map<string, () => Promise<Uint8Array>>;
export interface Converted { krpj: Krpj; files: Map<string, Uint8Array> }

export async function emitKrpj(m: GmModel, extra: GameFiles = new Map(), log: (msg: string) => void = () => {}): Promise<Converted> {
  const files = new Map<string, Uint8Array>();
  const name = (list: { name: string }[], i: number) => (i >= 0 && i < list.length ? list[i].name : null);
  const assets = assetNames(m);
  const code = decompileAll(m);
  const script = (codeId: number, where: string): Script => {
    const c = m.code[codeId], d = c && code.get(c.name);
    if (!d) throw new Error(`${where}: code entry ${codeId} missing`);
    return d.body as Script;
  };

  const pages: Image[] = m.textures.map((t, i) => decodePage(t.data, i));

  const sprites: Record<string, Sprite> = {};
  for (const s of m.sprites) {
    const frames: string[] = [];
    for (const [i, p] of s.frames.entries()) {
      const path = `sprites/${s.name}/${i}.png`;
      // Null texture: stripped from this build (e.g. console button prompts); keep a blank frame.
      const img = p ? cropItem(pages, tpagAt(m.tpag, p, `sprite ${s.name}`), `sprite ${s.name}`) : { w: s.width, h: s.height, data: new Uint8Array(s.width * s.height * 4) };
      files.set(path, await encodePng(img));
      frames.push('./' + path);
    }
    const g = s.margins;
    sprites[s.name] = {
      name: s.name, frames, origin: s.origin, speed: s.speed, ...(s.speedType === 1 ? { speed_type: 'frame' as const } : {}),
      bbox: [g.left, g.top, g.right, g.bottom], mask: (['rect', 'precise', 'rotated'] as const)[s.maskKind] ?? 'rect',
    };
  }
  log(`${m.sprites.length} sprites`);

  const tilesets: Record<string, Tileset> = {};
  for (const t of m.tilesets) {
    if (!t.tpag) continue;
    const path = `tilesets/${t.name}.png`;
    files.set(path, await encodePng(cropItem(pages, tpagAt(m.tpag, t.tpag, `tileset ${t.name}`), `tileset ${t.name}`)));
    const animated = t.frames > 1;
    tilesets[t.name] = {
      name: t.name, image: './' + path, tile_w: t.tileW, tile_h: t.tileH, border_x: t.borderX, border_y: t.borderY, columns: t.columns,
      ...(animated ? { frames: t.frames, frame_time: t.frameTime, ids: t.ids } : {}),
    };
  }

  const fonts: Record<string, Font> = {};
  for (const f of m.fonts) {
    const path = `fonts/${f.name}.png`;
    files.set(path, await encodePng(sourceRect(pages, tpagAt(m.tpag, f.tpag, `font ${f.name}`), `font ${f.name}`)));
    const glyphs: Font['glyphs'] = {}, kerning: NonNullable<Font['kerning']> = {};
    let lo = Infinity, hi = -Infinity, lineHeight = 0;
    for (const g of f.glyphs) {
      glyphs[g.char] = [g.x, g.y, g.w, g.h, g.shift, g.offset];
      if (g.kerning.length) kerning[g.char] = g.kerning;
      lo = Math.min(lo, g.char); hi = Math.max(hi, g.char); lineHeight = Math.max(lineHeight, g.h);
    }
    fonts[f.name] = {
      name: f.name, atlas: './' + path, font_name: f.displayName, size: f.size, bold: f.bold, italic: f.italic,
      antialias: f.antialias, line_height: lineHeight, ranges: f.glyphs.length ? [[lo, hi]] : [], glyphs,
      ...(Object.keys(kerning).length ? { kerning } : {}),
    };
  }

  // Sounds: group 0 is embedded in data.win, group N in audiogroupN.dat, audio id -1 is a file next to the game.
  const groupAudio = new Map<number, Uint8Array[]>([[0, m.audio]]);
  const sounds: Record<string, Sound> = {};
  for (const s of m.sounds) {
    let data: Uint8Array;
    if (s.audio < 0) {
      const read = extra.get(s.file);
      if (!read) throw new Error(`sound ${s.name}: external file ${s.file} is missing from the game folder`);
      data = await read();
    } else {
      let list = groupAudio.get(s.group);
      if (!list) {
        const read = extra.get(`audiogroup${s.group}.dat`);
        if (!read) throw new Error(`sound ${s.name}: audiogroup${s.group}.dat is missing from the game folder`);
        const b = await read();
        list = readAudioGroupFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
        groupAudio.set(s.group, list);
      }
      data = list[s.audio];
      if (!data) throw new Error(`sound ${s.name}: audio ${s.audio} missing from group ${s.group}`);
    }
    const path = `sounds/${s.name}.${audioExt(data)}`;
    files.set(path, data);
    sounds[s.name] = {
      name: s.name, src: './' + path, volume: s.volume, stream: s.audio < 0,
      ...(s.pitch && s.pitch !== 1 ? { pitch: s.pitch } : {}), ...(s.group ? { group: s.group } : {}),
    };
  }
  log(`${m.sounds.length} sounds`);

  // Included files. Audio is only kept when the game names it (games often ship unused music).
  const named = new Set(m.strings.map((s) => s.toLowerCase()));
  const included: Record<string, string> = {};
  for (const [path, read] of extra) {
    if (RUNNER_FILE.test(path) || m.sounds.some((s) => s.audio < 0 && s.file === path)) continue;
    const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    if (AUDIO_EXT.test(path) && !named.has(base) && !named.has(path.toLowerCase())) continue;
    files.set(`files/${path}`, await read());
    included[path] = `./files/${path}`;
  }

  const functions: Record<string, KrFunction> = {};
  const ctors = new Set(m.scripts.filter((s) => s.ctor).map((s) => m.code[s.code]?.name));
  for (const [entry, d] of code) {
    if (!d.child) continue;
    functions[fnName(entry)] = { args: [], body: d.body as Script, ...(d.args ? { argc: d.args } : {}), ...(ctors.has(entry) ? { ctor: true } : {}) };
  }
  const scripts = m.scripts.map((s) => {
    const c = m.code[s.code];
    return c && code.get(c.name)?.child ? fnName(c.name) : null;
  });

  const objects: Record<string, KrObject> = {};
  for (const o of m.objects) {
    const scriptsOf: Hat[] = o.events.map((e) => {
      const where = `object ${o.name}`;
      return [...hat(e, assets, where), script(e.code, where)];
    });
    objects[o.name] = {
      sprite: name(m.sprites, o.sprite), parent: name(m.objects, o.parent), visible: o.visible,
      persistent: o.persistent, solid: o.solid, ...(o.depth ? { depth: o.depth } : {}),
      ...(o.mask >= 0 ? { mask: name(m.sprites, o.mask) } : {}), scripts: scriptsOf,
    };
  }

  const sprite = (i: number, where: string) => {
    const n = name(m.sprites, i);
    if (n === null) throw new Error(`${where}: bad sprite ${i}`);
    return n;
  };
  const rooms: Record<string, Room> = {};
  for (const r of m.rooms) {
    const byId = new Map(r.instances.map((i) => [i.id, i]));
    const layers: Layer[] = r.layers.flatMap((l): Layer[] => {
      const base = {
        name: l.name, depth: l.depth, id: l.id, ...(l.visible ? {} : { visible: false }),
        ...(l.x ? { x: l.x } : {}), ...(l.y ? { y: l.y } : {}), ...(l.hspeed ? { hspeed: l.hspeed } : {}), ...(l.vspeed ? { vspeed: l.vspeed } : {}),
      };
      switch (l.type) {
        case 'effect': return [];
        case 'background': return [{
          ...base, type: 'background', visible: l.visible && l.bgVisible, color: l.color & 0xffffff, sprite: name(m.sprites, l.sprite),
          htiled: l.htiled, vtiled: l.vtiled, stretch: l.stretch, ...(l.foreground ? { foreground: true } : {}),
          ...((l.color >>> 24) !== 255 ? { alpha: (l.color >>> 24) / 255 } : {}),
          ...(l.frame ? { image_index: l.frame } : {}), ...(l.animSpeed !== 15 || l.animSpeedType ? { image_speed: l.animSpeed } : {}),
        }];
        case 'tiles': {
          const ts = name(m.tilesets, l.tileset);
          if (!ts) throw new Error(`room ${r.name}: layer ${l.name} has bad tileset ${l.tileset}`);
          return [{ ...base, type: 'tiles', tileset: ts, cols: l.cols, rows: l.rows, data: [...l.data] }];
        }
        case 'assets': {
          const where = `room ${r.name} layer ${l.name}`;
          const out: AssetLayer = { ...base, type: 'assets' };
          // A tile whose sprite was deleted (-1) draws nothing in GM.
          const tiles = l.tiles.filter((t) => t.sprite >= 0);
          if (tiles.length) out.tiles = tiles.map((t): LegacyTile => [t.x, t.y, sprite(t.sprite, where), t.sx, t.sy, t.w, t.h, t.scaleX, t.scaleY, t.color]);
          if (l.sprites.length) out.sprites = l.sprites.map((s) => {
            const alpha = (s.color >>> 24) / 255, colour = s.color & 0xffffff;
            return {
              sprite: sprite(s.sprite, where), x: s.x, y: s.y, name: s.name,
              ...(s.scaleX !== 1 ? { scale_x: s.scaleX } : {}), ...(s.scaleY !== 1 ? { scale_y: s.scaleY } : {}),
              ...(s.rotation ? { angle: s.rotation } : {}), ...(colour !== 0xffffff ? { colour } : {}), ...(alpha !== 1 ? { alpha } : {}),
              ...(s.frame ? { image_index: s.frame } : {}), ...(s.animSpeed !== 1 ? { image_speed: s.animSpeed } : {}),
            };
          });
          return [out];
        }
      }
      return [{ ...base, type: 'instances', instances: l.instances.map((id) => {
        const i = byId.get(id);
        if (!i) throw new Error(`room ${r.name}: layer ${l.name} lists unknown instance ${id}`);
        const object = name(m.objects, i.object);
        if (!object) throw new Error(`room ${r.name}: instance ${id} has bad object ${i.object}`);
        const alpha = (i.color >>> 24) / 255, colour = i.color & 0xffffff;
        return {
          object, x: i.x, y: i.y, id,
          ...(i.scaleX !== 1 ? { scale_x: i.scaleX } : {}), ...(i.scaleY !== 1 ? { scale_y: i.scaleY } : {}),
          ...(i.rotation ? { angle: i.rotation } : {}), ...(colour !== 0xffffff ? { colour } : {}), ...(alpha !== 1 ? { alpha } : {}),
          ...(i.imageIndex ? { image_index: i.imageIndex } : {}), ...(i.imageSpeed !== 1 ? { image_speed: i.imageSpeed } : {}),
          ...(i.creationCode >= 0 ? { creation: script(i.creationCode, `room ${r.name} instance ${id}`) } : {}),
        };
      }) }];
    });
    const views = r.views.map((v): View => ({
      view: v.view, port: v.port, border: v.border, speed: v.speed,
      ...(v.follow >= 0 ? { follow: name(m.objects, v.follow) } : {}), ...(v.enabled ? { visible: true } : {}),
    }));
    rooms[r.name] = {
      width: r.width, height: r.height, ...(r.persistent ? { persistent: true } : {}),
      colour: r.bgColor & 0xffffff, show_colour: r.drawBgColor, speed: r.speed,
      ...(r.flags & 1 ? { views_enabled: true } : {}), ...(views.some((v) => v.visible) ? { views } : {}),
      ...(r.instances.length ? { instance_order: r.instances.map((i) => i.id) } : {}), layers,
      scripts: r.creationCode >= 0 ? [['evt_create', script(r.creationCode, `room ${r.name}`)]] : [],
    };
  }

  const g = m.gen8;
  const roomOrder = g.roomOrder.map((i) => name(m.rooms, i)).filter((n): n is string => n !== null);
  const fps = g.fps || m.rooms[g.roomOrder[0] ?? 0]?.speed || 30;
  const krpj: Krpj = {
    krpj_v: '0.1',
    cfg_db_relay: { slug: g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: g.displayName || g.name, author: '', revision: 1, date_created: 0, date_updated: 0 },
    cfg_gm_compat: { imported_from: { tool: 'gm2kr', game: g.name, bytecode: g.bytecodeVersion, gm_version: g.version } },
    cfg_defaults: { width: g.windowWidth, height: g.windowHeight, fps, window_title: g.displayName || g.name },
    cfg_project: { init_room: roomOrder[0] ?? null },
    sprites, sounds, fonts, tilesets, functions, objects, rooms, room_order: roomOrder,
    global_init: m.globalInit.map((id) => script(id, 'global init')),
    scripts, audio_groups: m.audioGroups, included_files: included,
  };
  files.set('game.json', new TextEncoder().encode(JSON.stringify(krpj)));
  return { krpj, files };
}
