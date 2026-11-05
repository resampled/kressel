# gm2kr
gm2kr, when built, creates a page that converts a GameMaker game folder (data.win plus the files next to it) to a downloadable .krpj (a zip of game.json & assets), or hands the result straight to krplayer with **Play in krplayer**.

The player URL for that button comes from `<meta name="gm2kr-player-url">` in the page (dev: `http://localhost:8000/`).

## What converts today
Verified on a GM 2024 (bytecode 17) game (asteroids) and on Deltarune Chapter 1 (bytecode 17, GMS2.3+ compiler):
* **Code:** every code entry, including GMS2.3+ functions (child entries), global script init code (GLOB), methods, struct literals and constructors, `switch`, `repeat`, `for`/`continue`, `with`, multi-dimensional arrays and `callv` method calls. Script assets (SCPT) keep their indices.
* **Assets:** sprites (untrimmed PNG frames), sprite fonts, tile sets (BGND), sounds: embedded (AUDO), audio groups (`audiogroupN.dat`) and external files next to the game.
* **Rooms:** views, instance layers (with GM instance ids and creation code), background layers (colour or sprite, tiled/stretched, scrolling), asset layers (GMS1-style tiles and sprites), tile layers.
* **Included files:** everything else in the folder is packed under `files/`, except the runner's own files (data.win, audio groups, `options.ini`, executables and libraries) and **audio the game never names**: an `.ogg`/`.wav`/`.mp3` is only included when its file name (or path) appears as a string in the game, since games often ship music they don't use (Deltarune's `mus/` holds every chapter's).

Anything else fails loudly with the chunk, code entry or address: paths, timelines, shaders, sequences/particles in asset layers, PNG texture pages, precise masks (converted as rotated rectangles), and any GML function without an opcode in krpj_opcodes.md.

## Converting from Node
`convert(dataWin, extraFiles)` in `src/convert.ts` has no DOM dependency, so the same pipeline runs in tests (`gm2kr/test/emit.test.ts` converts and plays `samples/asteroids/data.win` when present) and from the command line:

```
node scripts/convert.ts samples/chapter1_windows samples/chapter1.krpj
```

`extraFiles` maps paths relative to the game folder (`"mus/battle.ogg"`) to loaders, so large folders are only read as needed.
