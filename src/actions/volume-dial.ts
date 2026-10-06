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

import { nextTrack, playPause, type MusicStatus } from "../music/applescript.js";
import { poller } from "../music/poller.js";
import { volumeControl } from "../music/volume-control.js";

/** Settings for the volume dial. */
type VolumeDialSettings = {
	/** Volume change per detent, 1-25. */
	step?: number;
};

/** Default volume change per detent. */
const DEFAULT_STEP = 5;

/**
 * Volume on a dial.
 *
 * Coalescing, the optimistic window and the unknown-is-not-zero rule live in the shared
 * {@link volumeControl}, so this dial and the Playback Control dial agree on the volume.
 */
@action({ UUID: "com.paulomoraesdev.applemusic.volume-dial" })
export class VolumeDial extends SingletonAction<VolumeDialSettings> {
	/** Visible dials, mapped to their unsubscribe function. */
	readonly #bound = new Map<string, () => void>();

	/**
	 * Starts rendering volume on this dial.
	 * @param ev Event, including the action that appeared.
	 */
	override onWillAppear(ev: WillAppearEvent<VolumeDialSettings>): void {
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
	override onWillDisappear(ev: WillDisappearEvent<VolumeDialSettings>): void {
		this.#bound.get(ev.action.id)?.();
		this.#bound.delete(ev.action.id);
	}

	/**
	 * Adjusts volume, coalescing fast spins into a single write.
	 * @param ev Event, including the number of detents turned.
	 */
	override async onDialRotate(ev: DialRotateEvent<VolumeDialSettings>): Promise<void> {
		const step = clampStep(ev.payload.settings.step);

		// Paint straight away; the write to Music follows on the flush timer.
		await this.#paint(ev.action, volumeControl.adjust(ev.payload.ticks * step));
	}

	/**
	 * Toggles playback when the dial is pressed.
	 * @param ev Event, including the action that was pressed.
	 */
	override async onDialDown(ev: DialDownEvent<VolumeDialSettings>): Promise<void> {
		await playPause();
		await poller.refresh();
	}

	/**
	 * Skips to the next track when the touch strip is tapped.
	 * @param ev Event, including the action that was tapped.
	 */
	override async onTouchTap(ev: TouchTapEvent<VolumeDialSettings>): Promise<void> {
		await nextTrack();
		await poller.refresh();
	}

	/**
	 * Draws the current volume, unless the user is mid-spin.
	 * @param action The dial to draw on.
	 * @param status Current Music snapshot.
	 */
	async #render(action: Action<VolumeDialSettings>, status: MusicStatus): Promise<void> {
		if (volumeControl.isAdjusting()) {
			return;
		}

		await this.#paint(action, volumeControl.resolve(status.volume));
	}

	/**
	 * Writes a volume value to the touch strip.
	 * @param action The dial to draw on.
	 * @param volume Volume to show, 0-100.
	 */
	async #paint(action: Action<VolumeDialSettings>, volume: number): Promise<void> {
		if (!action.isDial()) {
			return;
		}

		await action
			.setFeedback({ title: "Volume", value: `${volume}%`, indicator: { value: volume } })
			.catch((err) => streamDeck.logger.error("Failed to set dial feedback", err));
	}
}

/**
 * Clamps the configured step to a sane range.
 * @param step Step from settings.
 * @returns A step between 1 and 25.
 */
function clampStep(step: number | undefined): number {
	if (step === undefined || !Number.isFinite(step)) {
		return DEFAULT_STEP;
	}

	return Math.max(1, Math.min(25, Math.round(step)));
}
