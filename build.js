const esbuild = require("esbuild");

async function build() {
  // Bundle offscreen document (needs lamejs)
  await esbuild.build({
    entryPoints: ["src/offscreen/offscreen.js"],
    bundle: true,
    outfile: "dist/offscreen.js",
    format: "iife",
    minify: true,
  });

  // Bundle background service worker
  await esbuild.build({
    entryPoints: ["src/background/background.js"],
    bundle: true,
    outfile: "dist/background.js",
    format: "iife",
    minify: true,
  });

  // Bundle content script
  await esbuild.build({
    entryPoints: ["src/content/content.js"],
    bundle: true,
    outfile: "dist/content.js",
    format: "iife",
    minify: true,
  });

  // Bundle options page
  await esbuild.build({
    entryPoints: ["src/options/options.js"],
    bundle: true,
    outfile: "dist/options.js",
    format: "iife",
    minify: true,
  });

  console.log("Build complete");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
