---
name: playtest
description: Playtest a Kratience/GameMaker game headlessly in krplayer with scripted input, screenshots and state dumps. Use when asked to playtest, try, smoke-test or check a sample game (samples/), a converted .krpj, or whether a krplayer/gm2kr change works in a real game.
---

# Headless playtest

`scripts/playtest.ts` runs a project in krplayer's headless platform (fake clock, scripted keys, silent audio,
software renderer) and prints what happens. It's deterministic: the same commands always give the same frames.

```
pnpm playtest <project.krpj | game folder with data.win> [options] "<cmd>; <cmd>; ..."
```

A game folder (e.g. `samples/asteroids`) is converted on the fly with gm2kr, so it always reflects the
current converter. `samples/*.krpj*` files may be stale or in an old layout. Prefer the folder.

## Options
- `--out <dir>`: where screenshots go (default `playtest-out/`, gitignored). Keep it inside the repo.
- `--room <name|index>` [`--direct`]: debug warp (same as the player's `?room=`; `--direct` skips the init room).
- `--after <room>`: with `--room`, warp on the first room change out of that room (games whose setup room isn't the first, e.g. Deltarune Ch2: `--after ROOM_INITIALIZE`).
- `--set <name=v,...>` / `--call <fn(args),...>`: with `--room`, set globals / call functions before the warp room (same as the player's `?set=` / `?call=`).
- `--shared <dir>`: local folder for `/sa/` shared assets.
- `--render-all`: rasterize every frame. By default only the last frame of each run is drawn (~250 ms/frame
  at 1000x1000 otherwise). Use it if a game accumulates drawing on a persistent surface, or reads pixels back
  (`buffer_get_surface`, `surface_getpixel`): skipped frames read back zeros (e.g. Ch2 darkbulb `obj_shapepuzzle`'s md5 goal).

## Commands
| command | effect |
|---|---|
| `60f` / `wait 60` | run 60 frames |
| `until 5` | run until fake time reaches 5 s |
| `press Z` / `press Z 10` / `hold Z 10` | key down for 1 (or N) frames, then up for 1 frame |
| `down Z` / `up Z` | key state only (combine with `Nf` for chords) |
| `shot name` | save the window to `<out>/name.png` (view it with Read) |
| `state` / `state obj_player` | room + instance counts, or per-instance x/y/angle/sprite |
| `var obj_game._points` / `var global.flag` | print a variable (builtins like `image_angle` work too) |

Keys: `A-Z 0-9 Left Right Up Down Enter Space Shift Ctrl Alt Esc Tab Backspace F1-F12`, or a GML key code.
Pressed/released latches clear after each step, as in GM.

## How to playtest
1. Read the game's input code first instead of guessing controls: convert with `node scripts/convert.ts <folder> <scratch>/x.krpj`,
   unzip `game.json` and look at `objects.<name>.scripts` (`sen_key_held`, `sen_key_pressed` take key codes).
2. Start short (`30f; state; shot start`), look at the screenshot, then script the next step from what you saw.
   Each invocation restarts the game, so replay the earlier commands and extend them.
3. Check claims with `state`/`var` as well as pixels. Before calling something a rendering bug, work out where the
   expected geometry should land; sprites rotated off-axis are easy to misread.
4. Errors print `ERROR at frame N (room R)` with the stack and save `error.png`. Unknown opcodes/functions fail
   loudly by design, so treat them as findings (gm2kr emit or krplayer builtins), never as things to no-op.
5. Report what you did, what you saw (screenshot paths) and anything that differs from the GML's intent.
   Quirks confirmed against real GameMaker go in `docs/gm_gotchas.md`.

## Deltarune samples: light/dark world state for warps
Both chapters' init runs `scr_gamestart`, which leaves you in the light world at the very start: `darkzone=0`,
`plot=0`, `char=[1,0,0]` (Kris alone). A `--room` warp doesn't change these, so a dark room shows light-world Kris
(small sprites, no party, light text boxes/typer). Set the state the room expects:

| what | globals |
|---|---|
| world | `darkzone=1` dark (2x sprites, dark dialogue box, follower offsets) / `darkzone=0` light. `scr_become_dark`/`scr_become_light` also convert HP/items, but setting the flag is enough for rooms |
| party | `char[0]=1` Kris (always), `char[1]`, `char[2]`: 2 Susie, 3 Ralsei, 4 Noelle (Ch2), 0 empty. Followers spawn as `obj_caterpillarchara` |
| story | `plot`: rooms/NPCs/cutscenes gate on it (`plot < N` triggers an event, `>= N` removes it). Pick one at or after the room's cutscene |

- **Ch1** (`samples/chapter1_windows`, no `--after` needed): light world = defaults (`plot` 0–10 before the closet).
  Dark world: `--set darkzone=1,plot=40,char[1]=2,char[2]=3` (e.g. `room_field3`; verified).
- **Ch2** (`samples/chapter2_windows`, always `--after ROOM_INITIALIZE`): light world = defaults.
  Dark world: `--set darkzone=1,plot=60,char[1]=2,char[2]=3` (Cyber World, e.g. `room_dw_cyber_savepoint`; verified).
  Plot milestones from the cutscene code (unverified): Castle Town ~10–15, Cyber field entry 50–51,
  City with Noelle 70–99 (`char[1]=4,char[2]=0`), mansion 120–160, ending/back to light world 200+.
- Check with `var global.darkzone` / `var global.char` / `state` (count `obj_caterpillarchara`) before trusting a screenshot.

Not covered: WebGL renderer, real audio, timing/feel. For those, run `pnpm dev:player` and use the browser.
