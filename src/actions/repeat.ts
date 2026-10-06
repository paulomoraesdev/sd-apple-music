import {
	action,
	SingletonAction,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { setRepeat, type RepeatMode } from "../music/applescript.js";
import { poller } from "../music/poller.js";
import { ToggleState } from "../music/toggle-state.js";
import { KeyStateBinding } from "./key-state-binding.js";

/** The cycle order, matching the order of the three states declared in the manifest. */
const CYCLE: readonly RepeatMode[] = ["off", "all", "one"];

/** Cycles repeat off -> all -> one, showing the current mode. */
@action({ UUID: "com.paulomoraesdev.applemusic.repeat" })
export class Repeat extends SingletonAction {
	/** Tracks the repeat mode across polls that fail to report it. */
	readonly #state = new ToggleState<RepeatMode>("repeat");

	/** Tracks visible keys and their poller subscriptions. */
	readonly #keys = new KeyStateBinding((status) => {
		const index = CYCLE.indexOf(this.#state.resolve(status.repeat, "off"));
		return (index === -1 ? 0 : index) as 0 | 1 | 2;
	});

	/**
	 * Starts reflecting the repeat mode on this key.
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
	 * Advances to the next repeat mode.
	 * @param ev Event, including the action that was pressed.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const current = this.#state.resolve(poller.last?.repeat, "off");
		const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length] ?? "off";

		this.#state.remember(next);
		await setRepeat(next);
		await poller.refresh();

		this.#state.verify(next, poller.last?.repeat);
	}
}
