# Stream Deck+ Plugin for Apple Music

A Stream Deck plugin for the macOS Music app. Nine actions: seven keys and two dials.

Written from scratch against the [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/)
and the Music app's AppleScript dictionary. No code, artwork, or assets from any other
plugin.

This is a plugin I created for my personal use and released to the public in-case it's
useful to anyone else. It is not supported software, and I make no guarantees on
performance or future releases. **Use at your own risk**.

It was written entirely with Claude Code. The images and some of the copy associated with the plugin were also generated with Claude.

## Actions

| Action | Controller | Behaviour |
| --- | --- | --- |
| Play / Pause | Key | Toggles playback, showing the current album art. Paused dims the cover behind a play triangle; playing adds a small pause badge. |
| Next Track | Key | Skips forward. |
| Previous Track | Key | Within 3s, steps back a track; after that, restarts the current one. |
| Shuffle | Key | Toggles shuffle, showing the current state. |
| Repeat | Key | Cycles off → all → one. |
| Favorite | Key | Favorites the current track (falls back to `loved` on older Music versions). |
| Playlist | Key | Starts a specific playlist, optionally turning shuffle on first. |
| Volume | Dial | Rotate for volume, push to play/pause, tap for next track. |
| Transport | Dial | Rotate to change track, push or tap to play/pause. The strip shows the track and artist. |

## Design notes

**One poller, not nine.** Every visible action subscribes to a single shared timer that reads
Music once per second in one `osascript` call. Nine actions on a page means one process per
second, not nine — the Marketplace guidelines cap plugins at ten updates per second. The
timer stops entirely when no action is visible, and backs off to 5s while Music is closed.

**Never launch Music to read it.** Whether Music is running is decided in Node with `pgrep`,
not in AppleScript. Entering a `tell application "Music"` block starts the app, which would
be hostile on a once-per-second poll, and asking AppleScript the question instead means
compiling app terminology on every poll — itself a failure mode when the app is closed.
Commands do use `tell`: pressing Play should open Music.

**Unknown is not off.** Every field Music declines to report comes back as `undefined`, never
as a zero or a false. An earlier version defaulted a failed read to "off", which made the
toggles one-way (every press computed "turn it on") and sent the volume dial to 0%. Where a
reading is genuinely unavailable, the control falls back to what it last wrote, and defers to
Music the instant a real reading arrives.

**Failures are logged.** The osascript wrapper reports stderr rather than swallowing it. A
silent `undefined` is indistinguishable from "Music says everything is off", which is how two
releases shipped undiagnosable.

**Artwork is composited, not layered.** `sips` normalises whatever Music hands back -- JPEG,
TIFF, a 3000px scan -- into a 144px PNG, and `png.ts` draws the state indicator onto the
pixels. The alternative, an SVG wrapping the art in a data URI, would make the result depend
on Stream Deck's SVG renderer honouring a nested `<image>`, which this plugin cannot verify.
A plain PNG has no such question over it.

**The macOS 26 `current track` defect.** On Tahoe and later, `current track` raises `-1728`
for Apple Music catalogue tracks, autoplayed tracks, and anything played from the Home,
Radio or Recently Added tabs. Library tracks played from Songs or an album still work
([FB19908171](https://developer.apple.com/forums/thread/798267)). Every track property is
therefore read in its own `try`, so a title that fails does not take the volume and playback
state down with it. When Music is playing something it will not name, the Transport dial shows
"Playing" rather than going blank, and Favorite shows an alert rather than appearing to work.

**Dials coalesce.** A fast spin fires one rotation event per detent. Writing each one would
queue dozens of `osascript` processes and lag seconds behind the user's hand. Instead the
target is accumulated locally, the touch strip updates immediately, and a single write is
flushed once the spin stops. Incoming polls are ignored for 700ms after the last rotation, so
a stale reading never yanks the dial backwards.

## Building

```bash
npm install
npm run build          # bundles src/ into the .sdPlugin folder
npm run check          # typecheck
npx streamdeck validate org.paulomoraesdev.applemusic.sdPlugin
npx streamdeck pack org.paulomoraesdev.applemusic.sdPlugin
```

Icons are generated, not hand-drawn — `python3 tools/make-icons.py` redraws every SVG and PNG
from the geometry in that script.

`src/music/png.ts` is a self-contained PNG decoder, encoder and compositor. It is the one part
of this plugin that can be tested without a Mac, and it is tested: round-trip against all five
8-bit colour types `sips` can emit.

## Requirements

- macOS 12 or later
- Stream Deck 6.5 or later (dials need 6.5+)

## License

MIT
