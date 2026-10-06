import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import streamDeck from "@elgato/streamdeck";

/**
 * Thin, defensive wrapper around the macOS Music app's AppleScript dictionary.
 *
 * Three things shape this file:
 *
 *  1. **Failures are reported, never swallowed.** An earlier version resolved `undefined` on
 *     error and discarded stderr, which made a broken status read look exactly like "Music
 *     says everything is off" -- every button worked, every reading was wrong, and nothing in
 *     the log said why. Errors are now logged once per distinct message.
 *
 *  2. **Music is never launched to read it.** Whether Music is running is decided in Node
 *     with `pgrep`, not in AppleScript. Entering a `tell application "Music"` block starts the
 *     app, and asking AppleScript the question instead means compiling app terminology on
 *     every poll -- which is itself a source of failure when the app is closed.
 *
 *  3. **On macOS 26+, `current track` raises -1728** for Apple Music catalogue tracks,
 *     autoplayed tracks, and anything played from the Home, Radio or Recently Added tabs.
 *     Every property is read in its own `try`, and an unreadable field comes back empty --
 *     which is deliberately *not* the same as "off". Conflating those two is what made the
 *     toggles one-way and the volume dial snap to zero.
 */

/** Field separator. ASCII record separator -- cannot occur in track metadata. */
const SEP = "\u001e";

const OSASCRIPT_TIMEOUT_MS = 5_000;

/** Enumerating a large playlist library takes far longer than reading the status. */
const LIST_TIMEOUT_MS = 30_000;

/** Scratch directory for artwork, created once per plugin run. */
const SCRATCH = mkdtempSync(join(tmpdir(), "music-controls-"));

/** Error messages already logged, so a failing poll does not fill the log at 1Hz. */
const reported = new Set<string>();

/** The most recent raw status line, kept for diagnostics. */
let lastRawStatus = "";

/**
 * The raw, separator-delimited line the status script last returned.
 *
 * Exposed purely for diagnosis: once parsed, "Music says shuffle is off" and "Music refused
 * to answer" look identical, and only the second is a bug.
 * @returns The raw line, with separators shown as pipes.
 */
export function getLastRawStatus(): string {
	return lastRawStatus.split(SEP).join("|");
}

/** Playback state, normalised from Music's `player state`. */
export type PlayerState = "playing" | "paused" | "stopped" | "unknown";

/** Repeat mode, normalised from Music's `song repeat`. */
export type RepeatMode = "off" | "one" | "all";

/**
 * A point-in-time snapshot of the Music app.
 *
 * Every optional field means the same thing when absent: Music would not report it. Callers
 * must decide what to do about that rather than treating it as a zero or a false.
 */
export type MusicStatus = {
	/** Whether the Music app is currently running. */
	running: boolean;
	/** Current playback state. */
	state: PlayerState;
	/** App volume 0-100, or undefined when Music would not report it. */
	volume?: number;
	/** Playhead position in seconds, or undefined when unavailable. */
	position?: number;
	/** Track length in seconds, or undefined when unavailable. */
	duration?: number;
	/** Track title, or undefined when Music would not report it. */
	title?: string;
	/** Track artist, or undefined when Music would not report it. */
	artist?: string;
	/** Track album, or undefined when Music would not report it. */
	album?: string;
	/** Whether shuffle is enabled, or undefined when Music would not report it. */
	shuffle?: boolean;
	/** Current repeat mode, or undefined when Music would not report it. */
	repeat?: RepeatMode;
	/** Whether the current track is favorited, or undefined when Music would not report it. */
	favorited?: boolean;
	/** Name of the playlist playing, or undefined when Music would not report it. */
	playlist?: string;
	/** Stable identity for the current track. Empty when unknown. */
	trackId: string;
	/** True when Music is playing but refused to name what. */
	metadataUnavailable: boolean;
};

/** The state returned whenever Music is not running. */
const OFFLINE: MusicStatus = {
	running: false,
	state: "unknown",
	trackId: "",
	metadataUnavailable: false,
};

/**
 * Logs a failure once per distinct message.
 * @param context What was being attempted.
 * @param detail The error text.
 */
function reportOnce(context: string, detail: string): void {
	const key = `${context}:${detail}`;
	if (reported.has(key)) {
		return;
	}

	reported.add(key);
	streamDeck.logger.error(`${context}: ${detail}`);
}

/**
 * Runs a command and resolves with its trimmed stdout.
 * @param file Executable path.
 * @param args Arguments.
 * @param context Label used if it fails, for the log.
 * @param timeoutMs How long to wait before killing the command.
 * @returns Stdout, or undefined if the command failed.
 */
function run(
	file: string,
	args: string[],
	context: string,
	timeoutMs = OSASCRIPT_TIMEOUT_MS,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(file, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				// The message osascript prints is the whole diagnosis: a syntax error names the
				// offending token, a permissions failure says so outright. Throwing it away is
				// what made the last two releases undiagnosable.
				reportOnce(context, `${stderr.trim() || error.message}`);
				resolve(undefined);
				return;
			}

			resolve(stdout.trim());
		});
	});
}

/**
 * Runs an AppleScript.
 * @param script AppleScript source.
 * @param context Label used if it fails, for the log.
 * @param timeoutMs How long to wait before killing the script.
 * @returns Script output, or undefined on failure.
 */
function osascript(script: string, context: string, timeoutMs?: number): Promise<string | undefined> {
	return run("/usr/bin/osascript", ["-e", script], context, timeoutMs);
}

/**
 * Whether the Music app is currently running.
 *
 * Asked of the process table rather than of AppleScript, so a closed Music costs one cheap
 * `pgrep` instead of an AppleScript compile against an app that is not there.
 * @returns True when Music is running.
 */
async function isMusicRunning(): Promise<boolean> {
	return (await run("/usr/bin/pgrep", ["-x", "Music"], "pgrep Music")) !== undefined;
}

/**
 * Reads everything in a single osascript invocation.
 *
 * One process per poll rather than one per property: spawning osascript costs ~40ms, and the
 * Marketplace guidelines cap plugins at 10 updates per second.
 *
 * Variables are spelled out in full. Short names like `st` are a needless gamble against
 * AppleScript's terminology resolution, which will happily reinterpret a two-letter
 * identifier that collides with a scripting addition's vocabulary.
 */
const STATUS_SCRIPT = `
set fieldSeparator to (character id 30)

set playerStateText to ""
set volumeText to ""
set positionText to ""
set durationText to ""
set trackTitle to ""
set trackArtist to ""
set trackAlbum to ""
set shuffleText to ""
set repeatText to ""
set favoriteText to ""
set trackIdentifier to ""
set playlistName to ""

tell application "Music"
	try
		set playerStateText to (player state as text)
	end try
	try
		set volumeText to (sound volume as text)
	end try
	try
		set positionText to (player position as text)
	end try
	try
		if shuffle enabled then
			set shuffleText to "1"
		else
			set shuffleText to "0"
		end if
	end try
	try
		set repeatText to (song repeat as text)
	end try

	try
		set trackTitle to (name of current track)
	end try
	try
		set trackArtist to (artist of current track)
	end try
	try
		set trackAlbum to (album of current track)
	end try
	try
		set durationText to (duration of current track as text)
	end try
	try
		set trackIdentifier to (persistent ID of current track)
	end try
	try
		set playlistName to (name of current playlist)
	end try
	try
		if (favorited of current track) then
			set favoriteText to "1"
		else
			set favoriteText to "0"
		end if
	on error
		try
			if (loved of current track) then
				set favoriteText to "1"
			else
				set favoriteText to "0"
			end if
		end try
	end try
end tell

return playerStateText & fieldSeparator & volumeText & fieldSeparator & positionText & fieldSeparator & durationText & fieldSeparator & trackTitle & fieldSeparator & trackArtist & fieldSeparator & trackAlbum & fieldSeparator & shuffleText & fieldSeparator & repeatText & fieldSeparator & favoriteText & fieldSeparator & trackIdentifier & fieldSeparator & playlistName
`;

/**
 * Parses Music's `player state`.
 * @param raw Raw AppleScript value.
 * @returns Normalised player state.
 */
function toPlayerState(raw: string): PlayerState {
	switch (raw) {
		case "playing":
		case "fast forwarding":
		case "rewinding":
			return "playing";
		case "paused":
			return "paused";
		case "stopped":
			return "stopped";
		default:
			return "unknown";
	}
}

/**
 * Parses Music's `song repeat`.
 * @param raw Raw AppleScript value.
 * @returns Normalised repeat mode.
 */
function toRepeatMode(raw: string): RepeatMode {
	switch (raw) {
		case "one":
			return "one";
		case "all":
			return "all";
		default:
			return "off";
	}
}

/**
 * Parses a numeric field, tolerating empty strings and locale decimal commas.
 * @param raw Raw AppleScript value.
 * @returns The number, or undefined when unreadable.
 */
function toNumber(raw: string | undefined): number | undefined {
	if (raw === undefined || raw === "") {
		return undefined;
	}

	const value = Number.parseFloat(raw.replace(",", "."));
	return Number.isFinite(value) ? value : undefined;
}

/**
 * Reads the current state of the Music app.
 * @returns A snapshot; never rejects.
 */
export async function getStatus(): Promise<MusicStatus> {
	if (!(await isMusicRunning())) {
		lastRawStatus = "";
		return { ...OFFLINE };
	}

	const out = await osascript(STATUS_SCRIPT, "Reading Music status");
	lastRawStatus = out ?? "";

	if (out === undefined) {
		// Music is running but would not answer. Reporting it as closed would be a lie that
		// silently zeroes every control.
		return { ...OFFLINE, running: true };
	}

	const [state, volume, position, duration, title, artist, album, shuffle, repeat, favorited, trackId, playlist] =
		out.split(SEP);

	const playerState = toPlayerState(state ?? "");

	return {
		running: true,
		state: playerState,
		volume: toNumber(volume),
		position: toNumber(position),
		duration: toNumber(duration),
		title: title || undefined,
		artist: artist || undefined,
		album: album || undefined,
		shuffle: shuffle ? shuffle === "1" : undefined,
		repeat: repeat ? toRepeatMode(repeat) : undefined,
		favorited: favorited ? favorited === "1" : undefined,
		playlist: playlist || undefined,
		trackId: trackId ?? "",
		metadataUnavailable: playerState === "playing" && !title,
	};
}

/**
 * Runs a command against Music. Unlike reads, commands intentionally launch Music if it is
 * closed -- pressing Play should start the app.
 * @param body AppleScript statements to run inside a `tell application "Music"` block.
 * @param context Label used if it fails, for the log.
 * @param timeoutMs How long to wait before killing the script.
 * @returns Trimmed script output, or undefined on failure.
 */
function command(body: string, context: string, timeoutMs?: number): Promise<string | undefined> {
	return osascript(`tell application "Music"\n${body}\nend tell`, context, timeoutMs);
}

/** Toggles between playing and paused, starting Music if it is not running. */
export async function playPause(): Promise<void> {
	await command("playpause", "Play/pause");
}

/** Advances to the next track. */
export async function nextTrack(): Promise<void> {
	await command("next track", "Next track");
}

/**
 * Goes to the previous track, or restarts the current one.
 *
 * Matches the convention every hardware media remote uses: within the first three seconds a
 * press steps back a track, and after that it restarts the track you are on.
 */
export async function previousTrack(): Promise<void> {
	await command(
		`	try
		if (player position) < 3 then
			previous track
		else
			set player position to 0
		end if
	on error
		previous track
	end try`,
		"Previous track",
	);
}

/**
 * Sets the app volume.
 * @param volume Target volume, clamped to 0-100.
 */
export async function setVolume(volume: number): Promise<void> {
	const clamped = Math.max(0, Math.min(100, Math.round(volume)));
	await command(`set sound volume to ${clamped}`, "Set volume");
}

/**
 * Turns shuffle on or off.
 * @param enabled Desired shuffle state.
 */
export async function setShuffle(enabled: boolean): Promise<void> {
	await command(`set shuffle enabled to ${enabled ? "true" : "false"}`, "Set shuffle");
}

/**
 * Sets the repeat mode.
 * @param mode Desired repeat mode.
 */
export async function setRepeat(mode: RepeatMode): Promise<void> {
	await command(`set song repeat to ${mode}`, "Set repeat");
}

/**
 * Favorites or unfavorites the current track, falling back to the pre-2024 `loved` property.
 * @param favorited Desired favorite state.
 */
export async function setFavorited(favorited: boolean): Promise<void> {
	const value = favorited ? "true" : "false";
	await command(
		`	try
		set favorited of current track to ${value}
	on error
		set loved of current track to ${value}
	end try`,
		"Set favorite",
	);
}

/**
 * Starts playing a named playlist.
 * @param name Exact playlist name as it appears in Music's sidebar.
 * @param shuffle Whether to turn shuffle on before playing.
 * @returns True if the playlist was found and started.
 */
export async function playPlaylist(name: string, shuffle: boolean): Promise<boolean> {
	// Escaped for AppleScript's string literal syntax, which only special-cases these two.
	const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

	const out = await command(
		`	try
		${shuffle ? "set shuffle enabled to true" : ""}
		play playlist "${escaped}"
		return "ok"
	on error
		return "missing"
	end try`,
		"Play playlist",
	);

	return out === "ok";
}

/**
 * Lists the user's playlists, for the property inspector's picker.
 * @returns Playlist names, or an empty array if they could not be read.
 */
export async function listPlaylists(): Promise<string[]> {
	if (!(await isMusicRunning())) {
		return [];
	}

	// Joined with the record separator rather than left to osascript's list formatting, which
	// is comma-separated and so splits any playlist name that contains a comma. A large
	// library also needs longer than a status read to enumerate.
	const out = await command(
		`	try
		set oldDelimiters to AppleScript's text item delimiters
		set AppleScript's text item delimiters to (character id 30)
		set joinedNames to (name of every user playlist) as text
		set AppleScript's text item delimiters to oldDelimiters
		return joinedNames
	on error
		return ""
	end try`,
		"List playlists",
		LIST_TIMEOUT_MS,
	);

	if (!out) {
		return [];
	}

	return out
		.split(SEP)
		.map((name) => name.trim())
		.filter(Boolean);
}

/**
 * Reads the current track's artwork as a 144x144 PNG.
 *
 * Two deliberate choices here, both learned the hard way:
 *
 *  * `data of artwork 1` first, `raw data` second. `data` yields a picture the system knows
 *    how to convert; `raw data` hands back whatever bytes Music happens to be holding, which
 *    may be a format nothing downstream can read.
 *  * `sips` normalises the result. Whatever Music returns -- JPEG, TIFF, PNG, a 3000px
 *    gatefold scan -- comes out as a 144px PNG, which is the only thing the compositor and
 *    the websocket need to handle. It also caps a multi-megabyte payload at a few KB.
 *
 * @returns PNG bytes, or undefined when there is no artwork.
 */
export async function getArtwork(): Promise<Buffer | undefined> {
	const source = join(SCRATCH, "artwork.dat");
	const normalised = join(SCRATCH, "artwork.png");

	// The destination path is chosen here rather than in AppleScript: `path to temporary
	// items` resolves somewhere different under App Sandbox and is one more thing to be wrong.
	const script = `
set destinationPath to "${source}"

tell application "Music"
	try
		set artworkBytes to (data of artwork 1 of current track)
	on error
		try
			set artworkBytes to (raw data of artwork 1 of current track)
		on error
			return "none"
		end try
	end try
end tell

try
	set fileHandle to open for access (POSIX file destinationPath) with write permission
	set eof fileHandle to 0
	write artworkBytes to fileHandle
	close access fileHandle
	return "ok"
on error errorText
	try
		close access (POSIX file destinationPath)
	end try
	return "write failed: " & errorText
end try
`;

	const result = await osascript(script, "Reading artwork");
	if (result !== "ok") {
		if (result !== undefined && result !== "none") {
			reportOnce("Reading artwork", result);
		}

		return undefined;
	}

	// -s format png converts; -Z fits the long edge without distorting a non-square cover.
	const converted = await run(
		"/usr/bin/sips",
		["-s", "format", "png", "-Z", "144", source, "--out", normalised],
		"Converting artwork",
	);

	await unlink(source).catch(() => {});

	if (converted === undefined) {
		return undefined;
	}

	try {
		const png = await readFile(normalised);
		await unlink(normalised).catch(() => {});

		return png.length > 0 ? png : undefined;
	} catch (err) {
		reportOnce("Reading artwork", String(err));
		return undefined;
	}
}
