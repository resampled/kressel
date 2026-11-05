// Built-in variable ids. Instance built-ins live as fields on Instance; global built-ins on Game.
// The compiler resolves `_lv` names against these before falling back to user variables.

export const IV = {
  x: 0, y: 1, xprevious: 2, yprevious: 3, xstart: 4, ystart: 5, hspeed: 6, vspeed: 7, speed: 8, direction: 9,
  friction: 10, gravity: 11, gravity_direction: 12, sprite_index: 13, image_index: 14, image_speed: 15,
  image_xscale: 16, image_yscale: 17, image_angle: 18, image_blend: 19, image_alpha: 20, image_number: 21,
  sprite_width: 22, sprite_height: 23, bbox_left: 24, bbox_right: 25, bbox_top: 26, bbox_bottom: 27,
  visible: 28, solid: 29, persistent: 30, depth: 31, id: 32, object_index: 33, mask_index: 34, alarm: 35,
  sprite_xoffset: 36, sprite_yoffset: 37, path_index: 38, path_position: 39, path_speed: 40, path_scale: 41,
  path_orientation: 42, path_endaction: 43, layer: 44, path_positionprevious: 45,
} as const;

/** Instance built-ins that can't be assigned. */
export const IV_READONLY = new Set<number>([
  IV.image_number, IV.sprite_width, IV.sprite_height, IV.bbox_left, IV.bbox_right, IV.bbox_top, IV.bbox_bottom, IV.id, IV.object_index,
  IV.sprite_xoffset, IV.sprite_yoffset, IV.path_index,
]);

export const GV = {
  room: 0, room_width: 1, room_height: 2, room_speed: 3, fps: 4, current_time: 5, mouse_x: 6, mouse_y: 7, instance_count: 8,
  undefined: 9, application_surface: 10, async_load: 11, event_type: 12, event_number: 13, event_object: 14,
  keyboard_key: 15, keyboard_lastkey: 16, keyboard_string: 17, keyboard_lastchar: 18, os_type: 19, os_browser: 20,
  room_persistent: 21, view_camera: 22, view_current: 23, view_visible: 24, view_xport: 25, view_yport: 26, view_wport: 27,
  view_hport: 28, view_enabled: 29, working_directory: 30, program_directory: 31, temp_directory: 32, game_save_id: 33,
  fps_real: 34, delta_time: 35, debug_mode: 36, game_display_name: 37, room_first: 38, room_last: 39, room_caption: 40,
  os_device: 41, os_version: 42, browser_width: 43, browser_height: 44, current_year: 45, current_month: 46, current_day: 47,
  current_weekday: 48, current_hour: 49, current_minute: 50, current_second: 51, mouse_button: 52, mouse_lastbutton: 53,
  pointer_null: 54, pointer_invalid: 55, view_surface_id: 56, background_colour: 57, background_color: 58,
  background_showcolour: 59, background_showcolor: 60, display_aa: 61, game_id: 62, game_project_name: 63,
  health: 64, score: 65, lives: 66,
} as const;
export const GV_READONLY = new Set<number>([
  GV.room_width, GV.room_height, GV.fps, GV.current_time, GV.mouse_x, GV.mouse_y, GV.instance_count, GV.undefined,
  GV.application_surface, GV.async_load, GV.event_type, GV.event_number, GV.event_object, GV.os_type, GV.os_browser,
  GV.view_current, GV.working_directory, GV.program_directory, GV.temp_directory, GV.game_save_id, GV.fps_real, GV.delta_time,
  GV.debug_mode, GV.game_display_name, GV.room_first, GV.room_last, GV.os_device, GV.os_version, GV.browser_width,
  GV.browser_height, GV.current_year, GV.current_month, GV.current_day, GV.current_weekday, GV.current_hour, GV.current_minute,
  GV.current_second, GV.mouse_lastbutton, GV.pointer_null, GV.pointer_invalid, GV.display_aa, GV.game_id, GV.game_project_name,
]);
/** Built-in globals that are arrays (one entry per view). */
export const GV_ARRAY = new Set<number>([GV.view_camera, GV.view_visible, GV.view_xport, GV.view_yport, GV.view_wport, GV.view_hport, GV.view_surface_id]);

export const IV_NAMES = new Map<string, number>(Object.entries(IV));
export const GV_NAMES = new Map<string, number>(Object.entries(GV));
