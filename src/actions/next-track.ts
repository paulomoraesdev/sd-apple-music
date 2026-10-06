import { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";

import { nextTrack } from "../music/applescript.js";
import { poller } from "../music/poller.js";

/** Skips to the next track. */
@action({ UUID: "com.paulomoraesdev.applemusic.next-track" })
export class NextTrack extends SingletonAction {
	/**
	 * Skips forward.
	 * @param ev Event, including the action that was pressed.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await nextTrack();
		await poller.refresh();
	}
}
