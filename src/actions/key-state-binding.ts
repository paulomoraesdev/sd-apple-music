import streamDeck, { type Action, type State } from "@elgato/streamdeck";

import type { MusicStatus } from "../music/applescript.js";
import { poller } from "../music/poller.js";

/** Derives the key state (0 or 1, or 0-2 for repeat) from a Music snapshot. */
type StateSelector = (status: MusicStatus) => State;

/**
 * Keeps a set of visible keys showing the right state, and nothing more.
 *
 * Several actions in this plugin are the same shape -- a key whose image should track a
 * boolean read off Music. Rather than repeat the subscribe/unsubscribe/dedupe dance in each
 * one, they share this.
 *
 * The dedupe matters: Stream Deck redraws a key on every `setState`, so writing the same
 * state once a second makes keys flicker on some devices. We only write on change.
 */
export class KeyStateBinding {
	/** Visible actions, mapped to their unsubscribe function and last written state. */
	readonly #bound = new Map<string, { unsubscribe: () => void; state: State | undefined }>();

	/** Derives the desired state from a status snapshot. */
	readonly #select: StateSelector;

	/**
	 * Initializes a new instance of the {@link KeyStateBinding} class.
	 * @param select Maps a Music snapshot to the state the key should show.
	 */
	constructor(select: StateSelector) {
		this.#select = select;
	}

	/**
	 * Begins driving a key's state from the Music poller.
	 * @param action The action that became visible.
	 */
	public bind(action: Action): void {
		if (this.#bound.has(action.id)) {
			return;
		}

		const entry: { unsubscribe: () => void; state: State | undefined } = {
			unsubscribe: () => {},
			state: undefined,
		};

		entry.unsubscribe = poller.subscribe((status) => {
			if (!action.isKey()) {
				return;
			}

			const next = this.#select(status);
			if (next === entry.state) {
				return;
			}

			entry.state = next;
			action.setState(next).catch((err) => streamDeck.logger.error("Failed to set key state", err));
		});

		this.#bound.set(action.id, entry);
	}

	/**
	 * Stops driving a key that is no longer visible.
	 *
	 * Takes the identity rather than a full {@link Action}: `onWillDisappear` only hands back
	 * an action context, since the action no longer exists to be drawn on.
	 * @param action Identity of the action that disappeared.
	 */
	public unbind(action: { readonly id: string }): void {
		const entry = this.#bound.get(action.id);
		if (entry === undefined) {
			return;
		}

		entry.unsubscribe();
		this.#bound.delete(action.id);
	}
}
