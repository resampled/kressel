// KRPJ types (see /docs/krpj.md)

export interface Sprite { name: string; frames: string[]; origin: [number, number]; speed: number }
export interface Sound { name: string; src: string; volume: number; stream: boolean }
export interface Font { name: string; atlas: string; font_name: string; [k: string]: unknown }

export interface Krpj {
  krpj_v: string;
  cfg_db_relay: { slug: string; title: string; author: string; revision: number; date_created: number; date_updated: number };
  cfg_gm_compat: { imported_from: unknown };
  cfg_defaults: { width: number | 'default'; height: number | 'default'; fps: number; window_title: string };
  cfg_project: { init_room: string | null };
  sprites: Record<string, Sprite>;
  sounds: Record<string, Sound>;
  fonts: Record<string, Font>;
  [k: string]: unknown;
}
