# kressel
Core editor, player engine & GameMaker converter for Kratience. In heavy development.

When built, the player contains two files: kressel.js and gm2krpj.js.

kressel.js loads the src of `<meta id="kressel-load-project" src="" />` (should be a game.krpj) on the page it's loaded at.

gm2kr.js creates a page that converts supplied GameMaker projects (must include data.win & referenced assets) to a downloadable .zip with a game.krpj

By default, kressel loads from .krpj (JSON) project files. These contain everything (room data, custom scripting, settings, etc.) as long as it's not a resource (audio, image, etc.) 

## Docs
* /docs/gm2kr_compat.md -> GameMaker compatibility reference
* /docs/gm2kr.md -> GameMaker games to Kratience project converter
* /docs/krpj.md -> Kratience project format (.krpj) reference
* /docs/krpj_opcodes.md -> Kratience opcode & vs. GML disassembly reference
