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

import { nextTrack, playPause, setVolume, type MusicStatus } from "../music/applescript.js";
import { poller } from "../music/poller.js";
import { ToggleState } from "../music/toggle-state.js";

/** Settings for the volume dial. */
type VolumeDialSettings = {
	/** Volume change per detent, 1-25. */
	step?: number;
};

/** Default volume change per detent. */
const DEFAULT_STEP = 5;

/** Volume assumed when neither Music nor local memory knows. */
const FALLBACK_VOLUME = 50;

/**
 * How long the user's input wins over an incoming poll.
 *
 * Music applies `set sound volume` asynchronously, so a poll landing mid-spin reports the old
 * value and the dial visibly jumps backwards.
 */
const OPTIMISTIC_WINDOW_MS = 700;

/**
 * Volume on a dial.
 *
 * The dial used to snap to 0% because an unreadable `sound volume` was parsed as zero. It is
 * now parsed as *unknown*, and an unknown reading leaves the locally tracked value alone --
 * the same fix the toggles needed, for the same reason.
 *
 * Rotation is coalesced: a fast spin fires one event per detent, and writing each one would
 * queue dozens of osascript processes behind the user's hand. The target is accumulated
 * locally, the touch strip updates immediately, and one write is flushed when the spin stops.
 */
@action({ UUID: "com.paulomoraesdev.applemusic.volume-dial" })
export class VolumeDial extends SingletonAction<VolumeDialSettings> {
	/** Visible dials, mapped to their unsubscribe function. */
	readonly #bound = new Map<string, () => void>();

	/** Tracks volume across polls that fail to report it. */
	readonly #state = new ToggleState<number>("volume");

	/** The volume the user is spinning towards, held while writes are in flight. */
	#target: number | undefined;

	/** When the user last rotated. */
	#lastInput = 0;

	/** Pending flush of {@link #target} to Music. */
	#flush: NodeJS.Timeout | undefined;

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
		const base = this.#target ?? this.#state.resolve(poller.last?.volume, FALLBACK_VOLUME);

		this.#target = Math.max(0, Math.min(100, base + ev.payload.ticks * step));
		this.#lastInput = Date.now();
		this.#state.remember(this.#target);

		// Paint straight away; the write to Music follows on the flush timer.
		await this.#paint(ev.action, this.#target);
		this.#scheduleFlush();
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

	/** Schedules the accumulated volume to be written to Music. */
	#scheduleFlush(): void {
		if (this.#flush !== undefined) {
			return;
		}

		this.#flush = setTimeout(() => {
			this.#flush = undefined;

			const target = this.#target;
			if (target === undefined) {
				return;
			}

			setVolume(target).catch((err) => streamDeck.logger.error("Failed to set volume", err));
		}, 120);
	}

	/**
	 * Draws the current volume, unless the user is mid-spin.
	 * @param action The dial to draw on.
	 * @param status Current Music snapshot.
	 */
	async #render(action: Action<VolumeDialSettings>, status: MusicStatus): Promise<void> {
		if (Date.now() - this.#lastInput < OPTIMISTIC_WINDOW_MS) {
			return;
		}

		// Only surrender the local target to a reading that actually exists. Clearing it on an
		// unknown reading is what sent the dial back to zero.
		if (status.volume !== undefined) {
			this.#target = undefined;
		}

		await this.#paint(action, this.#state.resolve(status.volume, FALLBACK_VOLUME));
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
