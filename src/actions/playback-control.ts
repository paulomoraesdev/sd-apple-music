import streamDeck, {
	action,
	SingletonAction,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type FeedbackPayload,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { nextTrack, playPause, previousTrack, type MusicStatus } from "../music/applescript.js";
import { artworkFor } from "../music/artwork-cache.js";
import { buildStripArtwork } from "../music/artwork-key.js";
import { poller } from "../music/poller.js";
import { resolveShuffle, toggleShuffle } from "../music/shuffle-control.js";
import { volumeControl } from "../music/volume-control.js";

/** Detents a spin must cross before another track change fires. */
const SKIP_THRESHOLD = 2;

/** How long the dial must be held, without turning, to count as a long press. */
const LONG_PRESS_MS = 500;

/** Volume change per detent while the dial is pressed. */
const VOLUME_STEP = 5;

/** How long the volume overlay stays on the strip after the last pressed rotation. */
const VOLUME_OVERLAY_MS = 1_500;

/** Edge length of the artwork item in the touch strip layout, in pixels. */
const ARTWORK_SIZE = 44;

/** Upper bound of the progress bar's default range. */
const PROGRESS_MAX = 100;

/** Shown in place of a time Music will not report. */
const UNKNOWN_TIME = "--:--";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;

/** Images drawn on the strip, relative to the plugin folder. */
const IMAGES = {
	placeholder: "imgs/actions/playback-control/placeholder.svg",
	shuffleOn: "imgs/actions/shuffle/on.svg",
	shuffleOff: "imgs/actions/shuffle/off.svg",
	playing: "imgs/actions/play-pause/play.svg",
	paused: "imgs/actions/play-pause/pause.svg",
} as const;

/** A pixmap item that can be hidden, as accepted by `setFeedback`. */
type PixmapItem = { value?: string; enabled: boolean };

/** Everything drawn on the strip, keyed by the item keys in `layouts/playback-control.json`. */
type Strip = {
	artwork: string;
	track: string;
	artist: string;
	position: string;
	shuffle: PixmapItem;
	state: PixmapItem;
	duration: string;
	progress: number;
};

/** An in-progress press of the dial. */
type Press = {
	/** Fires the long-press action; cleared on release or rotation. */
	timer: NodeJS.Timeout | undefined;
	/** Set when the dial turned while pressed, so release does not toggle playback. */
	rotated: boolean;
	/** Set when the long press fired, so release does not toggle playback. */
	consumed: boolean;
};

/** Bookkeeping for one visible dial. */
type Dial = {
	action: DialAction;
	unsubscribe: () => void;
	/** Serialised value of every strip item last sent, to skip unchanged writes. */
	rendered: Map<string, string>;
	/** Bumped on every render, so a slow render cannot overwrite a newer one. */
	generation: number;
	/** Accumulated detents, reset when a track change fires or direction reverses. */
	ticks: number;
	/** When this dial last changed the volume, for the overlay. */
	volumeInputAt: number;
	press: Press | undefined;
};

/**
 * Playback on a dial: the current track, its progress, and the controls to move through it.
 *
 * - Turn: change track. A couple of detents per track, so a flick of the wrist does not skip
 *   six songs.
 * - Turn while pressed: Music's own volume (not the system's).
 * - Press: play / pause, on release -- the release is what tells a press from a long press.
 * - Hold without turning: toggle shuffle.
 * - Tap the strip: play / pause.
 */
@action({ UUID: "com.paulomoraesdev.applemusic.playback-control" })
export class PlaybackControl extends SingletonAction {
	/** Visible dials, by action id. */
	readonly #dials = new Map<string, Dial>();

	/** Strip-sized artwork, cached against the track it belongs to. */
	#artwork: { trackId: string; image: string } | undefined;

	/**
	 * Starts rendering the current track on this dial.
	 * @param ev Event, including the action that appeared.
	 */
	override onWillAppear(ev: WillAppearEvent): void {
		if (this.#dials.has(ev.action.id) || !ev.action.isDial()) {
			return;
		}

		const dial: Dial = {
			action: ev.action,
			unsubscribe: () => {},
			rendered: new Map(),
			generation: 0,
			ticks: 0,
			volumeInputAt: 0,
			press: undefined,
		};

		this.#dials.set(ev.action.id, dial);
		dial.unsubscribe = poller.subscribe((status) => void this.#render(dial, status));
	}

	/**
	 * Stops updating a dial that is no longer visible.
	 * @param ev Event, including the action that disappeared.
	 */
	override onWillDisappear(ev: WillDisappearEvent): void {
		const dial = this.#dials.get(ev.action.id);
		if (dial === undefined) {
			return;
		}

		clearTimeout(dial.press?.timer);
		dial.unsubscribe();
		this.#dials.delete(ev.action.id);
	}

	/**
	 * Changes track, or the volume while the dial is pressed.
	 * @param ev Event, including the number of detents turned and whether the dial is pressed.
	 */
	override async onDialRotate(ev: DialRotateEvent): Promise<void> {
		const dial = this.#dials.get(ev.action.id);
		if (dial === undefined) {
			return;
		}

		if (ev.payload.pressed) {
			await this.#changeVolume(dial, ev.payload.ticks);
			return;
		}

		await this.#changeTrack(dial, ev.payload.ticks);
	}

	/**
	 * Starts timing a press, to tell a tap from a long press on release.
	 * @param ev Event, including the action that was pressed.
	 */
	override onDialDown(ev: DialDownEvent): void {
		const dial = this.#dials.get(ev.action.id);
		if (dial === undefined) {
			return;
		}

		clearTimeout(dial.press?.timer);

		const press: Press = { timer: undefined, rotated: false, consumed: false };
		press.timer = setTimeout(() => void this.#longPress(dial, press), LONG_PRESS_MS);
		dial.press = press;
	}

	/**
	 * Toggles playback, unless the press turned into a long press or a volume change.
	 * @param ev Event, including the action that was released.
	 */
	override async onDialUp(ev: DialUpEvent): Promise<void> {
		const dial = this.#dials.get(ev.action.id);
		const press = dial?.press;
		if (dial === undefined || press === undefined) {
			return;
		}

		clearTimeout(press.timer);
		dial.press = undefined;

		if (press.rotated || press.consumed) {
			return;
		}

		await this.#togglePlayback(dial.action);
	}

	/**
	 * Toggles playback when the touch strip is tapped.
	 * @param ev Event, including the action that was tapped.
	 */
	override async onTouchTap(ev: TouchTapEvent): Promise<void> {
		await this.#togglePlayback(ev.action);
	}

	/**
	 * Steps between tracks once enough detents have accumulated in one direction.
	 * @param dial The dial that turned.
	 * @param ticks Detents turned; positive is clockwise.
	 */
	async #changeTrack(dial: Dial, ticks: number): Promise<void> {
		// Reversing discards the partial spin, so a flick back does not carry over.
		if (Math.sign(ticks) !== Math.sign(dial.ticks)) {
			dial.ticks = 0;
		}

		dial.ticks += ticks;

		while (Math.abs(dial.ticks) >= SKIP_THRESHOLD) {
			const forward = dial.ticks > 0;
			dial.ticks -= forward ? SKIP_THRESHOLD : -SKIP_THRESHOLD;

			const accepted = await (forward ? nextTrack() : previousTrack());
			if (!accepted) {
				await dial.action.showAlert();
			}
		}

		await poller.refresh();
	}

	/**
	 * Adjusts Music's volume and shows it on the strip straight away.
	 * @param dial The dial that turned while pressed.
	 * @param ticks Detents turned; positive is clockwise.
	 */
	async #changeVolume(dial: Dial, ticks: number): Promise<void> {
		if (dial.press !== undefined) {
			dial.press.rotated = true;
			clearTimeout(dial.press.timer);
		}

		const volume = volumeControl.adjust(ticks * VOLUME_STEP);
		dial.volumeInputAt = Date.now();

		await this.#send(dial, volumeItems(volume));
	}

	/**
	 * Toggles shuffle once the dial has been held long enough without turning.
	 * @param dial The dial being held.
	 * @param press The press that started the timer.
	 */
	async #longPress(dial: Dial, press: Press): Promise<void> {
		press.timer = undefined;
		if (press.rotated || dial.press !== press) {
			return;
		}

		press.consumed = true;

		const accepted = await toggleShuffle();
		if (!accepted) {
			await dial.action.showAlert();
		}
	}

	/**
	 * Toggles playback and refreshes, alerting on the dial if Music refused.
	 * @param action The dial that triggered it.
	 */
	async #togglePlayback(action: DialAction): Promise<void> {
		const accepted = await playPause();
		if (!accepted) {
			await action.showAlert();
		}

		await poller.refresh();
	}

	/**
	 * Draws the current Music snapshot on one dial.
	 * @param dial The dial to draw on.
	 * @param status Current Music snapshot.
	 */
	async #render(dial: Dial, status: MusicStatus): Promise<void> {
		dial.generation += 1;
		const generation = dial.generation;

		const artwork = await this.#artworkFor(status);

		// A newer snapshot started rendering while the artwork loaded; let that one win.
		if (generation !== dial.generation) {
			return;
		}

		const strip = describe(status, artwork);
		const showVolume = Date.now() - dial.volumeInputAt < VOLUME_OVERLAY_MS;

		await this.#send(dial, showVolume ? { ...strip, ...volumeItems(volumeControl.resolve(status.volume)) } : strip);
	}

	/**
	 * Sends only the strip items whose value changed since the last write.
	 * @param dial The dial to draw on.
	 * @param items Items to draw.
	 */
	async #send(dial: Dial, items: Partial<Strip>): Promise<void> {
		const changed: FeedbackPayload = {};

		for (const [key, value] of Object.entries(items)) {
			const serialised = JSON.stringify(value);
			if (dial.rendered.get(key) === serialised) {
				continue;
			}

			dial.rendered.set(key, serialised);
			changed[key] = value;
		}

		if (Object.keys(changed).length === 0) {
			return;
		}

		await dial.action
			.setFeedback(changed)
			.catch((error: unknown) => streamDeck.logger.error("Failed to set dial feedback", error));
	}

	/**
	 * Resolves the strip artwork for a snapshot, fetching and scaling it once per track.
	 * @param status Current Music snapshot.
	 * @returns A data URI, or the placeholder image when there is no artwork to show.
	 */
	async #artworkFor(status: MusicStatus): Promise<string> {
		if (!status.running || status.state === "stopped" || status.trackId === "") {
			return IMAGES.placeholder;
		}

		if (this.#artwork?.trackId === status.trackId) {
			return this.#artwork.image;
		}

		const png = await artworkFor(status.trackId);
		const image = png === undefined ? undefined : buildStripArtwork(png, ARTWORK_SIZE);

		if (png !== undefined && image === undefined) {
			streamDeck.logger.warn("Artwork was fetched but could not be decoded; showing the placeholder.");
		}

		this.#artwork = { trackId: status.trackId, image: image ?? IMAGES.placeholder };

		return this.#artwork.image;
	}
}

/**
 * Describes what the strip should show for a Music snapshot.
 * @param status Current Music snapshot.
 * @param artwork Image for the artwork item.
 * @returns Every strip item.
 */
function describe(status: MusicStatus, artwork: string): Strip {
	const controls = {
		shuffle: { value: resolveShuffle(status.shuffle) ? IMAGES.shuffleOn : IMAGES.shuffleOff, enabled: true },
		state: { value: status.state === "playing" ? IMAGES.playing : IMAGES.paused, enabled: true },
	};

	if (!status.running) {
		return { artwork, track: "Music", artist: "Not running", ...controls, ...emptyTimes() };
	}

	if (status.state === "stopped") {
		return { artwork, track: "Music", artist: "Stopped", ...controls, ...emptyTimes() };
	}

	return {
		artwork,
		track: status.title ?? (status.metadataUnavailable ? "Playing" : "Music"),
		artist: status.artist ?? "",
		...controls,
		position: formatTime(status.position),
		duration: formatTime(status.duration),
		progress: progressOf(status.position, status.duration),
	};
}

/**
 * Time items for a state with no track.
 * @returns Unknown times and an empty progress bar.
 */
function emptyTimes(): Pick<Strip, "position" | "duration" | "progress"> {
	return { position: UNKNOWN_TIME, duration: UNKNOWN_TIME, progress: 0 };
}

/**
 * Row 2 and the bar, repurposed to show the volume while it is being changed.
 * @param volume Volume to show, 0-100.
 * @returns The strip items that make up the volume overlay.
 */
function volumeItems(volume: number): Pick<Strip, "position" | "shuffle" | "state" | "duration" | "progress"> {
	return {
		position: "Volume",
		shuffle: { enabled: false },
		state: { enabled: false },
		duration: `${volume}%`,
		progress: volume,
	};
}

/**
 * Percentage of the track already played.
 * @param position Playhead position in seconds, if known.
 * @param duration Track length in seconds, if known.
 * @returns 0-100; 0 when either value is unknown.
 */
function progressOf(position: number | undefined, duration: number | undefined): number {
	if (position === undefined || duration === undefined || duration <= 0) {
		return 0;
	}

	return Math.round(Math.max(0, Math.min(PROGRESS_MAX, (position / duration) * PROGRESS_MAX)));
}

/**
 * Formats seconds as `m:ss`, or `h:mm:ss` from an hour up.
 * @param seconds Time in seconds, if known.
 * @returns The formatted time, or a placeholder when unknown.
 */
function formatTime(seconds: number | undefined): string {
	if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
		return UNKNOWN_TIME;
	}

	const total = Math.floor(seconds);
	const hours = Math.floor(total / SECONDS_PER_HOUR);
	const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
	const remainder = String(total % SECONDS_PER_MINUTE).padStart(2, "0");

	if (hours === 0) {
		return `${minutes}:${remainder}`;
	}

	return `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`;
}
