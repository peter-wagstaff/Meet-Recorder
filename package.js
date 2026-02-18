const { execSync } = require("child_process");
const { readFileSync } = require("fs");

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

execSync(`rm -f ${outfile}`);
execSync(`zip -r ${outfile} ${includes.join(" ")}`);

console.log(`Packaged: ${outfile}`);
