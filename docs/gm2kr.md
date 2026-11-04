# gm2kr
gm2kr, when built, creates a page that converts supplied GameMaker projects (must include data.win & referenced assets) to a downloadable zip with a game.krpj in it (& assets), or hands the result straight to krplayer with **Play in krplayer**.

The player URL for that button comes from `<meta name="gm2kr-player-url">` in the page (dev: `http://localhost:8000/`).

## What converts today
Verified on one GM 2024 (bytecode 17) game: objects and their events, rooms with instance and colour background layers, sprites, sprite fonts. Anything else fails loudly with the chunk, code entry or address: scripts/functions (SCPT, child code entries), sounds, paths, timelines, tilesets, views, PNG texture pages, precise masks, and any GML function without an opcode in krpj_opcodes.md.

## Converting from Node
`convert(dataWin)` in `src/convert.ts` has no DOM dependency, so the same pipeline runs in tests (`gm2kr/test/emit.test.ts` converts and plays `samples/asteroids/data.win` when present).
