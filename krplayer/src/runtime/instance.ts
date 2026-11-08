// An instance and its built-in variables. speed/direction and hspeed/vspeed are kept in sync
// the way GameMaker does: setting either pair recomputes the other.

import { IV } from '../compile/names.ts';
import { GmlError, real, Scope, truthy, type Value } from '../value.ts';
import type { ObjectDef, SpriteDef } from './assets.ts';

const D2R = Math.PI / 180;
/** "No index" marker for variable access helpers (distinct from any GML value). */
export const NOI: Value = [];

export class Instance extends Scope {
  id: number;
  obj: ObjectDef;
  /** Index in creation order; also the draw/iteration order among equal depths. */
  order = 0;
  alive = true;
  /** False while deactivated (instance_deactivate_*): skipped by events, with and collisions. */
  active = true;
  x = 0; y = 0; xprevious = 0; yprevious = 0; xstart = 0; ystart = 0;
  hspeed = 0; vspeed = 0; speed = 0; direction = 0;
  friction = 0; gravity = 0; gravity_direction = 270;
  sprite: SpriteDef | null = null;
  mask: SpriteDef | null = null;
  image_index = 0; image_speed = 1; image_xscale = 1; image_yscale = 1; image_angle = 0;
  image_blend = 0xffffff; image_alpha = 1;
  visible = true; solid = false; persistent = false; depth = 0;
  /** Layer id the instance is on (-1: none, e.g. created with instance_create_depth). */
  layer = -1;
  path = -1; path_position = 0; path_positionprevious = 0; path_speed = 0; path_scale = 1; path_orientation = 0; path_endaction = 0;
  /** Where the path's first point sits (path_start). */
  pathX = 0; pathY = 0;
  readonly alarm = new Float64Array(12).fill(-1);
  /** Set by built-in motion; cleared by the outside-room check. */
  wasOutside = false;
  /** Whether the mouse was over the mask last step (mouse enter/leave events). */
  mouseOver = false;

  constructor(id: number, obj: ObjectDef) {
    super();
    this.id = id; this.obj = obj;
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
      case IV.sprite_xoffset: return this.sprite ? this.sprite.ox : 0;
      case IV.sprite_yoffset: return this.sprite ? this.sprite.oy : 0;
      case IV.visible: return this.visible; case IV.solid: return this.solid; case IV.persistent: return this.persistent;
      case IV.depth: return this.depth; case IV.id: return this.id; case IV.object_index: return this.obj.index;
      case IV.layer: return this.layer;
      case IV.path_index: return this.path; case IV.path_position: return this.path_position;
      case IV.path_positionprevious: return this.path_positionprevious;
      case IV.path_speed: return this.path_speed; case IV.path_scale: return this.path_scale;
      case IV.path_orientation: return this.path_orientation; case IV.path_endaction: return this.path_endaction;
    }
    throw new GmlError(`built-in variable ${id} can't be read here`);
  }

  /** Assigns a built-in. Returns false for depth/layer, which the game handles (they move the instance). */
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
      case IV.sprite_index: {
        const s = sprites[Math.trunc(real(v))] ?? null;
        if (s !== this.sprite) this.sprite = s;
        return;
      }
      case IV.mask_index: this.mask = sprites[Math.trunc(real(v))] ?? null; return;
      case IV.image_index: this.image_index = real(v); return; case IV.image_speed: this.image_speed = real(v); return;
      case IV.image_xscale: this.image_xscale = real(v); return; case IV.image_yscale: this.image_yscale = real(v); return;
      case IV.image_angle: this.image_angle = real(v); return;
      case IV.image_blend: this.image_blend = real(v); return; case IV.image_alpha: this.image_alpha = real(v); return;
      case IV.visible: this.visible = truthy(v); return; case IV.solid: this.solid = truthy(v); return;
      case IV.persistent: this.persistent = truthy(v); return; case IV.depth: this.depth = real(v); return;
      case IV.path_position: this.path_position = real(v); return; case IV.path_positionprevious: this.path_positionprevious = real(v); return;
      case IV.path_speed: this.path_speed = real(v); return; case IV.path_scale: this.path_scale = real(v); return;
      case IV.path_orientation: this.path_orientation = real(v); return; case IV.path_endaction: this.path_endaction = real(v); return;
    }
    throw new GmlError(`built-in variable ${id} can't be assigned`);
  }
}
