const { execSync } = require("child_process");
const { readFileSync, writeFileSync, unlinkSync } = require("fs");

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const version = manifest.version;
const outfile = `meet-recorder-v${version}.zip`;

// Files and directories to include in the Chrome Web Store package
const includes = [
  "manifest.json",
  "dist/",
  "images/",
  "src/content/recorder-ui.css",
  "src/offscreen/offscreen.html",
  "src/offscreen/pcm-processor.js",
  "src/options/options.html",
  "src/permissions/permissions.html",
  "src/permissions/permissions.js",
];

const isDev = process.argv.includes("--dev");

if (isDev) {
  // Dev build: keep the key field so sideloaded installs share the same extension ID
  execSync(`rm -f ${outfile}`);
  execSync(`zip -r ${outfile} ${includes.join(" ")}`);
  console.log(`Packaged (dev): ${outfile}`);
} else {
  // Chrome Web Store does not allow the "key" field in the manifest.
  // Strip it for packaging, then restore the original after.
  const { key, ...manifestWithoutKey } = manifest;
  writeFileSync("manifest.json", JSON.stringify(manifestWithoutKey, null, 2) + "\n");

  try {
    execSync(`rm -f ${outfile}`);
    execSync(`zip -r ${outfile} ${includes.join(" ")}`);
    console.log(`Packaged: ${outfile}`);
  } finally {
    writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  }
}
