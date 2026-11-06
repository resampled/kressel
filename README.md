# kressel
Core editor (kreditor), player engine (krplayer/kressel.js) & GameMaker converter (gm2kr) for Kratience. In heavy development.

kressel.js loads the src of `<meta id="kressel-load-project" src="" />` (a .krpj project, or an unpacked game.json) on the page it's loaded at. The page must also provide the player shell: a `.kr-root` element containing a `<canvas>` and a `.kr-msg` (see krplayer/index.html); the canvas is scaled to fit `.kr-root`.

gm2kr.js creates a page that converts supplied GameMaker projects (must include data.win & referenced assets) to a downloadable .krpj project

Kratience projects are .krpj files: zip archives containing game.json plus the project's assets. game.json holds everything (room data, custom scripting, settings, etc.) that isn't a resource (audio, image, etc.); resources sit next to it in the archive or come from shared assets.

The recommended "launch dev build from source" command (from root folder) is `pnpm run dev:convert` to run krplayer and gm2kr cocurrently, and `pnpm run dev:editor` to start the editor.

## Docs
* /docs/gm2kr.md -> GameMaker games to Kratience project converter
* /docs/krpj.md -> Kratience project format (.krpj) reference
* /docs/krpj_opcodes.md -> Kratience opcode & vs. GML disassembly reference
* /docs/compat_matrix.csv -> GameMaker compatibility reference

## Further information
Kratience is a web directory (hooked up to a larger Django backend), currently in development, where people can play & mod Deltarune fangames on the browser. Kratience as a project aims to emulate Deltarune's logic as closely as possible while supporting ease of modding (through its editor, copying projects & shared objects).