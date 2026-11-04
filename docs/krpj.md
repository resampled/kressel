# Kratience Project Format (KRPJ)
KRPJ is the main project file for Kratience, generated from its editor and interpreted by the engine as text/json.

The editor works somewhat like Scratch/TurboWarp does, and the (interpreted) scripting blocks in KRPJs reflect the codeblocks as they appear in the editor.

.KRPJ files are read by Kressel to launch the game.

All non-text resources are external files not in the KRPJ, either as assets in the project folder (./asset.ext) or shared assets (/sa/~someone/asset.ext). (e.g. images, audio)

This is to allow expensive per-room assets to be loaded in during room transitions, among other advancements.

KRPJ is not a one-to-one data.win-to-JSON representation, it is its own format built to be interpreted in a web player. Where the ease & speed of the Kratience engine & editor benefits, changes will be made from GameMaker's setup (for example, the use of individual textures over texture maps).

## Example Small Project Structure
```jsonc
{
    "krpj_v": "0.1", // kratience version. stuck at 0.1 for now
    "cfg_db_relay": { // for double checking information about the project from the DB
        "slug": "coin-collector",
        "title": "Coin Collector",
        "author": "admin",
        "revision": 1,
        "date_created": 1793770552, // timestamp(z)
        "date_updated": 1793770552,
    },
    "cfg_gm_compat": {
        "imported_from": null,
        // if imported from a gamemaker project, has some info about the origin
    },
    "cfg_defaults": { // can be changed via game scripting
        "width": "default",
        "height": "default",
        "fps": 60,
        "window_title": "Coin Collector",
    },
    "cfg_project": { // can't be changed via game scripting
        "init_room": "room_main"
    },
  "sprites": {
    "spr_VleMv5v8Og": {
      "name": "player",
      "frames": ["./sprites/spr_player/0.png", "./sprites/spr_player/1.png"],
      "origin": [16, 16],
      "speed": 8
    },
    "spr_J3qvFn5sTQ": {
      "name": "coin",
      "frames": ["/sa/~admin/coin.png"],
      "origin": [8, 8],
      "speed": 0
    }
  },
  "sounds": {
    "snd_DkIcBl5DhB": { "name": "coin", "src": "/sa/~admin/snd_coin.ogg", "volume": 0.8, "stream": false }
  },
  "fonts": {
    "fnt_G785KWucVA": { // fonts are the exception to individual textures: pre-rendered to an atlas, like GameMaker
      "name": "main",
      "atlas": "./fonts/fnt_main.png", // glyph texture page
      "font_name": "Arial", // source font, used by the editor to regenerate the atlas
      "size": 16,
      "bold": false,
      "italic": false,
      "antialias": 1,
      "line_height": 19,
      "ranges": [[32, 127]],
      "glyphs": { // char code: [x, y, w, h, shift, offset]
        "32": [2, 2, 4, 19, 4, 0],
        "48": [8, 2, 9, 19, 9, 0],
        "83": [19, 2, 11, 19, 11, 0]
        // ...
      },
      "kerning": { "84": [[65, -1]] } // char code: [[next char code, amount], ...]
    }
  },
  "functions": {
    "fnc_giAqiCrTp2": {
      "args": ["amount"],
      "body": [
        ["var_set", ["_iv", ["_kw", "global"], "score"],
          ["opr_add", ["_iv", ["_kw", "global"], "score"], ["_lv", "amount"]]]
      ]
    }
  },
  "objects": {
    "obj_player": {
      "sprite": "spr_VleMv5v8Og",
      "parent": null,
      "visible": true,
      "persistent": false,
      "scripts": [
        ["evt_create", [
          ["var_set", ["_lv", "move_speed"], 4],
          ["var_set", ["_iv", ["_kw", "global"], "score"], 0]
        ]],
        ["evt_step", [
          ["ctr_if", ["sen_key_held", 39], [
            ["var_set", ["_lv", "x"], ["opr_add", ["_lv", "x"], ["_lv", "move_speed"]]]
          ]],
          ["ctr_if", ["sen_key_held", 37], [
            ["var_set", ["_lv", "x"], ["opr_sub", ["_lv", "x"], ["_lv", "move_speed"]]]
          ]]
        ]],
        ["evt_drawgui", [
          ["drw_set_font", ["_as", "fnt_G785KWucVA"]],
          ["drw_text", 8, 8,
            ["opr_add", "Score: ", ["opr_string", ["_iv", ["_kw", "global"], "score"]]]]
        ]]
      ]
    },
    "obj_coin": {
      "imported_from": "/so/~admin/free-coin-object.krso", // indicates this was imported from a shared object
      "sprite": "spr_J3qvFn5sTQ",
      "parent": null,
      "visible": true,
      "persistent": false,
      "scripts": [
        ["evt_collision", ["_as", "obj_player"], [
          ["fnc_g", "fnc_giAqiCrTp2", 10],
          ["snd_play", ["_as", "snd_DkIcBl5DhB"], 1, false],
          ["ins_destroy"]
        ]]
      ]
    }
  },
  "rooms": {
    "room_main": {
      "width": 640,
      "height": 360,
      "preload": ["spr_VleMv5v8Og", "spr_J3qvFn5sTQ", "snd_DkIcBl5DhB", "fnt_G785KWucVA"],
      "layers": [
        {
          "name": "Background",
          "type": "background",
          "depth": 100,
          "color": 3355443,
          "sprite": null
        },
        {
          "name": "Instances",
          "type": "instances",
          "depth": 0,
          "instances": [
            { "object": "obj_player", "x": 320, "y": 300 },
            { "object": "obj_coin", "x": 120, "y": 300 },
            { "object": "obj_coin", "x": 520, "y": 300 }
          ]
        }
      ],
      "scripts": [
        ["evt_create", [
          ["sys_log", "Room started"]
        ]]
      ]
    }
  }
}
```

Roughly equivalent GML for `obj_player`'s step event:
```gml
if (keyboard_check(vk_right)) x = x + move_speed;
if (keyboard_check(vk_left))  x = x - move_speed;
```