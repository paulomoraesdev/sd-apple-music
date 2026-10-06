import streamDeck, {
	action,
	SingletonAction,
	type Action,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { playPause, type MusicStatus } from "../music/applescript.js";
import { artworkFor } from "../music/artwork-cache.js";
import { buildKeyImage } from "../music/artwork-key.js";
import { poller } from "../music/poller.js";

/** Settings for the Play / Pause key. */
type PlayPauseSettings = {
	/** Whether to use the current album art as the key image. */
	showArtwork?: boolean;
	/** Whether to draw the play/pause indicator over the art. */
	showBadge?: boolean;
	/** Whether to print the track title across the bottom of the key. */
	showTitle?: boolean;
};

/** Characters of title that fit across the key. */
const TITLE_WIDTH = 16;

/**
 * Toggles playback, showing the current album art.
 *
 * The art is composited into a PNG here rather than handed to Stream Deck as an SVG with an
 * embedded image: the SVG route depends on how Stream Deck's renderer treats a nested data
 * URI, which is not something this plugin can verify, and a plain PNG has no such question
 * hanging over it.
 *
 * Fetching art is the expensive call in this plugin, so it is cached against the track's
 * persistent ID and refetched only on a track change. With no art -- Music closed, stopped,
 * or a track it will not identify -- the key falls back to the glyph from the manifest.
 */
@action({ UUID: "com.paulomoraesdev.applemusic.play-pause" })
export class PlayPause extends SingletonAction<PlayPauseSettings> {
	/** Visible keys, mapped to their unsubscribe function and last rendered signature. */
	readonly #bound = new Map<string, { unsubscribe: () => void; signature: string }>();

	/** Composited key image, cached against the track and state it was built for. */
	#cache: { key: string; image: string | undefined } | undefined;

	/**
	 * Starts rendering playback state on this key.
	 * @param ev Event, including the action that appeared.
	 */
	override onWillAppear(ev: WillAppearEvent<PlayPauseSettings>): void {
		if (this.#bound.has(ev.action.id)) {
			return;
		}

		const entry = { unsubscribe: () => {}, signature: "" };
		entry.unsubscribe = poller.subscribe((status) => void this.#render(ev.action, status, entry));

		this.#bound.set(ev.action.id, entry);
	}

	/**
	 * Stops updating a key that is no longer visible.
	 * @param ev Event, including the action that disappeared.
	 */
	override onWillDisappear(ev: WillDisappearEvent<PlayPauseSettings>): void {
		const entry = this.#bound.get(ev.action.id);
		if (entry === undefined) {
			return;
		}

		entry.unsubscribe();
		this.#bound.delete(ev.action.id);
	}

	/** Redraws immediately when the user changes the key's options. */
	override onDidReceiveSettings(): void {
		for (const entry of this.#bound.values()) {
			entry.signature = "";
		}

		this.#cache = undefined;
		void poller.refresh(0);
	}

	/**
	 * Toggles playback.
	 * @param ev Event, including the action that was pressed.
	 */
	override async onKeyDown(ev: KeyDownEvent<PlayPauseSettings>): Promise<void> {
		await playPause();
		await poller.refresh();
	}

	/**
	 * Draws the key, skipping the write when nothing visible has changed.
	 * @param action The key to draw on.
	 * @param status Current Music snapshot.
	 * @param entry Bookkeeping for this key.
	 */
	async #render(
		action: Action<PlayPauseSettings>,
		status: MusicStatus,
		entry: { signature: string },
	): Promise<void> {
		if (!action.isKey()) {
			return;
		}

		const settings = await action.getSettings();
		const showArtwork = settings.showArtwork ?? true;
		const showBadge = settings.showBadge ?? true;
		const showTitle = settings.showTitle ?? false;
		const playing = status.state === "playing";

		const title = showTitle ? truncate(status.title ?? "", TITLE_WIDTH) : "";

		// Redrawing an unchanged key once a second makes some devices strobe.
		const signature = `${playing}|${status.trackId}|${showArtwork}|${showBadge}|${title}|${status.running}`;
		if (signature === entry.signature) {
			return;
		}

		entry.signature = signature;

		// The state still drives the fallback glyph and keeps multi-actions sensible.
		await action.setState(playing ? 1 : 0).catch(() => {});
		await action.setTitle(title).catch(() => {});

		const image = showArtwork ? await this.#imageFor(status, playing, showBadge) : undefined;

		// setImage(undefined) restores the manifest glyph.
		await action.setImage(image).catch((err) => streamDeck.logger.error("Failed to set key image", err));
	}

	/**
	 * Builds the composited key image, reusing the cache where possible.
	 * @param status Current Music snapshot.
	 * @param playing Whether Music is playing.
	 * @param badge Whether to draw the state indicator.
	 * @returns A data URI, or undefined when there is nothing to show.
	 */
	async #imageFor(status: MusicStatus, playing: boolean, badge: boolean): Promise<string | undefined> {
		if (!status.running || status.state === "stopped" || status.trackId === "") {
			return undefined;
		}

		// The badge differs between states, so the cache is keyed on both.
		const key = `${status.trackId}|${playing}|${badge}`;
		if (this.#cache?.key === key) {
			return this.#cache.image;
		}

		// Artwork is cached separately from the composite: pressing play must not refetch the
		// cover just because the badge changed.
		const png = await artworkFor(status.trackId);
		const image = png === undefined ? undefined : buildKeyImage(png, playing, badge);

		if (png !== undefined && image === undefined) {
			streamDeck.logger.warn("Artwork was fetched but could not be decoded; falling back to the glyph.");
		}

		this.#cache = { key, image };

		return image;
	}
}

/**
 * Truncates text to fit across the key.
 * @param text Text to truncate.
 * @param max Maximum characters.
 * @returns The truncated text.
 */
function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
