# Architecture
How gm2kr and krplayer are structured, and the rules that keep them maintainable. Read this before adding a new module.

## Pipelines
```
gm2kr:    data.win ─► Reader ─► chunk parsers ─► GmModel ─► decompiler ─► emitter ─► zip
krplayer: .krpj ─► loader/validate ─► compiler ─► VM + runtime ─► platform (render/audio/input)
```
Each stage takes plain data and returns plain data, so it can be tested and dumped on its own. No stage reaches back into an earlier one: chunk parsers don't see the decompiler, builtins don't see the JSON.

**krplayer never walks the JSON script tree at runtime.** The compiler turns scripts into flat typed-array bytecode at load time. Variable names become slot indices and opcode names become numeric ids. The tree stays editor-friendly, and the hot loop gets switch dispatch with no allocations.

## Layout
```
gm2kr/src/
  io/reader.ts      the ONLY code that touches data.win bytes (bounds checks, count caps, offsets in errors)
  datawin.ts        FORM/chunk listing
  format.ts         version detection, once → GmFormat flags
  chunks/           one parser per chunk (gen8.ts, strg.ts, code.ts, ...)
  model.ts          GmModel: GameMaker-side types, not krpj        (todo)
  decompile/        disasm → cfg → structure → toKrpj, separate passes (todo)
  emit/             krpj, textures (TPAG → PNGs), audio            (todo)
  index.ts          UI only

krplayer/src/
  krpj.ts           shared format types (imported by gm2kr/kreditor)
  opcodes.ts        opcode registry (+ opcodes.gen.ts, generated)
  config.ts         base URLs, injected by the host page
  platform/         Renderer/Audio/Input/Storage interfaces + headless (webgl/webaudio todo)
  compile/          tree → bytecode, name resolution              (todo)
  vm/               dispatch loop, call frames, with-stack       (todo)
  value.ts          all GML coercion/equality/int64/undefined rules (todo)
  runtime/          instances (creation/iteration order), events, rooms, collision (todo)
  builtins/         one file per opcode category: ins.ts, drw.ts, snd.ts, ...   (todo)
```

## Rules
* **Untrusted input goes through `Reader`.** No `DataView` elsewhere in gm2kr. Every count read from the file goes through `count(max)`, and every pointer through `ptr()`.
* **Version checks go through flags.** Chunk parsers test `fmt.gms23` etc., never raw version numbers. GEN8's version is unreliable for GMS2 (often 2.0.0.0), so `format.ts` infers newer versions from chunk presence and layout probes. Each flag has a comment saying how it's detected.
* **Opcodes have one source: `docs/krpj_opcodes.md`.** `pnpm gen:opcodes` parses it into `krplayer/src/opcodes.gen.ts` (commit both). A test fails if the generated file is stale. gm2kr and krplayer both import `opcodes.ts`. Numeric ids are internal and never written to a .krpj, so reordering the doc is safe.
* **GML semantics live in two places.** `value.ts` holds the value rules and `runtime/instances.ts` holds instance order. Builtins call into them and never re-implement coercion.
* **The runtime only sees `Platform`.** No DOM, WebGL, WebAudio or fetch outside `platform/`. Keep platform arguments flat (no per-call objects) for the hot loop.
* **Errors name the place.** Format errors carry the file offset. Unknown opcodes and functions carry the object/event/offset. Nothing silently no-ops.
* **Browser code has no Node types.** Package tsconfigs exclude `@types/node`; only tests and `scripts/` (`tsconfig.test.json`) get it.
* **Imports use `.ts` extensions and erasable syntax only** (no enums, namespaces or constructor parameter properties). Node runs the tests directly, with no build step.

## Decisions
* **Unstructurable control flow fails loudly.** krpj has no goto. If the decompiler can't rebuild structured control flow (`if`/loops/`switch`/`with`) for a code entry, conversion fails with the code entry name and bytecode offset. It doesn't emit a fallback opcode or skip the code. GML has no goto, so this should only happen through compiler quirks. Add a hidden compat opcode only if real games need it, and update this note and krpj_opcodes.md when you do.
* **Supported bytecode versions are 15–17.** Anything else is rejected by `detectFormat`.

## Testing
`pnpm test` runs `node --test` on `gm2kr/test` and `krplayer/test` (Node ≥ 23 for type stripping).

1. **Unit tests**: Reader, format detection, value rules, each decompiler pass. Use the synthetic data.win builders in `gm2kr/test/util.ts`.
2. **Golden decompile tests** (todo): small GML snippets covering `with`, `switch` fall-through, `&&`/`||`, `break`/`exit` inside `with`, `static`. Build each in GameMaker and snapshot the krpj output. Commit the GML source and the expected output; the data.win stays in gitignored `samples/`.
3. **Trace tests** (todo): headless krplayer runs N frames and dumps instance state, compared against a log from the same game in real GameMaker. Every `gm_gotchas.md` repro becomes one of these.

## Build order
Get a thin end-to-end slice working first, then widen one opcode category at a time, updating the compat matrix "Build progress" as you go:
1. **Chunks:** GEN8, STRG, CODE, VARI, FUNC, OBJT, ROOM, SPRT, TPAG, TXTR
2. **Runtime:** create/step/draw events, `draw_sprite`, keyboard input
3. **Result:** a sprite moving in krplayer
