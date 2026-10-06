import streamDeck from "@elgato/streamdeck";

import { CurrentPlaylist } from "./actions/current-playlist.js";
import { Favorite } from "./actions/favorite.js";
import { NextTrack } from "./actions/next-track.js";
import { Playlist } from "./actions/playlist.js";
import { PlayPause } from "./actions/play-pause.js";
import { PreviousTrack } from "./actions/previous-track.js";
import { Repeat } from "./actions/repeat.js";
import { Shuffle } from "./actions/shuffle.js";
import { TransportDial } from "./actions/transport-dial.js";
import { VolumeDial } from "./actions/volume-dial.js";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new PlayPause());
streamDeck.actions.registerAction(new NextTrack());
streamDeck.actions.registerAction(new PreviousTrack());
streamDeck.actions.registerAction(new Shuffle());
streamDeck.actions.registerAction(new Repeat());
streamDeck.actions.registerAction(new Favorite());
streamDeck.actions.registerAction(new Playlist());
streamDeck.actions.registerAction(new CurrentPlaylist());
streamDeck.actions.registerAction(new VolumeDial());
streamDeck.actions.registerAction(new TransportDial());

// Must be last: Stream Deck expects every action registered before the socket opens.
streamDeck.connect();
