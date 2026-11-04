# Introduction to scripting in project files
Scripts are represented by JSON arrays inside objects (or anything else that can run scripts), sorta like this:
```json
{
"scripts":[
    ["evt_create",[
     ["var_set",["_lv","variable_name"],0],
     ["fnc_g","custom_function","arg1",["_lv","variable_name"],"arg3"],
     ["ctr_if",["opr_neq",1,-2.5],[
        ["var_set",["_lv","variable_name"],"Value!"]
     ]]
    ]]
]
}
```
This is roughly equivalent to the following GameMaker code:
```gml
// (on create...)
variable_name = 0;
custom_function("arg1", variable_name, "arg3");

if (1 != -2.5) {
    variable_name = "Value!";
}
```
What follows is a list of these opcodes and their arguments. Opcodes labelled as (hidden) are particularly complex features that the editor should hide by default. Opcodes listed as (compat) mostly exist for compatibility reasons and, for the sake of simplicity, should not be used unless absolutely necessary. They often have incomplete or 'dummy block' representations in the editor.

Note that most of these opcodes are (near-)exact representations of how they appear in the editor.
## Categories
* `evt_*` - Events (e.g. create, step, drawgui)
* `ctr_*` - Control (e.g. if, for, doing)
* `fnc_*` - Functions (`fnc_g` calls user-defined functions/scripts; built-ins have their own opcodes)
* `opr_*` - Operators (e.g. eq, neq, gt, math, random, strings, type checks)
* `var_*` - Variables (incl. arrays and structs)
* `ins_*` - Instances (e.g. create, destroy, exists, events)
* `mov_*` - Movement (incl. paths and motion planning)
* `sen_*` - Sensing (collisions and input)
* `lks_*` - Looks (sprite and asset info)
* `snd_*` - Sound
* `drw_*` - Drawing (incl. colours, surfaces, shaders, particles)
* `rom_*` - Rooms (incl. layers, tilemaps, sequences)
* `cam_*` - Camera (incl. views, GUI and window)
* `dat_*` - Files & Data (ds_*, JSON, ini, text/binary files, buffers)
* `sys_*` - System (debug, game end/restart, device, dates)
* `_*` - Declarations 

Built-in function opcodes keep GML's argument order (so imports keep GML's evaluation order). Where one block covers several functions via a dropdown, the variant is a leading `ref` argument, e.g. `["opr_mathop","sqrt",16]`.


# Values
Plain values can often be read directly:

| JSON | GML |
|---|---|
| `-1.35` | `-1.35` |
| `true` / `false` | `true` / `false` |
| `"some string"` | `"some string"` |
| `null` | `undefined` |
| `{"key": "value", "x": -20}` | `{key: "value", x: -20}` |

Arrays work similar, but they function with opcodes so first element must be `_ar`.

Struct values are read the same way, so they may contain opcodes. In `ref` arguments a string is a name rather than a string literal.

Constants like `pi` or `c_red` can be written as plain numbers. Enums and macros should be inlined as their values when converting from data.win.

# Declarations
These opcodes denote values that plain JSON can't express.

They can be used for autofilling in the editor, too.

Can be used anywhere a variable ("var arg#") is expected - especially in `var_set`. Declaring variables (`var`, `static`) is done with `var_*` opcodes, not declarations.

* `_ar` - array
> * any arg1, arg2, ... = elements
> * KRPJ: ["_ar", 1, "2", ["_lv","three"]]
> * GML: [1, "2", three]

* `_lv` - variable
> A bare name, resolved by GML's usual scope rules: `var` locals, variables on `self`, built-ins (`room`, `x`, `argument`...) and statics.
> * ref arg1 = variable name
> * KRPJ: ["_lv","variable_name"]
> * GML: variable_name

* `_iv` - member variable
> Dot access on any instance, object or struct.
> * var arg1 = instance, object or struct
> * ref arg2 = variable name
> * KRPJ: ["_iv","obj_someone","variable_name"]
> * GML: obj_someone.variable_name
> * KRPJ: ["_iv",["_kw","global"],"variable_name"]
> * GML: global.variable_name

* `_kw` - keyword
> * ref arg1 = one of `self`, `other`, `all`, `noone`, `global`
> * KRPJ: ["_kw","other"]
> * GML: other

* `_as` - asset reference
> * ref arg1 = asset name (sprite, object, room, sound, font, path, timeline, shader, sequence...)
> * KRPJ: ["_as","spr_player"]
> * GML: spr_player

* `_fn` - function reference
> Refers to a function/script without calling it (e.g. for callbacks).
> * ref arg1 = function name
> * KRPJ: ["_fn","scr_on_hit"]
> * GML: scr_on_hit

* `_cn` - special constant (hidden)
> Only for values JSON can't hold.
> * ref arg1 = one of `infinity`, `NaN`, `ptr_null`, `ptr_invalid`
> * KRPJ: ["_cn","infinity"]
> * GML: infinity

* `_i6` - int64 (hidden)
> Stored as a string, since JSON numbers can't hold all 64-bit integers.
> * str arg1 = integer value
> * KRPJ: ["_i6","9007199254740993"]
> * GML: int64(9007199254740993)

## Accessors
Not strictly necessary (functions like `array_get`, `ds_map_find_value` or `struct_get` do the same), but much shorter when writing to elements.

* `_ai` - array index
> * var arg1 = array
> * var arg2 = index
> * KRPJ: ["_ai",["_lv","my_array"],0]
> * GML: my_array[0]

* `_ac` - accessor (hidden)
> * ref arg1 = accessor type: `@` (array, no copy-on-write), `|` (ds_list), `?` (ds_map), `#` (ds_grid), `$` (struct)
> * var arg2 = data structure
> * var arg3 = key/index
> * var arg4 = (grid only) y index
> * KRPJ: ["_ac","?",["_lv","my_map"],"hp"]
> * GML: my_map[? "hp"] <!-- this isn't valid json... what? -->

# Events
Stores the rest of the script as the last argument. These are the 'hat' blocks. Don't have direct GML equivalents due to how the engine works.

Events run in GameMaker's order each step: begin step, alarms, keyboard, mouse, step, (built-in motion and paths), collisions, end step, then the draw events. An object without an event uses its parent's; `ins_event_inherited` runs the parent's version from inside one.

A visual script may have several hats for the same event. They run in the order they appear in `scripts`, and `ctr_exit`/`ctr_return` only end the current hat. gm2kr always emits one hat per event.

* `evt_create` - Executes when the instance is created.
> * KRPJ: ["evt_create",[...]]

* `evt_destroy` - Executes when the instance is destroyed with `ins_destroy` (unless run_destroy_event is false).
> * KRPJ: ["evt_destroy",[...]]

* `evt_cleanup` - Executes when the instance is removed for any reason (destroyed, room end for non-persistent instances, game end). Free surfaces and data structures here.
> * KRPJ: ["evt_cleanup",[...]]

* `evt_step` / `evt_step_begin` / `evt_step_end` - Execute each step ('on update' in some langs).
> * KRPJ: ["evt_step",[...]]

* `evt_alarm` - Executes when an alarm counts down to 0 (set with `ctr_alarm_set` or `alarm[n]`).
> * num arg1 = the alarm, min 0 max 11.
> * KRPJ: ["evt_alarm",10,[...]]

* `evt_draw` / `evt_draw_begin` / `evt_draw_end` - Draw in room space. An object with no draw event at all draws itself, as if it had `drw_self`.
> * KRPJ: ["evt_draw",[...]]

* `evt_drawgui` / `evt_drawgui_begin` / `evt_drawgui_end` - Draw on the GUI layer, above everything and unaffected by the camera.
> * KRPJ: ["evt_drawgui",[...]]

* `evt_draw_pre` / `evt_draw_post` / `evt_resize` (compat) - Pre-draw, post-draw and window resize.

* `evt_collision` - Executes each step while touching an instance of the object (or a child of it). `other` is the instance touched.
> * obj arg1 = object
> * KRPJ: ["evt_collision",["_as","obj_player"],[...]]

* `evt_key` - Keyboard events.
> * ref arg1 = `held`, `pressed` or `released`
> * key arg2 = key code; `vk_anykey` (1) and `vk_nokey` (0) work as in GM
> * KRPJ: ["evt_key","pressed",90,[...]]

* `evt_mouse` - Mouse events. Non-global ones only fire while the mouse is over the instance's mask.
> * ref arg1 = `left`/`right`/`middle` + `_held`/`_pressed`/`_released` (e.g. `left_pressed`), `none`, `enter`, `leave`, `wheel_up`, `wheel_down`, or any of the button ones with a `global_` prefix (e.g. `global_left_pressed`)
> * KRPJ: ["evt_mouse","left_pressed",[...]]

* `evt_user` - Executes when `ins_event_user` triggers it.
> * num arg1 = user event, min 0 max 15
> * KRPJ: ["evt_user",0,[...]]

* `evt_room_start` / `evt_room_end` / `evt_game_start` / `evt_game_end` - Room and game lifecycle.
> * KRPJ: ["evt_room_start",[...]]

* `evt_animation_end` - Executes when the sprite's last frame finishes.
* `evt_path_end` - Executes when a path started with `mov_path_start` ends.
* `evt_outside_room` / `evt_intersect_boundary` - Execute when the instance leaves the room or touches its edge.
* `evt_outside_view` / `evt_boundary_view` (hidden) - Same for a view.
> * num arg1 = view, min 0 max 7

* `evt_async` (compat) - Asynchronous events.
> * ref arg1 = event type (`audio_playback`, `dialog`, `save_load`, `social`...). Only events backed by supported APIs fire; HTTP and networking never do.
> * KRPJ: ["evt_async","dialog",[...]]

# Variables
Assignments are statements, never reporters. Targets are `_lv`, `_iv`, `_ai` or `_ac`.

* `var_set` - set
> * var arg1 = target
> * any arg2 = value
> * KRPJ: ["var_set",["_lv","hp"],10]
> * GML: hp = 10;

* `var_change` - compound assignment ('change [hp] by (1)' for `+`)
> The target is evaluated once, as in GML (`a[i++] += 1` increments `i` once).
> * ref arg1 = operator: `+`, `-`, `*`, `/`, `%`, `&`, `|`, `^`, `<<`, `>>`, `??`
> * var arg2 = target
> * any arg3 = value
> * KRPJ: ["var_change","+",["_lv","hp"],-1]
> * GML: hp += -1;

* `var_inc` / `var_dec` - `++` / `--`
> Works as a statement or a reporter. As a reporter, prefix returns the new value and postfix the old one.
> * var arg1 = target
> * bool arg2 (optional) = postfix (default false)
> * KRPJ: ["var_inc",["_lv","i"]]
> * GML: ++i

* `var_local` - local variable, lasts until the end of the event/function
> * ref arg1 = name
> * any arg2 (optional) = initial value
> * KRPJ: ["var_local","dir",["sen_key_held",39]]
> * GML: var dir = keyboard_check(vk_right);

* `var_static` (hidden) - static variable, initialised once per function
> * ref arg1 = name
> * any arg2 = initial value
> * KRPJ: ["var_static","count",0]
> * GML: static count = 0;

* `var_globalvar` (compat) - legacy global declaration; afterwards `_lv` with that name resolves to the global
> * ref arg1 = name
> * GML: globalvar score;

* `var_delete` (hidden) - `delete` a struct reference
> * var arg1 = target
> * GML: delete data;

The array, struct and variable_* functions are under [Variables (functions)](#variables-functions).

# Operators
Operators follow GML's rules exactly, including what they refuse to coerce: `+` on a string and a number is an error, not a join (use `opr_string`), and booleans are the numbers 1/0. All binary operators take `any arg1, any arg2`, and unary ones `any arg1`.

| Opcode | GML | Notes |
|---|---|---|
| `opr_add` | `a + b` | Also joins two strings. |
| `opr_sub` | `a - b` | |
| `opr_mul` | `a * b` | |
| `opr_div` | `a / b` | Always a real division. |
| `opr_idiv` | `a div b` | Integer division. |
| `opr_mod` | `a % b` / `a mod b` | Result has the sign of `a`. |
| `opr_neg` | `-a` | Unary. |
| `opr_eq` | `a == b` | |
| `opr_neq` | `a != b` | |
| `opr_lt` | `a < b` | |
| `opr_lte` | `a <= b` | |
| `opr_gt` | `a > b` | |
| `opr_gte` | `a >= b` | |
| `opr_and` | `a && b` | Short-circuits. |
| `opr_or` | `a \|\| b` | Short-circuits. |
| `opr_xor` | `a ^^ b` | |
| `opr_not` | `!a` | Unary. |
| `opr_cond` | `c ? a : b` | arg1 = condition; only the chosen branch is evaluated. |
| `opr_nullish` (hidden) | `a ?? b` | `b` is only evaluated when `a` is `undefined`. |
| `opr_band` (hidden) | `a & b` | |
| `opr_bor` (hidden) | `a \| b` | |
| `opr_bxor` (hidden) | `a ^ b` | |
| `opr_bnot` (hidden) | `~a` | Unary. |
| `opr_shl` (hidden) | `a << b` | |
| `opr_shr` (hidden) | `a >> b` | |

Math, string, random and type-check functions are under [Operators (functions)](#operators-functions).

* KRPJ: ["opr_and",["opr_gt",["_lv","hp"],0],["opr_not",["_lv","dead"]]]
* GML: hp > 0 && !dead

# Control
Bodies are script arrays (lists of statements). Opcodes marked "cap" end a script, so the editor doesn't let blocks attach below them.

* `ctr_if` - if / else
> Else-if chains are a `ctr_if` alone in the else body; the editor shows them as 'else if'.
> * any arg1 = condition
> * script arg2 = then
> * script arg3 (optional) = else
> * KRPJ: ["ctr_if",["opr_lte",["_lv","hp"],0],[["ins_destroy"]],[["var_change","-",["_lv","hp"],1]]]
> * GML: if (hp <= 0) instance_destroy(); else hp -= 1;

* `ctr_repeat` - repeat
> The count is evaluated once.
> * num arg1 = count
> * script arg2 = body
> * KRPJ: ["ctr_repeat",3,[...]]
> * GML: repeat (3) {...}

* `ctr_while` - while
> * any arg1 = condition
> * script arg2 = body
> * GML: while (cond) {...}

* `ctr_do_until` - do / until
> The body runs once before the first check, and the loop stops when the condition is true. The editor's Scratch-style 'repeat until' checks first and is saved as `ctr_while` with `opr_not`.
> * script arg1 = body
> * any arg2 = condition
> * GML: do {...} until (cond);

* `ctr_for` - for
> * script arg1 = init (one statement)
> * any arg2 = condition
> * script arg3 = step (one statement)
> * script arg4 = body
> * KRPJ: ["ctr_for",[["var_local","i",0]],["opr_lt",["_lv","i"],10],[["var_inc",["_lv","i"]]],[...]]
> * GML: for (var i = 0; i < 10; ++i) {...}

* `ctr_for_each` - for each item of an array (visual scripts only; GML has no equivalent, so gm2kr never emits it)
> The array is evaluated once; its length is re-checked every iteration, like a `for` loop over `array_length`. The item variable is a local.
> * ref arg1 = item variable name
> * arr arg2 = array
> * script arg3 = body
> * KRPJ: ["ctr_for_each","item",["_lv","items"],[...]]

* `ctr_switch` - switch
> The body is one flat list, with `ctr_case`/`ctr_default` as labels between statements, so GML's fall-through survives exactly. Case values are compared with `==`, in order. The editor shows each label as a section of the C-block.
> * any arg1 = value
> * script arg2 = body
> * KRPJ: ["ctr_switch",["_lv","state"],[["ctr_case",0],["var_set",["_lv","spd"],0],["ctr_break"],["ctr_case",1],["ctr_default"],["var_set",["_lv","spd"],4]]]
> * GML: switch (state) { case 0: spd = 0; break; case 1: default: spd = 4; }

* `ctr_case` / `ctr_default` - switch labels (only valid directly inside a `ctr_switch` body)
> * any arg1 = case value (`ctr_case` only)

* `ctr_break` / `ctr_continue` - cap. Leave or skip to the next iteration of the innermost loop; `ctr_break` also leaves a `ctr_switch` or `ctr_with`. As in GML, `ctr_continue` inside a switch applies to the surrounding loop.

* `ctr_with` - with
> Runs the body as each matching instance (or as a struct), with `other` set to the caller. Iteration order and the handling of instances created or destroyed during the loop match GameMaker exactly. The editor's 'for each instance of' block.
> * inst arg1 = object, instance, keyword (`all`, `other`...) or struct
> * script arg2 = body
> * KRPJ: ["ctr_with",["_as","obj_enemy"],[["var_change","-",["_lv","hp"],1]]]
> * GML: with (obj_enemy) hp -= 1;

* `ctr_exit` - cap. Ends the current event or function.
> * GML: exit;

* `ctr_return` - cap. Returns from a function.
> * any arg1 (optional) = value
> * GML: return value;

* `ctr_try` (hidden) - try / catch / finally
> * script arg1 = try body
> * ref arg2 = name of the local that receives the exception (null when there is no catch)
> * script arg3 = catch body (null when there is no catch)
> * script arg4 (optional) = finally body
> * KRPJ: ["ctr_try",[...],"e",[["sys_log",["_iv",["_lv","e"],"message"]]]]
> * GML: try {...} catch (e) { show_debug_message(e.message); }

* `ctr_throw` (hidden) - cap. Throws any value.
> * any arg1 = value
> * GML: throw "bad state";

Alarm, timer and dynamic-call functions are under [Control (functions)](#control-functions).

# Functions
User-defined functions live in the project's `functions` table (see krpj.md), keyed by asset id, with their argument names and body. Inside a function, `argument`, `argument0`...`argument15` and `argument_count` are built-in variables (`_lv`).

* `fnc_g` - call a global (user-defined) function or script
> Built-in GML functions have their own opcodes ([Function opcodes](#function-opcodes)) and are never called through `fnc_g`.
> * ref arg1 = function id from `functions` (or the name of an imported global function)
> * any arg2, arg3, ... = arguments
> * KRPJ: ["fnc_g","fnc_giAqiCrTp2",10]
> * GML: add_score(10)

* `fnc_m` - call a function value (method variable, struct member, array element...)
> * var arg1 = the function
> * any arg2, ... = arguments
> * KRPJ: ["fnc_m",["_iv",["_kw","self"],"on_hit"],5]
> * GML: self.on_hit(5)

* `fnc_def` (hidden) - inline function, a reporter that makes a method bound to the current `self`
> * arr arg1 = argument names; an element can be `[name, default]`
> * script arg2 = body
> * KRPJ: ["var_set",["_lv","on_hit"],["fnc_def",["dmg"],[["var_change","-",["_lv","hp"],["_lv","dmg"]]]]]
> * GML: on_hit = function(dmg) { hp -= dmg; };

* `fnc_new` (hidden) - construct a struct with a constructor function
> * ref arg1 = constructor function id or name
> * any arg2, ... = arguments
> * KRPJ: ["fnc_new","Vec2",1,2]
> * GML: new Vec2(1, 2)

# Function opcodes
Every supported GML built-in function has its own opcode, grouped by category. `fnc_g` is only for user-defined functions and scripts (`["fnc_g","scr_hurt",10]`). Importing a built-in that isn't listed here fails loudly (see [Unsupported](#unsupported)).

Rules for every opcode in this section:
* **Argument order is GML's**, even when the block label shows inputs in a different order. Imports then keep GML's evaluation order.
* **Variants**: when one block covers several GML functions with the same arguments, the first argument is a `ref` naming the variant, e.g. `["opr_mathop","sqrt",16]` = `sqrt(16)`.
* **Families** (hidden/compat APIs too big for a block each): the first argument is a `ref` holding the GML name minus the family prefix, e.g. `["dat_queue","enqueue",["_lv","q"],1]` = `ds_queue_enqueue(q, 1)`. Names that aren't real functions of that family fail loudly.
* **Optional arguments** (`?`) are trailing. Leave one out and it isn't passed, like in GML, so `argument_count` and defaults behave the same.
* **Statements vs. reporters**: any opcode that returns a value can be a reporter or a statement (the result is thrown away). Opcodes that return nothing are statements only.

Argument types: `num`, `str`, `bool`, `any`, `inst` (instance id, object or keyword), `obj`/`spr`/`snd`/`fnt`/`room`/`path`/`shd`/`seq` (an `_as` asset of that kind; `inst`/`obj` also accept ids), `layer` (layer id or name), `fn` (`_fn` or a method), `arr`, `struct`, `ds` (data structure id), `col` (colour as a BGR int, e.g. `c_red` = `255`), `key` (key code), `ref` (variant name). `...` means repeated; `?` means optional.

## Instances
| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `ins_create_layer` | num x, num y, layer layer, obj obj, struct? vars | `instance_create_layer` | Returns the new id. |
| `ins_create_depth` | num x, num y, num depth, obj obj, struct? vars | `instance_create_depth` | Returns the new id. |
| `ins_destroy` | inst? target, bool? run_destroy_event | `instance_destroy` | Not a cap: code after it still runs. |
| `ins_exists` | inst obj | `instance_exists` | |
| `ins_number` | obj obj | `instance_number` | |
| `ins_find` | obj obj, num n | `instance_find` | |
| `ins_nearest` | num x, num y, obj obj | `instance_nearest` | |
| `ins_furthest` | num x, num y, obj obj | `instance_furthest` | |
| `ins_copy` (hidden) | bool run_create | `instance_copy` | Returns the new id. |
| `ins_change` (compat) | obj obj, bool run_events | `instance_change` | Deprecated in GMS2. |
| `ins_set_active_all` (hidden) | ref `activate`/`deactivate`, bool? notme | `instance_activate_all` / `instance_deactivate_all` | `notme` is only passed for `deactivate`. |
| `ins_set_active_object` (hidden) | ref `activate`/`deactivate`, inst obj | `instance_activate_object` / `instance_deactivate_object` | |
| `ins_event_inherited` | - | `event_inherited` | Greyed out when the object has no parent. |
| `ins_event_user` | num n (0-15) | `event_user` | |
| `ins_event_perform` (compat) | num type, num number | `event_perform` | |
| `ins_object_name` (hidden) | obj obj | `object_get_name` | |
| `ins_is_ancestor` | obj child, obj parent | `object_is_ancestor` | |

## Movement
| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `mov_motion_set` | num dir, num speed | `motion_set` | |
| `mov_motion_add` | num dir, num speed | `motion_add` | |
| `mov_towards_point` | num x, num y, num speed | `move_towards_point` | Sets speed/direction; doesn't move instantly. |
| `mov_snap` | num hsnap, num vsnap | `move_snap` | |
| `mov_wrap` | bool hor, bool vert, num margin | `move_wrap` | |
| `mov_bounce` (hidden) | ref `solid`/`all`, bool precise | `move_bounce_solid` / `move_bounce_all` | |
| `mov_contact` (hidden) | ref `solid`/`all`, num dir, num maxdist | `move_contact_solid` / `move_contact_all` | |
| `mov_outside` (hidden) | ref `solid`/`all`, num dir, num maxdist | `move_outside_solid` / `move_outside_all` | |
| `mov_is_snapped` (hidden) | num hsnap, num vsnap | `place_snapped` | |
| `mov_mp_linear_step` (hidden) | num x, num y, num speed, bool checkall | `mp_linear_step` | Returns whether the goal was reached. |
| `mov_mp_potential_step` (hidden) | num x, num y, num speed, bool checkall | `mp_potential_step` | Same. |
| `mov_path_start` | path path, num speed, num end_action, bool absolute | `path_start` | end_action: 0 stop, 1 restart, 2 continue, 3 reverse. |
| `mov_path_end` | - | `path_end` | |

## Sensing
| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `sen_place_meeting` | num x, num y, inst obj | `place_meeting` | x/y inputs default to `x`/`y` reporters. |
| `sen_place_free` | num x, num y | `place_free` | |
| `sen_place_empty` | num x, num y, inst? obj | `place_empty` | |
| `sen_position_meeting` | num x, num y, inst obj | `position_meeting` | |
| `sen_position_empty` (hidden) | num x, num y | `position_empty` | |
| `sen_instance_place` | num x, num y, inst obj | `instance_place` | `noone` (-4) when nothing is found. |
| `sen_instance_position` | num x, num y, inst obj | `instance_position` | |
| `sen_instance_list` (hidden) | ref `place`/`position`, num x, num y, inst obj, ds list, bool ordered | `instance_place_list` / `instance_position_list` | Returns the count. |
| `sen_collision_point` | num x, num y, inst obj, bool precise, bool notme | `collision_point` | |
| `sen_collision_rect` | num x1, num y1, num x2, num y2, inst obj, bool precise, bool notme | `collision_rectangle` | |
| `sen_collision_circle` | num x, num y, num r, inst obj, bool precise, bool notme | `collision_circle` | |
| `sen_collision_line` | num x1, num y1, num x2, num y2, inst obj, bool precise, bool notme | `collision_line` | |
| `sen_collision_ellipse` (hidden) | num x1, num y1, num x2, num y2, inst obj, bool precise, bool notme | `collision_ellipse` | |
| `sen_distance_to_object` | inst obj | `distance_to_object` | Bounding-box distance, not origin distance. |
| `sen_distance_to_point` | num x, num y | `distance_to_point` | Bounding-box distance. |
| `sen_key_held` | key key | `keyboard_check` | Dropdown lists `vk_*`, A-Z and 0-9; letters are stored as `ord()` codes (A = 65). Also accepts a reporter. |
| `sen_key_pressed` | key key | `keyboard_check_pressed` | |
| `sen_key_released` | key key | `keyboard_check_released` | |
| `sen_key_direct` (compat) | key key | `keyboard_check_direct` | Same as `sen_key_held` in a browser. |
| `sen_key_clear` (hidden) | key key | `keyboard_clear` | |
| `sen_io_clear` (hidden) | - | `io_clear` | |
| `sen_mouse_held` | num button | `mouse_check_button` | `mb_left` = 1, `mb_right` = 2, `mb_middle` = 3. Use `_lv` `mouse_x`/`mouse_y` for the position. |
| `sen_mouse_pressed` | num button | `mouse_check_button_pressed` | |
| `sen_mouse_released` | num button | `mouse_check_button_released` | |
| `sen_mouse_wheel` | ref `up`/`down` | `mouse_wheel_up` / `mouse_wheel_down` | |
| `sen_mouse_gui` | ref `x`/`y`, num device | `device_mouse_x_to_gui` / `device_mouse_y_to_gui` | |
| `sen_gamepad_connected` | num slot | `gamepad_is_connected` | |
| `sen_gamepad_button` | ref `held`/`pressed`/`released`, num slot, num button | `gamepad_button_check` / `_pressed` / `_released` | |
| `sen_gamepad_axis` | num slot, num axis | `gamepad_axis_value` | |
| `sen_ask` (compat) | ref `string`/`integer`, str prompt, any default | `get_string` / `get_integer` | In-canvas modal; deprecated in GM. |
| `sen_clipboard` (hidden) | - | `clipboard_get_text` | Stubbed. |
| `sen_clipboard_set` (hidden) | str text | `clipboard_set_text` | Stubbed. |

## Operators (functions)
Math, randomness, strings and type checks. GML's `+` doesn't turn numbers into text, so use `opr_string` before joining a number to a string.

| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `opr_point_direction` | num x1, num y1, num x2, num y2 | `point_direction` | Degrees; 0 = right, counter-clockwise. |
| `opr_point_distance` | num x1, num y1, num x2, num y2 | `point_distance` | |
| `opr_lengthdir` | ref `x`/`y`, num len, num dir | `lengthdir_x` / `lengthdir_y` | |
| `opr_angle_difference` | num a, num b | `angle_difference` | |
| `opr_point_in_rect` | num px, num py, num x1, num y1, num x2, num y2 | `point_in_rectangle` | |
| `opr_point_in_circle` | num px, num py, num cx, num cy, num r | `point_in_circle` | |
| `opr_rect_in_rect` (hidden) | num ×8 (two rectangles) | `rectangle_in_rectangle` | Returns 0/1/2. |
| `opr_mathop` | ref fn, num n | `abs` `sign` `round` `floor` `ceil` `frac` `sqrt` `sqr` `exp` `ln` `log2` `log10` | `round` is banker's rounding. |
| `opr_trig` | ref fn, num radians | `sin` `cos` `tan` `arcsin` `arccos` `arctan` | |
| `opr_dtrig` | ref fn, num degrees | `dsin` `dcos` `dtan` `darcsin` `darccos` `darctan` | ref is written without the `d` (`["opr_dtrig","sin",90]`). Listed first in the editor, since GM directions are degrees. |
| `opr_atan2` | ref `rad`/`deg`, num y, num x | `arctan2` / `darctan2` | |
| `opr_convert_angle` | ref `deg_to_rad`/`rad_to_deg`, num n | `degtorad` / `radtodeg` | |
| `opr_power` | ref `power`/`logn`, num a, num b | `power(base, n)` / `logn(base, n)` | |
| `opr_aggregate` | ref `min`/`max`/`mean`/`median`, num... | `min` `max` `mean` `median` | Variadic: +/- buttons add or remove inputs. |
| `opr_clamp` | num n, num lo, num hi | `clamp` | |
| `opr_lerp` | num a, num b, num t | `lerp` | |
| `opr_random` | num n | `random` | |
| `opr_random_range` | num a, num b | `random_range` | |
| `opr_irandom` | num n | `irandom` | |
| `opr_irandom_range` | num a, num b | `irandom_range` | Scratch 'pick random'. |
| `opr_choose` | any... | `choose` | Variadic. |
| `opr_randomize` | - | `randomize` / `randomise` | |
| `opr_seed_set` (hidden) | num seed | `random_set_seed` | Not bit-identical to GM's RNG. |
| `opr_seed_get` (hidden) | - | `random_get_seed` | |
| `opr_string` | any value | `string` | |
| `opr_real` | str text | `real` | Throws on non-numeric text (GMS2). |
| `opr_str_length` | str text | `string_length` | |
| `opr_str_char_at` | str text, num n | `string_char_at` | 1-based. |
| `opr_str_copy` | str text, num start, num count | `string_copy` | |
| `opr_str_pos` | str sub, str text | `string_pos` | Needle first; 0 when not found. |
| `opr_str_count` | str sub, str text | `string_count` | |
| `opr_str_insert` | str sub, str text, num pos | `string_insert` | |
| `opr_str_delete` | str text, num pos, num count | `string_delete` | |
| `opr_str_replace` | ref `first`/`all`, str text, str sub, str new | `string_replace` / `string_replace_all` | |
| `opr_str_case` | ref `upper`/`lower`, str text | `string_upper` / `string_lower` | |
| `opr_str_repeat` | str text, num n | `string_repeat` | |
| `opr_str_filter` (hidden) | ref `digits`/`letters`/`lettersdigits`, str text | `string_digits` / `string_letters` / `string_lettersdigits` | |
| `opr_str_trim` | ref `both`/`start`/`end`, str text, arr? chars | `string_trim` / `string_trim_start` / `string_trim_end` | GM 2023+. |
| `opr_str_affix` | ref `start`/`end`, str text, str sub | `string_starts_with` / `string_ends_with` | GM 2023+. |
| `opr_str_split` | str text, str sep, bool? remove_empty, num? max | `string_split` | GM 2023+. Returns an array. |
| `opr_str_join` | str sep, any... | `string_join` | GM 2023+. |
| `opr_str_join_ext` | str sep, arr values | `string_join_ext` | GM 2023+. This is the editor's 'join (array) with (sep)' block. |
| `opr_str_format` (hidden) | num n, num total, num decimals | `string_format` | Pads with spaces, not zeros. |
| `opr_charcode` | ref `chr`/`ord`, num/str value | `chr` / `ord` | |
| `opr_str_hash_newline` (compat) | str text | `string_hash_to_newline` | For GMS1-era text. |
| `opr_is_type` | ref type, any value | `is_real` `is_string` `is_array` `is_struct` `is_undefined` `is_bool` `is_method` `is_numeric` `is_int64` `is_ptr` | ref drops the `is_` (`["opr_is_type","undefined",v]`). |
| `opr_typeof` (hidden) | any value | `typeof` | |
| `opr_convert` (hidden) | ref `bool`/`int64`, any value | `bool` / `int64` | |

## Variables (functions)
Arrays are 0-based (unlike Scratch lists), and block labels say so. Array functions take the array first.

| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `var_arr_length` | arr a | `array_length` | |
| `var_arr_create` | num n, any? value | `array_create` | |
| `var_arr_push` | arr a, any... | `array_push` | Scratch 'add (thing) to [list]'. |
| `var_arr_take` | ref `last`/`first`, arr a | `array_pop` / `array_shift` | Returns the removed item. |
| `var_arr_insert` | arr a, num index, any... | `array_insert` | |
| `var_arr_delete` | arr a, num index, num count | `array_delete` | |
| `var_arr_contains` | arr a, any value, num? offset, num? length | `array_contains` | |
| `var_arr_index_of` | arr a, any value, num? offset, num? length | `array_get_index` | -1 when absent. |
| `var_arr_resize` | arr a, num n | `array_resize` | Size 0 = Scratch 'delete all of list'. |
| `var_arr_sort` | arr a, bool/fn order | `array_sort` | |
| `var_arr_reverse` (hidden) | arr a, num? offset, num? length | `array_reverse` | Returns a new array. |
| `var_arr_concat` (hidden) | arr... | `array_concat` | |
| `var_arr_copy` (hidden) | arr dest, num dest_index, arr src, num src_index, num length | `array_copy` | |
| `var_arr_iterate` (hidden) | ref fn, arr a, fn callback, num? offset, num? length | `array_foreach` `array_map` `array_filter` `array_find_index` `array_any` `array_all` | ref drops the `array_`. Visual scripts usually use a `ctr_` 'for each item' C-block instead. |
| `var_struct_get` | struct s, str key | `struct_get` / `variable_struct_get` | For key names known only at runtime; fixed names use `_iv`. |
| `var_struct_set` | struct s, str key, any value | `struct_set` / `variable_struct_set` | |
| `var_struct_exists` | struct s, str key | `struct_exists` / `variable_struct_exists` | |
| `var_struct_remove` | struct s, str key | `struct_remove` / `variable_struct_remove` | |
| `var_struct_keys` | struct s | `struct_get_names` / `variable_struct_get_names` | |
| `var_inst_get` (hidden) | inst i, str name | `variable_instance_get` | Scratch '(x position of [Sprite])'. |
| `var_inst_set` (hidden) | inst i, str name, any value | `variable_instance_set` | |
| `var_inst_exists` (hidden) | inst i, str name | `variable_instance_exists` | |
| `var_global_get` (hidden) | str name | `variable_global_get` | |
| `var_global_set` (hidden) | str name, any value | `variable_global_set` | |
| `var_global_exists` (hidden) | str name | `variable_global_exists` | |
| `var_method` (hidden) | inst/struct context, fn f | `method` | |
| `var_method_self` (hidden) | fn f | `method_get_self` | |

## Looks
| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `lks_sprite_info` | ref `width`/`height`/`number`/`xoffset`/`yoffset`, spr s | `sprite_get_width` etc. | |
| `lks_sprite_name` (hidden) | spr s | `sprite_get_name` | |
| `lks_sprite_exists` (hidden) | spr s | `sprite_exists` | |
| `lks_asset_named` (hidden) | str name | `asset_get_index` | Looks an asset up by name at runtime, so gm2kr has to keep the original asset names findable. |

## Sound
Sound inputs take an `_as` sound or a voice id reporter (the value `snd_play` returns).

| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `snd_play` | snd s, num priority, bool loop, num? gain, num? offset, num? pitch, num? listener_mask | `audio_play_sound` | Returns a voice id. Optional args sit behind an expand arrow. |
| `snd_play_at` (hidden) | as GML | `audio_play_sound_at` | |
| `snd_play_on` (hidden) | as GML | `audio_play_sound_on` | |
| `snd_stop` | snd s | `audio_stop_sound` | |
| `snd_stop_all` | - | `audio_stop_all` | |
| `snd_pause` | ref `pause`/`resume`, snd s | `audio_pause_sound` / `audio_resume_sound` | |
| `snd_pause_all` | ref `pause`/`resume` | `audio_pause_all` / `audio_resume_all` | |
| `snd_is` | ref `playing`/`paused`, snd s | `audio_is_playing` / `audio_is_paused` | |
| `snd_gain` | snd s, num volume, num ms | `audio_sound_gain` | Scratch 'set volume to'; 0 ms = instant. |
| `snd_pitch` | snd s, num pitch | `audio_sound_pitch` | |
| `snd_get` | ref `gain`/`pitch`, snd s | `audio_sound_get_gain` / `audio_sound_get_pitch` | |
| `snd_master_gain` | num volume | `audio_master_gain` | |
| `snd_position` | snd voice | `audio_sound_get_track_position` | Seconds. |
| `snd_seek` | snd voice, num seconds | `audio_sound_set_track_position` | |
| `snd_length` | snd s | `audio_sound_length` | |
| `snd_loop` (hidden) | ref `enabled`/`start`/`end`, snd voice, bool/num value | `audio_sound_loop` / `audio_sound_loop_start` / `audio_sound_loop_end` | GM 2023+. |
| `snd_stream_create` (hidden) | str path | `audio_create_stream` | The path is resolved against the project's CDN path. |
| `snd_stream_destroy` (hidden) | snd stream | `audio_destroy_stream` | |
| `snd_group` (compat, family) | ref fn, ... | `audio_group_*` (`load`, `is_loaded`, `set_gain`) | Only a loading hint. |
| `snd_3d` (hidden, family) | ref fn, ... | `audio_emitter_*`, `audio_listener_*` | ref drops `audio_` (`["snd_3d","emitter_position",em,0,0,0]`). |

## Drawing
Only does anything in draw events; the editor greys these out elsewhere. Colour inputs are Scratch-style pickers that store a BGR int. "as GML" means the same arguments as the GML function.

| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `drw_self` | - | `draw_self` | |
| `drw_sprite` | spr s, num frame, num x, num y | `draw_sprite` | |
| `drw_sprite_ext` | spr s, num frame, num x, num y, num xscale, num yscale, num angle, col colour, num alpha | `draw_sprite_ext` | |
| `drw_sprite_stretched` | spr s, num frame, num x, num y, num w, num h | `draw_sprite_stretched` | |
| `drw_sprite_part` | spr s, num frame, num left, num top, num w, num h, num x, num y | `draw_sprite_part` | |
| `drw_sprite_tiled` | spr s, num frame, num x, num y | `draw_sprite_tiled` | |
| `drw_sprite_part_ext` (hidden) | as GML | `draw_sprite_part_ext` | |
| `drw_sprite_stretched_ext` (hidden) | as GML | `draw_sprite_stretched_ext` | |
| `drw_sprite_general` (hidden) | as GML | `draw_sprite_general` | |
| `drw_sprite_pos` (hidden) | as GML | `draw_sprite_pos` | |
| `drw_text` | num x, num y, any text | `draw_text` | |
| `drw_text_ext` | num x, num y, any text, num sep, num w | `draw_text_ext` | |
| `drw_text_transformed` | num x, num y, any text, num xscale, num yscale, num angle | `draw_text_transformed` | |
| `drw_text_colour` (hidden) | num x, num y, any text, col c1, col c2, col c3, col c4, num alpha | `draw_text_colour` | |
| `drw_text_ext_colour` (hidden) | as GML | `draw_text_ext_colour` | |
| `drw_text_ext_transformed` (hidden) | as GML | `draw_text_ext_transformed` | |
| `drw_text_transformed_colour` (hidden) | as GML | `draw_text_transformed_colour` | |
| `drw_text_size` | ref `width`/`height`, str text | `string_width` / `string_height` | Uses the current font. |
| `drw_set_font` | fnt f | `draw_set_font` | |
| `drw_set_colour` | col c | `draw_set_colour` / `draw_set_color` | |
| `drw_set_alpha` | num alpha (0-1) | `draw_set_alpha` | Like Scratch's 'ghost effect', with the scale inverted. |
| `drw_set_align` | ref `h`/`v`, num align | `draw_set_halign` / `draw_set_valign` | `fa_left`/`fa_top` = 0, centre/middle = 1, right/bottom = 2. |
| `drw_get` (hidden) | ref `colour`/`alpha`/`font`/`halign`/`valign` | `draw_get_*` | |
| `drw_rect` | num x1, num y1, num x2, num y2, bool outline | `draw_rectangle` | |
| `drw_rect_colour` (hidden) | num x1, num y1, num x2, num y2, col c1, col c2, col c3, col c4, bool outline | `draw_rectangle_colour` | |
| `drw_roundrect` (hidden) | num x1, num y1, num x2, num y2, bool outline | `draw_roundrect` | |
| `drw_roundrect_ext` (hidden) | num x1, num y1, num x2, num y2, num xrad, num yrad, bool outline | `draw_roundrect_ext` | |
| `drw_circle` | num x, num y, num r, bool outline | `draw_circle` | |
| `drw_ellipse` | num x1, num y1, num x2, num y2, bool outline | `draw_ellipse` | |
| `drw_line` | num x1, num y1, num x2, num y2, num? width | `draw_line` / `draw_line_width` | Leaving out width = `draw_line`. |
| `drw_triangle` | num x1, num y1, num x2, num y2, num x3, num y3, bool outline | `draw_triangle` | |
| `drw_point` | num x, num y | `draw_point` | |
| `drw_arrow` (hidden) | num x1, num y1, num x2, num y2, num size | `draw_arrow` | |
| `drw_healthbar` | num x1, num y1, num x2, num y2, num amount, col back, col min, col max, num direction, bool showback, bool showborder | `draw_healthbar` | |
| `drw_clear` | col c, num? alpha | `draw_clear` / `draw_clear_alpha` | Leaving out alpha = `draw_clear`. |
| `drw_make_colour` | ref `rgb`/`hsv`, num a, num b, num c | `make_colour_rgb` / `make_colour_hsv` | |
| `drw_merge_colour` | col c1, col c2, num t | `merge_colour` | |
| `drw_colour_get` (hidden) | ref `red`/`green`/`blue`/`hue`/`saturation`/`value`, col c | `colour_get_*` | |
| `drw_blendmode` (hidden) | num mode | `gpu_set_blendmode` | |
| `drw_gpu` (compat, family) | ref fn, ... | `gpu_set_*` (`blendmode_ext`, `alphatestenable`, `colorwriteenable`, `fog`...) | ref drops `gpu_set_`. |
| `drw_surface_create` (hidden) | num w, num h | `surface_create` | The editor calls surfaces 'canvases'. |
| `drw_surface_free` (hidden) | num surf | `surface_free` | |
| `drw_surface_exists` (hidden) | num surf | `surface_exists` | Check every frame; surfaces can be lost. |
| `drw_surface_target` (hidden) | num surf | `surface_set_target` | Shown together with `drw_surface_reset` as one 'draw onto canvas' C-block, but saved as two opcodes. Calls that aren't paired show as plain commands. |
| `drw_surface_reset` (hidden) | - | `surface_reset_target` | |
| `drw_surface` (hidden) | num surf, num x, num y | `draw_surface` | |
| `drw_surface_ext` (hidden) | as GML | `draw_surface_ext` | |
| `drw_surface_part` (hidden) | as GML | `draw_surface_part` | |
| `drw_shader_set` (hidden) | shd s | `shader_set` | Pairs with `drw_shader_reset` like surfaces. |
| `drw_shader_reset` (hidden) | - | `shader_reset` | |
| `drw_shader_uniform` (hidden) | shd s, str name | `shader_get_uniform` | |
| `drw_shader_uniform_f` (hidden) | num uniform, num... | `shader_set_uniform_f` | |
| `drw_getpixel` (compat) | num x, num y | `draw_getpixel` | Stubbed. |
| `drw_surface_getpixel` (compat) | num surf, num x, num y | `surface_getpixel` | Stubbed. |
| `drw_effect` | ref `above`/`below`, num kind, num x, num y, num size, col colour | `effect_create_above` / `effect_create_below` | Built-in one-shot effects. kind: `ef_explosion` = 0, `ef_ring` 1, `ef_ellipse` 2, `ef_firework` 3, `ef_smoke` 4, `ef_smokeup` 5, `ef_star` 6, `ef_spark` 7, `ef_flare` 8, `ef_cloud` 9, `ef_rain` 10, `ef_snow` 11; size 0-2 (small/medium/large). Drawn by krplayer as an approximation, not GM's exact particles. |
| `drw_part` (hidden, family) | ref fn, ... | `part_*` | ref drops `part_` (`["drw_part","particles_create",ps,x,y,pt,10]`). Only `system_create`, `particles_create` and `system_destroy` get custom labels. |

## Rooms
| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `rom_goto` | room r | `room_goto` | The room changes at the end of the event, not straight away, so this isn't a cap. |
| `rom_change` | ref `next`/`previous`/`restart` | `room_goto_next` / `room_goto_previous` / `room_restart` | Same timing as `rom_goto`. |
| `rom_info` (hidden) | ref `next`/`previous`/`exists`/`name`, room r | `room_next` / `room_previous` / `room_exists` / `room_get_name` | |
| `rom_set` (hidden) | ref `persistent`/`width`/`height`, room r, any value | `room_set_*` | |
| `rom_layer_id` | str name | `layer_get_id` | |
| `rom_layer_exists` | layer l | `layer_exists` | |
| `rom_layer_set_visible` | layer l, bool visible | `layer_set_visible` | |
| `rom_layer_get_visible` | layer l | `layer_get_visible` | |
| `rom_layer_depth` | layer l, num depth | `layer_depth` | |
| `rom_layer_get_depth` | layer l | `layer_get_depth` | |
| `rom_layer_set` | ref `x`/`y`/`hspeed`/`vspeed`, layer l, num value | `layer_x` / `layer_y` / `layer_hspeed` / `layer_vspeed` | For parallax/scrolling backgrounds. |
| `rom_layer_get` | ref `x`/`y`/`hspeed`/`vspeed`, layer l | `layer_get_x` etc. | |
| `rom_layer_create` (hidden) | num depth, str? name | `layer_create` | |
| `rom_layer_destroy` (hidden) | layer l | `layer_destroy` | |
| `rom_bg` (hidden, family) | ref fn, ... | `layer_background_*` | ref drops `layer_background_` (`["rom_bg","blend",bg,255]`). |
| `rom_tilemap` (hidden, family) | ref fn, ... | `tilemap_*`, `layer_tilemap_get_id` | ref drops `tilemap_`; `layer_tilemap_get_id` is `layer_get_id`. |
| `rom_sequence` (hidden, family) | ref fn, ... | `layer_sequence_*` | ref drops `layer_sequence_`. |
| `rom_animcurve` (hidden, family) | ref fn, ... | `animcurve_*` | ref drops `animcurve_`. |

## Camera
Camera inputs default to `["_ai",["_lv","view_camera"],0]`.

| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `cam_get` | ref `x`/`y`/`width`/`height`, num cam | `camera_get_view_*` | |
| `cam_set_pos` | num cam, num x, num y | `camera_set_view_pos` | |
| `cam_set_size` | num cam, num w, num h | `camera_set_view_size` | |
| `cam_set_target` (hidden) | num cam, inst target | `camera_set_view_target` | |
| `cam_set_border` (hidden) | num cam, num hborder, num vborder | `camera_set_view_border` | |
| `cam_set_speed` (hidden) | num cam, num hspeed, num vspeed | `camera_set_view_speed` | |
| `cam_set_angle` (hidden) | num cam, num angle | `camera_set_view_angle` | |
| `cam_view_get` (hidden) | ref `visible`/`camera`, num view | `view_get_visible` / `view_get_camera` | |
| `cam_view_set` (hidden) | ref `visible`/`camera`, num view, any value | `view_set_visible` / `view_set_camera` | |
| `cam_legacy_view_get` (compat) | num what, num view | `__view_get` | GMS1-to-GMS2 compatibility scripts, common in older imports. |
| `cam_legacy_view_set` (compat) | num what, num view, any value | `__view_set` | |
| `cam_gui_size` | ref `width`/`height` | `display_get_gui_width` / `display_get_gui_height` | |
| `cam_gui_set_size` | num w, num h | `display_set_gui_size` | |
| `cam_fullscreen` | - | `window_get_fullscreen` | |
| `cam_fullscreen_set` | bool on | `window_set_fullscreen` | Needs a user gesture, so it waits until the next click/key. |
| `cam_window` (hidden) | ref `width`/`height` | `window_get_width` / `window_get_height` | The window is the canvas. |
| `cam_display` (hidden) | ref `width`/`height` | `display_get_width` / `display_get_height` | |
| `cam_window_set_size` (hidden) | num w, num h | `window_set_size` | |
| `cam_window_caption` (hidden) | str caption | `window_set_caption` | |
| `cam_cursor_set` (hidden) | num cursor | `window_set_cursor` | |
| `cam_window_mouse` (hidden) | ref `x`/`y` | `window_mouse_get_x` / `window_mouse_get_y` | |

## Control (functions)
Alarms, timing and dynamic calls. Timelines have no opcode: `timeline_index`/`timeline_running`/`timeline_position` are built-in variables set with `var_set` (the 'start timeline' block is sugar for that).

| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `ctr_alarm_set` | num n (0-11), num steps | `alarm_set` | Pairs with `evt_alarm`. Imports usually write `alarm[n]` with `_ai`; the editor shows both the same way. |
| `ctr_alarm_get` | num n | `alarm_get` | |
| `ctr_game_speed` | num type | `game_get_speed` | type: 0 = fps, 1 = microseconds per frame. |
| `ctr_game_speed_set` | num value, num type | `game_set_speed` | |
| `ctr_timer` | - | `get_timer` | Microseconds since start. Like Scratch's 'timer', but can't be reset. |
| `ctr_call_later` (hidden) | num period, num units, fn callback, bool? repeat | `call_later` | GM 2023+. Returns a handle. |
| `ctr_call_cancel` (hidden) | num handle | `call_cancel` | |
| `ctr_time_source` (compat, family) | ref fn, ... | `time_source_*` | ref drops `time_source_`. |
| `ctr_script_execute` | fn/num f, any... | `script_execute` | For calls where the function is only known at runtime; fixed calls to user functions use `fnc_g`. |
| `ctr_script_exists` (hidden) | fn/num f | `script_exists` | |
| `ctr_script_name` (hidden) | fn/num f | `script_get_name` | |

## Files & Data
Arrays and structs (Variables) are better for visual scripts; `ds_*` mainly exists for imports. The editor warns when a script creates a data structure without destroying it. Files live in a virtual file system.

| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `dat_list_create` (hidden) | - | `ds_list_create` | |
| `dat_list_destroy` (hidden) | ds l | `ds_list_destroy` | |
| `dat_list_add` (hidden) | ds l, any... | `ds_list_add` | Labels match the array blocks. |
| `dat_list_get` (hidden) | ds l, num n | `ds_list_find_value` | Reads/writes can also use `_ac` with `\|`. |
| `dat_list_set` (hidden) | ds l, num n, any value | `ds_list_set` | |
| `dat_list_delete` (hidden) | ds l, num n | `ds_list_delete` | |
| `dat_list_size` (hidden) | ds l | `ds_list_size` | |
| `dat_list_index_of` (hidden) | ds l, any value | `ds_list_find_index` | |
| `dat_list_clear` (hidden) | ds l | `ds_list_clear` | |
| `dat_list_sort` (hidden) | ds l, bool ascending | `ds_list_sort` | |
| `dat_map_create` (hidden) | - | `ds_map_create` | |
| `dat_map_destroy` (hidden) | ds m | `ds_map_destroy` | |
| `dat_map_exists` (hidden) | ds m, any key | `ds_map_exists` | |
| `dat_map_get` (hidden) | ds m, any key | `ds_map_find_value` | Reads/writes can also use `_ac` with `?`. |
| `dat_map_set` (hidden) | ds m, any key, any value | `ds_map_set` | |
| `dat_map_add` (hidden) | ds m, any key, any value | `ds_map_add` | Does nothing if the key exists. |
| `dat_map_delete` (hidden) | ds m, any key | `ds_map_delete` | |
| `dat_map_size` (hidden) | ds m | `ds_map_size` | |
| `dat_grid_create` (hidden) | num w, num h | `ds_grid_create` | |
| `dat_grid_get` (hidden) | ds g, num x, num y | `ds_grid_get` | |
| `dat_grid_set` (hidden) | ds g, num x, num y, any value | `ds_grid_set` | |
| `dat_grid_size` (hidden) | ref `width`/`height`, ds g | `ds_grid_width` / `ds_grid_height` | |
| `dat_grid_clear` (hidden) | ds g, any value | `ds_grid_clear` | |
| `dat_grid_destroy` (hidden) | ds g | `ds_grid_destroy` | |
| `dat_stack` (hidden, family) | ref fn, ... | `ds_stack_*` | ref drops `ds_stack_`. |
| `dat_queue` (hidden, family) | ref fn, ... | `ds_queue_*` | ref drops `ds_queue_`. |
| `dat_priority` (hidden, family) | ref fn, ... | `ds_priority_*` | ref drops `ds_priority_`. |
| `dat_exists` (hidden) | ds id, num type | `ds_exists` | |
| `dat_json_stringify` | any value, bool? pretty | `json_stringify` | |
| `dat_json_parse` | str text | `json_parse` | |
| `dat_json_encode` (compat) | ds m | `json_encode` | Old ds_map-based API. |
| `dat_json_decode` (compat) | str text | `json_decode` | Same. |
| `dat_ini_open` | str name | `ini_open` | Shown together with `dat_ini_close` as one 'with save file' C-block, but saved as two opcodes. Calls that aren't paired show as plain commands. |
| `dat_ini_close` | - | `ini_close` | |
| `dat_ini_read` | ref `string`/`real`, str section, str key, any default | `ini_read_string` / `ini_read_real` | |
| `dat_ini_write` | ref `string`/`real`, str section, str key, any value | `ini_write_string` / `ini_write_real` | The editor picks the variant from the value's type; a dropdown overrides it. |
| `dat_ini_section_exists` | str section | `ini_section_exists` | |
| `dat_ini_key_exists` | str section, str key | `ini_key_exists` | |
| `dat_ini_key_delete` | str section, str key | `ini_key_delete` | |
| `dat_ini_section_delete` | str section | `ini_section_delete` | |
| `dat_file_exists` | str name | `file_exists` | |
| `dat_file_delete` | str name | `file_delete` | |
| `dat_file_copy` (hidden) | str from, str to | `file_copy` | |
| `dat_file_rename` (hidden) | str from, str to | `file_rename` | |
| `dat_text_open` | ref `read`/`write`/`append`, str name | `file_text_open_read` / `_write` / `_append` | Returns a file id. Fangames often save this way. |
| `dat_text_close` | num f | `file_text_close` | |
| `dat_text_read` | ref `string`/`real`, num f | `file_text_read_string` / `file_text_read_real` | |
| `dat_text_readln` | num f | `file_text_readln` | |
| `dat_text_eof` | num f | `file_text_eof` | |
| `dat_text_write` | ref `string`/`real`, num f, any value | `file_text_write_string` / `file_text_write_real` | |
| `dat_text_writeln` | num f | `file_text_writeln` | |
| `dat_file_find_first` (hidden) | str mask, num attr | `file_find_first` | |
| `dat_file_find_next` (hidden) | - | `file_find_next` | |
| `dat_file_find_close` (hidden) | - | `file_find_close` | |
| `dat_dir_exists` (hidden) | str name | `directory_exists` | |
| `dat_dir_create` (hidden) | str name | `directory_create` | |
| `dat_bin` (compat, family) | ref fn, ... | `file_bin_*` | ref drops `file_bin_`. |
| `dat_buffer` (hidden, family) | ref fn, ... | `buffer_*` | ref drops `buffer_`. |
| `dat_encode` (hidden) | ref `base64_encode`/`base64_decode`/`md5`/`sha1`, str text | `base64_encode` / `base64_decode` / `md5_string_utf8` / `sha1_string_utf8` | |
| `dat_game` (compat) | ref `save`/`load`, str name | `game_save` / `game_load` | |

## System
| Opcode | Arguments | GML | Notes |
|---|---|---|---|
| `sys_log` | any message | `show_debug_message` | Goes to the dev console. |
| `sys_alert` (compat) | str text | `show_message` | In-canvas modal; pauses the game like GM does. |
| `sys_confirm` (compat) | str text | `show_question` | Same; returns a bool. |
| `sys_error` (hidden) | str text, bool abort | `show_error` | Cap. |
| `sys_game_end` | - | `game_end` | Cap. Returns to the player menu. |
| `sys_game_restart` | - | `game_restart` | Cap. |
| `sys_device` (hidden) | ref `language`/`info` | `os_get_language` / `os_get_info` | `os_type`/`os_browser` are built-in variables (`_lv`), shown in the same dropdown. |
| `sys_now` | - | `date_current_datetime` | |
| `sys_date` | ref `year`/`month`/`day`/`hour`/`minute`/`second`/`weekday`, num? datetime | `date_get_*` | Scratch 'current [year]'. Leaving out datetime = now; gm2kr folds `date_get_*(date_current_datetime())` into that form. |
| `sys_url_open` (hidden) | str url | `url_open` | Opens a new tab after a confirmation. |
| `sys_param` (compat, family) | ref `count`/`string`/`env`, ... | `parameter_count` / `parameter_string` / `environment_get_variable` | Empty values in the browser. |
| `sys_callstack` (hidden) | - | `debug_get_callstack` | |

## Unsupported
These have no opcode. Importing them fails loudly with the function name and offset.

* `physics_*` / `phy_*` - not implemented.
* `execute_string` / `execute_file` - not supported, for security.
* `http_*` / `network_*` - not supported, by design.
* `external_call` / `external_define` / `shell_execute` - not supported.
