import { decodePng, draw, encodePng, fill, type Bitmap } from "./png.js";

/** Stream Deck key canvas, at the high-DPI size. */
const SIZE = 144;

/**
 * Turns album art into a key image, with an indicator of whether Music is playing.
 *
 * The art is always shown -- that is the point of the key. But art alone cannot tell you
 * whether music is playing, so the two states are drawn differently: paused dims the cover
 * behind a centred play triangle, playing leaves it at full brightness with a small pause
 * badge in the corner. That reads from across a desk.
 *
 * @param png Album art as PNG bytes, already normalised to roughly key size.
 * @param playing Whether Music is currently playing.
 * @param badge Whether to draw the state indicator at all.
 * @returns A data URI for `setImage`, or undefined if the art could not be decoded.
 */
export function buildKeyImage(png: Buffer, playing: boolean, badge: boolean): string | undefined {
	let image: Bitmap;
	try {
		image = decodePng(png);
	} catch {
		return undefined;
	}

	const canvas = fitToSquare(image);

	if (badge) {
		if (playing) {
			drawPauseBadge(canvas);
		} else {
			drawPlayOverlay(canvas);
		}
	}

	return `data:image/png;base64,${encodePng(canvas).toString("base64")}`;
}

/**
 * Centre-crops and scales artwork to the square key canvas.
 *
 * Nearest-neighbour is fine here: `sips` has already resampled the cover to within a few
 * pixels of the target, so this is a small correction, not a real downscale.
 * @param image Decoded artwork.
 * @returns A square bitmap at key size.
 */
function fitToSquare(image: Bitmap): Bitmap {
	const out: Bitmap = { width: SIZE, height: SIZE, data: Buffer.alloc(SIZE * SIZE * 4, 0) };

	// Cover, not contain: a non-square sleeve fills the key rather than sitting in letterbox
	// bars, which look like a rendering bug on a small black key.
	const scale = Math.max(SIZE / image.width, SIZE / image.height);
	const offsetX = (image.width * scale - SIZE) / 2;
	const offsetY = (image.height * scale - SIZE) / 2;

	for (let y = 0; y < SIZE; y++) {
		const sourceY = Math.min(image.height - 1, Math.max(0, Math.floor((y + offsetY) / scale)));

		for (let x = 0; x < SIZE; x++) {
			const sourceX = Math.min(image.width - 1, Math.max(0, Math.floor((x + offsetX) / scale)));
			image.data.copy(out.data, (y * SIZE + x) * 4, (sourceY * image.width + sourceX) * 4, (sourceY * image.width + sourceX) * 4 + 4);
		}
	}

	return out;
}

/**
 * Dims the art and draws a centred play triangle, for the paused state.
 * @param canvas Bitmap to draw on, modified in place.
 */
function drawPlayOverlay(canvas: Bitmap): void {
	fill(canvas, [0, 0, 0, 0.55]);

	const left = 54;
	const right = 102;
	const top = 44;
	const bottom = 100;
	const middle = (top + bottom) / 2;

	draw(canvas, [255, 255, 255], (x, y) => {
		if (x < left || x > right) {
			return 0;
		}

		// The triangle narrows linearly from the left edge to the tip.
		const progress = (x - left) / (right - left);
		const halfHeight = ((bottom - top) / 2) * (1 - progress);

		return Math.abs(y - middle) <= halfHeight ? 1 : 0;
	});
}

/**
 * Draws a small pause badge bottom-right, for the playing state.
 *
 * On a dark disc so it stays visible over a pale album cover.
 * @param canvas Bitmap to draw on, modified in place.
 */
function drawPauseBadge(canvas: Bitmap): void {
	const centreX = 112;
	const centreY = 112;
	const radius = 22;

	draw(canvas, [0, 0, 0], (x, y) => {
		const distance = Math.hypot(x - centreX, y - centreY);

		// One pixel of feathering, so the disc does not look jagged.
		return distance <= radius ? 0.6 : distance <= radius + 1 ? 0.6 * (radius + 1 - distance) : 0;
	});

	draw(canvas, [255, 255, 255], (x, y) => {
		const withinHeight = y >= centreY - 10 && y <= centreY + 10;
		if (!withinHeight) {
			return 0;
		}

		const leftBar = x >= centreX - 8 && x <= centreX - 3;
		const rightBar = x >= centreX + 3 && x <= centreX + 8;

		return leftBar || rightBar ? 1 : 0;
	});
}
