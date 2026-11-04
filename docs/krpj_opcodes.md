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
* `ctr_*` - Control (e.g. if, for, wait, doing)
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
(add more where it's reasonable)

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

* `evt_step` - Executes each step ('on update' in some langs)
> * KRPJ: ["evt_onstep",[...]]

* `evt_create` - Executes when object is instantiated.
> * KRPJ: ["evt_onstep",[...]]

* `evt_alarm` - Executes when alarm is triggered.
> * num arg1 = the reference for the alarm, min 0 max 11.
> * KRPJ: ["evt_alarm",10,[...]]
