import streamDeck from "@elgato/streamdeck";

import { setVolume } from "./applescript.js";
import { poller } from "./poller.js";
import { ToggleState } from "./toggle-state.js";

/** Volume assumed when neither Music nor local memory knows. */
const FALLBACK_VOLUME = 50;

/** Lowest and highest volume Music accepts. */
const MIN_VOLUME = 0;
const MAX_VOLUME = 100;

/** Delay before the accumulated volume is written, so a fast spin becomes one write. */
const FLUSH_DELAY_MS = 120;

/**
 * How long the user's input wins over an incoming poll.
 *
 * Music applies `set sound volume` asynchronously, so a poll landing mid-spin reports the old
 * value and the dial visibly jumps backwards.
 */
const OPTIMISTIC_WINDOW_MS = 700;

/**
 * Music's app volume, adjusted by dials.
 *
 * Rotation is coalesced: a fast spin fires one event per detent, and writing each one would
 * queue dozens of osascript processes behind the user's hand. The target is accumulated
 * locally, callers paint it immediately, and one write is flushed when the spin stops.
 *
 * An unreadable `sound volume` is *unknown*, not zero: an unknown reading leaves the locally
 * tracked value alone. Treating it as zero is what once snapped the dial to 0%.
 */
class VolumeControl {
	/** Tracks volume across polls that fail to report it. */
	readonly #state = new ToggleState<number>("volume");

	/** The volume the user is spinning towards, held while writes are in flight. */
	#target: number | undefined;

	/** When the user last adjusted the volume. */
	#lastInput = 0;

	/** Pending flush of {@link #target} to Music. */
	#flush: NodeJS.Timeout | undefined;

	/**
	 * When the volume was last adjusted from a dial, in epoch milliseconds.
	 * @returns The timestamp, or 0 if it has never been adjusted.
	 */
	public get lastInput(): number {
		return this.#lastInput;
	}

	/**
	 * Moves the volume by a relative amount and schedules a single write to Music.
	 * @param delta Volume change, positive or negative.
	 * @returns The new target volume, 0-100, for the caller to paint straight away.
	 */
	public adjust(delta: number): number {
		const base = this.#target ?? this.#state.resolve(poller.last?.volume, FALLBACK_VOLUME);

		this.#target = Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, base + delta));
		this.#lastInput = Date.now();
		this.#state.remember(this.#target);
		this.#scheduleFlush();

		return this.#target;
	}

	/**
	 * Whether the user's recent input should win over a poll.
	 * @returns True while still inside the optimistic window.
	 */
	public isAdjusting(): boolean {
		return Date.now() - this.#lastInput < OPTIMISTIC_WINDOW_MS;
	}

	/**
	 * Resolves the volume to show for a poll, preferring Music's reading once the user stops.
	 * @param reported Volume from the latest poll, or undefined when Music would not say.
	 * @returns The volume to display, 0-100.
	 */
	public resolve(reported: number | undefined): number {
		// Only surrender the local target to a reading that actually exists. Clearing it on an
		// unknown reading is what sent the dial back to zero.
		if (reported !== undefined && !this.isAdjusting()) {
			this.#target = undefined;
		}

		return this.#target ?? this.#state.resolve(reported, FALLBACK_VOLUME);
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

			setVolume(target).catch((error: unknown) => streamDeck.logger.error("Failed to set volume", error));
		}, FLUSH_DELAY_MS);
	}
}

/** The plugin-wide volume control, shared so every dial agrees on the target. */
export const volumeControl = new VolumeControl();
