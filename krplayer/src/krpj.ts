// KRPJ types (see /docs/krpj.md). Defined once here; gm2kr and kreditor import them.

/** A script node: a JSON literal, or an opcode array ["name", ...args]. See docs/krpj_opcodes.md. */
export type Node = null | boolean | number | string | Node[] | { [k: string]: Node };
/** A list of statements. */
export type Script = Node[];
/** An event 'hat': ["evt_*", ...args, Script]. */
export type Hat = Node[];

export interface Sprite {
  name: string;
  frames: string[];
  origin: [number, number];
  /** Frames per second (or per game frame when speed_type is "frame"). */
  speed: number;
  speed_type?: 'fps' | 'frame';
  /** Collision box [left, top, right, bottom], inclusive pixels. Defaults to the whole image. */
  bbox?: [number, number, number, number];
  /** Collision mask kind. Defaults to "rect". */
  mask?: 'rect' | 'rotated' | 'precise';
}
export interface Sound { name: string; src: string; volume: number; stream: boolean }
export interface Font {
  name: string; atlas: string; font_name: string; size: number; bold: boolean; italic: boolean;
  antialias: number; line_height: number; ranges: [number, number][];
  /** char code -> [x, y, w, h, shift, offset] in the atlas. */
  glyphs: Record<string, [number, number, number, number, number, number]>;
  kerning?: Record<string, [number, number][]>;
}
export interface KrFunction { args: string[]; body: Script }
export interface KrObject {
  sprite: string | null;
  parent: string | null;
  visible: boolean;
  persistent: boolean;
  solid?: boolean;
  /** Collision mask sprite, when it differs from the sprite. */
  mask?: string | null;
  imported_from?: string;
  scripts: Hat[];
}
export interface RoomInstance {
  object: string; x: number; y: number;
  scale_x?: number; scale_y?: number; angle?: number;
  /** BGR colour blend. */
  colour?: number; alpha?: number;
  image_index?: number; image_speed?: number;
  /** Instance creation code, run after the instance's create event. */
  creation?: Script;
}
interface LayerBase { name: string; depth: number; visible?: boolean }
export interface BackgroundLayer extends LayerBase {
  type: 'background'; color: number; sprite: string | null;
  htiled?: boolean; vtiled?: boolean; stretch?: boolean;
}
export interface InstanceLayer extends LayerBase { type: 'instances'; instances: RoomInstance[] }
export type Layer = BackgroundLayer | InstanceLayer;
export interface Room {
  width: number; height: number;
  persistent?: boolean;
  preload?: string[];
  layers: Layer[];
  scripts: Hat[];
}

export interface Krpj {
  krpj_v: string;
  cfg_db_relay: { slug: string; title: string; author: string; revision: number; date_created: number; date_updated: number };
  cfg_gm_compat: { imported_from: null | { tool: string; game: string; bytecode: number; gm_version: number[] } };
  cfg_defaults: { width: number | 'default'; height: number | 'default'; fps: number; window_title: string };
  cfg_project: { init_room: string | null };
  sprites: Record<string, Sprite>;
  sounds: Record<string, Sound>;
  fonts: Record<string, Font>;
  functions?: Record<string, KrFunction>;
  objects?: Record<string, KrObject>;
  rooms?: Record<string, Room>;
  /** Room keys in game order (room_goto_next etc.). Defaults to the order of `rooms`. */
  room_order?: string[];
}
