// Editor entry (kressel_eval.js): kreditor's "print output" runs one reporter block through the real compiler and VM,
// as the create event of the only instance in an otherwise empty headless game, so the result follows GML's rules.
// Blocks that read game state see that empty game (x = 0, no keys held, unset variables fail like they would in GM).

import type { Krpj, Node } from './krpj.ts';
import { createHeadless } from './platform/headless.ts';
import { load } from './play.ts';
import { str, typeName } from './value.ts';
import { errorKind, RuntimeError } from './vm/vm.ts';

const OUT = '__kr_print';

/** Evaluates a block; throws with the error kind (docs/error_audit.md) when it fails. */
export async function evaluate(node: Node): Promise<{ value: string; type: string }> {
  const krpj = {
    krpj_v: '0.1',
    cfg_db_relay: { slug: '', title: 'print', author: '', revision: 1, date_created: 0, date_updated: 0 },
    cfg_gm_compat: { imported_from: null }, cfg_defaults: { width: 'default', height: 'default', fps: 60, window_title: '' },
    cfg_project: { init_room: 'rm' }, sprites: {}, sounds: {}, fonts: {},
    objects: { obj: { sprite: null, parent: null, visible: true, persistent: false, scripts: [['evt_create', [['var_set', ['_lv', OUT], node]]]] } },
    rooms: { rm: { width: 640, height: 480, layers: [{ name: 'Instances', type: 'instances', depth: 0, instances: [{ object: 'obj', x: 0, y: 0 }] }], scripts: [] } },
  } as unknown as Krpj;
  try {
    const g = await load({ krpj, url: (x) => x }, createHeadless());
    const v = g.instances[0].vars.get(g.a.varSlot(OUT));
    return { value: str(v, (k) => g.a.varNames[k]), type: typeName(v) };
  } catch (e) {
    let r = e; // the root error: the wrappers only name this file's throwaway object and event
    while (r instanceof RuntimeError && r.cause) r = r.cause;
    throw new Error(`${errorKind(e)}: ${r instanceof Error ? r.message : String(r)}`, { cause: e });
  }
}

Object.assign(globalThis, { kresselEval: evaluate });
