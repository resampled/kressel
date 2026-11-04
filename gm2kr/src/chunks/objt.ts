// OBJT: objects and their events. Layout per UndertaleModTool's UndertaleGameObject.

import { FormatError, type Reader } from '../io/reader.ts';

export interface GmEvent { type: number; subtype: number; code: number }
export interface GmObject {
  name: string; sprite: number; visible: boolean; solid: boolean; depth: number;
  persistent: boolean; parent: number; mask: number; events: GmEvent[];
}

/** Reads the physics block and returns the position of the event list, or -1 if it doesn't look right. */
function eventsAt(o: Reader, from: number): number {
  try {
    const r = o.at(from);
    r.skip(32); // uses physics .. angular damping
    const verts = r.count(4096);
    r.skip(12 + verts * 8); // friction, awake, kinematic, vertices
    const at = r.pos, list = r.ptrList(64);
    return list.length > 0 && list[0] === at + 4 + 4 * list.length ? at : -1;
  } catch { return -1; }
}

export function readObjt(r: Reader): GmObject[] {
  return r.ptrList(1 << 16).map((p) => {
    const o = r.at(p);
    const name = o.strPtr(), sprite = o.i32(), visible = o.bool();
    // GM 2022.5 added a "managed" bool after visible; probe which layout lines up.
    const fieldsAt = o.pos;
    let evAt = eventsAt(o, fieldsAt + 4 * 6);
    if (evAt >= 0) o.skip(4); else evAt = eventsAt(o, fieldsAt + 4 * 5);
    if (evAt < 0) throw new FormatError(`object ${name}: unrecognised layout`, p);
    const solid = o.bool(), depth = o.i32(), persistent = o.bool(), parent = o.i32(), mask = o.i32();

    const events: GmEvent[] = [];
    o.at(evAt).ptrList(64).forEach((tp, type) => {
      for (const ep of o.at(tp).ptrList(4096)) {
        const e = o.at(ep), subtype = e.u32();
        const actions = e.ptrList(64);
        if (actions.length !== 1) throw new FormatError(`object ${name}: event ${type}/${subtype} has ${actions.length} actions (DnD not supported)`, ep);
        events.push({ type, subtype, code: o.at(actions[0] + 32).i32() });
      }
    });
    return { name, sprite, visible, solid, depth, persistent, parent, mask, events };
  });
}
