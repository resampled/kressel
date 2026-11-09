# krplayer error audit

krplayer must never be stricter than GameMaker. Unmodified Deltarune never shows a GM error dialog, so a GML error on a path the real game runs is almost always a krplayer bug. This file records which of krplayer's errors are known to match GM and which are guesses.

## Error kinds (`krplayer/src/value.ts`)

| Class | Meaning | GML `catch` | Crash label |
|---|---|---|---|
| `GmlError` | GM raises this too. Needs evidence: known VM behaviour, or `yyError` in the HTML5 runner. | yes | GML error |
| `Unverified` | krplayer raises it, but nothing shows GM does. Often GM logs a message and carries on. | yes | unverified GML error |
| `NotImplemented` | krplayer lacks the feature (incl. an unknown family member or a krplayer limit such as nesting depth). | no | not implemented |
| plain `Error` | krplayer bug or bad input that isn't GML (bad bytecode, broken project data, debug URL params). | no | internal error |

`errorKind()` (`vm/vm.ts`) gives the label. The player's crash screen and `scripts/playtest.ts` print it.

Rules:
* New GML error sites start as `Unverified`. Promote to `GmlError` only with a cited source, written in a comment next to the throw.
* When an `Unverified` site turns out lenient in GM, implement GM's behaviour (no-op, `-1`, `0`, `undefined`...) and add the repro to `gm_gotchas.md`. Don't add a release-only fallback: the fix is the same either way, and playtests and published games must behave the same.
* The HTML5 runner (github.com/YoYoGames/GameMaker-HTML5) is evidence, not proof. The VM can differ (surfaces: see below). Trace tests against a real VM build are the deciding source.

## How the audit was done

Each of the 123 `GmlError` throws in `krplayer/src` (2026-11-09) was matched to the GM function(s) that reach it. Then the HTML5 runner's version of each function (`develop` branch) was checked for `yyError` (fatal) versus `return` / `debug()` / `console.log` (non-fatal).

## Fixed: errors where the HTML5 runner is lenient (2026-11-09)

These threw in krplayer while the HTML5 runner carries on. All now match the HTML5 runner (defaults per function in gm_gotchas.md, "Missing resources"). They're still unchecked against the VM.

| # | krplayer site | GML | krplayer was | HTML5 runner (now krplayer too) |
|---|---|---|---|---|
| 1 | `runtime/sound.ts` `snd()` | `audio_play_sound`, `audio_sound_gain`, `audio_sound_get_gain`, `audio_sound_pitch`, `audio_sound_get_pitch` on a missing or destroyed sound | error | returns without doing anything (`audio_sound_gain`: `if (voice === null) return;`) |
| 2 | `drw.ts` `spr`, `lks.ts` `lks_sprite_info` / `_set_offset` / `_bbox` (other `spriteOrThrow()` callers, like `sprite_merge` and `sprite_collision_mask`, are still Unverified) | sprite index -1 / missing | error | `draw_sprite`: `if (pSpr != null)` draw, else nothing. `sprite_get_width`: returns 0 |
| 3 | `builtins/dat.ts` `dat_ini_open` | `ini_open` while an ini is open | error | closes the open one first (`if (g_IniFile) ini_close();`) |
| 4 | `builtins/rom.ts` `layer()` | `layer_get_visible`, `layer_get_depth`, `layer_get_x`, `layer_destroy`, `layer_get_all_elements`... on a missing layer | error | `layer_get_depth`: -1. `layer_get_visible`: undefined. `layer_get_x`: 0 |
| 5 | `builtins/rom.ts` `elGet` / `elSet` | `layer_background_*`, `layer_sprite_*`, `layer_tile_*`, `tilemap_*` on a missing element | error | setters do nothing (`layer_sprite_x`: `if (el != null)`), getters return per-function defaults |
| 6 | `builtins/cam.ts` `cam()` | `camera_get_view_*` / `camera_set_view_*` on a missing camera | error | getters return -1, setters do nothing |
| 7 | `builtins/drw.ts` `drw_set_font` | `draw_set_font` with a missing font | error | stores the id without checking |
| 8 | `builtins/ins.ts` `mov_path` | `path_get_*`, `path_add_point`, `path_set_*` on a missing path (`path_start` and `draw_path` are still Unverified) | error | -1 / 0 / true / 8 |
| 9 | `builtins/ins.ts` `ins_event_user` | `event_user(n)` with n outside 0-15 | error | does nothing |
| 10 | `registry.ts` `n()` / `b()` / `opt()` via `value.ts` `argReal` / `argBool` (builtins that call `real()` directly, and all operators, stay strict) | numeric string passed as a real or bool argument, e.g. `draw_sprite(spr, "0", x, y)` | error | `yyGetReal` reads `"5"` as 5; `yyGetBool` reads `"true"`, `"false"` and numeric strings |
| 11 | `dat.ts` `buffer_read`, `runtime/data.ts` `Buffer.read` | `buffer_read` on a missing buffer or past the end | error | missing: 0. Past the end: -3 (`eBuffer_OutOfBounds`), `""` for strings. A partial read that straddles the end is still Unverified |

## Other Unverified sites (no evidence either way yet)

`grep -rn "new Unverified" krplayer/src` lists every site.

* `instance_create_layer` on a missing layer (`runtime/layers.ts` `get()`, also used by `layer = x`). The HTML5 runner `yyError`s here, so it could be promoted to GmlError.

* `vm/vm.ts`: `argument` writes and `argument[i]` past the argument count, built-in 2D array access, built-in variable on a struct, array index above 2^26.
* `runtime/game.ts`: built-in variables used as arrays or not, alarm index outside 0-11, view index outside 0-7, read-only or unknown built-in globals, `room_goto` to a missing room.
* `runtime/instance.ts`: unknown or read-only built-in instance variables.
* `builtins/cam.ts`: view index out of range.
* `builtins/drw.ts`: `matrix_*` given a non-matrix, unknown matrix type, `draw_vertex` outside a primitive, unknown primitive kind, missing shader, missing tilemap.
* `builtins/var.ts`: array/struct/instance argument checks, `array_create` size, `method` on a non-function.
* `builtins/lks.ts`: `background_replace` on a missing background, `sprite_collision_mask` kind.
* `builtins/ins.ts`: instance-only functions called from a struct, path point out of range.
* `builtins/opr.ts` `string_join_ext` with a non-array, `builtins/rom.ts` `room_set_*` on a missing room, `builtins/dat.ts` `buffer_get_surface` size, `runtime/data.ts` `ds_list_read` bad data, buffer overflow.

## Confirmed (GmlError)

* VM-known (the standard GM error dialogs): string + real, non-numeric string ordered against a real, modulo/div by zero, array index out of range or negative, indexing a non-array, variable not set before reading, no instance found for `obj.var`, calling a non-function or non-constructor, `room_goto_next` / `_previous` past the end ("Moving to next room after the last room"), missing ds_* ("Data structure with index does not exist"), `real()` of a non-numeric string, creating an instance of a missing object, `show_error`.
* **Surfaces stay GmlError even though HTML5 is lenient.** `draw_surface` on a missing surface returns silently in the HTML5 runner, but the VM's "Trying to use non-existing surface" is fatal (a common GM crash after surface loss).
* HTML5 `yyError`: `sqrt` of a negative number, `array_get` out of range, `json_parse` parse error, ini read/write with no ini open, text file functions on a bad handle.
* `undefined`, structs, arrays or methods used as a real (`yyGetReal` errors on them). krplayer's `num()` still maps `undefined` to 0 for arguments that accept it.
