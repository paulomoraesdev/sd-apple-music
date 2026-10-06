import streamDeck from "@elgato/streamdeck";

/**
 * Remembers the value of a Music setting that Music will not reliably report back.
 *
 * Shuffle, repeat and favorite all have the same failure mode: the write lands but the read
 * comes back empty, so a naive toggle reads "off" every time and writes "on" every time. The
 * control turns on once and then appears dead.
 *
 * This keeps a local record of what was last written, and prefers Music's own answer whenever
 * Music actually gives one. So the toggle alternates even against a mute Music, and still
 * self-corrects the moment a real reading arrives -- including when the user changes the
 * setting from Music's own UI.
 *
 * @template T The value being tracked.
 */
export class ToggleState<T> {
	/** What we last wrote, used only while Music declines to answer. */
	#assumed: T | undefined;

	/** The last value Music actually reported, used to detect a write that did not stick. */
	#lastReported: T | undefined;

	/** Human-readable name, for log messages. */
	readonly #label: string;

	/** Set once we have warned that Music is not reporting this setting. */
	#warned = false;

	/**
	 * Initializes a new instance of the {@link ToggleState} class.
	 * @param label Name of the setting, used in log messages.
	 */
	constructor(label: string) {
		this.#label = label;
	}

	/**
	 * Resolves the value to act on, preferring Music's own reading.
	 * @param reported What the latest poll reported, or undefined when Music would not say.
	 * @param fallback Value to assume when neither Music nor local memory knows.
	 * @returns The best available value.
	 */
	public resolve(reported: T | undefined, fallback: T): T {
		if (reported !== undefined) {
			this.#lastReported = reported;
			this.#assumed = reported;
			return reported;
		}

		if (!this.#warned) {
			this.#warned = true;
			streamDeck.logger.warn(
				`Music is not reporting ${this.#label}; falling back to locally tracked state. ` +
					`Raw status will show an empty field for it.`,
			);
		}

		return this.#assumed ?? fallback;
	}

	/**
	 * Records a value that has just been written to Music.
	 * @param value The value written.
	 */
	public remember(value: T): void {
		this.#assumed = value;
	}

	/**
	 * Notes whether a write actually took effect, once a real reading is available.
	 *
	 * A write that Music reports back as unchanged means the property is not writable on this
	 * version -- worth saying once in the log rather than leaving the user to wonder.
	 * @param expected The value that was written.
	 * @param reported The value Music subsequently reported, if any.
	 */
	public verify(expected: T, reported: T | undefined): void {
		if (reported === undefined || reported === expected) {
			return;
		}

		if (this.#lastReported === reported) {
			streamDeck.logger.warn(
				`Wrote ${this.#label}=${String(expected)} but Music still reports ${String(reported)}; ` +
					`this property appears to be read-only on this version of Music.`,
			);
		}
	}

	/** Forgets the local value, for when it no longer applies (e.g. the track changed). */
	public reset(): void {
		this.#assumed = undefined;
		this.#lastReported = undefined;
	}
}
