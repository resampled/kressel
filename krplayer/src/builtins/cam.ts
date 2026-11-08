// Camera, views and window (cam_*), control functions (ctr_*) and system (sys_*).

import { define, family, n, b, str } from './registry.ts';
import { GmlError, NotImplemented, real } from '../value.ts';
import { newCamera, type Camera } from '../runtime/layers.ts';
import type { Game } from '../runtime/game.ts';
import { gstr } from './opr.ts';
import { DsMap } from '../runtime/data.ts';

function cam(g: Game, v: unknown): Camera {
  const c = g.cameras[real(v as number)];
  if (!c) throw new GmlError(`camera ${String(v)} does not exist`);
  return c;
}
define('cam_get', (g, s, t) => {
  const c = cam(g, s[t - 1]);
  switch (s[t]) {
    case 'x': return c.x; case 'y': return c.y; case 'width': return c.w; case 'height': return c.h; case 'angle': return c.angle;
    case 'border_x': return c.bx; case 'border_y': return c.by; case 'speed_x': return c.sx; case 'speed_y': return c.sy; case 'target': return c.target;
  }
  throw new GmlError(`camera_get_view_${String(s[t])} unknown`);
});
define('cam_set_pos', (g, s, t) => { const c = cam(g, s[t]); c.x = n(s, t, 1); c.y = n(s, t, 2); return undefined; });
define('cam_set_size', (g, s, t) => { const c = cam(g, s[t]); c.w = n(s, t, 1); c.h = n(s, t, 2); return undefined; });
define('cam_set_target', (g, s, t) => { cam(g, s[t]).target = n(s, t, 1); return undefined; });
define('cam_set_border', (g, s, t) => { const c = cam(g, s[t]); c.bx = n(s, t, 1); c.by = n(s, t, 2); return undefined; });
define('cam_set_speed', (g, s, t) => { const c = cam(g, s[t]); c.sx = n(s, t, 1); c.sy = n(s, t, 2); return undefined; });
define('cam_set_angle', (g, s, t) => { cam(g, s[t]).angle = n(s, t, 1); return undefined; });
define('cam_create', (g) => { const id = g.cameras.length; g.cameras.push(newCamera(id)); return id; });
define('cam_view_get', (g, s, t) => {
  const v = g.views[n(s, t, 1)];
  if (!v) throw new GmlError(`view ${String(s[t - 1])} out of range`);
  switch (s[t]) {
    case 'visible': return v.visible; case 'camera': return v.camera; case 'xport': return v.px; case 'yport': return v.py;
    case 'wport': return v.pw; case 'hport': return v.ph; case 'surface_id': return v.surface;
  }
  throw new GmlError(`view_get_${String(s[t])} unknown`);
});
define('cam_view_set', (g, s, t) => {
  const v = g.views[n(s, t, 1)], x = s[t - 2];
  if (!v) throw new GmlError(`view ${String(s[t - 1])} out of range`);
  switch (s[t]) {
    case 'visible': v.visible = b(s, t, 2); break; case 'camera': v.camera = real(x); break;
    case 'xport': v.px = real(x); break; case 'yport': v.py = real(x); break; case 'wport': v.pw = real(x); break; case 'hport': v.ph = real(x); break;
    case 'surface_id': v.surface = real(x); break;
    default: throw new GmlError(`view_set_${String(s[t])} unknown`);
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
define('sys_alert', (g, s, t) => { g.p.log(`show_message: ${gstr(g, s[t])}`); return undefined; });
define('sys_confirm', () => true);
define('sys_error', (g, s, t) => { throw new GmlError(`show_error: ${gstr(g, s[t])}`); });
define('sys_game_end', (g) => { g.ended = true; g.endMessage = 'Game ended.'; return undefined; });
define('sys_game_restart', (g) => { g.ended = true; g.endMessage = 'game_restart is not supported yet: reload the page.'; return undefined; });
define('sys_game_change', (g, s, t) => { g.ended = true; g.endMessage = `The game switched to ${str(s, t, 0)} ${str(s, t, 1)}: load that project to continue.`; return undefined; });
define('sys_device', (g, s, t) => (s[t] === 'language' ? 'en' : g.data.maps.add(new DsMap())));
define('sys_now', () => dateTime(new Date()));
define('sys_date', (_g, s, t, argc) => {
  const d = argc > 1 ? fromDateTime(n(s, t, 1)) : new Date();
  switch (s[t]) {
    case 'year': return d.getFullYear(); case 'month': return d.getMonth() + 1; case 'day': return d.getDate();
    case 'hour': return d.getHours(); case 'minute': return d.getMinutes(); case 'second': return d.getSeconds(); case 'weekday': return d.getDay();
  }
  throw new GmlError(`date_get_${String(s[t])} unknown`);
});
define('sys_url_open', (g, s, t) => { g.p.log(`url_open: ${str(s, t, 0)}`); return undefined; });
define('sys_param', (_g, s, t) => (s[t] === 'count' ? 0 : ''));
define('sys_callstack', () => []);
define('sys_os_paused', (g) => g.p.hidden());
// Console SDKs: only reachable on consoles (games check os_type first). Calling one fails loudly.
family('sys_psn', 'psn_', {});
family('sys_switch', 'switch_', {});

/** GM datetimes are days since 1899-12-30, like OLE automation dates. */
const EPOCH = Date.UTC(1899, 11, 30);
function dateTime(d: Date): number { return (d.getTime() - d.getTimezoneOffset() * 60000 - EPOCH) / 86400000; }
function fromDateTime(v: number): Date { const d = new Date(EPOCH + v * 86400000); return new Date(d.getTime() + d.getTimezoneOffset() * 60000); }
define('cam_screen_save', () => { throw new GmlError('screen_save is not supported in krplayer (no file to write a PNG to)'); });
