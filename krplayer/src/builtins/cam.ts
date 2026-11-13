// Camera, views and window (cam_*), control functions (ctr_*) and system (sys_*).

import { define, family, n, b, str } from './registry.ts';
import { GmlError, NotImplemented, real, Unverified } from '../value.ts';
import { newCamera, type Camera } from '../runtime/layers.ts';
import type { Game } from '../runtime/game.ts';
import { gstr } from './opr.ts';
import { DsMap } from '../runtime/data.ts';
import { ortho, viewMat2d } from '../runtime/matrix.ts';

/** A camera, or undefined. GM never errors on a missing one: getters give -1, setters do nothing (HTML5 CameraManager; error_audit.md). */
const cam = (g: Game, v: unknown): Camera | undefined => g.cameras[real(v as number)] ?? undefined;
const CAM_GET: Record<string, true> = { x: true, y: true, width: true, height: true, angle: true, border_x: true, border_y: true, speed_x: true, speed_y: true, target: true };
define('cam_get', (g, s, t) => {
  const c = cam(g, s[t - 1]);
  if (!c) { if (String(s[t]) in CAM_GET) return -1; } else switch (s[t]) {
    case 'x': return c.x; case 'y': return c.y; case 'width': return c.w; case 'height': return c.h; case 'angle': return c.angle;
    case 'border_x': return c.bx; case 'border_y': return c.by; case 'speed_x': return c.sx; case 'speed_y': return c.sy; case 'target': return c.target;
  }
  throw new NotImplemented(`camera_get_view_${String(s[t])} unknown`);
});
define('cam_set_pos', (g, s, t) => { const c = cam(g, s[t]); if (c) { c.x = n(s, t, 1); c.y = n(s, t, 2); } return undefined; });
define('cam_set_size', (g, s, t) => { const c = cam(g, s[t]); if (c) { c.w = n(s, t, 1); c.h = n(s, t, 2); } return undefined; });
define('cam_set_target', (g, s, t) => { const c = cam(g, s[t]); if (c) c.target = n(s, t, 1); return undefined; });
define('cam_set_border', (g, s, t) => { const c = cam(g, s[t]); if (c) { c.bx = n(s, t, 1); c.by = n(s, t, 2); } return undefined; });
define('cam_set_speed', (g, s, t) => { const c = cam(g, s[t]); if (c) { c.sx = n(s, t, 1); c.sy = n(s, t, 2); } return undefined; });
define('cam_set_angle', (g, s, t) => { const c = cam(g, s[t]); if (c) c.angle = n(s, t, 1); return undefined; });
define('cam_create', (g) => { const id = g.cameras.length; g.cameras.push(newCamera(id)); return id; });
/** camera_create_view(x, y, w, h, angle, target, hspeed, vspeed, hborder, vborder) */
define('cam_create_view', (g, s, t, argc) => {
  const id = g.cameras.length, c = newCamera(id), o = (k: number, d: number) => (k < argc ? n(s, t, k) : d);
  c.x = n(s, t, 0); c.y = n(s, t, 1); c.w = n(s, t, 2); c.h = n(s, t, 3);
  c.angle = o(4, 0); c.target = o(5, -1); c.sx = o(6, -1); c.sy = o(7, -1); c.bx = o(8, 0); c.by = o(9, 0);
  g.cameras.push(c);
  return id;
});
define('cam_apply', (g, s, t) => { const c = cam(g, s[t]); if (c) g.applyCamera(c); return undefined; });
define('cam_special', (g, s, t) => (s[t] === 'active' ? g.activeCamera : g.defaultCamera));
define('cam_get_mat', (g, s, t) => {
  const c = cam(g, s[t - 1]);
  if (!c) return -1;
  const m = s[t] === 'view' ? c.view ?? viewMat2d(c.x, c.y, c.w, c.h, c.angle) : c.proj ?? ortho(c.w, c.h, 1, 32000);
  return [...m];
});
/**
 * camera_set_view_mat / camera_set_proj_mat. krplayer draws through the view rectangle, so a matrix must show the
 * same thing: the view's own look-at (any eye z), or an ortho projection of its size (any z range).
 */
define('cam_set_mat', (g, s, t) => {
  const c = cam(g, s[t - 1]), v = s[t - 2], view = s[t] === 'view';
  if (!c) return undefined;
  if (!Array.isArray(v) || v.length < 16) throw new Unverified(`camera_set_${String(s[t])}_mat: not a matrix`);
  const m = v.slice(0, 16).map((x) => real(x));
  const want = view ? viewMat2d(c.x, c.y, c.w, c.h, c.angle) : ortho(c.w, c.h, 1, 32000);
  const skip = view ? [14] : [10, 14]; // depth only
  if (m.some((x, k) => !skip.includes(k) && Math.abs(x - want[k]) > 1e-4 * Math.max(1, Math.abs(want[k])))) {
    throw new NotImplemented(`camera_set_${String(s[t])}_mat: krplayer draws in 2D and only takes matrices matching the camera's view (camera ${c.id})`);
  }
  if (view) c.view = m; else c.proj = m;
  return undefined;
});
define('ctr_call_later', () => { throw new NotImplemented('call_later is not implemented in krplayer yet'); });
define('cam_destroy', (g, s, t) => { const i = real(s[t]); if (g.cameras[i]) g.cameras[i] = null; return undefined; });
define('cam_view_get', (g, s, t) => {
  const v = g.views[n(s, t, 1)];
  if (!v) throw new Unverified(`view ${String(s[t - 1])} out of range`);
  switch (s[t]) {
    case 'visible': return v.visible; case 'camera': return v.camera; case 'xport': return v.px; case 'yport': return v.py;
    case 'wport': return v.pw; case 'hport': return v.ph; case 'surface_id': return v.surface;
  }
  throw new NotImplemented(`view_get_${String(s[t])} unknown`);
});
define('cam_view_set', (g, s, t) => {
  const v = g.views[n(s, t, 1)], x = s[t - 2];
  if (!v) throw new Unverified(`view ${String(s[t - 1])} out of range`);
  switch (s[t]) {
    case 'visible': v.visible = b(s, t, 2); break; case 'camera': v.camera = real(x); break;
    case 'xport': v.px = real(x); break; case 'yport': v.py = real(x); break; case 'wport': v.pw = real(x); break; case 'hport': v.ph = real(x); break;
    case 'surface_id': v.surface = real(x); break;
    default: throw new NotImplemented(`view_set_${String(s[t])} unknown`);
  }
  return undefined;
});
define('cam_gui_size', (g, s, t) => (s[t] === 'width' ? g.guiW || g.surface(0).w : g.guiH || g.surface(0).h));
define('cam_gui_set_size', (g, s, t) => { g.guiW = n(s, t, 0); g.guiH = n(s, t, 1); return undefined; });
define('cam_fullscreen', (g) => g.p.isFullscreen());
define('cam_fullscreen_set', (g, s, t) => { g.p.setFullscreen(b(s, t, 0)); return undefined; });
define('cam_window', (g, s, t) => g.p.renderer.windowSize()[s[t] === 'width' ? 0 : 1]);
// The "display" is the window's host; report a typical desktop so games don't pick tiny window scales.
define('cam_display', (_g, s, t) => (s[t] === 'width' ? 1920 : 1080));
define('cam_window_set_size', (g, s, t) => { g.p.renderer.setWindowSize(Math.max(1, n(s, t, 0)), Math.max(1, n(s, t, 1))); return undefined; });
define('cam_window_caption', (g, s, t) => { g.p.setTitle(str(s, t, 0)); return undefined; });
define('cam_cursor_set', () => undefined);
define('cam_window_mouse', (g, s, t) => (s[t] === 'x' ? g.p.input.mouseX : g.p.input.mouseY));
define('cam_window_center', () => undefined);
define('cam_window_borderless', () => undefined);
define('cam_legacy_view_get', () => { throw new NotImplemented('__view_get is not implemented in krplayer yet'); });
define('cam_legacy_view_set', () => { throw new NotImplemented('__view_set is not implemented in krplayer yet'); });

// ---------------------------------------------------------------- control

define('ctr_alarm_set', (g, s, t) => { if ('alarm' in g.self) (g.self as { alarm: Float64Array }).alarm[n(s, t, 0)] = n(s, t, 1); return undefined; });
define('ctr_alarm_get', (g, s, t) => ('alarm' in g.self ? (g.self as { alarm: Float64Array }).alarm[n(s, t, 0)] : -1));
define('ctr_game_speed', (g, s, t) => (n(s, t, 0) === 0 ? g.speed : 1e6 / g.speed));
define('ctr_game_speed_set', (g, s, t) => { g.speed = n(s, t, 1) === 0 ? n(s, t, 0) : 1e6 / n(s, t, 0); return undefined; });
define('ctr_timer', (g) => Math.floor((g.p.now() - g.startTime) * 1000));
define('ctr_script_exists', (g, s, t) => { const f = s[t]; return typeof f === 'number' ? (g.a.scripts[f] ?? -1) >= 0 : f !== undefined; });
define('ctr_script_name', (g, s, t) => { const f = real(s[t]); return g.a.functions[g.a.scripts[f] ?? -1]?.name ?? '<undefined>'; });

// ---------------------------------------------------------------- system

define('sys_log', (g, s, t) => { g.p.log(gstr(g, s[t])); return undefined; });
// show_message / show_question block like GM's dialogs (the platform's own, as get_string). A platform without
// dialogs (headless) logs the text and answers yes.
define('sys_alert', (g, s, t) => { const m = gstr(g, s[t]); if (g.p.alert) g.p.alert(m); else g.p.log(`show_message: ${m}`); return undefined; });
define('sys_confirm', (g, s, t) => {
  const m = gstr(g, s[t]);
  if (g.p.confirm) return g.p.confirm(m);
  g.p.log(`show_question: ${m} (no dialog on this platform: answered yes)`);
  return true;
});
define('sys_error', (g, s, t) => { throw new GmlError(`show_error: ${gstr(g, s[t])}`); });
define('sys_game_end', (g) => { g.ended = true; g.endMessage = 'Game ended.'; return undefined; });
define('sys_game_restart', (g) => { g.ended = true; g.endMessage = 'game_restart is not supported yet: reload the page.'; return undefined; });
define('sys_game_change', (g, s, t) => { g.ended = true; g.endMessage = `The game switched to ${str(s, t, 0)} ${str(s, t, 1)}: load that project to continue.`; return undefined; });
define('sys_device', (g, s, t) => (s[t] === 'language' ? 'en' : s[t] === 'region' ? 'US' : g.data.maps.add(new DsMap())));
define('sys_now', () => dateTime(new Date()));
define('sys_date', (_g, s, t, argc) => {
  const d = argc > 1 ? fromDateTime(n(s, t, 1)) : new Date();
  switch (s[t]) {
    case 'year': return d.getFullYear(); case 'month': return d.getMonth() + 1; case 'day': return d.getDate();
    case 'hour': return d.getHours(); case 'minute': return d.getMinutes(); case 'second': return d.getSeconds(); case 'weekday': return d.getDay();
  }
  throw new NotImplemented(`date_get_${String(s[t])} unknown`);
});
define('sys_url_open', (g, s, t) => { g.p.log(`url_open: ${str(s, t, 0)}`); return undefined; });
define('sys_param', (_g, s, t) => (s[t] === 'count' ? 0 : ''));
define('sys_callstack', () => []);
define('sys_os_paused', (g) => g.p.hidden());
// Console SDKs: only reachable on consoles (games check os_type first). Calling one fails loudly.
family('sys_psn', 'psn_', {});
family('sys_switch', 'switch_', {});
// Deltarune's shader_replace_simple DLL swaps D3D11 shaders at runtime (only its dead live-reload path
// does). Behave like the DLL failed to load: nothing is ever replaced, so sync has nothing to rebind.
define('sys_srs', (_g, s, t) => (s[t] === 'raw' ? 'shader_replace_simple is unavailable in krplayer' : 0));

/** GM datetimes are days since 1899-12-30, like OLE automation dates. */
const EPOCH = Date.UTC(1899, 11, 30);
function dateTime(d: Date): number { return (d.getTime() - d.getTimezoneOffset() * 60000 - EPOCH) / 86400000; }
function fromDateTime(v: number): Date { const d = new Date(EPOCH + v * 86400000); return new Date(d.getTime() + d.getTimezoneOffset() * 60000); }
define('cam_screen_save', () => { throw new NotImplemented('screen_save is not supported in krplayer (no file to write a PNG to)'); });
define('cam_screen_save_part', () => { throw new NotImplemented('screen_save_part is not supported in krplayer (no file to write a PNG to)'); });
