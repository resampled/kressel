// GmModel -> game.json + asset files (zipped together, they make a .krpj).

import type { Font, Hat, KrObject, Krpj, Layer, Room, Script, Sprite } from '../../../krplayer/src/krpj.ts';
import type { GmModel } from '../model.ts';
import type { GmEvent } from '../chunks/objt.ts';
import { disassemble } from '../decompile/disasm.ts';
import { Decompiler, type AssetNames } from '../decompile/structure.ts';
import { tpagAt } from '../chunks/tpag.ts';
import { cropItem, decodePage, encodePng, sourceRect, type Image } from './textures.ts';

const DRAW: Record<number, string> = { 0: 'evt_draw', 64: 'evt_drawgui', 65: 'evt_resize', 72: 'evt_draw_begin', 73: 'evt_draw_end', 74: 'evt_drawgui_begin', 75: 'evt_drawgui_end', 76: 'evt_draw_pre', 77: 'evt_draw_post' };
const OTHER: Record<number, string> = { 0: 'evt_outside_room', 1: 'evt_intersect_boundary', 2: 'evt_game_start', 3: 'evt_game_end', 4: 'evt_room_start', 5: 'evt_room_end', 7: 'evt_animation_end', 8: 'evt_path_end' };
const STEP = ['evt_step', 'evt_step_begin', 'evt_step_end'];
const KEY: Record<number, string> = { 5: 'held', 9: 'pressed', 10: 'released' };

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
      break;
    case 8: if (DRAW[s]) return [DRAW[s]]; break;
    case 12: return ['evt_cleanup'];
  }
  throw new Error(`${where}: event type ${e.type} subtype ${s} not supported yet`);
}

export interface Converted { krpj: Krpj; files: Map<string, Uint8Array> }

export async function emitKrpj(m: GmModel): Promise<Converted> {
  const files = new Map<string, Uint8Array>();
  const name = (list: { name: string }[], i: number) => (i >= 0 && i < list.length ? list[i].name : null);
  const assets: AssetNames = {
    objects: m.objects.map((o) => o.name), sprites: m.sprites.map((s) => s.name), sounds: [],
    rooms: m.rooms.map((r) => r.name), fonts: m.fonts.map((f) => f.name),
  };
  const script = (codeId: number, where: string): Script => {
    const c = m.code[codeId];
    if (!c) throw new Error(`${where}: code entry ${codeId} missing`);
    if (c.offset !== 0) throw new Error(`${c.name}: child code entries (functions) not supported yet`);
    const ins = disassemble(m.buf, c, m.refs, m.strings);
    return new Decompiler(c.name, ins, c.start + c.length, assets).run() as Script;
  };

  const pages: Image[] = m.textures.map((t, i) => decodePage(t.data, i));

  const sprites: Record<string, Sprite> = {};
  for (const s of m.sprites) {
    const frames: string[] = [];
    for (const [i, p] of s.frames.entries()) {
      const path = `sprites/${s.name}/${i}.png`;
      files.set(path, await encodePng(cropItem(pages, tpagAt(m.tpag, p, `sprite ${s.name}`), `sprite ${s.name}`)));
      frames.push('./' + path);
    }
    const g = s.margins;
    sprites[s.name] = {
      name: s.name, frames, origin: s.origin, speed: s.speed, ...(s.speedType === 1 ? { speed_type: 'frame' as const } : {}),
      bbox: [g.left, g.top, g.right, g.bottom], mask: (['rect', 'precise', 'rotated'] as const)[s.maskKind] ?? 'rect',
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

  const objects: Record<string, KrObject> = {};
  for (const o of m.objects) {
    const scripts: Hat[] = o.events.map((e) => {
      const where = `object ${o.name}`;
      return [...hat(e, assets, where), script(e.code, where)];
    });
    objects[o.name] = {
      sprite: name(m.sprites, o.sprite), parent: name(m.objects, o.parent), visible: o.visible,
      persistent: o.persistent, solid: o.solid, ...(o.mask >= 0 ? { mask: name(m.sprites, o.mask) } : {}), scripts,
    };
  }

  const rooms: Record<string, Room> = {};
  for (const r of m.rooms) {
    if (r.views.some((v) => v.enabled)) throw new Error(`room ${r.name}: views not supported yet`);
    const byId = new Map(r.instances.map((i) => [i.id, i]));
    const layers: Layer[] = r.layers.map((l): Layer => {
      if (l.type === 'background') {
        return { name: l.name, type: 'background', depth: l.depth, visible: l.visible && l.bgVisible,
          color: l.color & 0xffffff, sprite: name(m.sprites, l.sprite), htiled: l.htiled, vtiled: l.vtiled, stretch: l.stretch };
      }
      return { name: l.name, type: 'instances', depth: l.depth, visible: l.visible, instances: l.instances.map((id) => {
        const i = byId.get(id);
        if (!i) throw new Error(`room ${r.name}: layer ${l.name} lists unknown instance ${id}`);
        const object = name(m.objects, i.object);
        if (!object) throw new Error(`room ${r.name}: instance ${id} has bad object ${i.object}`);
        const alpha = (i.color >>> 24) / 255, colour = i.color & 0xffffff;
        return {
          object, x: i.x, y: i.y,
          ...(i.scaleX !== 1 ? { scale_x: i.scaleX } : {}), ...(i.scaleY !== 1 ? { scale_y: i.scaleY } : {}),
          ...(i.rotation ? { angle: i.rotation } : {}), ...(colour !== 0xffffff ? { colour } : {}), ...(alpha !== 1 ? { alpha } : {}),
          ...(i.imageIndex ? { image_index: i.imageIndex } : {}), ...(i.imageSpeed !== 1 ? { image_speed: i.imageSpeed } : {}),
          ...(i.creationCode >= 0 ? { creation: script(i.creationCode, `room ${r.name} instance ${id}`) } : {}),
        };
      }) };
    });
    rooms[r.name] = {
      width: r.width, height: r.height, ...(r.persistent ? { persistent: true } : {}), layers,
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
    sprites, sounds: {}, fonts, functions: {}, objects, rooms, room_order: roomOrder,
  };
  files.set('game.json', new TextEncoder().encode(JSON.stringify(krpj)));
  return { krpj, files };
}
