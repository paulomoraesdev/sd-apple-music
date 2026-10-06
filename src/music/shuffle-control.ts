import { setShuffle } from "./applescript.js";
import { poller } from "./poller.js";
import { ToggleState } from "./toggle-state.js";

/**
 * Shuffle state shared by every control that shows or flips it.
 *
 * One instance for the whole plugin, so the Shuffle key and the Playback Control dial never
 * disagree about what was last written while Music declines to report shuffle.
 */
export const shuffleState = new ToggleState<boolean>("shuffle");

/**
 * Resolves whether shuffle is on, preferring Music's own reading.
 * @param reported What the latest poll reported, or undefined when Music would not say.
 * @returns The best available shuffle state; off when nothing is known.
 */
export function resolveShuffle(reported: boolean | undefined): boolean {
	return shuffleState.resolve(reported, false);
}

/**
 * Flips shuffle and refreshes the shared status.
 * @returns True when Music accepted the command.
 */
export async function toggleShuffle(): Promise<boolean> {
	const next = !resolveShuffle(poller.last?.shuffle);

	// Remember before writing: the next poll may not report shuffle at all, and every control
	// still has to show the new value.
	shuffleState.remember(next);
	const accepted = await setShuffle(next);
	await poller.refresh();

	shuffleState.verify(next, poller.last?.shuffle);

	return accepted;
}
