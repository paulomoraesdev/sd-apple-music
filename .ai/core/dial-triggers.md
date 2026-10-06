# Dial Triggers — Stream Deck+ Encoder Reference

Reference for every input an Encoder action (dial + touch strip segment) can react to. It covers what the SDK provides natively and how to build the rest with timing, counting and hit-testing logic.

* **Scope:** `@elgato/streamdeck` v2 (installed: 2.1.2), `SingletonAction`, `Controllers: ["Encoder"]`.
* **Verified:** the native events and payload fields below were checked against the SDK docs (Context7) and the installed `.d.ts` files. Derived triggers are plugin logic, not SDK features.
* **Reference implementation:** `src/actions/playback-control.ts` uses per-dial state, long press, press + rotate, detent accumulation and change-only feedback.
* **Project rules still apply:** see `AGENTS.md`. Code samples follow them: strict TS, guard clauses, braces, named constants, no abbreviations, JSDoc.

---

## 1. Native triggers

| Handler | Fires when | Payload you use | Event type |
|---|---|---|---|
| `onDialRotate` | dial turned | `ticks: number` (positive = clockwise, negative = counter-clockwise; can be > 1 on a fast spin), `pressed: boolean` (dial held down while turning) | `DialRotateEvent<T>` |
| `onDialDown` | dial pressed | none beyond `settings`, `coordinates`, `controller` | `DialDownEvent<T>` |
| `onDialUp` | dial released | none beyond `settings`, `coordinates`, `controller` | `DialUpEvent<T>` |
| `onTouchTap` | touch strip segment tapped | `hold: boolean` (long touch), `tapPos: [x, y]` (relative to the 200×100 segment canvas) | `TouchTapEvent<T>` |

Lifecycle handlers (`onWillAppear`, `onWillDisappear`, `onDidReceiveSettings`) are not triggers, but every derived trigger depends on them to create and clean up per-dial state.

### Not available natively
* **Swipe or drag on the touch strip.** Stream Deck uses the gesture for page navigation; plugins never receive it.
* **Double press, long press of the dial, double tap.** There is no event for these; derive them (section 3).
* **Absolute dial position.** Dials are relative encoders. Only `ticks` deltas exist.

### Manifest declaration
```json
{
	"Controllers": ["Encoder"],
	"Encoder": {
		"layout": "layouts/<action>.json",
		"TriggerDescription": {
			"Rotate": "Change Track · Pressed: Volume",
			"Push": "Play / Pause · Hold: Shuffle",
			"Touch": "Play / Pause",
			"LongTouch": "Optional, shown for touch with hold"
		}
	}
}
```
`TriggerDescription` only provides help text in the Stream Deck app; it does not enable or disable events. Keep it in sync with the behaviour you implement, including derived triggers.

### Native usage
```ts
import {
	action,
	SingletonAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type TouchTapEvent,
} from "@elgato/streamdeck";

@action({ UUID: "com.paulomoraesdev.applemusic.example" })
export class Example extends SingletonAction {
	/**
	 * Handles rotation.
	 * @param ev Event, including detents turned and whether the dial is pressed.
	 */
	override async onDialRotate(ev: DialRotateEvent): Promise<void> {
		const { ticks, pressed } = ev.payload;
		// ev.action is already typed as DialAction; no isDial() check needed in dial handlers.
	}

	/**
	 * Handles the dial being pressed.
	 * @param ev Event, including the action that was pressed.
	 */
	override onDialDown(ev: DialDownEvent): void {}

	/**
	 * Handles the dial being released.
	 * @param ev Event, including the action that was released.
	 */
	override onDialUp(ev: DialUpEvent): void {}

	/**
	 * Handles a tap on the touch strip.
	 * @param ev Event, including tap position and whether it was held.
	 */
	override async onTouchTap(ev: TouchTapEvent): Promise<void> {
		const { hold, tapPos } = ev.payload;
		const [x, y] = tapPos;
	}
}
```

---

## 2. Foundation: per-dial state

`SingletonAction` is **one instance for every dial** that uses the action. Any state stored directly on the class, such as a tick counter or the last rendered value, is shared by all visible dials and they corrupt each other. Always key state by `ev.action.id`.

```ts
/** Bookkeeping for one visible dial. */
type Dial = {
	action: DialAction;
	/** Accumulated detents (section 3.3). */
	ticks: number;
	/** In-progress press, if any (section 3.1). */
	press: Press | undefined;
};

readonly #dials = new Map<string, Dial>();

override onWillAppear(ev: WillAppearEvent): void {
	if (this.#dials.has(ev.action.id) || !ev.action.isDial()) {
		return;
	}

	this.#dials.set(ev.action.id, { action: ev.action, ticks: 0, press: undefined });
}

override onWillDisappear(ev: WillDisappearEvent): void {
	const dial = this.#dials.get(ev.action.id);
	if (dial === undefined) {
		return;
	}

	// Every timer a derived trigger starts must be cleared here.
	clearTimeout(dial.press?.timer);
	this.#dials.delete(ev.action.id);
}
```

Rules:
* Look up the dial at the start of every handler and return early if it is missing.
* Events can arrive unpaired. A `DialUp` can come without a `DialDown`, for example when the press started before the action appeared, and a rotation with `pressed: true` can come with no recorded press. Handle the missing half instead of assuming it exists.
* Clear all timers in `onWillDisappear`.

---

## 3. Derived triggers

Each pattern lists its **mechanism**, its **cost** to other triggers, and **code**. Constants are illustrative; tune them and keep them named.

### 3.1 Long press (hold the dial without turning) — *implemented*

**Mechanism:** start a timer on `DialDown`. If it fires before `DialUp` and the dial has not rotated, it is a long press. On `DialUp`, a press that was neither long nor rotated is a short press.

**Cost:** the short-press action must move from `DialDown` to `DialUp`. Otherwise every long press also fires the short action first.

**Feedback choice:** fire the long action **when the timer elapses**, while the dial is still held, so the user knows when to let go. Firing on release makes the hold time impossible to judge.

```ts
/** How long the dial must be held, without turning, to count as a long press. */
const LONG_PRESS_MS = 500;

/** An in-progress press of the dial. */
type Press = {
	timer: NodeJS.Timeout | undefined;
	/** The dial turned while pressed (section 3.2); release must not act. */
	rotated: boolean;
	/** The long press already fired; release must not act. */
	consumed: boolean;
};

override onDialDown(ev: DialDownEvent): void {
	const dial = this.#dials.get(ev.action.id);
	if (dial === undefined) {
		return;
	}

	clearTimeout(dial.press?.timer);

	const press: Press = { timer: undefined, rotated: false, consumed: false };
	press.timer = setTimeout(() => void this.#onLongPress(dial, press), LONG_PRESS_MS);
	dial.press = press;
}

override async onDialUp(ev: DialUpEvent): Promise<void> {
	const dial = this.#dials.get(ev.action.id);
	const press = dial?.press;
	if (dial === undefined || press === undefined) {
		return;
	}

	clearTimeout(press.timer);
	dial.press = undefined;

	if (press.rotated || press.consumed) {
		return;
	}

	await this.#onShortPress(dial);
}

async #onLongPress(dial: Dial, press: Press): Promise<void> {
	press.timer = undefined;

	// A newer press replaced this one, or the user started turning.
	if (press.rotated || dial.press !== press) {
		return;
	}

	press.consumed = true;
	// ...long-press action
}
```

### 3.2 Press + rotate (turn while holding) — *implemented*

**Mechanism:** native flag `ev.payload.pressed`. The logic is in how it interacts with the press: mark the press as `rotated` and cancel the long-press timer, so neither the short nor the long action fires on release.

**Cost:** none, if 3.1 honours `rotated`.

```ts
override async onDialRotate(ev: DialRotateEvent): Promise<void> {
	const dial = this.#dials.get(ev.action.id);
	if (dial === undefined) {
		return;
	}

	if (!ev.payload.pressed) {
		await this.#onRotate(dial, ev.payload.ticks);
		return;
	}

	// No recorded press is possible (see section 2); act anyway.
	if (dial.press !== undefined) {
		dial.press.rotated = true;
		clearTimeout(dial.press.timer);
	}

	await this.#onPressedRotate(dial, ev.payload.ticks);
}
```

### 3.3 Detent threshold (N clicks per action) — *implemented*

**Mechanism:** accumulate `ticks` and act each time the total crosses a threshold. Reset on direction change, so a small turn back does not undo progress. Use this for discrete actions such as skipping tracks or scrolling a list, where 1 click = 1 action is too sensitive.

```ts
/** Detents a spin must cross before another step fires. */
const STEP_THRESHOLD = 2;

async #onRotate(dial: Dial, ticks: number): Promise<void> {
	if (Math.sign(ticks) !== Math.sign(dial.ticks)) {
		dial.ticks = 0;
	}

	dial.ticks += ticks;

	while (Math.abs(dial.ticks) >= STEP_THRESHOLD) {
		const forward = dial.ticks > 0;
		dial.ticks -= forward ? STEP_THRESHOLD : -STEP_THRESHOLD;
		// ...await step(forward)
	}
}
```

### 3.4 Continuous value with coalescing — *implemented (volume)*

**Mechanism:** for continuous values such as volume or brightness, write once per burst instead of once per event. Accumulate a local target, paint feedback immediately, flush one write after a short delay, and ignore incoming polls for a short window so a stale reading does not pull the value back.

**Use:** the shared `volumeControl` in `src/music/volume-control.ts`. Do not reimplement it.

### 3.5 Rotation acceleration (fast spin = bigger steps)

**Mechanism:** measure the gap between rotate events, or the size of `ticks` in one event, and multiply the step when the user spins fast. It gives fine control when turning slowly and fast travel when spinning.

**Cost:** none. Apply it only to continuous values; on discrete actions it makes the result unpredictable.

```ts
/** Events closer together than this count as a fast spin. */
const FAST_SPIN_MS = 60;

/** Step multiplier applied during a fast spin. */
const FAST_SPIN_MULTIPLIER = 3;

/** Add to Dial: when this dial last rotated. */
// lastRotateAt: number;

#acceleratedDelta(dial: Dial, ticks: number, baseStep: number): number {
	const now = Date.now();
	const fast = now - dial.lastRotateAt < FAST_SPIN_MS || Math.abs(ticks) > 1;
	dial.lastRotateAt = now;

	return ticks * baseStep * (fast ? FAST_SPIN_MULTIPLIER : 1);
}
```

### 3.6 Double press (two presses in quick succession)

**Mechanism:** on `DialUp` of a short press, do not act right away. Start a window timer. A second short press inside the window is a double press; if the window expires, run the single-press action.

**Cost:** **every single press is delayed by `DOUBLE_PRESS_MS`.** On a play/pause control that delay is noticeable. Only use double press where a delay on single press is acceptable.

```ts
/** Maximum gap between two presses to count as a double press. */
const DOUBLE_PRESS_MS = 300;

/** Add to Dial: pending single-press action, waiting to see if a second press follows. */
// pendingSingle: NodeJS.Timeout | undefined;

async #onShortPress(dial: Dial): Promise<void> {
	if (dial.pendingSingle !== undefined) {
		clearTimeout(dial.pendingSingle);
		dial.pendingSingle = undefined;
		// ...await doublePressAction()
		return;
	}

	dial.pendingSingle = setTimeout(() => {
		dial.pendingSingle = undefined;
		void this.#singlePressAction(dial);
	}, DOUBLE_PRESS_MS);
}
```
Clear `pendingSingle` in `onWillDisappear`.

### 3.7 Multi-stage hold (different actions by hold duration)

**Mechanism:** extend 3.1 with several timers or one timer per stage. Each stage replaces the previous one, and only the stage reached when the dial is released, or the last stage when its timer fires, runs.

**Cost:** users cannot discover it without feedback. Show the current stage on the strip while holding, such as a label or icon change, or do not use it.

```ts
/** Hold durations, in ascending order, and what each one triggers. */
const HOLD_STAGES = [
	{ afterMs: 500, name: "shuffle" },
	{ afterMs: 1_500, name: "repeat" },
] as const;

/** Add to Press: index of the stage reached so far, or -1. */
// stage: number;

// In onDialDown: schedule one timer per stage that sets press.stage and paints a hint.
// In onDialUp: if !rotated, run HOLD_STAGES[press.stage] (or the short action when stage is -1).
```

### 3.8 Touch zones (where on the strip was tapped)

**Mechanism:** hit-test `tapPos` against regions of the layout. Coordinates are relative to the 200×100 segment canvas, the same space as layout `rect` values, so reuse the layout rects as hit areas.

**Cost:** fingers are imprecise. Give each zone at least ~40 px in each direction, pad small icons, and always have a fallback for taps outside every zone.

```ts
/** A tappable area of the touch strip, in layout coordinates. */
type Zone = { name: string; x: number; y: number; width: number; height: number };

/** Kept in sync with layouts/<action>.json; padded beyond the visual rects. */
const ZONES: readonly Zone[] = [
	{ name: "shuffle", x: 62, y: 50, width: 40, height: 32 },
	{ name: "progress", x: 0, y: 78, width: 200, height: 22 },
];

/**
 * Finds the zone under a tap.
 * @param x Tap x, 0-200.
 * @param y Tap y, 0-100.
 * @returns The zone, or undefined when the tap missed every zone.
 */
function zoneAt(x: number, y: number): Zone | undefined {
	return ZONES.find((zone) => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height);
}

override async onTouchTap(ev: TouchTapEvent): Promise<void> {
	const [x, y] = ev.payload.tapPos;
	const zone = zoneAt(x, y);

	if (zone?.name === "shuffle") {
		// ...toggle shuffle
		return;
	}

	if (zone?.name === "progress") {
		// Position along the bar → fraction of the track, e.g. for seeking.
		const fraction = Math.max(0, Math.min(1, (x - zone.x) / zone.width));
		// ...seek to fraction * duration (verify `player position` is writable in docs/music.sdef)
		return;
	}

	// Fallback for every other tap.
}
```

### 3.9 Long touch on the strip — *native flag*

**Mechanism:** `ev.payload.hold === true` on `onTouchTap`. No timer is needed. Describe it with `TriggerDescription.LongTouch`. It can be combined with zones (3.8) to give each zone a second action.

```ts
override async onTouchTap(ev: TouchTapEvent): Promise<void> {
	if (ev.payload.hold) {
		// ...long-touch action
		return;
	}

	// ...tap action
}
```

### 3.10 Double tap on the strip

**Mechanism:** identical to 3.6, driven by `onTouchTap` instead of `onDialUp`. Optionally require both taps to land in the same zone.

**Cost:** same delay on single tap as 3.6.

### 3.11 Cross-dial combinations

**Mechanism:** module-level state shared by actions, such as "dial A is currently pressed", read by another dial's handler. For example, hold the Playback Control dial while turning the Volume dial to change a different value.

**Cost:** hard to discover, fragile when one dial is on another page, and couples actions together. Avoid it unless explicitly requested.

---

## 4. Composition rules

When combining triggers on one dial, resolve them in this order:

1. **Rotation while pressed** (3.2) overrides every press-based trigger. Once `rotated` is set, release does nothing.
2. **Long or multi-stage hold** (3.1, 3.7) overrides short and double press. Once `consumed` is set, release does nothing.
3. **Double press** (3.6) is decided on release, after the two checks above.
4. **Single press** fires only when nothing above claimed the press.

Compatibility:

| Combination | OK? | Note |
|---|---|---|
| Long press + press-rotate | ✅ | Rotation cancels the long-press timer. |
| Long press + double press | ⚠️ | Works, but single press now waits for both the release and `DOUBLE_PRESS_MS`. |
| Detent threshold + acceleration | ❌ | Acceleration makes discrete steps unpredictable. |
| Touch zones + long touch | ✅ | Each zone can have tap and long-touch actions. |
| Touch zones + double tap | ⚠️ | Every tap is delayed; require the same zone for both taps. |

---

## 5. Feedback and performance rules

* **Acknowledge every derived trigger visibly**, such as an icon change or an overlay. A long press with no change on screen feels broken.
* **≤ 10 visual updates per second** for the whole plugin. Send only the strip items that changed (see `#send` in `playback-control.ts`).
* **No per-event process spawning** for continuous input. Coalesce (3.4).
* **Report failures** with `ev.action.showAlert()` when a user-triggered command fails.
* **Clean up**: every `setTimeout` started by a trigger is cleared on release, on replacement and in `onWillDisappear`.
* **Update `TriggerDescription`** in `manifest.json` whenever triggers change.
