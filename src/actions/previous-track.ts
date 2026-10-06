import { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";

import { previousTrack } from "../music/applescript.js";
import { poller } from "../music/poller.js";

/**
 * Goes to the previous track, or restarts the current one.
 *
 * Matches the behaviour of every hardware media remote: the first press restarts the track
 * unless you are within the first three seconds, in which case it steps back.
 */
@action({ UUID: "com.paulomoraesdev.applemusic.previous-track" })
export class PreviousTrack extends SingletonAction {
	/**
	 * Steps back.
	 * @param ev Event, including the action that was pressed.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await previousTrack();
		await poller.refresh();
	}
}
