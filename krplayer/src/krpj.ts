// KRPJ types (see /docs/krpj.md). Defined once here; gm2kr and kreditor import them.

/** A script node: a JSON literal, or an opcode array ["name", ...args]. See docs/krpj_opcodes.md. */
export type Node = null | boolean | number | string | Node[] | { [k: string]: Node };
/** A list of statements. */
export type Script = Node[];
/** An event 'hat': ["evt_*", ...args, Script]. */
export type Hat = Node[];
/**
 * A top-level script with its editor canvas position (x/y null or absent = auto-placed). A loose entry never runs.
 * In object/room lists, an entry without a hat, or a hat with no script after it, never runs either.
 */
export interface Placed { x?: number | null; y?: number | null; loose?: boolean; script: Node[] }
/** An object/room `scripts` or `global_init` entry: a bare script (imports) or a placed one (the editor). */
export type ScriptEntry = Node[] | Placed;

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
  /** Precise masks: file of one or one-per-frame bitmaps, rows of ceil(w / 8) bytes, MSB = leftmost pixel. */
  mask_bits?: string;
}
export interface Sound {
  name: string; src: string; volume: number; stream: boolean;
  /** Pitch multiplier (default 1). */
  pitch?: number;
  /** Audio group index (into `audio_groups`), default 0. */
  group?: number;
}
export interface Font {
  name: string; atlas: string; font_name: string; size: number; bold: boolean; italic: boolean;
  antialias: number; line_height: number; ranges: [number, number][];
  /** char code -> [x, y, w, h, shift, offset] in the atlas. */
  glyphs: Record<string, [number, number, number, number, number, number]>;
  kerning?: Record<string, [number, number][]>;
}
/** A tile set: one image cut into a grid of tile_w x tile_h tiles, each padded by border_x/border_y. */
export interface Tileset {
  name: string; image: string;
  tile_w: number; tile_h: number; border_x: number; border_y: number; columns: number;
  /** Animation frames per tile (default 1) and microseconds per frame. */
  frames?: number; frame_time?: number;
  /** Animated tile sets: tile -> its frames' source tiles (tile_count * frames entries). */
  ids?: number[];
}
/** A path: points [x, y, speed %], straight or smooth (curved), open or closed. */
export interface Path { points: [number, number, number][]; smooth?: boolean; closed?: boolean; precision?: number }
/**
 * An animation curve's channels. type: 0 linear, 1 smooth (Catmull-Rom), 2 bezier; iterations: samples per
 * segment for smooth/bezier. points: [x (0-1), value] or, for bezier, [x, value, in-handle dx, dy, out-handle dx, dy].
 */
export interface AnimCurve { channels: { name: string; type: number; iterations: number; points: number[][] }[] }
/** A GLSL ES shader pair, GameMaker conventions (in_Position/in_Colour/in_TextureCoord, gm_BaseTexture, gm_Matrices). */
export interface Shader { vertex: string; fragment: string }
export interface KrFunction {
  args: string[];
  body: Script;
  /** Number of arguments GameMaker declared (imports; named args are not kept). */
  argc?: number;
  ctor?: boolean;
  /** Editor canvas position of the body (null or absent = auto-placed), and stacks lying loose on its canvas. */
  x?: number | null; y?: number | null;
  loose?: Placed[];
}
export interface KrObject {
  sprite: string | null;
  parent: string | null;
  visible: boolean;
  persistent: boolean;
  solid?: boolean;
  /** Collision mask sprite, when it differs from the sprite. */
  mask?: string | null;
  /** Depth for instances created without a layer (GM object depth). */
  depth?: number;
  imported_from?: string;
  scripts: ScriptEntry[];
}
export interface RoomInstance {
  object: string; x: number; y: number;
  scale_x?: number; scale_y?: number; angle?: number;
  /** BGR colour blend. */
  colour?: number; alpha?: number;
  image_index?: number; image_speed?: number;
  /** Variable overrides (GM room editor), run after the object's pre-create event and before its create event. */
  pre_create?: Script;
  /** Instance creation code, run after the instance's create event. */
  creation?: Script;
  /** GameMaker instance id (imports keep them, since code can refer to room instances by id). */
  id?: number;
}
interface LayerBase {
  name: string; depth: number; visible?: boolean;
  /** Offset and scroll speed (pixels per step). */
  x?: number; y?: number; hspeed?: number; vspeed?: number;
  /** GameMaker layer id (imports). */
  id?: number;
}
export interface BackgroundLayer extends LayerBase {
  type: 'background'; color: number; sprite: string | null;
  htiled?: boolean; vtiled?: boolean; stretch?: boolean;
  /** Drawn above instances. */
  foreground?: boolean;
  alpha?: number; image_index?: number; image_speed?: number;
}
export interface InstanceLayer extends LayerBase { type: 'instances'; instances: RoomInstance[] }
/** [x, y, sprite, left, top, width, height, scale_x, scale_y, colour (ABGR)] */
export type LegacyTile = [number, number, string, number, number, number, number, number, number, number];
/** sprite null: an element whose sprite was deleted; draws nothing, but code can still find it by name. */
export interface AssetSprite {
  sprite: string | null; x: number; y: number;
  scale_x?: number; scale_y?: number; angle?: number; colour?: number; alpha?: number;
  image_index?: number; image_speed?: number;
  name?: string;
}
/** Sprites and GMS1-style tiles placed in the room editor. */
export interface AssetLayer extends LayerBase { type: 'assets'; tiles?: LegacyTile[]; sprites?: AssetSprite[] }
/** A tile map: rows * cols cells, each a tile index (bits 28-30: mirror, flip, rotate; 0 = empty). tileset null: draws nothing. */
export interface TileLayer extends LayerBase { type: 'tiles'; tileset: string | null; cols: number; rows: number; data: number[] }
export type Layer = BackgroundLayer | InstanceLayer | AssetLayer | TileLayer;
export interface View {
  view: [number, number, number, number]; port: [number, number, number, number];
  border?: [number, number]; speed?: [number, number];
  /** Object followed by the view. */
  follow?: string | null;
  visible?: boolean;
}
export interface Room {
  width: number; height: number;
  persistent?: boolean;
  /** Clear colour (BGR) when no background covers the room, and whether it's drawn. */
  colour?: number; show_colour?: boolean;
  /** Room speed (imports from GMS1-style games; GMS2 uses cfg_defaults.fps). */
  speed?: number;
  views_enabled?: boolean;
  /** Instance creation order by instance id (imports: GM's room instance list); defaults to layer order. */
  instance_order?: number[];
  /** Up to 8 views. */
  views?: View[];
  preload?: string[];
  layers: Layer[];
  scripts: ScriptEntry[];
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
  tilesets?: Record<string, Tileset>;
  paths?: Record<string, Path>;
  animcurves?: Record<string, AnimCurve>;
  shaders?: Record<string, Shader>;
  functions?: Record<string, KrFunction>;
  objects?: Record<string, KrObject>;
  rooms?: Record<string, Room>;
  /** Room keys in game order (room_goto_next etc.). Defaults to the order of `rooms`. */
  room_order?: string[];
  /** Scripts run once at game start, before the first room, with self = global (GM 2.3+ script files). */
  global_init?: ScriptEntry[];
  /** Script asset index -> function key (script_execute(n), asset_get_index). null for non-function scripts. */
  scripts?: (string | null)[];
  /** Audio group names, by index. */
  audio_groups?: string[];
  /** Included files: path the game opens (relative to working_directory) -> asset path. */
  included_files?: Record<string, string>;
}
