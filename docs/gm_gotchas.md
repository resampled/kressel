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

## Runtime (assumed, verify with trace tests)
* Real comparisons use `math_get_epsilon()` (default 0.00001): `0.1 + 0.2 == 0.3` is true.
* `string()` of a non-integer real prints 2 decimals (`string(1.5)` = `"1.50"`).
* `obj.var = v` writes to every instance of `obj`; reading `obj.var` reads the first instance.
* Outside Room fires when the instance's bbox leaves the room. krplayer fires it once on leaving; whether GM repeats it every step while outside is unverified.

## Known krplayer divergences (not fixes, gaps)
* Asset references are plain indices, not GM 2023.8+ typed refs (`typeof(spr_x)` gives `"number"`, not `"ref"`).
* `random()` is deterministic per run like GM (fixed seed), but not GM's sequence.
* `effect_create_*` is drawn as an approximation (see `drw_effect`).
