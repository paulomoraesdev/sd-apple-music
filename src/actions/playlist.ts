import streamDeck, {
	action,
	SingletonAction,
	type KeyDownEvent,
	type PropertyInspectorDidAppearEvent,
	type WillAppearEvent,
} from "@elgato/streamdeck";

import { listPlaylists, playPlaylist } from "../music/applescript.js";

/** Settings for the playlist key. */
type PlaylistSettings = {
	/** Exact playlist name, as it appears in Music's sidebar. */
	playlist?: string;
	/** Whether to turn shuffle on before starting the playlist. */
	shuffle?: boolean;
	/** Whether to print the playlist name on the key. */
	showName?: boolean;
};

/** Characters of playlist name that fit across a key. */
const NAME_WIDTH = 9;

/**
 * Starts a specific playlist.
 *
 * The property inspector offers a picker populated from Music's own playlists, because the
 * name has to match exactly and typing it by hand is a silent failure waiting to happen. If
 * Music is closed when the inspector opens there is nothing to list, so the field stays a
 * plain text box rather than an empty dropdown that looks broken.
 */
@action({ UUID: "com.paulomoraesdev.applemusic.playlist" })
export class Playlist extends SingletonAction<PlaylistSettings> {
	/**
	 * Labels the key with the playlist it will start.
	 * @param ev Event, including the action that appeared.
	 */
	override async onWillAppear(ev: WillAppearEvent<PlaylistSettings>): Promise<void> {
		await this.#label(ev.action, ev.payload.settings);
	}

	/**
	 * Relabels the key when the user picks a different playlist.
	 * @param ev Event, including the updated settings.
	 */
	override async onDidReceiveSettings(ev: {
		action: { setTitle(title: string): Promise<void> };
		payload: { settings: PlaylistSettings };
	}): Promise<void> {
		await this.#label(ev.action, ev.payload.settings);
	}

	/**
	 * Sends Music's playlists to the property inspector so it can offer a picker.
	 * @param ev Event, including the action whose inspector appeared.
	 */
	override async onPropertyInspectorDidAppear(
		ev: PropertyInspectorDidAppearEvent<PlaylistSettings>,
	): Promise<void> {
		const playlists = await listPlaylists();
		await streamDeck.ui.sendToPropertyInspector({ event: "playlists", playlists }).catch(() => {});
	}

	/**
	 * Starts the configured playlist.
	 * @param ev Event, including the action that was pressed.
	 */
	override async onKeyDown(ev: KeyDownEvent<PlaylistSettings>): Promise<void> {
		const name = ev.payload.settings.playlist?.trim();
		if (!name) {
			// Nothing configured yet -- an alert is more honest than silently launching Music.
			await ev.action.showAlert();
			return;
		}

		const started = await playPlaylist(name, ev.payload.settings.shuffle ?? false);

		if (started) {
			await ev.action.showOk();
			return;
		}

		streamDeck.logger.warn(`Music could not find a playlist named "${name}".`);
		await ev.action.showAlert();
	}

	/**
	 * Writes the playlist name onto the key, when the user wants it there.
	 * @param target Something that can take a title.
	 * @param settings Current settings.
	 */
	async #label(target: { setTitle(title: string): Promise<void> }, settings: PlaylistSettings): Promise<void> {
		if (!(settings.showName ?? true)) {
			await target.setTitle("").catch(() => {});
			return;
		}

		await target.setTitle(wrap(settings.playlist ?? "", NAME_WIDTH)).catch(() => {});
	}
}

/**
 * Wraps a playlist name onto at most two lines of key-width text.
 * @param text The name.
 * @param width Characters per line.
 * @returns The wrapped name.
 */
function wrap(text: string, width: number): string {
	if (text === "") {
		return "";
	}

	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const candidate = current === "" ? word : `${current} ${word}`;
		if (candidate.length <= width) {
			current = candidate;
			continue;
		}

		if (current !== "") {
			lines.push(current);
		}

		current = word.length > width ? `${word.slice(0, width - 1)}…` : word;

		if (lines.length === 2) {
			break;
		}
	}

	if (current !== "" && lines.length < 2) {
		lines.push(current);
	}

	return lines.slice(0, 2).join("\n");
}
