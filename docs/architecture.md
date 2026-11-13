# Architecture
How gm2kr and krplayer are structured, and the rules that keep them maintainable. Read this before adding a new module.

## Pipelines
```
gm2kr:    data.win ─► Reader ─► chunk parsers ─► GmModel ─► decompiler ─► emitter ─► .krpj (zip)
krplayer: .krpj / game.json ─► loader/validate ─► compiler ─► VM + runtime ─► platform (render/audio/input)
```
Each stage takes plain data and returns plain data, so it can be tested and dumped on its own. No stage reaches back into an earlier one: chunk parsers don't see the decompiler, builtins don't see the JSON.

**krplayer never walks the JSON script tree at runtime.** The compiler turns scripts into flat typed-array bytecode at load time. Variable names become slot indices and opcode names become numeric ids. The tree stays editor-friendly, and the hot loop gets switch dispatch with no allocations.

## Layout
```
gm2kr/src/
  io/reader.ts      the ONLY code that touches data.win bytes (bounds checks, count caps, offsets in errors)
  datawin.ts        FORM/chunk listing
  format.ts         version detection, once → GmFormat flags
  io/bzip2.ts       bzip2 decoder for "2zoq" textures (bounded output)
  chunks/           one parser per chunk (gen8, strg, tpag, txtr, sprt, font, objt, room, code); audio.ts (SOND, AGRP,
                    AUDO, audiogroupN.dat), misc.ts (SCPT, GLOB, BGND)
  model.ts          GmModel: GameMaker-side types, not krpj
  decompile/        disasm.ts → structure.ts (stack sim + pattern structuring → krpj); program.ts (all entries,
                    child functions); builtins.ts (GML name → opcode, derived from the opcode table)
  emit/             krpj.ts, textures.ts (QOI → RGBA → PNG), zip.ts, ogg.ts (optional .ogg → Ogg Opus pass over the
                    output files; the encoder is passed in)
  convert.ts        data.win + game folder → { krpj, files }, no DOM; optional progress callback
  opus_web.ts       the page's Opus encoder (WebAudio decode + WebCodecs), browser only
  index.ts          entry: the one bundle runs as the page (page.ts, UI only) or as its worker (worker.ts)
  worker.ts         runs convert + zip off the page's thread, relaying log/progress messages

krplayer/src/
  krpj.ts           shared format types (imported by gm2kr/kreditor)
  opcodes.ts        opcode registry (+ opcodes.gen.ts, generated)
  config.ts         base URLs, injected by the host page
  platform/         Renderer/Audio/Input/Storage interfaces; headless (+ soft.ts, a software renderer for
                    screenshots in tests); web (WebGL2 batch renderer, WebAudio, keyboard, IndexedDB saves);
                    filestore (saved-file partitions and quotas, see below)
  loader/           project sources (URL, in-memory files, .krpj archive) and the gm2kr handoff
  compile/          tree → bytecode, name resolution
  vm/               dispatch loop, call frames, with-stack, copy-on-write arrays
  value.ts          all GML coercion/equality/undefined rules, structs and methods
  runtime/          assets (load + compile), instance, game (rooms, event order, drawing), layers (room layers,
                    cameras, views), draw (sprite/text/primitive helpers), sound (voices), data (ds_*, JSON, ini,
                    files, buffers), collision, effects, paths (path geometry and following)
  builtins/         one file per opcode category (ins, sen, opr, var, drw, lks, rom, cam, dat); registry.ts maps
                    opcode id → implementation, family() for family opcodes
  play.ts           source + platform → Game (browser and headless)
  eval.ts           editor entry (kressel_eval.js): runs one block in an empty headless game for "print output"

kreditor/_static/     the editor (kreditor.html): classic scripts, no modules or build step, so it also opens from file://.
                      Load order = dependency order; each file exposes one global.
  windows.js        kw: draggable/maximisable .w windows on the desk
  codeblocks.js     kreditorCode: block palette + canvas. open(kind, data) shows a function/object's scripts and edits
                    them in place; commit() writes canvas layout back; onchange fires after every edit
  krpj.js           kreditorKrpj: .krpj read (bounds-checked) / write, newProject()
  project.js        kreditorProject: the open project (game.json + files), load/save, dirty flag, undo/redo. No UI.
  views.js          kreditorViews: File menu, Undo/Redo, nav dropdowns and the main window. VIEWS maps each game.json
                    field to its editor (tabs, title, create); F holds form-field helpers. New editors are VIEWS entries.

kreditor/mockup/src/ older module-based prototype, kept for reference (dev: `pnpm dev:editor`, then open /kreditor/)
  state.js          open project + asset files, selection, undo (JSON snapshots), form helpers
  blocks.js         block canvas + palette, generated from opcodes.gen.js; pointer drag/snap/pan
  room.js           room layout editor (canvas) and room inspector
  assets.js         sprite/sound/font/tile set/included file views (import, preview, delete)
  main.js           tree, views, inspector, rename/delete (rewrites references), file menu, stage
  krpj.js, project.js  .krpj zip I/O and game.json helpers
  opcodes.gen.js    GENERATED with krplayer/src/opcodes.gen.ts

scripts/
  gen-opcodes.ts    docs/krpj_opcodes.md → krplayer/src/opcodes.gen.ts + kreditor opcodes.gen.js (kreditor/_static's also lists
                    the built-in variable names from krplayer/src/compile/names.ts)
  convert.ts        gm2kr from the command line (folder → .krpj)
```

## Rules
* **Untrusted input goes through `Reader`.** No `DataView` elsewhere in gm2kr. Every count read from the file goes through `count(max)`, and every pointer through `ptr()`.
* **Version checks go through flags.** Chunk parsers test `fmt.gms23` etc., never raw version numbers. GEN8's version is unreliable for GMS2 (often 2.0.0.0), so `format.ts` infers newer versions from chunk presence and layout probes. Each flag has a comment saying how it's detected.
* **Opcodes have one source: `docs/krpj_opcodes.md`.** `pnpm gen:opcodes` parses it into `krplayer/src/opcodes.gen.ts` (commit both). A test fails if the generated file is stale. gm2kr and krplayer both import `opcodes.ts`. Numeric ids are internal and never written to a .krpj, so reordering the doc is safe.
* **GML semantics live in two places.** `value.ts` holds the value rules and `runtime/instances.ts` holds instance order. Builtins call into them and never re-implement coercion.
* **The runtime only sees `Platform`.** No DOM, WebGL, WebAudio or fetch outside `platform/` (included files come through `Platform.fetchBytes`). Keep platform arguments flat (no per-call objects) for the hot loop.
* **Errors name the place.** Format errors carry the file offset. Unknown opcodes and functions carry the object/event/offset. Nothing silently no-ops.
* **Loud failure is for krplayer's gaps; krplayer is never stricter than GM.** Where GM logs a warning and carries on, krplayer does the same. A `GmlError` needs a cited source; an error without one is `Unverified`. See docs/error_audit.md for the error kinds and the audit.
* **Browser code has no Node types.** Package tsconfigs exclude `@types/node`; only tests and `scripts/` (`tsconfig.test.json`) get it.
* **Imports use `.ts` extensions and erasable syntax only** (no enums, namespaces or constructor parameter properties). Node runs the tests directly, with no build step.

## Decisions
* **Unstructurable control flow fails loudly.** krpj has no goto. If the decompiler can't rebuild structured control flow (`if`/loops/`switch`/`with`) for a code entry, conversion fails with the code entry name and bytecode offset. It doesn't emit a fallback opcode or skip the code. GML has no goto, so this should only happen through compiler quirks. Add a hidden compat opcode only if real games need it, and update this note and krpj_opcodes.md when you do.
* **Supported bytecode versions are 15–17.** Anything else is rejected by `detectFormat`.
* **Family opcodes dispatch on their first argument** (the GML name minus the family prefix); a member krplayer doesn't implement fails when called, naming the GML function. Console SDK families (`sys_psn`, `sys_switch`) have no members at all: games only reach them on consoles.
* **Copy-on-write owners are per variable.** GM's `setowner` constants aren't stored in the project; krplayer's compiler gives each variable (scope + name, or a block's local slot) an owner token, and an array written through a variable that doesn't own it is copied first.
* **Built-in calls are opcodes, resolved at load.** The krplayer compiler maps each opcode name to its id and refuses ones with no implementation in `builtins/`, so a project that would hit an unimplemented builtin fails before it starts, naming the script path.
* **Getting a converted project into krplayer.** gm2kr's output is a set of files (`game.json` + `./` assets), which zipped together form a `.krpj`. It reaches the player one of three ways, all ending in the same `ProjectSource` (`{ krpj, url(path) }`):
  1. a URL (a `game.json` or a `.krpj`), for published projects on the CDN;
  2. a `.krpj` the user opens in the player;
  3. **in-memory handoff**: gm2kr opens the player with `?from=opener`, the player posts `kr-player-ready` to its opener, and gm2kr replies with the files as transferred ArrayBuffers (`loader/handoff.ts`). The player only accepts that message from its own opener and serves the files from blob URLs. Nothing is uploaded and the Django site isn't involved.
* **Shaders are GameMaker's GLSL ES, run by the platform.** gm2kr keeps the GLSL ES sources; the WebGL renderer rewrites GM's GLSL ES 1.00 as 3.00 (`platform/glsl.ts`, falling back to the source as written) and compiles it with GM's attribute names bound to its batch layout, and sets `gm_Matrices[4]` to its pixel-to-clip matrix (vertices are already in target pixels). The software renderer can't run GLSL, so headless screenshots draw without shaders (it warns once); this is a platform limit, like silent audio, not a GML change.
* **GML try/catch never catches krplayer's gaps.** Builtins that krplayer lacks throw `NotImplemented`, which a GML `catch` passes on, so an unimplemented feature still fails loudly inside `try`. The infinite-loop watchdog isn't catchable either.
* **Saved files.** Files a game writes (saves, ini, text, buffers) live in IndexedDB `kratience-fs`, partitioned by `cfg_db_relay.slug` (`_unpublished` if empty). Projects loaded locally (a `.krpj` opened in the player, gm2kr's handoff, the editor's blob URL; `ProjectSource.local`) use `_<slug>` instead, so a local project with a published game's slug can't read or overwrite that game's saves. Published slugs must not start with `_` (the site has to enforce this). `Storage.open(slug)` loads that partition into memory while assets load, so file calls stay synchronous; every write goes straight through to IndexedDB. Each project gets 500 KB (path + contents, UTF-8). A write that would go over is refused with a warning and the old file is kept. All projects together get 50 MB: a write that would go over evicts the least recently written files of *other* projects first. If two tabs run the same game, each keeps its own in-memory copy, and the last write wins (`platform/filestore.ts`).
* **Files loaded at runtime are decoded while assets load.** `sprite_add`, `font_add` and friends are synchronous in GM. So `loadAssets` decodes included images (`Platform.decodeImage`) and registers included fonts (`Platform.fonts`) up front, and the builtins then make textures with `Renderer.createTexture`. Both platform members are optional: without them, those builtins fail loudly. Images stay CPU-side because strips can be wider than the max texture size (ch1_ribbit_mod has a 26520 px one).
* **Debug params need `?debug`.** `?room`, `?direct`, `?after`, `?set` and `?call` are ignored (with a console warning) unless `?debug` is also on the URL.
* **Debug start room.** `?debug&room=<name|index>` on the player URL (works with any source, e.g. `?from=opener&debug&room=room_town_krisyard`) still runs global init and the init room, but the game's first room change goes to that room instead, so setup code in the init room (e.g. Deltarune's `obj_initializer`) still runs. Add `&direct` to enter the room straight away and skip the init room, or `&after=<room>` to warp on the first room change *out of* that room instead, for games whose setup room isn't the first (Deltarune Ch2: `?debug&room=room_castle_town&after=ROOM_INITIALIZE`; playtest: `--after`). It's a debug option: imported code isn't changed, and flags the skipped rooms would set stay unset.
* **Debug start state.** With `?room=`, `&set=name=value` (or `name[i]=value`, optional `global.` prefix) sets a global and `&call=fn` (or `fn(1,"a")`) calls a project function as global. They run in URL order just before the warp room is entered (after the init room, so its resets don't undo them). Each param can repeat or take a comma list. Values are numbers, `true`/`false` (1/0) or strings (`"quoted"` when they contain commas). Unknown functions fail when the page loads (`runtime/debug.ts`). Example: Deltarune Ch1's init runs `scr_gamestart` (darkzone 0, plot 0, Kris alone), so `?room=room_field3` alone gives a light-world Kris in a dark room; `?debug&room=room_field3&set=darkzone=1,plot=40,char[1]=2,char[2]=3` starts it as the game would (dark world, Susie and Ralsei following).
* **Editor stage.** kreditor plays the open project by zipping it to a blob URL and loading `kressel.js` in a `srcdoc` iframe, with `<meta id="kressel-load-project" src=blob>`. Two embed metas exist for this: `kressel-query` stands in for `location.search` (a srcdoc frame has none; "play this room" passes `debug&room=<key>&direct`), and `kressel-autostart` skips the click-to-start prompt (the Play click was the gesture). The player script URL and the shared asset base are `kreditor-player` / `kreditor-shared-assets` metas on the editor page.
* **Editor history.** kreditor edits `game.json` in place and records undo per unit: one asset (`game[field][key]`) or one top-level field (`cfg_defaults`). A view `watch()`es its units when it opens and `touch()`es them after each edit; a changed unit's before/after JSON becomes one undo step. So undo only copies the edited asset, which matters for imports with thousands of them. Opening an asset may normalise it (bare scripts get canvas positions, missing config objects get created); that happens before `watch()`, so it never shows up as an edit.
* **Editor "print output".** Right-clicking a reporter in kreditor evaluates it with `kressel_eval.js` (`src/eval.ts`), loaded on first use from the editor page's `kreditor-eval` meta. The block runs as the create event of the only instance in an empty headless game, through the normal compiler and VM, so results and errors follow the same GML rules as a real run; it does not see the open project's state.
* **Editor layout lives on the scripts.** Script positions and loose stacks are saved inline as `{ x, y, script, loose }` entries (krpj.md "Script layout"). The engine reads only `script` and skips anything that can't run (loose, hat-less, or a hat with nothing under it) instead of failing, since a canvas mid-edit is normal. Asset keys are the names the user types (like gm2kr), so renaming rewrites every reference (`_as`, `_fn`, `fnc_g`, object/room/layer fields, `room_order`...).
* **Debug console handle.** `?debug` puts the running `Game` on `window.kr` (e.g. `kr.room.name`, `kr.roomIndex`). Without it nothing is exposed.

## Testing
`pnpm test` runs `node --test` on `gm2kr/test` and `krplayer/test` (Node ≥ 23 for type stripping).

1. **Unit tests**: Reader, format detection, value rules, each decompiler pass. Use the synthetic data.win builders in `gm2kr/test/util.ts`.
2. **Golden decompile tests** (todo): small GML snippets covering `with`, `switch` fall-through, `&&`/`||`, `break`/`exit` inside `with`, `static`. Build each in GameMaker and snapshot the krpj output. Commit the GML source and the expected output; the data.win stays in gitignored `samples/`.
3. **Trace tests** (todo): headless krplayer runs N frames and dumps instance state, compared against a log from the same game in real GameMaker. Every `gm_gotchas.md` repro becomes one of these.

## Build order
Get a thin end-to-end slice working first, then widen one opcode category at a time, updating the compat matrix "Build progress" as you go:
Steps 1–3 are done for the asteroids sample (plus collisions, alarms, fonts and room restart). Deltarune Chapter 1 converts completely and runs through its intro (contact sequence, vessel creation and naming) in krplayer. Deltarune Chapter 2 converts completely, plays its intro to the file menu, and its rooms load and draw (light world, Castle Town, Cyber World, Cyber City) with debug warps. Deltarune Chapter 3 converts completely and plays from its intro through file select and naming into the opening couch scene (cutscene, dialogue, walking with Susie following). Deltarune Chapter 4 converts completely, loads, shows its file menu and naming, and plays the opening fountain cutscene; its light and dark world rooms load and draw with debug warps (particles, animation curves and `call_later` fail when called).

1. **Chunks:** GEN8, STRG, CODE, VARI, FUNC, OBJT, ROOM, SPRT, TPAG, TXTR
2. **Runtime:** create/step/draw events, `draw_sprite`, keyboard input
3. **Result:** a sprite moving in krplayer
