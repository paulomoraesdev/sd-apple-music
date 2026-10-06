/**
 * Minimal property-inspector runtime.
 *
 * Deliberately dependency-free: a property inspector only needs to register on a WebSocket,
 * read the settings it was handed, and write them back on change. Vendoring a UI component
 * library for that would add megabytes and a supply chain to a plugin whose settings fit on
 * one screen.
 *
 * Usage: give each input an `data-setting` attribute naming the key it binds to, and this
 * wires it up both ways.
 */

(() => {
	/** The open connection to Stream Deck, once registered. */
	let socket;

	/** This action instance's context, used to address settings messages. */
	let context;

	/** The action's manifest UUID. */
	let actionUuid;

	/** The current settings, kept in memory and written back wholesale on change. */
	let settings = {};

	/**
	 * Reads a value out of an input, coerced to the type the plugin expects.
	 * @param {HTMLInputElement | HTMLSelectElement} input The bound input.
	 * @returns {string | number | boolean} The value to persist.
	 */
	function readValue(input) {
		if (input instanceof HTMLInputElement && input.type === "checkbox") {
			return input.checked;
		}

		if (input instanceof HTMLInputElement && (input.type === "number" || input.type === "range")) {
			const value = Number.parseFloat(input.value);
			return Number.isFinite(value) ? value : 0;
		}

		return input.value;
	}

	/**
	 * Writes a stored value into an input.
	 * @param {HTMLInputElement | HTMLSelectElement} input The bound input.
	 * @param {unknown} value The stored value.
	 */
	function writeValue(input, value) {
		if (value === undefined || value === null) {
			return;
		}

		if (input instanceof HTMLInputElement && input.type === "checkbox") {
			input.checked = Boolean(value);
			return;
		}

		input.value = String(value);
	}

	/** Pushes the in-memory settings to Stream Deck. */
	function save() {
		if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
			return;
		}

		socket.send(
			JSON.stringify({
				action: actionUuid,
				context,
				event: "setSettings",
				payload: settings,
			}),
		);
	}

	/** Binds every `[data-setting]` input to the settings object. */
	function bind() {
		for (const input of document.querySelectorAll("[data-setting]")) {
			const key = input.dataset.setting;
			if (key === undefined) {
				continue;
			}

			writeValue(input, settings[key]);

			// Mirror range inputs into their companion output, if the markup declares one.
			const output = document.querySelector(`[data-output="${key}"]`);
			const sync = () => {
				if (output !== null) {
					output.textContent = String(readValue(input));
				}
			};

			sync();

			input.addEventListener("input", () => {
				settings[key] = readValue(input);
				sync();
				save();
			});
		}
	}

	/**
	 * Entry point called by Stream Deck when the property inspector loads.
	 * @param {string} port WebSocket port.
	 * @param {string} uuid This property inspector's identifier.
	 * @param {string} registerEvent Name of the registration event.
	 * @param {string} _info Stream Deck application information, as JSON.
	 * @param {string} actionInfo Information about the action, as JSON.
	 */
	window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo) => {
		const info = JSON.parse(actionInfo);

		context = uuid;
		actionUuid = info.action;
		settings = info.payload?.settings ?? {};

		socket = new WebSocket(`ws://127.0.0.1:${port}`);
		socket.addEventListener("open", () => {
			socket.send(JSON.stringify({ event: registerEvent, uuid }));
		});

		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);

			if (message.event === "sendToPropertyInspector") {
				// Re-emitted as a DOM event so each inspector page can listen without this file
				// knowing anything about what any particular action sends.
				window.dispatchEvent(new CustomEvent("sdpi.message", { detail: message.payload }));
				return;
			}

			if (message.event !== "didReceiveSettings") {
				return;
			}

			// Another surface changed the settings; reflect that rather than clobbering it.
			settings = message.payload?.settings ?? {};
			for (const input of document.querySelectorAll("[data-setting]")) {
				writeValue(input, settings[input.dataset.setting ?? ""]);
			}
		});

		bind();
	};
})();
