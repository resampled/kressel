# gm2kr
gm2kr, when built, creates a page that converts a GameMaker game folder (data.win plus the files next to it) to a downloadable .krpj (a zip of game.json & assets), or hands the result straight to krplayer with **Play in krplayer**.

The player URL for that button comes from `<meta name="gm2kr-player-url">` in the page (dev: `http://localhost:8000/`).

Converting and zipping run in a Web Worker, so the page stays responsive; a status line with a progress bar shows the current step (decompiling, texture pages, sprites, sounds, ...). The worker is the page's own script (`gm2kr.js`, which checks whether it is running in a worker), so the build still makes one file; if that script is on another origin (a CDN), the worker loads it with `importScripts`. The .ogg option runs on the page because it needs WebAudio, which waits on the browser between files rather than blocking.

## What converts today
Verified on a GM 2024 (bytecode 17) game (asteroids), on Deltarune Chapters 1 and 2 (bytecode 17, GMS2.3+ compiler) and on ch1_ribbit_mod (bytecode 16, GMS2 pre-2.3: a mod of the 2018 Chapter 1 with PNG texture pages, 2D arrays, scripts called by name and runtime-loaded sprites/fonts from `spr/`):
* **Code:** every code entry, including GMS2.3+ functions (child entries), try/catch, global script init code (GLOB), methods, struct literals and constructors, `switch`, `repeat`, `for`/`continue`, `with`, multi-dimensional arrays, `callv` method calls and `??`. Extension GML functions (standalone `gml_Script_` entries) become functions too. Script assets (SCPT) keep their indices; a 2.3+ script asset maps to a `gml_GlobalScript_<asset>` function holding its global body, which code calling the asset by name also calls.
* **Assets:** sprites (untrimmed PNG frames, precise collision masks), sprite fonts, tile sets (BGND), paths (PATH), GLSL ES shaders (SHDR), sounds: embedded (AUDO), audio groups (`audiogroupN.dat`) and external files next to the game.
* **Rooms:** views, instance layers (with GM instance ids and creation code), background layers (colour or sprite, tiled/stretched, scrolling), asset layers (GMS1-style tiles and sprites), tile layers.
* **Included files:** everything else in the folder is packed under `files/`, except the runner's own files (data.win, audio groups, `options.ini`, executables and libraries) and **audio the game never names**: an `.ogg`/`.wav`/`.mp3` is only included when its file name (or path) appears as a string in the game, or starts with a string of 4+ name characters while its extension is also a string (names built at runtime, e.g. `"keygen" + string(n) + ".ogg"`), since games often ship music they don't use (Deltarune's `mus/` holds every chapter's).

Anything else fails loudly with the chunk, code entry or address: timelines, HLSL-only shaders, try/finally, sequences/particles in asset layers, PNG texture pages and any GML function without an opcode in krpj_opcodes.md.

## Compressing .ogg audio (optional)
Music is most of a converted project's size, so the page has a **Compress .ogg audio** option (off by default) with a bitrate (default 64 kbps, total for all channels). It re-encodes every `.ogg` in the output (`sounds/` and `files/`) as Ogg Opus and keeps the original wherever the result isn't smaller or the file can't be re-encoded (logged). File names and `game.json` don't change, so it can be toggled after converting. Deltarune Chapter 1 at 64 kbps: 48.6 MB of `.ogg` becomes 22.7 MB (the `.krpj` goes from 73.8 MB to 47.8 MB).

* It is lossy, and audio is resampled to 48 kHz (Opus's rate). Lengths in seconds are unchanged: the encoder's lead-in and padding are trimmed by the Ogg headers, so loops keep their length.
* The page encodes with WebCodecs (`AudioEncoder`, `src/opus_web.ts`); the option is disabled in browsers without it. The Ogg container is written by `oggOpus` in `src/emit/ogg.ts`.
* Players need Ogg Opus support in `decodeAudioData` (checked in Firefox; not yet checked in Chrome or Safari).
* `.wav` and `.mp3` files are left alone.

## Converting from Node
`convert(dataWin, extraFiles)` in `src/convert.ts` has no DOM dependency, so the same pipeline runs in tests (`gm2kr/test/emit.test.ts` converts and plays `samples/asteroids/data.win` when present) and from the command line:

```
node scripts/convert.ts samples/chapter1_windows samples/chapter1.krpj
```

Add `--ogg-kbps=64` for the .ogg option above; from Node it encodes with `ffmpeg` (libopus), which must be on PATH.

`extraFiles` maps paths relative to the game folder (`"mus/battle.ogg"`) to loaders, so large folders are only read as needed.
