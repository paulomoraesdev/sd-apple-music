import { deflateSync, inflateSync } from "node:zlib";

/**
 * A minimal PNG decoder and encoder, enough to draw a badge onto album art.
 *
 * Why not send the artwork inside an SVG and let Stream Deck composite it? Because that makes
 * the result depend on whether Stream Deck's SVG renderer honours a nested `<image>` with a
 * data URI -- untestable from here, and it is exactly the kind of assumption that already
 * cost a release. Compositing the pixels ourselves produces a plain PNG, which Stream Deck
 * unambiguously supports, and the code below is testable on its own.
 *
 * Only what is needed: 8-bit PNGs, which is what `sips` produces when it normalises the
 * artwork. Interlaced and 16-bit images are rejected rather than mangled.
 */

/** A decoded image: 8-bit RGBA, row-major, 4 bytes per pixel. */
export type Bitmap = {
	/** Image width in pixels. */
	width: number;
	/** Image height in pixels. */
	height: number;
	/** Pixel data, 4 bytes per pixel. */
	data: Buffer;
};

/** PNG file signature. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel for each supported colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Decodes an 8-bit PNG into RGBA pixels.
 * @param png PNG file contents.
 * @returns The decoded bitmap.
 * @throws If the PNG is malformed, interlaced, or not 8 bits per channel.
 */
export function decodePng(png: Buffer): Bitmap {
	if (!png.subarray(0, 8).equals(SIGNATURE)) {
		throw new Error("not a PNG");
	}

	let width = 0;
	let height = 0;
	let depth = 0;
	let colorType = 0;
	let palette: Buffer | undefined;
	let alphaTable: Buffer | undefined;
	const idat: Buffer[] = [];

	let offset = 8;
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.toString("ascii", offset + 4, offset + 8);
		const body = png.subarray(offset + 8, offset + 8 + length);
		offset += 12 + length; // length + type + data + CRC

		switch (type) {
			case "IHDR":
				width = body.readUInt32BE(0);
				height = body.readUInt32BE(4);
				depth = body.readUInt8(8);
				colorType = body.readUInt8(9);

				if (body.readUInt8(12) !== 0) {
					throw new Error("interlaced PNGs are not supported");
				}

				break;
			case "PLTE":
				palette = Buffer.from(body);
				break;
			case "tRNS":
				alphaTable = Buffer.from(body);
				break;
			case "IDAT":
				idat.push(Buffer.from(body));
				break;
			case "IEND":
				offset = png.length;
				break;
			default:
				break;
		}
	}

	if (depth !== 8) {
		throw new Error(`unsupported bit depth ${depth}`);
	}

	const channels = CHANNELS[colorType];
	if (channels === undefined) {
		throw new Error(`unsupported colour type ${colorType}`);
	}

	const raw = inflateSync(Buffer.concat(idat));
	const scanline = width * channels;
	const out = Buffer.alloc(width * height * 4);

	// Undo the per-row filters. Each row is prefixed with its filter type, and filters
	// reference the row above, so this has to run top to bottom.
	const current = Buffer.alloc(scanline);
	const previous = Buffer.alloc(scanline);

	for (let y = 0; y < height; y++) {
		const rowStart = y * (scanline + 1);
		const filter = raw[rowStart];
		raw.copy(current, 0, rowStart + 1, rowStart + 1 + scanline);

		unfilter(filter ?? 0, current, previous, channels);

		for (let x = 0; x < width; x++) {
			const src = x * channels;
			const dst = (y * width + x) * 4;

			writePixel(out, dst, current, src, colorType, palette, alphaTable);
		}

		current.copy(previous);
	}

	return { width, height, data: out };
}

/**
 * Reverses a PNG row filter in place.
 * @param filter Filter type, 0-4.
 * @param row The row being decoded, modified in place.
 * @param previous The already-decoded row above.
 * @param bpp Bytes per pixel.
 */
function unfilter(filter: number, row: Buffer, previous: Buffer, bpp: number): void {
	for (let i = 0; i < row.length; i++) {
		const a = i >= bpp ? (row[i - bpp] ?? 0) : 0;
		const b = previous[i] ?? 0;
		const c = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
		const value = row[i] ?? 0;

		switch (filter) {
			case 1:
				row[i] = (value + a) & 0xff;
				break;
			case 2:
				row[i] = (value + b) & 0xff;
				break;
			case 3:
				row[i] = (value + ((a + b) >> 1)) & 0xff;
				break;
			case 4:
				row[i] = (value + paeth(a, b, c)) & 0xff;
				break;
			default:
				break;
		}
	}
}

/**
 * The Paeth predictor from the PNG specification.
 * @param a Byte to the left.
 * @param b Byte above.
 * @param c Byte above-left.
 * @returns The predicted byte.
 */
function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);

	if (pa <= pb && pa <= pc) {
		return a;
	}

	return pb <= pc ? b : c;
}

/**
 * Expands one source pixel into RGBA.
 * @param out Destination RGBA buffer.
 * @param dst Destination offset.
 * @param row Decoded source row.
 * @param src Source offset within the row.
 * @param colorType PNG colour type.
 * @param palette Palette, for colour type 3.
 * @param alphaTable Palette alpha, for colour type 3.
 */
function writePixel(
	out: Buffer,
	dst: number,
	row: Buffer,
	src: number,
	colorType: number,
	palette: Buffer | undefined,
	alphaTable: Buffer | undefined,
): void {
	switch (colorType) {
		case 0: {
			const grey = row[src] ?? 0;
			out[dst] = grey;
			out[dst + 1] = grey;
			out[dst + 2] = grey;
			out[dst + 3] = 255;
			break;
		}
		case 2:
			out[dst] = row[src] ?? 0;
			out[dst + 1] = row[src + 1] ?? 0;
			out[dst + 2] = row[src + 2] ?? 0;
			out[dst + 3] = 255;
			break;
		case 3: {
			const index = row[src] ?? 0;
			out[dst] = palette?.[index * 3] ?? 0;
			out[dst + 1] = palette?.[index * 3 + 1] ?? 0;
			out[dst + 2] = palette?.[index * 3 + 2] ?? 0;
			out[dst + 3] = alphaTable?.[index] ?? 255;
			break;
		}
		case 4: {
			const grey = row[src] ?? 0;
			out[dst] = grey;
			out[dst + 1] = grey;
			out[dst + 2] = grey;
			out[dst + 3] = row[src + 1] ?? 255;
			break;
		}
		default:
			out[dst] = row[src] ?? 0;
			out[dst + 1] = row[src + 1] ?? 0;
			out[dst + 2] = row[src + 2] ?? 0;
			out[dst + 3] = row[src + 3] ?? 255;
			break;
	}
}

/**
 * Encodes RGBA pixels as a PNG.
 *
 * Rows are written unfiltered. Filtering would compress better, but the image is a 144px key
 * icon sent once per track change -- the bytes saved are not worth the code.
 * @param image The bitmap to encode.
 * @returns PNG file contents.
 */
export function encodePng(image: Bitmap): Buffer {
	const { width, height, data } = image;
	const scanline = width * 4;
	const raw = Buffer.alloc(height * (scanline + 1));

	for (let y = 0; y < height; y++) {
		raw[y * (scanline + 1)] = 0; // filter: none
		data.copy(raw, y * (scanline + 1) + 1, y * scanline, (y + 1) * scanline);
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.writeUInt8(8, 8); // bit depth
	ihdr.writeUInt8(6, 9); // colour type: RGBA
	ihdr.writeUInt8(0, 10); // compression
	ihdr.writeUInt8(0, 11); // filter
	ihdr.writeUInt8(0, 12); // interlace

	return Buffer.concat([
		SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/**
 * Builds a PNG chunk with its length, type and CRC.
 * @param type Four-character chunk type.
 * @param body Chunk payload.
 * @returns The complete chunk.
 */
function chunk(type: string, body: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, "ascii");

	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);

	return Buffer.concat([head, body, crc]);
}

/** Lazily-built CRC lookup table. */
let crcTable: Uint32Array | undefined;

/**
 * Computes the CRC-32 a PNG chunk requires.
 * @param buffer Bytes to checksum.
 * @returns The CRC-32 value.
 */
function crc32(buffer: Buffer): number {
	if (crcTable === undefined) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) {
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			}

			crcTable[n] = c >>> 0;
		}
	}

	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
	}

	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Blends a colour over a rectangle of the bitmap.
 * @param image Bitmap to draw on, modified in place.
 * @param rgba Colour to blend, as [r, g, b, a] with a in 0-1.
 */
export function fill(image: Bitmap, rgba: [number, number, number, number]): void {
	const [r, g, b, alpha] = rgba;

	for (let i = 0; i < image.data.length; i += 4) {
		image.data[i] = blend(image.data[i] ?? 0, r, alpha);
		image.data[i + 1] = blend(image.data[i + 1] ?? 0, g, alpha);
		image.data[i + 2] = blend(image.data[i + 2] ?? 0, b, alpha);
	}
}

/**
 * Draws a shape by testing each pixel against a coverage function.
 *
 * The callback returns coverage from 0 (outside) to 1 (fully inside), which gives cheap
 * antialiasing on circles and triangles without a rasteriser.
 * @param image Bitmap to draw on, modified in place.
 * @param rgb Colour to draw.
 * @param coverage Returns how much of the pixel at (x, y) the shape covers.
 */
export function draw(
	image: Bitmap,
	rgb: [number, number, number],
	coverage: (x: number, y: number) => number,
): void {
	const [r, g, b] = rgb;

	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const alpha = coverage(x + 0.5, y + 0.5);
			if (alpha <= 0) {
				continue;
			}

			const i = (y * image.width + x) * 4;
			const a = Math.min(1, alpha);

			image.data[i] = blend(image.data[i] ?? 0, r, a);
			image.data[i + 1] = blend(image.data[i + 1] ?? 0, g, a);
			image.data[i + 2] = blend(image.data[i + 2] ?? 0, b, a);
			image.data[i + 3] = 255;
		}
	}
}

/**
 * Blends one channel.
 * @param base Existing value.
 * @param over Incoming value.
 * @param alpha Opacity of the incoming value, 0-1.
 * @returns The blended value.
 */
function blend(base: number, over: number, alpha: number): number {
	return Math.round(base * (1 - alpha) + over * alpha);
}
