import streamDeck from "@elgato/streamdeck";

import { getLastRawStatus, getStatus, type MusicStatus } from "./applescript.js";

/** Listener invoked with each new status snapshot. */
type Listener = (status: MusicStatus) => void;

/** How often to poll Music while at least one action is visible. */
const POLL_INTERVAL_MS = 1_000;

/**
 * How often to poll while Music is not running. Backing off avoids spawning an osascript
 * process every second for a user who simply does not have Music open.
 */
const IDLE_INTERVAL_MS = 5_000;

/**
 * A single shared poller for the whole plugin.
 *
 * Every visible action subscribes to this rather than running its own timer. With eight
 * actions on a page that is the difference between one osascript process per second and
 * eight -- and the Marketplace guidelines cap plugins at ten updates per second.
 *
 * The timer only runs while at least one action is subscribed, so a plugin sitting on an
 * unopened profile page costs nothing.
 */
class MusicPoller {
	/** Active subscribers. */
	readonly #listeners = new Set<Listener>();

	/** Handle for the scheduled poll, or undefined when idle. */
	#timer: NodeJS.Timeout | undefined;

	/** True while a poll is in flight, to stop slow osascript calls from stacking up. */
	#polling = false;

	/** The most recent snapshot, replayed to new subscribers so keys render immediately. */
	#last: MusicStatus | undefined;

	/**
	 * Which fields Music last refused to report.
	 *
	 * Logged whenever it changes, because "shuffle is off" and "Music will not say whether
	 * shuffle is on" look identical once parsed, and only the second one is a bug worth
	 * chasing. This is the diagnostic: the log names exactly which reads are failing.
	 */
	#unreadable = "";

	/**
	 * The last snapshot seen, or undefined if Music has not been polled yet.
	 * @returns The cached status.
	 */
	public get last(): MusicStatus | undefined {
		return this.#last;
	}

	/**
	 * Subscribes to status updates, starting the poll loop if it is not already running.
	 * @param listener Called on every poll.
	 * @returns A function that unsubscribes.
	 */
	public subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);

		// Replay the cached status so a newly-appeared key is not blank until the next tick.
		if (this.#last !== undefined) {
			listener(this.#last);
		}

		this.#start();

		return () => {
			this.#listeners.delete(listener);
			if (this.#listeners.size === 0) {
				this.#stop();
			}
		};
	}

	/**
	 * Polls immediately, outside the normal schedule.
	 *
	 * Called right after a command so the UI reflects the change without waiting up to a
	 * second. Music applies commands asynchronously, so we give it a short grace period.
	 * @param delayMs How long to wait before reading, letting Music settle.
	 */
	public async refresh(delayMs = 150): Promise<void> {
		if (delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}

		await this.#poll();
	}

	/** Starts the poll loop if it is not already running. */
	#start(): void {
		if (this.#timer !== undefined) {
			return;
		}

		void this.#poll();
		this.#schedule(POLL_INTERVAL_MS);
	}

	/** Stops the poll loop and clears the cache. */
	#stop(): void {
		if (this.#timer !== undefined) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}

		this.#last = undefined;
	}

	/**
	 * Schedules the next poll.
	 * @param delay Milliseconds until the next poll.
	 */
	#schedule(delay: number): void {
		if (this.#timer !== undefined) {
			clearTimeout(this.#timer);
		}

		this.#timer = setTimeout(() => {
			void this.#poll().then(() => {
				if (this.#listeners.size > 0) {
					this.#schedule(this.#last?.running === false ? IDLE_INTERVAL_MS : POLL_INTERVAL_MS);
				}
			});
		}, delay);
	}

	/** Reads Music once and fans the result out to every subscriber. */
	async #poll(): Promise<void> {
		if (this.#polling) {
			return;
		}

		this.#polling = true;
		try {
			const status = await getStatus();
			this.#last = status;

			const unreadable = [
				status.shuffle === undefined ? "shuffle" : "",
				status.repeat === undefined ? "repeat" : "",
				status.favorited === undefined ? "favorited" : "",
				status.running && status.title === undefined ? "title" : "",
				status.running && status.trackId === "" ? "trackId" : "",
			]
				.filter(Boolean)
				.join(",");

			if (unreadable !== this.#unreadable) {
				this.#unreadable = unreadable;
				streamDeck.logger.info(
					unreadable === ""
						? `Music is reporting every field. Raw: ${getLastRawStatus()}`
						: `Music will not report: ${unreadable}. Raw: ${getLastRawStatus()}`,
				);
			}

			for (const listener of this.#listeners) {
				try {
					listener(status);
				} catch (err) {
					streamDeck.logger.error("Status listener threw", err);
				}
			}
		} catch (err) {
			streamDeck.logger.error("Failed to poll Music", err);
		} finally {
			this.#polling = false;
		}
	}
}

/** The plugin-wide Music poller. */
export const poller = new MusicPoller();
