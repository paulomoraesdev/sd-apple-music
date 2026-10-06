import {
	action,
	SingletonAction,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { setFavorited } from "../music/applescript.js";
import { poller } from "../music/poller.js";
import { ToggleState } from "../music/toggle-state.js";
import { KeyStateBinding } from "./key-state-binding.js";

/**
 * Favorites the current track.
 *
 * Music renamed "Loved" to "Favorite" in 2024; the AppleScript layer writes whichever
 * property this copy of Music understands.
 */
@action({ UUID: "com.paulomoraesdev.applemusic.favorite" })
export class Favorite extends SingletonAction {
	/** Tracks the favorite flag across polls that fail to report it. */
	readonly #state = new ToggleState<boolean>("favorite");

	/** The track the local state belongs to; favoriting is per-track, unlike shuffle. */
	#trackId = "";

	/** Tracks visible keys and their poller subscriptions. */
	readonly #keys = new KeyStateBinding((status) => {
		// A new track invalidates anything we assumed about the old one.
		if (status.trackId !== this.#trackId) {
			this.#trackId = status.trackId;
			this.#state.reset();
		}

		return this.#state.resolve(status.favorited, false) ? 1 : 0;
	});

	/**
	 * Starts reflecting the favorite state on this key.
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
	 * Flips the favorite state of the current track.
	 * @param ev Event, including the action that was pressed.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		// Music cannot favorite a track it will not identify -- the macOS 26 defect. Say so
		// with an alert rather than appearing to work.
		if (poller.last?.running === true && poller.last.trackId === "") {
			await ev.action.showAlert();
			return;
		}

		const next = !this.#state.resolve(poller.last?.favorited, false);

		this.#state.remember(next);
		await setFavorited(next);
		await poller.refresh();

		this.#state.verify(next, poller.last?.favorited);
	}
}
