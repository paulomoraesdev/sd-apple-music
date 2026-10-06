import {
	action,
	SingletonAction,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { setShuffle } from "../music/applescript.js";
import { poller } from "../music/poller.js";
import { ToggleState } from "../music/toggle-state.js";
import { KeyStateBinding } from "./key-state-binding.js";

/** Toggles shuffle, showing whether it is currently on. */
@action({ UUID: "com.paulomoraesdev.applemusic.shuffle" })
export class Shuffle extends SingletonAction {
	/** Tracks shuffle across polls that fail to report it. */
	readonly #state = new ToggleState<boolean>("shuffle");

	/** Tracks visible keys and their poller subscriptions. */
	readonly #keys = new KeyStateBinding((status) => (this.#state.resolve(status.shuffle, false) ? 1 : 0));

	/**
	 * Starts reflecting the shuffle state on this key.
	 * @param ev Event, including the action that appeared.
	 */
	override onWillAppear(ev: WillAppearEvent): void {
		this.#keys.bind(ev.action);
	}

	/**
	 * Stops updating a key that is no longer visible.
	 * @param ev Event, including the action that disappeared.
	 */
	override onWillDisappear(ev: WillDisappearEvent): void {
		this.#keys.unbind(ev.action);
	}

	/**
	 * Flips shuffle.
	 * @param ev Event, including the action that was pressed.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const next = !this.#state.resolve(poller.last?.shuffle, false);

		// Remember before writing: the next poll may not report shuffle at all, and the key
		// still has to show the new value.
		this.#state.remember(next);
		await setShuffle(next);
		await poller.refresh();

		this.#state.verify(next, poller.last?.shuffle);
	}
}
