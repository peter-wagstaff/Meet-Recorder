const { createCanvas } = require("canvas");
const fs = require("fs");

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#1a1a2e";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();

  // Red record circle
  ctx.fillStyle = "#ea4335";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
  ctx.fill();

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(`icons/icon${size}.png`, buffer);
  console.log(`Generated icon${size}.png`);
}

fs.mkdirSync("icons", { recursive: true });
[16, 48, 128].forEach(generateIcon);
