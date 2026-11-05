# GameMaker gotchas
Quirks found while reimplementing the runtime and the data.win format. Each has a short repro.
"Observed" means seen in a real data.win; "assumed" means implemented from references and still needs checking against GameMaker.

## Bytecode / data.win (observed, GM 2024, bytecode 17)
* **Call arguments are evaluated right to left.** The VM pushes the last argument first: `draw_text(10, 10, _points)` compiles to `push _points; push 10; push 10; call`. krplayer's compiler pushes arguments last-to-first too, so side effects (e.g. two `random()` calls in one call) happen in GM's order.
  * Repro: `show_debug_message(string(a()) + string(b()))` vs `f(a(), b())` where `a`/`b` log; in the call, `b` logs first.
* **The assigned value is evaluated before the target.** `alarm[0] = 120` on `obj_game` compiles to `push 120; pushref obj_game; pushi -9; pushi 0; pop.v.v [array]alarm`. krplayer's `var_set` evaluates the value, then the instance, then the index.
* **Instance refs on the stack are marked with `pushi -9`.** `obj_player.image_angle` is `pushref obj_player; pushi -9; push.v [stacktop]image_angle`: the -9 says "the real instance is below".
* **`pop.i.v` means the value is on top.** In compound assignments (`obj_game._points += 50`) the target is `dup`ed and the store is `pop.i.v`, with the new value above the instance. Plain stores (`pop.v.*`) have the target above the value.
* **`dup` counts in units of the instruction type's size.** `dup.i 4` duplicates 5 × 4 = 20 bytes: a 16-byte instance ref plus the 4-byte -9 marker.
* **Self variables use instance type -6 ("builtin") as well as -1.** `_points = 0` in a create event is `pop.v.i builtin._points`. Treat -6 like -1.
* **`pushref` asset types:** 0 object, 1 sprite, 3 room… and **6 = font** (`draw_set_font(fnt_main)` pushes `0x06000000`). gm2kr fails loudly on other types until they're seen.
* **`@@Other@@` / `@@This@@` are pseudo-function calls** returning `other`/`self`, e.g. `instance_destroy(other)` is `call @@Other@@ argc=0; call instance_destroy argc=1`.
* **FUNC's first-occurrence address points at the reference word**, one word after the `call` instruction; VARI's points at the instruction itself.
* **ROOM gained a pointer in GM 2024.13** (after the tiles pointer). gm2kr detects it by where the backgrounds list starts.
* **OBJT gained a "managed" bool after `visible` (GM 2022.5).** Detected by probing which layout lines up with the event list.
* **No-parent is -100**, not -1, in GMS2.3+ OBJT.
* **SHDR can hold null pointers** (a count of 3 with three zero pointers when shaders were stripped). An all-null list is empty.
* **Texture pages are "2zoq"**: `2zoq`, u16 width, u16 height, u32 uncompressed size, then a bzip2 stream of GM's QOI variant (`fioq`). Pages also hold GM's built-in particle shapes, unreferenced by any sprite.
* **AGRP can hold null entries** (GM 2024: a count of 1 and a zero pointer). They're groups with no name.

## Bytecode / data.win (observed, Deltarune Chapter 1, bytecode 17, GMS2.3+ compiler, no typed refs)
* **`callv` is opcode 0x99** (method calls: args, then the instance, then the function value; `callv argc`). UndertaleModTool's 0xDA belongs to older bytecode.
  * Repro: `inst.f(1)` compiles to `push 1; push inst; dup.v 0; push.v [stacktop]f; callv 1`.
* **`pushenv` jumps to the matching `popenv` itself**, not past it; `popenv` jumps back to the body start (or to itself for an empty `with`).
  * Repro: `with (s) {}` is `push s; pushi -9; pushenv P; P: popenv P`.
* **Short-circuit chains share one false label.** `a && b && c` is `a; bf F; b; bf F; c; b E; F: push.e 0; E:` (the constant is a `push.e`, not a `pushi`). `||` is the same with `bt` and `push.e 1`.
* **`for` loops: `continue` is a `b` to the step**, which sits right before the closing `b` to the condition. A `while` loop's `continue` is a `b` to the condition. gm2kr tells them apart by finding a step with no branches into or out of it.
* **Empty `else {}`** leaves a `b` to the very next instruction.
* **`switch`** is `value; (dup.v 0; case; cmp eq; bt Lk)*; b D; bodies; E: popz.v`. With no default, `b D` goes straight to the `popz`. `break` is a `b` to that `popz`.
* **`repeat (n)`** is `n; dup.i 0; push 0; cmp le; bt E; T: body; push.i 1; sub; dup.i 0; conv.i.b; bt T; E: popz.i`.
* **`dup` has a swap form.** `dup.t n` with byte 1 bit 7 set moves the top `n` units below the next `(b1 & 0x7f) >> 3` units, instead of copying.
  * Repro: `_loading.show_loading_screen(_target_chapter, 80)` uses `dup.v 2 swap136` to bring `_loading` above the two arguments.
* **Multi-dimensional arrays** use access kinds 0x10 (`[pushaf]`: push the row) and 0x90 (`[popaf]`: the row, for writing), then `pushaf`/`popaf` (break -2/-3) for the final index. `savearef`/`restorearef` (-8/-9) bracket compound assignments and don't touch the stack.
  * Repro: `a[1][2] = 5` is `push 5; pushi -1; pushi 1; push.v [popaf]a; pushi 2; popaf`.
* **Function references are `push.i` with a FUNC occurrence.** The 32-bit operand belongs to the occurrence chain, so its value means nothing; the function is the FUNC entry. Script ids passed as plain numbers (`script_execute(340)`) are SCPT indices.
* **Functions are child code entries** inside their parent's bytecode block (`offset > 0`). The parent jumps over each child's body with a `b`, then defines it: global scripts with `self.name = method(-1, fn)` (self is the global scope there), events with `name = method(-1, fn)`.
* **Struct literals** call `@@NewGMLObject@@(method(@@NullObject@@(), ctor), args...)` and first cache the method in a static `___struct___N` (instance type -16), via `dup; pop`.
* **`obj.method()`** is `@@GetInstance@@(obj)` then a `callv` on it.
* **`setowner` takes a constant per written variable**, not per function. Arrays are copy-on-write through it: `push.i 168386; setowner` before writing `bspeed[i][j]`, `push.i 168385; setowner` before `bx[i][j]` in the same event (`obj_deathanim` Step). krplayer derives one owner token per variable (scope + name) instead of storing the constants.
* **`argument0`..`argument15` and `argument_count`** are built-in variables (instance type -15 for the numbered ones); `argument[i]` is an array access on `argument`.
* **SOND entries are 36 bytes** (name, flags, type, file, effects, volume, pitch, audio group, audio id). Audio id -1 means a file next to the game (`file` is its name, e.g. `snd_closet_fall.ogg`); group 1+ audio lives in `audiogroupN.dat`, a FORM with its own AUDO chunk.
* **GMS2 legacy tiles reference sprites**, not backgrounds. Asset layers store a pointer list (legacy tiles, sprites, sequences...) whose length you only learn from where the first list starts. Tiles whose sprite was deleted keep sprite -1 (GM draws nothing).
* **Sprite frames can have a null texture** when the build strips them (console button prompts in the PC build). gm2kr keeps a blank frame of the sprite's size.
* **A room's views only apply when room flag bit 0 is set**; views keep their own "enabled" flag either way.

## Runtime (observed in Deltarune)
* **At equal depth, the newest instance draws first.** GM adds new layer elements at the front, so a later-created instance draws *before* (under) older ones at the same depth. Deltarune Ch1 relies on it: in `room_town_krisyard`, `obj_carcutscene`'s alarm 5 creates an `obj_writer` at depth 0, and carcutscene's draw (also depth 0) reads `myd.stringmax`, which only the writer's draw sets. Drawing oldest-first crashes with "variable stringmax not set before reading it".
* **All of a room's instances exist before any create event runs.** `obj_mainchara` is first in `room_krishallway`'s creation order, yet its create event reads `obj_markerA.x` (placed later). The create events (then creation code) run in the room's creation order, which is the room's instance list, not layer order.
* **`obj.var = v` when no instance of `obj` exists does nothing**; only reading it is an error. Deltarune's `scr_controls_default` writes `obj_gamecontroller.gamepad_shoulderlb_reassign` from `obj_time`'s create event, which runs (via `obj_initializer2`) before `obj_gamecontroller` is created.

## Runtime (assumed, verify with trace tests)
* Real comparisons use `math_get_epsilon()` (default 0.00001): `0.1 + 0.2 == 0.3` is true.
* `string()` of a non-integer real prints 2 decimals (`string(1.5)` = `"1.50"`).
* `obj.var = v` writes to every instance of `obj`; reading `obj.var` reads the first instance.
* Copy-on-write follows the HTML5 runner's model (copy when the owner differs; no reference counts), so writing an array that only one variable holds, through another variable, copies it like a shared one.
* Room changes happen at the end of the event phase that asked for them (the rest of the step and that frame's drawing are skipped), as the HTML5 runner checks after begin step, alarms, step and end step.
* Async save/load events fire at the start of the next step.
* Outside Room fires when the instance's bbox leaves the room. krplayer fires it once on leaving; whether GM repeats it every step while outside is unverified.

## Known krplayer divergences (not fixes, gaps)
* Asset references are plain indices, not GM 2023.8+ typed refs (`typeof(spr_x)` gives `"number"`, not `"ref"`).
* `random()` is deterministic per run like GM (fixed seed), but not GM's sequence.
* `effect_create_*` is drawn as an approximation (see `drw_effect`).
* int64 literals become reals (exact up to 2^53); `typeof` never says `"int64"`.
* Precise masks are tested per pixel (at pixel centres) by place_*/instance_place/collision events/collision_point/collision_rectangle, but `collision_circle`/`collision_line` still test the other instance's bounding box; `collision_ellipse` tests its own bounding box.
* Deltarune's diagonal walls (`obj_sul`/`obj_sur`/`obj_sdl`/`obj_sdr`, children of `obj_solidblock`) are precise triangles. Their bbox is the whole square, so treating them as boxes blocks movement near slopes (repro: Ch1 `?room=room_torbathroom`, hold left; with box masks Kris doesn't move).
* Paths and timelines aren't implemented (Deltarune Chapter 1 has none: its PATH and TMLN chunks are empty).
* krplayer reports `os_type` = `os_windows`, so games take their PC code paths.
* `ds_list_write` / `ds_map_find_first` order use krplayer's own formats/insertion order, not GM's hash order.
