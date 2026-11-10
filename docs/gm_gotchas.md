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

## Bytecode / data.win (observed, ch1_ribbit_mod: a mod of the 2018 Deltarune Ch1, bytecode 16, GMS2 pre-2.3)
GEN8 says 2.0.0.0 and there is no SEQN/FEAT/TGIN chunk. `fmt.gms23` is false.
* **FUNC's first-occurrence address points at the `call` instruction itself**, not at the reference word after it (2.3+). Walking from `first - 4` lands mid-chain and leaves the file.
  * Repro: FUNC `scr_litemcheck` first = 0x630ee0, and the word there is `d9020001` (`call.i argc=2`).
* **Scripts are top-level code entries (`gml_Script_<name>`) called by the script's own name** (`call scr_litemcheck`), with no `gml_Script_` function. gm2kr makes each a function keyed by the SCPT name.
* **2D arrays are one index, `i * 32000 + j`**, with `chkindex` (break -1, no stack effect) after each index part. gm2kr imports `a[i, j]` as `a[i][j]`, as GMS2.3's project importer does, but only for pre-2.3 data.
  * Repro: `scr_itemshift_temp`: `pushi -1; pushi 12; chkindex; push.i 32000; mul.i.i; pushbltn argument1; conv; chkindex; add.i.i; pop.v.i [array]tempitem`.
* **Texture pages are plain PNGs** (8-bit RGBA), not QOI.
* **Every GMS1-imported object has a PreCreate event (type 14)** whose body is just `event_inherited()`. It runs right before Create (`evt_pre_create`).
* **Room instances have a second code entry: pre-create code** (bytecode 16+, the field after `rotation` in a ROOM instance entry). It holds the room editor's per-instance variable overrides (`gml_RoomCC_<room>_<n>_PreCreate`) and runs after the object's PreCreate event, before Create, so it overrides the object's variable defaults. Dropping it leaves every override at the object default.
  * Repro: Ch2 `room_schoollobby` south `obj_doorAny` (#100954): `obj_doorparent` PreCreate sets `doorRoom = room_next(room)` (`room_alphysclass`); the instance's PreCreate code sets `doorRoom = room_town_school; doorEntrance = 24`.
* **Sprites added by the mod tool have odd TPAG items.** Some stretch a 1x1 page rect to the whole frame (`spr_puzzlemaster_beanie`: sw 1, tw 11). Others overhang their bounding box by a pixel (`spr_youb_attack`: tx 11 + tw 63 > bw 63). GM draws the page rect stretched to (tx, ty, tw, th). gm2kr does the same with nearest sampling and clips to the frame.
* **An empty script is a zero-length code entry whose start address is the next entry's.** `gml_Script___init_background` (length 0) starts where `gml_Script___background_get_element` (1232 bytes) does. Grouping entries by start address (as for 2.3 child functions) made the empty one the block head, and the real script decompiled to nothing; `background_*` compat calls then failed with "trying to index a variable which is not an array" (`room_field_checkers1`).
* **GMS1 view arrays are still builtins.** VARI lists `view_xview`, `view_yview`, `view_wview`, `view_hview` and `view_object` with id -6 (builtin), and the mod tool's code reads them as `push.v self.view_xview [array]` (`obj_checkersfog` Draw in `room_field_checkers2`). krplayer maps `view_*view[i]`, `view_angle[i]` and `view_object[i]` to view i's camera.
* **`other` is the instance itself in ordinary events** (step, draw, alarm...), not `noone`: `obj_shop2` Draw does `draw_circle(131, 79, 12 + other.rng * 1.25, 0)` outside any `with` (`room_shop2`).
* **An embedded sound can have audio id -1** (`snd_pombark`: flags 0x65, group 1), meaning no data, not an external file. It's emitted with `src: ""` and plays nothing.
* **A call's result is sometimes never popped.** In `obj_dustpile_susie` Draw, `call draw_sprite_ext` is followed directly by the next statement with no `popz`. This is most likely from the mod tool's compiler. When an `if` statement starts with plain calls still on the stack, gm2kr emits them as statements.
* **Included file names can be built at runtime**, e.g. `snd_init("keygen" + string(round(random_range(1, 5))) + ".ogg")` in `obj_crackintro`. So gm2kr also keeps audio whose name starts with a 4+ character string literal when its extension is a literal too.
* **`buffer_get_surface` bytes are RGBA**: `obj_vaporized_new` reads each pixel as a u32 and uses `& 255` as red. The old signature is `(buffer, surface, mode, offset, modulo)`.
* **Real division by zero doesn't error**: `/` gives inf, -inf or NaN (0/0), which then flows on, and drawing at a NaN position draws nothing. `obj_crackintro` Draw sets `b = sin((30 * i + a2) / 480)`, which is exactly 0 at `i = 0, a2 = 0`, then draws at `sin(a2 / b)`. That's 0/0 on the first frame, and the original runner shows the screen fine. `div` and `mod` by zero still fail in krplayer, which is assumed rather than observed.
* **Font sizes are points at 96 DPI**: every TTF-based font in FONT has a glyph height of 4/3 × its size (`fnt_main` 12 → 16 px). `font_add` sizes are rasterized the same way.

## Bytecode / data.win (observed, Deltarune Chapter 2, bytecode 17, GMS2.3+ compiler)
* **`popenv`'s exit form is the 24-bit operand `0xf00000`.** `return`/`exit` inside `with` leaves the with first: `pop local.$$$$temp$$$$; popenv <exit>; push local.$$$$temp$$$$; ret`. The branch offset field is 23 bits, so testing `w & 0x7fffff` never matches it.
  * Repro: `scr_findactor`: `with (903) { ...; return __foundactor; }`.
* **Access kind 0xe0 reads a room instance by id**: the instance-type operand is the id minus 100000. `push.v 2269.y [instance]` is `(102269).y` (`gml_RoomCC_room_dw_cyber_teacup_final_0_PreCreate`, which also stores `jumpToRide = 102269`).
* **`++x` / `x++` as values**: prefix is `x; push 1; add; dup.v 0; pop x` (the copy left is the new value), postfix is `x; dup.v 0; push 1; add; pop x` (the old value).
  * Repro: `obj_gms_debug_failsafe` Step: `if (!debug_mode || ++x > xstart + 3)`.
* **`exit` inside `repeat` pops the repeat counter first** (`popz.i; exit`), like a switch value (`obj_fakespare` Draw).
* **An entry can end with `if (c) exit;`**: the `bf` targets the end of the code, so that last `exit` isn't the implicit one (`obj_sneo_heartattack` Step ends `if (heart_health < 1) exit;`).
* **try / catch** is `push finally_off; push catch_off; call @@try_hook@@; popz; body; b U; C: pop local.e; call @@try_unhook@@; popz; catch body; call @@finish_catch@@; popz; b F; U: call @@try_unhook@@; popz; F:`. The offsets are byte offsets gm2kr doesn't need: the layout gives the same addresses (`obj_tensionbar` Draw, which catches a failing `global.tensionselect` read).
* **PATH entries** are name, smooth, closed, precision, then an inline list (not pointers) of `(x, y, speed)` floats. 14 paths in Ch2, e.g. `path_tasquePaintings_tasque` with speed 4 at every point.
* **SHDR keeps GLSL ES sources** (with GameMaker's prelude: `gm_Matrices`, `gm_BaseTexture`, `DoAlphaTest`...), even in the Windows build. The type field has its top bit set (`0x80000001`).
* **Path layers (type 0) have no runtime data**, and **a tile layer can have no tile set** (-1, `room_debug_battle` layer `TILES`): GM draws nothing, but code can still look the layer up.
* **Mouse events are event type 6**: subtypes 0-2 held (left/right/middle), 3 none, 4-6 pressed, 7-9 released, 10/11 enter/leave, 50-58 global held/pressed/released, 60/61 wheel up/down (`obj_poppup_ad` uses 4).
* **The game's setup room isn't the first room.** `room_gms_debug_failsafe` goes to `ROOM_INITIALIZE`, whose `obj_initializer2` runs `scr_gamestart`. A debug warp on the first room change skips it (`global.darkzone not set`); warp with `after=ROOM_INITIALIZE`.
* **`layer_tile_*` setters on a missing element do nothing.** Ch2's GMS1 compat script `tile_get_ids_at_depth` starts its result as `[-1]` and returns that when no tiles are at the depth; `obj_battlealphaer` and others then call `tile_set_alpha(-1, ...)` every frame in normal play (`room_dw_cyber_music_bullet`).
* **`vertex_format_add_textcoord`** (Ch1) and **`vertex_format_add_texcoord`** (Ch2) are both real names.

## Runtime (observed in Deltarune)
* **Layer setters on a missing layer do nothing.** Ch2 `obj_controller_tasquePaintingsRevisit` Create calls `layer_set_visible("reference", 0)`, but `room_dw_mansion_tasquePaintings` has no `reference` layer; it runs on every revisit in normal play (walk left from `room_dw_mansion_traffic`). krplayer ignores `layer_set_visible`, `layer_depth`, `layer_x/y/hspeed/vspeed`, `layer_destroy` and `layer_script_begin/end` on a missing layer. Getters give the HTML5 runner's defaults: `layer_get_visible` undefined, `layer_get_depth` -1, `layer_get_x/y/hspeed/vspeed` 0, `layer_get_all_elements` `[]`, `layer_*_get_id` -1 (see "Missing resources" below). The original runner's debug-output warning isn't reproduced.
* **At equal depth, the newest instance draws first.** GM adds new layer elements at the front, so a later-created instance draws *before* (under) older ones at the same depth. Deltarune Ch1 relies on it: in `room_town_krisyard`, `obj_carcutscene`'s alarm 5 creates an `obj_writer` at depth 0, and carcutscene's draw (also depth 0) reads `myd.stringmax`, which only the writer's draw sets. Drawing oldest-first crashes with "variable stringmax not set before reading it".
* **All of a room's instances exist before any create event runs.** `obj_mainchara` is first in `room_krishallway`'s creation order, yet its create event reads `obj_markerA.x` (placed later). The create events (then creation code) run in the room's creation order, which is the room's instance list, not layer order.
* **The application surface isn't resized on room change, and the first view's port is stretched to fill it.** Deltarune Ch1's `room_krisroom` (also `room_torroom`, `room_krishallway`) has view 0 at 320×240 with a 640×320 port, yet shows as 4:3 in a 640×480 window. Resizing the app surface to the port each room squashes the view vertically. (Whether GM sizes it from the first room's port at game start is still assumed; krplayer uses the project's default width/height.)
* **A camera whose border is at least half its view size centres on the target** instead of scrolling at the border (HTML5 runner `CCamera.Update`; it uses `floor(x)`/`floor(y)` of the target's origin, clamps to the room left/top first, then applies the speed limit; only visible views' cameras update). Deltarune's 320×240 views use border 160×240, so every overworld room centres on Kris. Repro: Ch1 `room_schoollobby` at plot 3 (from `room_alphysclass`, talk to Noelle, choose "Yes, ask", leave): the cutscene moves Kris to `obj_markerB` (110, 200), so the view should be at y = 80. Scrolling at the border instead puts it at y = 180, and the start of the cutscene is drawn in the wrong place.
* **`obj.var = v` when no instance of `obj` exists does nothing**; only reading it is an error. Deltarune's `scr_controls_default` writes `obj_gamecontroller.gamepad_shoulderlb_reassign` from `obj_time`'s create event, which runs (via `obj_initializer2`) before `obj_gamecontroller` is created.

## Runtime (assumed, verify with trace tests)
* Real comparisons use `math_get_epsilon()` (default 0.00001): `0.1 + 0.2 == 0.3` is true.
* **A string compared with a real is read as a number** (all of `== != < <= > >=`): it's trimmed, then its leading number is taken, so `"5" > 0`, `"5" == 5` and `"5abc" == 5` are true. Ordering a non-numeric string against a real is an error ("unable to compare"); `==` just gives false. Repro: DR ch2 `obj_ch2_scene6` calls `c_wait("5")`, and `obj_cutscene_master` Step then checks `cs_wait_amount > 0` / `cs_wait_timer >= cs_wait_amount`, which the original runner runs without error. The details come from the HTML5 runner's `yyCompareVal` (`g_NumberRE`) and haven't been checked against the VM.
* **`undefined` ordered against a real is false, not an error**: `undefined > 0`, `undefined < 0`, `<=`, `>=` are all false (`undefined <= undefined` is true). Repro: DR ch2 `scr_monsterattackidcount` has no `return` (bytecode: `call scr_monsterattacknamecount; popz; exit`), so it returns undefined, and `obj_dbulletcontroller` Step (Virovirokun invader fleet) does `cars = scr_monsterattacknamecount("CarChase") > 0 || scr_monsterattackidcount(16) > 0`, which the original runner runs without error. From the HTML5 runner's `yyCompareVal` (returns -2, which `yyfgreater` etc. turn into false); not checked against the VM. Undefined against a string isn't modelled (still an error).
* `string()` of a non-integer real prints 2 decimals (`string(1.5)` = `"1.50"`).
* `obj.var = v` writes to every instance of `obj`; reading `obj.var` reads the first instance.
* Copy-on-write follows the HTML5 runner's model (copy when the owner differs; no reference counts), so writing an array that only one variable holds, through another variable, copies it like a shared one.
* Room changes happen at the end of the event phase that asked for them (the rest of the step and that frame's drawing are skipped), as the HTML5 runner checks after begin step, alarms, step and end step.
* Async save/load events fire at the start of the next step.
* **Missing resources are ignored, not errors** (HTML5 runner; error_audit.md has the source lines). Repro for each: call it with an id that doesn't exist, e.g. `audio_sound_gain(999, 0.5, 0)`. Not checked against the VM, except surfaces, which the VM does treat as fatal ("Trying to use non-existing surface") and krplayer keeps as errors.
  * Sounds: `audio_play_sound` returns -1, `audio_sound_gain`/`audio_sound_pitch` do nothing, `audio_sound_get_gain` 0, `audio_sound_get_pitch` 1.
  * Sprites: `draw_sprite*` draw nothing; `sprite_get_width/height/number/xoffset/yoffset/bbox_*` return 0; `sprite_set_offset` does nothing.
  * Layer elements (`layer_background_*`, `layer_sprite_*`, `layer_tile_*`, `tilemap_*`): setters and destroy do nothing; each getter has its own default (e.g. `layer_sprite_get_x` 0, `_get_xscale` 1, `_get_sprite`/`_get_index` -1, `layer_background_get_visible` true, `tilemap_get_x` -1). `draw_tilemap` of a missing tilemap draws nothing. Repro: DR ch2 `obj_battleLayerHighlight` Draw does `draw_tilemap(layer_tilemap_get_id(layer_get_id("TILES_BATTLEBORDER")), 0, 0)` in rooms without that layer (e.g. `room_dw_cyber_music_fight`), so the id is -1 (inferred from the shipped game running those rooms; runner source not checked).
  * Cameras: `camera_get_view_*` return -1, `camera_set_view_*` do nothing.
  * Paths: `path_get_x/y/speed` -1, `path_get_length/number/kind` and `path_get_point_*` 0 (also for a point out of range), `path_get_closed` true, `path_get_precision` 8; `path_add_point`/`path_set_*`/`path_clear_points` do nothing.
  * Buffers: `buffer_read` of a missing buffer gives 0; reading at or past the end gives `""` for strings and -3 (`eBuffer_OutOfBounds`) otherwise; a wrap buffer wraps first.
  * `draw_set_font` stores any id; text in a missing font draws in the fallback font.
* **`ini_open` while an ini is open closes (and saves) the old one** instead of failing. Repro: `ini_open("a.ini"); ini_write_string("s", "k", "v"); ini_open("b.ini")` leaves `a.ini` written.
* **`event_user(n)` outside 0-15 does nothing.**
* **Builtin arguments read numeric strings as numbers**: `sprite_get_width("0")` is `sprite_get_width(0)`; bool arguments also take `"true"`/`"false"`. Same pattern as string/real comparison (`yyGetReal`/`yyGetBool`). Operators don't do this: `"5" - 1` is still an error. Some builtins still read their arguments with plain `real()` and stay strict.
* Outside Room fires when the instance's bbox leaves the room. krplayer fires it once on leaving; whether GM repeats it every step while outside is unverified.

* `sprite_add` sprites get a rectangle mask with an automatic bbox and animate one frame per step. A file that isn't shipped returns -1 (ch1_ribbit_mod asks for `spr/spr/spr_status_ailments.png`, which it doesn't ship).
* `sprite_add`/`sprite_replace`/`background_replace` with removeback make every pixel of the bottom-left pixel's colour (RGB) fully transparent. smooth (with removeback) is not implemented and fails loudly (ch1_ribbit_mod `PROCESS_LOGO` uses removeback without smooth).
* `get_string` / `get_integer` return the default when cancelled (or, for integers, when the input isn't a number).

* Paths: positions advance by `path_speed * point speed% / (length * path_scale)` each step after built-in motion; relative paths put their first point at the instance; `path_end` fires at every end, and end action 0 stops the path. `direction` isn't changed. Smooth paths use quadratic pieces between segment midpoints, subdivided `precision` times; GM's exact curve is unverified.
* `ds_priority` ties go to the earliest added value.
* GML `catch` gets `{message, longMessage, script, stacktrace}` for runtime errors; GM's message text differs from krplayer's.

## Known krplayer divergences (not fixes, gaps)
* Asset references are plain indices, not GM 2023.8+ typed refs (`typeof(spr_x)` gives `"number"`, not `"ref"`).
* `random()` is deterministic per run like GM (fixed seed), but not GM's sequence.
* `effect_create_*` is drawn as an approximation (see `drw_effect`).
* int64 literals become reals (exact up to 2^53); `typeof` never says `"int64"`.
* Precise masks are tested per pixel (at pixel centres) by place_*/instance_place/collision events/collision_point/collision_rectangle, but `collision_circle`/`collision_line` still test the other instance's bounding box; `collision_ellipse` tests its own bounding box.
* Deltarune's diagonal walls (`obj_sul`/`obj_sur`/`obj_sdl`/`obj_sdr`, children of `obj_solidblock`) are precise triangles. Their bbox is the whole square, so treating them as boxes blocks movement near slopes (repro: Ch1 `?room=room_torbathroom`, hold left; with box masks Kris doesn't move).
* Timelines aren't implemented (Deltarune Chapters 1 and 2 have none: their TMLN chunks are empty).
* The software renderer (headless screenshots) can't run GLSL: shaders compile to handles and drawing ignores them (it warns once). Only WebGL runs them.
* **GM's GLSL ES shaders don't have to be valid GLSL ES 1.00.** Desktop GM runs them through HLSL, so Appendix A limits don't apply: Ch2 `shd_pal_swapper` has `for(float i = corner.y; i < u_Uvs.w; i += u_pixelSize.y)`, which WebGL rejects as 1.00 ("Loop index cannot be initialized with non-constant expression"). Repro: compile that fragment shader in WebGL as 1.00, then with `#version 300 es` (plus the in/out/texture renames). krplayer compiles as 3.00. Headless runs never compile GLSL, so only the browser catches these.
* Primitives take their alpha from the first vertex of each triangle/line (GM interpolates per vertex). `surface_getpixel*` reads the whole surface back each call.
* `try` with a `finally` block, and `throw`, aren't implemented (refused at load). Layer scripts only work on non-instance layers.
* krplayer reports `os_type` = `os_windows`, so games take their PC code paths.
* `ds_list_write` / `ds_map_find_first` order use krplayer's own formats/insertion order, not GM's hash order.
* Pre-2.3 arrays alias 1D and 2D access (`a[j]` is `a[0, j]`), but imports read `a[i, j]` as `a[i][j]`, so code that mixes the two forms on one array diverges.
* `matrix_set` only accepts the identity matrix and `vertex_submit` isn't implemented. Both fail loudly (ch1_ribbit_mod's `obj_boingball` easter egg uses them).
* `screen_save` fails when called. `sprite_add`/`font_add` removeback/smooth aren't supported, and precise `sprite_collision_mask` only works on `sprite_add` sprites.
