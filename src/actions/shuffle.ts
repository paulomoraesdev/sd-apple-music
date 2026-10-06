import {
	action,
	SingletonAction,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { resolveShuffle, toggleShuffle } from "../music/shuffle-control.js";
import { KeyStateBinding } from "./key-state-binding.js";

/** Toggles shuffle, showing whether it is currently on. */
@action({ UUID: "com.paulomoraesdev.applemusic.shuffle" })
export class Shuffle extends SingletonAction {
	/** Tracks visible keys and their poller subscriptions. */
	readonly #keys = new KeyStateBinding((status) => (resolveShuffle(status.shuffle) ? 1 : 0));

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
		await toggleShuffle();
	}
}
