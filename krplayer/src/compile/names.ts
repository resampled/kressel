// Built-in variable ids. Instance built-ins live as fields on Instance; global built-ins on Game.
// The compiler resolves `_lv` names against these before falling back to user variables.

export const IV = {
  x: 0, y: 1, xprevious: 2, yprevious: 3, xstart: 4, ystart: 5, hspeed: 6, vspeed: 7, speed: 8, direction: 9,
  friction: 10, gravity: 11, gravity_direction: 12, sprite_index: 13, image_index: 14, image_speed: 15,
  image_xscale: 16, image_yscale: 17, image_angle: 18, image_blend: 19, image_alpha: 20, image_number: 21,
  sprite_width: 22, sprite_height: 23, bbox_left: 24, bbox_right: 25, bbox_top: 26, bbox_bottom: 27,
  visible: 28, solid: 29, persistent: 30, depth: 31, id: 32, object_index: 33, mask_index: 34, alarm: 35,
} as const;

/** Instance built-ins that can't be assigned. */
export const IV_READONLY = new Set<number>([IV.image_number, IV.sprite_width, IV.sprite_height, IV.bbox_left, IV.bbox_right, IV.bbox_top, IV.bbox_bottom, IV.id, IV.object_index]);
/** Instance built-ins that are arrays (accessed with _ai). */
export const IV_ARRAY = new Set<number>([IV.alarm]);

export const GV = { room: 0, room_width: 1, room_height: 2, room_speed: 3, fps: 4, current_time: 5, mouse_x: 6, mouse_y: 7, instance_count: 8 } as const;
export const GV_READONLY = new Set<number>([GV.room_width, GV.room_height, GV.fps, GV.current_time, GV.mouse_x, GV.mouse_y, GV.instance_count]);

export const IV_NAMES = new Map<string, number>(Object.entries(IV));
export const GV_NAMES = new Map<string, number>(Object.entries(GV));
