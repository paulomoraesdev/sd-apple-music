# Apple Music for Stream Deck+

Control the Music app on your Mac straight from a Stream Deck: transport keys, playback toggles,
one-press playlists and two Stream Deck+ dials.

> [!WARNING]
> This is a personal project, shared in case someone else finds it handy. It comes with no
> support, no warranty and no promise of future updates. You use it at your own risk.

## At a glance

- **9 actions**: 7 keys and 2 dials
- Built from the ground up on the [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/) and
  the AppleScript dictionary of Music. It contains no code, artwork or assets taken from other plugins.
- The code was written with Claude Code. Claude also generated part of the plugin's text.
- Icons are from [Iconoir](https://iconoir.com), under the MIT license.

## What's included

### Keys

- **Play / Pause**: starts or stops playback and uses the current album cover as the key image.
  When paused, the cover is dimmed and a play triangle sits on top. While playing, a small pause
  badge shows in the corner.
- **Next Track**: moves to the next song.
- **Previous Track**: in the first 3 seconds of a song, goes to the previous track. After that,
  it restarts the song that is playing.
- **Shuffle**: turns shuffle on or off. The key shows which state is active.
- **Repeat**: steps through *off*, *all* and *one*, then back to *off*.
- **Favorite**: marks the current song as a favorite. On older versions of Music it uses `loved`
  instead.
- **Playlist**: starts the playlist you choose. It can turn shuffle on before it starts.

### Dials (Stream Deck+)

| Dial | Rotate | Press | Touch |
| --- | --- | --- | --- |
| **Volume** | changes the volume | play / pause | next track |
| **Transport** | changes track | play / pause | play / pause |

The Transport dial's touch strip shows the song title and the artist.

## How it works

### A single shared poller

The actions don't poll Music one by one. Every visible action subscribes to one timer, and that
timer reads Music once per second in a single `osascript` call. So a page with all nine actions
still starts only one process per second. That matters because the Marketplace guidelines allow
at most ten updates per second per plugin. When no action is on screen, the timer stops. While
Music is closed, it slows down to one check every 5 seconds.

### Reading state never opens Music

The plugin checks whether Music is running from Node, using `pgrep`, and never from AppleScript.
Any `tell application "Music"` block launches the app, which you don't want happening every
second. Asking AppleScript instead would also mean compiling the app's terminology on every poll,
and that fails on its own when Music is closed. Commands work differently: they *do* use `tell`,
because pressing Play is supposed to open Music.

### "Unknown" is different from "off"

If Music doesn't report a field, the value is `undefined`. It is never turned into `0` or `false`.
An earlier version treated a failed read as "off". As a result the toggles only worked in one
direction (every press decided to "turn it on"), and the volume dial dropped to 0%. Now, when a
value really can't be read, the control uses the last value it wrote. As soon as Music returns a
real reading, the control follows Music again.

### Errors get logged

The `osascript` wrapper logs stderr instead of hiding it. A silent `undefined` looks exactly like
Music saying everything is off, and that is how two releases shipped with problems nobody could
diagnose.

### Artwork is baked into one PNG

Music returns covers as JPEG, TIFF, or sometimes 3000-pixel scans. `sips` converts them all to a
144 px PNG, and `png.ts` draws the state indicator directly onto those pixels. The other option
was an SVG with the artwork embedded as a data URI. That would depend on Stream Deck's SVG
renderer supporting a nested `<image>`, which the plugin has no way to confirm. A plain PNG
avoids the question entirely.

### Working around `current track` on macOS 26

On macOS Tahoe and later, `current track` fails with error `-1728` for Apple Music catalogue
songs, autoplay songs, and anything started from the Home, Radio or Recently Added tabs. Library
songs played from Songs or from an album still work
([FB19908171](https://developer.apple.com/forums/thread/798267)). Because of this, each track
property is read inside its own `try`. If the title can't be read, volume and playback state are
still reported. When Music is playing something it won't identify, the Transport dial shows
"Playing" instead of going blank, and Favorite shows an alert instead of pretending it worked.

### Dial input is batched

A fast turn sends one rotation event per detent. Writing each one would queue dozens of
`osascript` processes, and the dial would lag seconds behind your hand. Instead, the target value
is added up locally and the touch strip updates right away. A single write goes out once the
dial stops turning. For 700 ms after the last rotation, incoming polls are ignored, so an old
reading can't pull the dial backwards.

## Development

```bash
npm install
npm run build    # compiles src/ into the .sdPlugin folder
npm run check    # runs the type checker
npx streamdeck validate com.paulomoraesdev.applemusic.sdPlugin
npx streamdeck pack com.paulomoraesdev.applemusic.sdPlugin
```

**Icons:** all of them come from [Iconoir](https://iconoir.com) (MIT) and are generated by code.
`node tools/make-icons.mjs` recolours every SVG and rasterises the plugin PNGs with `sips`.

**Tests:** `src/music/png.ts` is a standalone PNG decoder, encoder and compositor. It is the only
part of the plugin that can be tested without a Mac. Its tests run a round trip through all five
8-bit color types that `sips` can output.

## Compatibility

| | Minimum version |
| --- | --- |
| macOS | 12 |
| Stream Deck | 6.5 (required for the dials) |

## License

Released under the [MIT License](LICENSE).
