## What this project is
 
Kratience is a browser-based Deltarune fangame creator: an editor (kreditor), a web player (krplayer), a GameMaker-to-Kratience project converter (gm2kr) and a publish directory. This repo contains all these but the publish directory.

Read relevant docs before editing:
* /docs/architecture.md -> gm2kr/krplayer structure, rules and decisions
* /docs/gm2kr.md -> GameMaker games to Kratience project converter
* /docs/gm_gotchas.md -> GameMaker common gotchas/things to notice
* /docs/krpj.md -> Kratience project format (.krpj) reference
* /docs/krpj_opcodes.md -> Kratience opcode & vs. GML disassembly reference
* /docs/compat_matrix.csv -> GameMaker compatibility reference

Backend framework (outside this project) is Django (with access to a CDN). Be consistent to existing data with visual design/stylesheets.

When editing, use all 3 projects to construct a reimplementation of the GameMaker runtime that can: 
1. import a compiled GameMaker `data.win` (bytecode build, not YYC) and convert it to the Kratience project format (w/ assets), and
2. run those projects, plus projects authored with visual scripts, in the browser.
The Django site (accounts, publishing, storage, pages) is separate. The engine must not depend on it.

## Workflow
* Monorepo uses pnpm workspaces. Run `pnpm typecheck` and `pnpm test` after any TS change and `pnpm build` before calling work done. Never mix in npm/yarn lockfiles.
* After editing docs/krpj_opcodes.md, run `pnpm gen:opcodes` and commit the regenerated krplayer/src/opcodes.gen.ts.
* Dev servers: `pnpm dev:editor`, `pnpm dev:player`, `pnpm dev:gm2kr`.
* Keep each change inside one package where possible. If a change crosses packages (e.g. a new opcode), update gm2kr (emit), krplayer (execute) and docs/krpj_opcodes.md in the same change.

## Format & compatibility
* docs/krpj.md is the source of truth for .krpj. Change the doc and the code together, and bump the schema version for any breaking change.
* Shared format types (krplayer/src/krpj.ts) are defined once. Import them in gm2kr/kreditor rather than redefining them.
* When a compat_matrix.csv row's status changes, update its "Build progress" column.

## GameMaker fidelity
* Match observed GameMaker runtime behaviour, not the manual, when the two disagree. Write every quirk you find into docs/gm_gotchas.md with a short repro.
* Never "fix" GML semantics in the interpreter (e.g. real/string coercion, `with` iteration order, instance creation order). Visual scripts may hide quirks, imported code may not.
* Unknown opcodes/functions: fail loudly with the name and offset, don't silently no-op.

## Performance (krplayer)
* No per-frame allocations in the hot loop (step/draw/interpreter dispatch). Reuse objects and arrays.
* Prefer typed arrays and switch-based dispatch over closures per instruction.
* Profile before optimizing, and say what you measured.

## Engine boundaries
* krplayer/gm2kr/kreditor must not import Django-specific code or hardcode kr.mindfang.com. Take base URLs (CDN paths) as config.
* gm2kr input (data.win) is untrusted. Bounds-check every read and cap allocation sizes.

## Legal/content
* Don't commit Deltarune/Undertale assets or any data.win. Test files stay local (gitignored).

## kreditor
GUI similar to Scratch/TurboWarp with its own features. kreditor is plain JS while the other two packages are TS.

## krplayer
Capabilities attempt to match GameMaker and mimic its quirks so base game demo & existing mods can be converted seamlessly. Should be relatively lag-free.

## gm2kr
Comprehensive testing of gm2kr outputs can be done by loading the output into krplayer.

## URL and storage layout (for reference)
 
```
Web:     kr.mindfang.com/ | /play/<slug> | /editor | /editor?pj=<slug>
Static:  /static/kr/kr_player.js, /static/kr/kr_editor.js
CDN:     /kr/so/~<alias>/*   shared objects
         /kr/sa/~<alias>/*   shared asset files
         /kr/pj/<slug>/*     project data (global.json is the main project file)
```
 
(Note: the compat matrix refers to shared assets as `/kr/sa/*`. Both notations mean the paths above.)
