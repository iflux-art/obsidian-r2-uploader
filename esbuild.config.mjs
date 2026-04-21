import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

const buildOptions = {
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian"],
	outdir: "dist",
	format: "cjs",
	platform: "neutral",
	sourcemap: true,
	metafile: true,
	target: ["es2020"],
	mainFields: ["browser", "module", "main"],
};

async function build() {
	if (!existsSync("dist")) {
		mkdirSync("dist", { recursive: true });
	}

	copyFileSync("manifest.json", "dist/manifest.json");
	copyFileSync("styles.css", "dist/styles.css");

	if (isWatch) {
		const ctx = await esbuild.context(buildOptions);
		await ctx.watch();
		console.log("Watching for changes...");
	} else {
		await esbuild.build(buildOptions);
		console.log("Build complete!");
	}
}

build().catch((err) => {
	console.error(err);
	process.exit(1);
});
