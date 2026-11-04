// An instance and its built-in variables. speed/direction and hspeed/vspeed are kept in sync
// the way GameMaker does: setting either pair recomputes the other.

import { IV } from '../compile/names.ts';
import { GmlError, real, type Value } from '../value.ts';
import type { ObjectDef, SpriteDef } from './assets.ts';

const D2R = Math.PI / 180;
/** Marks a user variable that was never assigned (reading it is an error in GML). */
export const UNSET: Value[] = [];
/** "No index" marker for variable access helpers (distinct from any GML value). */
export const NOI: Value = [];

export class Instance {
  id: number;
  obj: ObjectDef;
  /** Index in creation order; also the draw/iteration order among equal depths. */
  order = 0;
  alive = true;
  x = 0; y = 0; xprevious = 0; yprevious = 0; xstart = 0; ystart = 0;
  hspeed = 0; vspeed = 0; speed = 0; direction = 0;
  friction = 0; gravity = 0; gravity_direction = 270;
  sprite: SpriteDef | null = null;
  mask: SpriteDef | null = null;
  image_index = 0; image_speed = 1; image_xscale = 1; image_yscale = 1; image_angle = 0;
  image_blend = 0xffffff; image_alpha = 1;
  visible = true; solid = false; persistent = false; depth = 0;
  readonly alarm = new Float64Array(12).fill(-1);
  /** User variables by slot. */
  vars: Value[];
  /** Set by built-in motion; cleared by the outside-room check. */
  wasOutside = false;

  constructor(id: number, obj: ObjectDef, nVars: number) {
    this.id = id; this.obj = obj;
    this.vars = new Array(nVars).fill(UNSET);
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.hspeed = s * Math.cos(this.direction * D2R);
    this.vspeed = -s * Math.sin(this.direction * D2R);
  }
  setDirection(d: number): void {
    this.direction = ((d % 360) + 360) % 360;
    this.setSpeed(this.speed);
  }
  setHV(h: number, v: number): void {
    this.hspeed = h; this.vspeed = v;
    this.speed = Math.sqrt(h * h + v * v);
    if (h !== 0 || v !== 0) this.direction = ((Math.atan2(-v, h) / D2R) + 360) % 360;
  }

  get(id: number): Value {
    switch (id) {
      case IV.x: return this.x; case IV.y: return this.y;
      case IV.xprevious: return this.xprevious; case IV.yprevious: return this.yprevious;
      case IV.xstart: return this.xstart; case IV.ystart: return this.ystart;
      case IV.hspeed: return this.hspeed; case IV.vspeed: return this.vspeed;
      case IV.speed: return this.speed; case IV.direction: return this.direction;
      case IV.friction: return this.friction; case IV.gravity: return this.gravity; case IV.gravity_direction: return this.gravity_direction;
      case IV.sprite_index: return this.sprite ? this.sprite.index : -1;
      case IV.mask_index: return this.mask ? this.mask.index : -1;
      case IV.image_index: return this.image_index; case IV.image_speed: return this.image_speed;
      case IV.image_xscale: return this.image_xscale; case IV.image_yscale: return this.image_yscale;
      case IV.image_angle: return this.image_angle; case IV.image_blend: return this.image_blend; case IV.image_alpha: return this.image_alpha;
      case IV.image_number: return this.sprite ? this.sprite.frames.length : 0;
      case IV.sprite_width: return this.sprite ? this.sprite.width * this.image_xscale : 0;
      case IV.sprite_height: return this.sprite ? this.sprite.height * this.image_yscale : 0;
      case IV.visible: return this.visible; case IV.solid: return this.solid; case IV.persistent: return this.persistent;
      case IV.depth: return this.depth; case IV.id: return this.id; case IV.object_index: return this.obj.index;
    }
    throw new GmlError(`built-in variable ${id} can't be read here`);
  }

  set(id: number, v: Value, sprites: SpriteDef[]): void {
    switch (id) {
      case IV.x: this.x = real(v); return; case IV.y: this.y = real(v); return;
      case IV.xprevious: this.xprevious = real(v); return; case IV.yprevious: this.yprevious = real(v); return;
      case IV.xstart: this.xstart = real(v); return; case IV.ystart: this.ystart = real(v); return;
      case IV.hspeed: this.setHV(real(v), this.vspeed); return;
      case IV.vspeed: this.setHV(this.hspeed, real(v)); return;
      case IV.speed: this.setSpeed(real(v)); return;
      case IV.direction: this.setDirection(real(v)); return;
      case IV.friction: this.friction = real(v); return; case IV.gravity: this.gravity = real(v); return;
      case IV.gravity_direction: this.gravity_direction = real(v); return;
      case IV.sprite_index: this.sprite = sprites[real(v)] ?? null; return;
      case IV.mask_index: this.mask = sprites[real(v)] ?? null; return;
      case IV.image_index: this.image_index = real(v); return; case IV.image_speed: this.image_speed = real(v); return;
      case IV.image_xscale: this.image_xscale = real(v); return; case IV.image_yscale: this.image_yscale = real(v); return;
      case IV.image_angle: this.image_angle = real(v); return;
      case IV.image_blend: this.image_blend = real(v); return; case IV.image_alpha: this.image_alpha = real(v); return;
      case IV.visible: this.visible = real(v) > 0.5; return; case IV.solid: this.solid = real(v) > 0.5; return;
      case IV.persistent: this.persistent = real(v) > 0.5; return; case IV.depth: this.depth = real(v); return;
    }
    throw new GmlError(`built-in variable ${id} can't be assigned`);
  }
}
