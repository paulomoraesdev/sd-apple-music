import streamDeck, { action, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { poller } from "../music/poller.js";

/** Longest line, in characters, that fits inside the record label. */
const LINE_CHARS = 8;

/** Lines of text the record label holds. */
const MAX_LINES = 3;

/**
 * Splits a playlist name into at most {@link MAX_LINES} lines that fit the label.
 * @param name Playlist name.
 * @returns Lines of text, the last ending in an ellipsis if the name was cut.
 */
function wrap(name: string): string[] {
	const lines: string[] = [];
	let line = "";

	for (const word of name.split(/\s+/).filter(Boolean)) {
		// A single long word is cut rather than allowed to overflow the label.
		const chunk = word.length > LINE_CHARS ? `${word.slice(0, LINE_CHARS - 1)}…` : word;

		if (line !== "" && `${line} ${chunk}`.length > LINE_CHARS) {
			lines.push(line);
			line = chunk;
		} else {
			line = line === "" ? chunk : `${line} ${chunk}`;
		}
	}

	if (line !== "") {
		lines.push(line);
	}

	if (lines.length > MAX_LINES) {
		lines.length = MAX_LINES;
		lines[MAX_LINES - 1] = `${lines[MAX_LINES - 1]!.replace(/…$/, "").slice(0, LINE_CHARS - 1)}…`;
	}

	return lines;
}

/**
 * Draws a vinyl record with the playlist name on its label.
 * @param name Playlist name, or undefined when nothing is playing from one.
 * @returns An SVG data URI.
 */
function render(name: string | undefined): string {
	const lines = wrap(name ?? "No playlist");
	const first = 72 - ((lines.length - 1) * 20) / 2 + 6;
	const text = lines
		.map((line, i) => {
			const safe = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			return `<text x="72" y="${first + i * 20}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" font-weight="800" fill="#000">${safe}</text>`;
		})
		.join("");

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">` +
		`<rect width="144" height="144" fill="#000"/>` +
		`<circle cx="72" cy="72" r="70" fill="#2A2A2A"/>` +
		`<circle cx="72" cy="72" r="62" fill="none" stroke="#555" stroke-width="1"/>` +
		`<circle cx="72" cy="72" r="56" fill="#FFF"/>` +
		text +
		`</svg>`;

	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/** Shows the name of the playlist that is playing, on a record. */
@action({ UUID: "com.paulomoraesdev.applemusic.current-playlist" })
export class CurrentPlaylist extends SingletonAction {
	/** Visible keys, mapped to their unsubscribe function and last drawn name. */
	readonly #bound = new Map<string, { unsubscribe: () => void }>();

	/**
	 * Starts showing the current playlist on this key.
	 * @param ev Event, including the action that appeared.
	 */
	override onWillAppear(ev: WillAppearEvent): void {
		if (this.#bound.has(ev.action.id) || !ev.action.isKey()) {
			return;
		}

		const key = ev.action;
		let drawn: string | undefined | null = null;

		this.#bound.set(key.id, {
			unsubscribe: poller.subscribe((status) => {
				// Redrawing every second makes some devices flicker; only draw on change.
				if (status.playlist === drawn) {
					return;
				}

				drawn = status.playlist;
				key.setImage(render(status.playlist)).catch((err) => streamDeck.logger.error("Failed to set image", err));
			}),
		});
	}

	/**
	 * Stops updating a key that is no longer visible.
	 * @param ev Event, including the action that disappeared.
	 */
	override onWillDisappear(ev: WillDisappearEvent): void {
		this.#bound.get(ev.action.id)?.unsubscribe();
		this.#bound.delete(ev.action.id);
	}
}
