# AGENTS.md

## Overview
Stream Deck plugin (Stream Deck+ keys, dials and touch strip) that controls the **macOS Music app** through AppleScript (`osascript`). Maintained for personal use.

* **Plugin UUID:** `com.paulomoraesdev.applemusic` — every action UUID is prefixed with it.
* **Stack:** TypeScript (strict), `@elgato/streamdeck` SDK, Rollup, Node runtime bundled by the Stream Deck app.
* **Target:** macOS (current release), Stream Deck app 6.5+, Stream Deck+ hardware.
* **References:**
  * `README.md` — design notes. They are **binding architecture**, not history (summarised in §5).
  * `docs/music.sdef` — the Music app's AppleScript dictionary. The **only** source of truth for commands and properties.
  * Stream Deck SDK docs — query them via **Context7** (`@elgato/streamdeck`). Do not rely on memory for SDK APIs.

## 1. Interaction Rules
* **Human priority:** explicit instructions from the human always override this file.
* **Never assume — ask.** If a requirement, behaviour, UX detail, AppleScript capability or SDK API is unclear or unverified, STOP and ask. This includes, but is not limited to:
  * what an action should do on edge cases (Music closed, nothing playing, track without metadata);
  * new actions, settings, or changes to existing action behaviour;
  * anything that needs a new macOS permission;
  * any trade-off between approaches — present the options with pros/cons and let the human choose.
* **Verify before claiming:** check `docs/music.sdef` before using any AppleScript term, and the SDK docs before using any SDK API. If something cannot be verified, say so explicitly.
* **Concise communication:** no pleasantries, no apologies, no unrequested explanations. Output questions, direct answers, or code.
* **Halting:** after two failed attempts to fix the same problem, STOP and ask for context. Do not guess in a loop.
* **Read before write:** never modify a file without reading its current content.
* **Language:** reply in the language the human used. Code, identifiers, comments, logs and UI strings are **EN-US**.

## 2. Tooling & Boundaries
* **Package manager:** `npm` only.
* **No dependency installation.** If a library is essential, justify it and ask the human to install it. Prefer Node built-ins and macOS built-in tools (`osascript`, `sips`, `pgrep`).
* **No git interaction.**
* **No terminal commands unless explicitly asked.** When asked, the allowed set is:
  * `npm run build`, `npm run check`, `npm run watch`
  * `npx streamdeck validate com.paulomoraesdev.applemusic.sdPlugin`
  * `npx streamdeck restart com.paulomoraesdev.applemusic`
  * `npx streamdeck pack com.paulomoraesdev.applemusic.sdPlugin`
  * `python3 tools/make-icons.py` (icon regeneration)
* **Protected files — ask before editing:** `package.json`, `package-lock.json`, `rollup.config.mjs`, `tsconfig.json`, `LICENSE`.
* **`manifest.json`:** adding/editing an action entry is in scope when the task requires it. Changing the plugin `UUID`, existing action UUIDs, `Name`, `Version`, `SDKVersion`, `Nodejs` or `OS` requires permission.
* **Never rename an existing action UUID** — it silently breaks every key the human has already configured.
* **No deletion** of files/directories unless explicitly ordered.
* **Do not hand-edit generated output** (compiled bundle inside the `.sdPlugin` folder, generated icons). Change the source and regenerate.

## 3. Security
* **Process execution:** use `execFile`/`spawn` with an argument array. `exec`, `shell: true`, and any shell string are **FORBIDDEN**.
* **No AppleScript injection:** never interpolate user-provided values (playlist names, settings) into script source. Pass them as arguments and read them with `on run argv`:
  ```ts
  execFile("osascript", ["-e", "on run argv", "-e", 'tell application "Music" to play playlist (item 1 of argv)', "-e", "end run", playlistName]);
  ```
  If interpolation is truly unavoidable, escaping must be centralised in one tested helper — ask first.
* **Reuse the existing `osascript` wrapper** (locate it under `src/` before writing any new process call). Every call has a timeout and surfaces stderr.
* **No dynamic code:** `eval`, `new Function`, dynamic `import()` of computed paths are FORBIDDEN.
* **Validate all Property Inspector input** in the plugin (type, length, allowed values) before use. Settings coming from the PI are untrusted.
* **Least privilege:** the plugin needs only the **Automation → Music** permission. Using `System Events`, Accessibility, Full Disk Access, or controlling any other app requires explicit approval.
* **Filesystem:** write only to the plugin's own folder or a dedicated subfolder of `os.tmpdir()`. Clean up temporary files (e.g. artwork) you create.
* **No network access** of any kind, unless explicitly requested.

## 4. Privacy
* Listening data (track, artist, album, playlists, artwork) **never leaves the machine**: no telemetry, analytics, crash reporting or remote calls.
* Do not persist listening history. Cache only what the current display needs (e.g. current artwork), and overwrite it.
* Logs: no track/playlist names at `info` level or above. Use `debug` for diagnostic details and log errors without personal data where possible.

## 5. Architecture (binding — from README design notes)
* **One poller, not N:** all visible actions subscribe to a single shared timer that reads Music in **one** `osascript` call per tick. Never add a per-action poll.
* **Poll lifecycle:** start on the first `onWillAppear`, stop when no action is visible (`onWillDisappear`), back off while Music is closed.
* **Never launch Music to read it:** check if it is running in Node (`pgrep`), never with `tell application "Music"` in a read path. Commands triggered by the user (e.g. Play) may launch it.
* **Unknown is not off:** a property Music does not report is `undefined`, never `0`/`false`/`""`. Controls fall back to the last value written and defer to Music on the next real reading.
* **No silent failures:** errors are logged and, for user actions, reported with `action.showAlert()`. Empty `catch` blocks are FORBIDDEN.
* **Per-property `try` in AppleScript:** on macOS 26+, `current track` raises `-1728` for catalog/radio/autoplay tracks. Read each property in its own `try` so one failure does not drop the rest.
* **Dials coalesce:** accumulate rotation locally, update the touch strip immediately, flush a single write when rotation stops, ignore incoming polls briefly after the last tick.
* **Artwork:** normalise with `sips` to the key size and composite as PNG (existing `src/music/png.ts`). No SVG wrapping of bitmaps.

## 6. Performance
* Respect the Marketplace limit of **≤ 10 visual updates per second** across the plugin.
* Only call `setImage`/`setTitle`/`setFeedback` when the value actually changed.
* Cache artwork by track identity; never re-process the same image.
* Never block the event loop: all process calls are async, with timeouts. No `execFileSync`.
* One `osascript` process per user command; batch reads into the poller's single call.

## 7. Modern Code Standards
* **TypeScript strict.** `any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` are FORBIDDEN. Use `unknown` and narrow.
* **SDK v2 idioms:** `@action({ UUID })` decorator, `SingletonAction<Settings>`, typed settings, event handlers (`onKeyDown`, `onDialRotate`, `onDialDown`, `onTouchTap`, `onWillAppear`, `onWillDisappear`, `onDidReceiveSettings`). Encoder actions declare `Controllers: ["Encoder"]` and a touch-strip layout in `manifest.json`.
* **ESM, async/await,** explicit return types on every function, exported types for shared contracts.
* **No magic values:** timings, limits, sizes and AppleScript error codes become named constants.
* **Clean code:** guard clauses (avoid `else`), one level of indentation per block, no abbreviations (`error`, not `err`), always use braces, small single-purpose functions.
* **Reuse before writing:** search `src/` for an existing helper first. Extract shared logic on its second occurrence.
* **No lazy code:** no placeholders or `// rest unchanged`. Code must be complete — but surgical: change only the lines the task needs.
* **Scope control:** no unprompted refactoring. Report improvements outside scope instead of applying them.
* **Comments/JSDoc:** JSDoc on exported functions and actions; comments explain *why*, never narrate *what*.

## 8. Verification
Before declaring a task done (run commands only if the human asked — otherwise list them for the human):
1. `npm run check` and `npm run build` pass with no warnings introduced.
2. `npx streamdeck validate …` passes.
3. Manual checklist for the human, covering the affected actions:
   * Music closed (must not be launched by polling);
   * Music open, nothing playing;
   * library track vs. catalog/radio track;
   * fast dial spin (no lag, no jump back);
   * action removed from the deck (poller stops).

## 9. Release
* Bump `Version` in `manifest.json` (four-part, e.g. `1.0.1.0`) for every packed build — with permission (§2).
* Never modify or remove `LICENSE`.

## 10. Working with Specs
If the human mention a spec folder, you must read the specs.md file before starting. It will give you the task requirements and guidelines.
You can use other files inside the spec folder to increase the context, store memory and progress and set the final release for that task.

* context.md: use this file to add context and new/updated infos after clarifying with the human, when needed.
* progress.md: use this file to track the progress of the task, making sure to update it as you go. This file is very important for new code sessions, as it helps you keep track of what you've done and what's left to do.
* release.md: this file must contain the release notes for the current task, with what has been implemented and how.

If one of those files is not present, create it and add the relevant information if needed.
