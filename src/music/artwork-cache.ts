import { getArtwork } from "./applescript.js";

/** The artwork fetch for the most recently requested track. */
let current: { trackId: string; png: Promise<Buffer | undefined> } | undefined;

/**
 * Returns the current track's artwork as a PNG, fetching it at most once per track.
 *
 * Shared by every action that shows artwork. Fetching art is the most expensive call in the
 * plugin, and {@link getArtwork} writes to fixed scratch filenames -- two concurrent fetches
 * would overwrite each other's files. Callers asking for the same track share one in-flight
 * promise, so neither problem can happen.
 *
 * @param trackId Persistent ID of the track the caller is drawing.
 * @returns PNG bytes, or undefined when the track has no artwork.
 */
export function artworkFor(trackId: string): Promise<Buffer | undefined> {
	if (current?.trackId === trackId) {
		return current.png;
	}

	current = { trackId, png: getArtwork() };

	return current.png;
}
