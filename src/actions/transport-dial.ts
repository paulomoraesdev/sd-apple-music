import streamDeck, {
	action,
	SingletonAction,
	type Action,
	type DialDownEvent,
	type DialRotateEvent,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { nextTrack, playPause, previousTrack, type MusicStatus } from "../music/applescript.js";
import { poller } from "../music/poller.js";

/** Detents a spin must cross before another track change fires. */
const SKIP_THRESHOLD = 2;

/**
 * Transport on a dial: spin between tracks, press to play or pause.
 *
 * Rotation deliberately requires a couple of detents per track. A 1:1 mapping turns an
 * ordinary flick of the wrist into six skipped songs, which is not a control anyone can aim.
 *
 * The touch strip shows the track and artist, so the dial doubles as a now-playing display.
 */
@action({ UUID: "com.paulomoraesdev.applemusic.transport-dial" })
export class TransportDial extends SingletonAction {
	/** Visible dials, mapped to their unsubscribe function. */
	readonly #bound = new Map<string, () => void>();

	/** Accumulated detents, reset each time a track change fires or direction reverses. */
	#ticks = 0;

	/** Last text written to the touch strip, to avoid redundant redraws. */
	#rendered = "";

	/**
	 * Starts rendering the current track on this dial.
	 * @param ev Event, including the action that appeared.
	 */
	override onWillAppear(ev: WillAppearEvent): void {
		if (this.#bound.has(ev.action.id)) {
			return;
		}

		this.#bound.set(
			ev.action.id,
			poller.subscribe((status) => void this.#render(ev.action, status)),
		);
	}

	/**
	 * Stops updating a dial that is no longer visible.
	 * @param ev Event, including the action that disappeared.
	 */
	override onWillDisappear(ev: WillDisappearEvent): void {
		this.#bound.get(ev.action.id)?.();
		this.#bound.delete(ev.action.id);
	}

	/**
	 * Steps between tracks once enough detents have accumulated in one direction.
	 * @param ev Event, including the number of detents turned.
	 */
	override async onDialRotate(ev: DialRotateEvent): Promise<void> {
		// Reversing discards the partial spin, so a flick back does not carry over.
		if (Math.sign(ev.payload.ticks) !== Math.sign(this.#ticks)) {
			this.#ticks = 0;
		}

		this.#ticks += ev.payload.ticks;

		while (Math.abs(this.#ticks) >= SKIP_THRESHOLD) {
			const forward = this.#ticks > 0;
			this.#ticks -= forward ? SKIP_THRESHOLD : -SKIP_THRESHOLD;

			await (forward ? nextTrack() : previousTrack());
		}

		await poller.refresh();
	}

	/**
	 * Toggles playback when the dial is pressed.
	 * @param ev Event, including the action that was pressed.
	 */
	override async onDialDown(ev: DialDownEvent): Promise<void> {
		await playPause();
		await poller.refresh();
	}

	/**
	 * Toggles playback when the touch strip is tapped.
	 * @param ev Event, including the action that was tapped.
	 */
	override async onTouchTap(ev: TouchTapEvent): Promise<void> {
		await playPause();
		await poller.refresh();
	}

	/**
	 * Writes the current track to the touch strip.
	 * @param action The dial to draw on.
	 * @param status Current Music snapshot.
	 */
	async #render(action: Action, status: MusicStatus): Promise<void> {
		if (!action.isDial()) {
			return;
		}

		const title = status.running
			? (status.title ?? (status.metadataUnavailable ? "Playing" : "Music"))
			: "Music";
		const value = status.running
			? (status.artist ?? (status.state === "playing" ? "Playing" : "Paused"))
			: "Not running";

		const signature = `${title}|${value}`;
		if (signature === this.#rendered) {
			return;
		}

		this.#rendered = signature;

		await action
			.setFeedback({ title: truncate(title, 18), value: truncate(value, 18) })
			.catch((err) => streamDeck.logger.error("Failed to set dial feedback", err));
	}
}

/**
 * Truncates text to fit the touch strip.
 * @param text Text to truncate.
 * @param max Maximum characters.
 * @returns The truncated text.
 */
function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
