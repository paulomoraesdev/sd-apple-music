#!/usr/bin/env python3
"""
Generates every icon the plugin ships.

Two families, with different rules from Elgato's guidelines:

  * Action list icons (20x20, @2x 40x40) must be monochrome white on transparent -- they sit
    in the Stream Deck action list, which tints them.
  * Key state images (72x72, @2x 144x144) may use colour. We stay mostly white so the keys
    read at a glance, and use one accent only where state needs to be obvious at arm's length
    (shuffle on, repeat on, favorited).

Everything is drawn from geometry here rather than traced from anyone else's artwork, so the
shapes are original and the output is reproducible.
"""

from __future__ import annotations

import os
from pathlib import Path

import cairosvg

ROOT = Path(__file__).resolve().parent.parent
IMGS = ROOT / "com.paulomoraesdev.applemusic.sdPlugin" / "imgs"

WHITE = "#FFFFFF"
ACCENT = "#4AC3FF"
DIM = "#8A8A8E"


def svg(body: str, size: int = 24) -> str:
    """Wraps path data in an SVG document with a square viewBox."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}" fill="none">{body}</svg>'
    )


def triangle(cx: float, cy: float, half_h: float, width: float, fill: str) -> str:
    """A right-pointing play triangle centred on (cx, cy)."""
    x0 = cx - width / 2
    x1 = cx + width / 2
    return f'<path d="M{x0} {cy - half_h} L{x1} {cy} L{x0} {cy + half_h} Z" fill="{fill}"/>'


def bar(x: float, cy: float, half_h: float, w: float, fill: str) -> str:
    """A rounded vertical bar."""
    return (
        f'<rect x="{x}" y="{cy - half_h}" width="{w}" height="{half_h * 2}" '
        f'rx="{w / 2.4:.2f}" fill="{fill}"/>'
    )


def bul(x: float, cy: float, half_h: float, w: float, fill: str) -> str:
    """Alias for {@link bar}, used where the local name would read ambiguously."""
    return bar(x, cy, half_h, w, fill)


def glyphs(fg: str, accent: str) -> dict[str, str]:
    """Returns every glyph's SVG body, drawn on a 24x24 grid."""
    stroke = f'stroke="{fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

    return {
        # Transport
        "play": triangle(13, 12, 6.5, 11, fg),
        "pause": bar(8, 12, 6.5, 3.2, fg) + bar(12.8, 12, 6.5, 3.2, fg),
        "next": triangle(10, 12, 6, 9, fg) + bar(16.6, 12, 6, 2.8, fg),
        "previous": (
            f'<g transform="rotate(180 12 12)">{triangle(10, 12, 6, 9, fg)}'
            f"{bar(16.6, 12, 6, 2.8, fg)}</g>"
        ),
        # Shuffle: two crossing paths with arrowheads.
        "shuffle": (
            f'<path d="M3 7h3.5c1.6 0 2.6 1 3.6 2.4l4 5.8c1 1.4 2 2.4 3.6 2.4H21" {stroke}/>'
            f'<path d="M3 17h3.5c1.6 0 2.6-1 3.6-2.4l.9-1.3" {stroke}/>'
            f'<path d="M14.6 9.6l.9-1.3C16.5 6.9 17.5 6 19.1 6H21" {stroke}/>'
            f'<path d="M18.5 3.5L21 6l-2.5 2.5" {stroke}/>'
            f'<path d="M18.5 15.1L21 17.6l-2.5 2.5" {stroke}/>'
        ),
        # Repeat: a rounded loop, broken at each end where the arrowheads sit.
        "repeat": (
            f'<path d="M17 6.5H7.5A4.5 4.5 0 0 0 3 11v1" {stroke}/>'
            f'<path d="M14.5 4l2.8 2.5-2.8 2.5" {stroke}/>'
            f'<path d="M7 17.5h9.5A4.5 4.5 0 0 0 21 13v-1" {stroke}/>'
            f'<path d="M9.5 20L6.7 17.5 9.5 15" {stroke}/>'
        ),
        "favorite": (
            f'<path d="M12 20.2l-7.1-6.6a4.4 4.4 0 0 1 0-6.4 4.7 4.7 0 0 1 6.5 0l.6.6.6-.6a4.7 '
            f'4.7 0 0 1 6.5 0 4.4 4.4 0 0 1 0 6.4z" {stroke}/>'
        ),
        "note": (
            f'<path d="M10 17.5V6.2l9-1.7v11" {stroke}/>'
            f'<circle cx="7.4" cy="17.6" r="2.7" {stroke}/>'
            f'<circle cx="16.4" cy="15.6" r="2.7" {stroke}/>'
        ),
        "volume": (
            f'<path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z" {stroke}/>'
            f'<path d="M15.6 9.4a3.7 3.7 0 0 1 0 5.2" {stroke}/>'
            f'<path d="M18.4 6.6a7.6 7.6 0 0 1 0 10.8" {stroke}/>'
        ),
        # Transport dial: back and forward arrows either side of the dial's centre.
        "transport": (
            f'<g transform="rotate(180 7 12)">{triangle(6.2, 12, 4.6, 6.6, fg)}'
            f'{bul(9.2, 12, 4.6, 2.2, fg)}</g>'
            f'{triangle(15.4, 12, 4.6, 6.6, fg)}{bul(19.6, 12, 4.6, 2.2, fg)}'
        ),
        # Playlist: stacked lines with a play triangle where the last line would be.
        "playlist": (
            f'<path d="M4 6.5h16M4 11h16M4 15.5h7" {stroke}/>'
            f'{triangle(16.5, 17.5, 3.6, 5.4, accent)}'
        ),
    }


def write(path: Path, content: str) -> None:
    """Writes a file, creating parent directories."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def emit_svg(rel: str, body: str) -> None:
    """Writes an SVG, plus the @2x copy Stream Deck expects alongside it."""
    doc = svg(body)
    write(IMGS / f"{rel}.svg", doc)
    write(IMGS / f"{rel}@2x.svg", doc)


def emit_png(rel: str, body: str, size: int) -> None:
    """Rasterises an SVG to PNG at 1x and 2x."""
    doc = svg(body).encode("utf-8")
    for suffix, scale in (("", 1), ("@2x", 2)):
        out = IMGS / f"{rel}{suffix}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        cairosvg.svg2png(
            bytestring=doc,
            write_to=str(out),
            output_width=size * scale,
            output_height=size * scale,
        )


def main() -> None:
    """Writes every icon the manifest references."""
    mono = glyphs(WHITE, WHITE)
    keyed = glyphs(WHITE, ACCENT)

    # Action list icons: monochrome white, per the Marketplace guidelines.
    action_icons = {
        "play-pause": mono["play"],
        "next-track": mono["next"],
        "previous-track": mono["previous"],
        "shuffle": mono["shuffle"],
        "repeat": mono["repeat"],
        "favorite": mono["favorite"],
        "volume-dial": mono["volume"],
        "transport-dial": mono["transport"],
        "playlist": mono["playlist"],
    }
    for name, body in action_icons.items():
        emit_svg(f"actions/{name}/icon", body)

    # Key state images.
    emit_svg("actions/play-pause/play", keyed["play"])
    emit_svg("actions/play-pause/pause", keyed["pause"])
    emit_svg("actions/next-track/key", keyed["next"])
    emit_svg("actions/previous-track/key", keyed["previous"])
    emit_svg("actions/volume-dial/key", keyed["volume"])
    emit_svg("actions/transport-dial/key", keyed["transport"])
    emit_svg("actions/playlist/key", keyed["playlist"])

    # Off states are dimmed so on/off reads at arm's length without relying on colour alone.
    off = glyphs(DIM, DIM)
    on = glyphs(ACCENT, ACCENT)

    emit_svg("actions/shuffle/off", off["shuffle"])
    emit_svg("actions/shuffle/on", on["shuffle"])
    emit_svg("actions/repeat/off", off["repeat"])
    emit_svg("actions/repeat/all", on["repeat"])
    emit_svg(
        "actions/repeat/one",
        on["repeat"]
        + f'<circle cx="12" cy="12" r="4.6" fill="#1C1C1E"/>'
        + f'<text x="12" y="15" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"'
        f' font-size="9" font-weight="700" fill="{ACCENT}">1</text>',
    )

    # Favorite: outline when off, filled when on.
    emit_svg("actions/favorite/off", off["favorite"])
    emit_svg(
        "actions/favorite/on",
        '<path d="M12 20.2l-7.1-6.6a4.4 4.4 0 0 1 0-6.4 4.7 4.7 0 0 1 6.5 0l.6.6.6-.6a4.7 '
        f'4.7 0 0 1 6.5 0 4.4 4.4 0 0 1 0 6.4z" fill="{ACCENT}"/>',
    )

    # Encoder icons, shown on the Stream Deck + touch strip.
    emit_svg("actions/volume-dial/encoder", mono["volume"])
    emit_svg("actions/transport-dial/encoder", mono["transport"])

    # Plugin icons must be PNG. The marketplace icon gets a filled background so it does not
    # vanish against the Stream Deck app's light theme.
    plugin_icon = (
        f'<rect width="24" height="24" rx="5.4" fill="#1C1C1E"/>'
        f'<g transform="translate(0 0)">{glyphs(WHITE, ACCENT)["note"]}</g>'
    )
    emit_png("plugin/marketplace", plugin_icon, 256)
    emit_png("plugin/category-icon", mono["note"], 28)

    print(f"wrote icons to {IMGS}")


if __name__ == "__main__":
    main()
