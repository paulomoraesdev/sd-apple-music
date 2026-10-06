import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const sdPlugin = "com.paulomoraesdev.applemusic.sdPlugin";

export default {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		format: "es",
		sourcemap: false,
	},
	// Node built-ins stay external; Stream Deck runs the plugin on its own Node runtime.
	external: [/^node:/],
	plugins: [
		typescript({ tsconfig: "./tsconfig.json", noEmit: false, outDir: undefined, declaration: false }),
		nodeResolve({ preferBuiltins: true, exportConditions: ["node"] }),
		commonjs(),
	],
};
