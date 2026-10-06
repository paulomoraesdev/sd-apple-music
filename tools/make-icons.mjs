#!/usr/bin/env node
/**
 * Generates every icon the plugin ships, from the Iconoir set (MIT, https://iconoir.com).
 *
 * Two families, with different rules from Elgato's guidelines:
 *
 *   * Action list icons (20x20, @2x 40x40) must be monochrome white on transparent -- they sit
 *     in the Stream Deck action list, which tints them. These use Iconoir's outline variant.
 *   * Key state images may use colour. We stay mostly white so the keys read at a glance, and
 *     use one accent only where state needs to be obvious at arm's length (shuffle on, repeat
 *     on, favorited). Off states are dimmed so on/off does not rely on colour alone.
 *
 * Iconoir draws with `currentColor`, which Stream Deck's SVG renderer is not documented to
 * resolve, so every colour is written out explicitly.
 *
 * The plugin icons must be PNG. They are rasterised with macOS's own `sips`, which renders SVG,
 * so no native graphics library is needed.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMGS = join(ROOT, "com.paulomoraesdev.applemusic.sdPlugin", "imgs");
const ICONOIR = join(ROOT, "node_modules", "iconoir", "icons");

const WHITE = "#FFFFFF";
const ACCENT = "#4AC3FF";
const DIM = "#8A8A8E";

/** Background of the artwork placeholder on the touch strip. */
const PLACEHOLDER_TILE = "#2C2C2E";

/** Background of the marketplace icon, so it does not vanish against a light theme. */
const MARKETPLACE_TILE = "#1C1C1E";

/** Iconoir's own grid. */
const GRID = 24;

/**
 * Stroke width for every outline, on the 24px grid. Iconoir's default; raise it if the icons
 * read too thin on the touch strip.
 */
const STROKE_WIDTH = 1.5;

/** Iconoir icon used for each action in the Stream Deck action list. */
const ACTION_ICONS = {
	"play-pause": "play",
	"next-track": "skip-next",
	"previous-track": "skip-prev",
	shuffle: "shuffle",
	repeat: "repeat",
	favorite: "heart",
	"volume-dial": "sound-high",
	"playback-control": "compact-disc",
	playlist: "playlist-play",
};

/**
 * Reads an Iconoir icon and returns its drawing, recoloured.
 * @param {string} name Icon name, without extension.
 * @param {"regular" | "solid"} variant Outline or filled.
 * @param {string} color Colour to draw in.
 * @returns {Promise<string>} The SVG elements inside the icon's root `<svg>`.
 */
async function glyph(name, variant, color) {
	const source = await readFile(join(ICONOIR, variant, `${name}.svg`), "utf8");

	return source
		.replace(/^[\s\S]*?<svg[^>]*>/, "")
		.replace(/<\/svg>\s*$/, "")
		.replaceAll("currentColor", color)
		.replaceAll('stroke-width="1.5"', `stroke-width="${STROKE_WIDTH}"`)
		.trim();
}

/**
 * Wraps drawing elements in an SVG document on the 24px grid.
 * @param {string} body SVG elements.
 * @param {number} size Rendered width and height, in pixels.
 * @returns {string} A complete SVG document.
 */
function svgDocument(body, size = GRID) {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${size}" height="${size}" ` +
		`fill="none" stroke-width="${STROKE_WIDTH}">${body}</svg>\n`
	);
}

/**
 * Draws a glyph shrunk onto a rounded tile.
 * @param {string} body SVG elements of the glyph.
 * @param {string} tile Tile colour.
 * @param {number} radius Corner radius, on the 24px grid.
 * @returns {string} SVG elements.
 */
function onTile(body, tile, radius) {
	return `<rect width="${GRID}" height="${GRID}" rx="${radius}" fill="${tile}"/><g transform="translate(3.6 3.6) scale(0.7)">${body}</g>`;
}

/**
 * Writes an SVG, plus the @2x copy Stream Deck expects alongside it.
 * @param {string} relativePath Path under `imgs/`, without extension.
 * @param {string} body SVG elements.
 * @returns {Promise<void>}
 */
async function emitSvg(relativePath, body) {
	const document = svgDocument(body);
	await mkdir(dirname(join(IMGS, relativePath)), { recursive: true });
	await writeFile(join(IMGS, `${relativePath}.svg`), document, "utf8");
	await writeFile(join(IMGS, `${relativePath}@2x.svg`), document, "utf8");
}

/**
 * Rasterises an SVG to PNG at 1x and 2x with `sips`.
 * @param {string} relativePath Path under `imgs/`, without extension.
 * @param {string} body SVG elements.
 * @param {number} size Width and height at 1x, in pixels.
 * @param {string} scratch Temporary directory for the intermediate SVGs.
 * @returns {Promise<void>}
 */
async function emitPng(relativePath, body, size, scratch) {
	await mkdir(dirname(join(IMGS, relativePath)), { recursive: true });

	for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
		const source = join(scratch, `${relativePath.replaceAll("/", "-")}${suffix}.svg`);
		await writeFile(source, svgDocument(body, size * scale), "utf8");
		await run("/usr/bin/sips", ["-s", "format", "png", source, "--out", join(IMGS, `${relativePath}${suffix}.png`)]);
	}
}

/**
 * Writes every icon the manifest and the touch strip reference.
 * @returns {Promise<void>}
 */
async function main() {
	// Action list icons: monochrome white outlines, per the Marketplace guidelines.
	for (const [action, icon] of Object.entries(ACTION_ICONS)) {
		await emitSvg(`actions/${action}/icon`, await glyph(icon, "regular", WHITE));
	}

	// Key images. Transport keys use the filled variant, which reads better from a distance.
	await emitSvg("actions/play-pause/play", await glyph("play", "solid", WHITE));
	await emitSvg("actions/play-pause/pause", await glyph("pause", "solid", WHITE));
	await emitSvg("actions/next-track/key", await glyph("skip-next", "solid", WHITE));
	await emitSvg("actions/previous-track/key", await glyph("skip-prev", "solid", WHITE));
	await emitSvg("actions/volume-dial/key", await glyph("sound-high", "solid", WHITE));
	await emitSvg("actions/playback-control/key", await glyph("compact-disc", "regular", WHITE));
	await emitSvg("actions/playlist/key", await glyph("playlist-play", "regular", WHITE));

	// Toggles: dimmed outline when off, accent when on. Favorite also fills in when on.
	await emitSvg("actions/shuffle/off", await glyph("shuffle", "regular", DIM));
	await emitSvg("actions/shuffle/on", await glyph("shuffle", "regular", ACCENT));
	await emitSvg("actions/repeat/off", await glyph("repeat", "regular", DIM));
	await emitSvg("actions/repeat/all", await glyph("repeat", "regular", ACCENT));
	await emitSvg("actions/repeat/one", await glyph("repeat-once", "regular", ACCENT));
	await emitSvg("actions/favorite/off", await glyph("heart", "regular", DIM));
	await emitSvg("actions/favorite/on", await glyph("heart", "solid", ACCENT));

	// Encoder icons, shown on the Stream Deck + touch strip.
	await emitSvg("actions/volume-dial/encoder", await glyph("sound-high", "regular", WHITE));
	await emitSvg("actions/playback-control/encoder", await glyph("compact-disc", "regular", WHITE));

	// Stands in for album art on the Playback Control strip when there is none to show.
	await emitSvg(
		"actions/playback-control/placeholder",
		onTile(await glyph("music-double-note", "regular", DIM), PLACEHOLDER_TILE, 4),
	);

	// Plugin icons must be PNG.
	const scratch = await mkdtemp(join(tmpdir(), "make-icons-"));
	try {
		const note = await glyph("music-double-note", "regular", WHITE);
		await emitPng("plugin/marketplace", onTile(note, MARKETPLACE_TILE, 5.4), 256, scratch);
		await emitPng("plugin/category-icon", note, 28, scratch);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}

	console.log(`wrote icons to ${IMGS}`);
}

await main();
