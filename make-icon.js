// Generates icon.png (256x256) and icon.ico for the Jot app.
// Pure Node, no dependencies. Draws a rounded orange square with a "J".
const fs = require('fs');
const zlib = require('zlib');

const SIZE = 256;

// RGBA framebuffer
const px = Buffer.alloc(SIZE * SIZE * 4, 0);

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  if (a >= 255) {
    // opaque: write directly (avoids blend artifacts)
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    return;
  }
  const ea = px[i + 3] / 255;
  const na = a / 255;
  const outA = na + ea * (1 - na);
  if (outA === 0) return;
  px[i]     = Math.round((r * na + px[i]     * ea * (1 - na)) / outA);
  px[i + 1] = Math.round((g * na + px[i + 1] * ea * (1 - na)) / outA);
  px[i + 2] = Math.round((b * na + px[i + 2] * ea * (1 - na)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

// Write a solid 2x2 block to close gaps from rotated coordinate rounding
function solidBlock(x, y, r, g, b) {
  setPx(x, y, r, g, b, 255);
  setPx(x + 1, y, r, g, b, 255);
  setPx(x, y + 1, r, g, b, 255);
  setPx(x + 1, y + 1, r, g, b, 255);
}

// Rounded-rect background (Peccy orange), with margin
const margin = 24;
const radius = 56;
function inRoundedRect(x, y) {
  const x0 = margin, y0 = margin, x1 = SIZE - margin, y1 = SIZE - margin;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  // corners
  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
  const dx = x - cx, dy = y - cy;
  return (dx * dx + dy * dy) <= radius * radius ||
    (x >= x0 + radius && x <= x1 - radius) ||
    (y >= y0 + radius && y <= y1 - radius);
}

// Fill background
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (inRoundedRect(x, y)) {
      // subtle vertical gradient
      const t = (y - margin) / (SIZE - 2 * margin);
      const r = Math.round(0xff - t * 20);
      const g = Math.round(0xa8 - t * 20);
      const b = 0x25;
      setPx(x, y, r, g, b, 255);
    }
  }
}

// Draw a pencil (writing) glyph in dark ink — evokes the ✍️ emoji
const ink = [26, 26, 26];

const angle = -0.75; // radians, diagonal
const cxp = 128, cyp = 128;
const halfLen = 66;
const halfW = 16;
const dirx = Math.cos(angle), diry = Math.sin(angle);
const nx = -diry, ny = dirx; // normal
// Body (sample at half-steps to avoid gaps, write solid blocks)
for (let t = -halfLen; t <= halfLen; t += 0.5) {
  for (let w = -halfW; w <= halfW; w += 0.5) {
    const x = Math.round(cxp + dirx * t + nx * w);
    const y = Math.round(cyp + diry * t + ny * w);
    const tipStart = halfLen - 22;
    if (t > tipStart) {
      const taper = halfW * (halfLen - t) / 22;
      if (Math.abs(w) > taper) continue;
    }
    solidBlock(x, y, ink[0], ink[1], ink[2]);
  }
}
// Pencil tip (orange graphite point)
for (let t = halfLen - 22; t <= halfLen - 14; t += 0.5) {
  for (let w = -halfW; w <= halfW; w += 0.5) {
    const x = Math.round(cxp + dirx * t + nx * w);
    const y = Math.round(cyp + diry * t + ny * w);
    const taper = halfW * (halfLen - t) / 22;
    if (Math.abs(w) <= taper) solidBlock(x, y, 0xff, 0xc9, 0x6b);
  }
}
// Eraser band at the back (pink)
for (let t = -halfLen; t <= -halfLen + 12; t += 0.5) {
  for (let w = -halfW; w <= halfW; w += 0.5) {
    const x = Math.round(cxp + dirx * t + nx * w);
    const y = Math.round(cyp + diry * t + ny * w);
    solidBlock(x, y, 0xff, 0x6b, 0x6b);
  }
}

// ===== Encode PNG =====
function crc32(buf) {
  let c, table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // rest 0
  // filter: each scanline prefixed with 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = encodePNG(SIZE, SIZE, px);
fs.writeFileSync('icon.png', png);

// ===== Encode ICO (embeds the PNG) =====
// ICO can contain a PNG directly (Vista+). Build a 1-image icon dir.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; // width 256 -> 0
entry[1] = 0; // height 256 -> 0
entry[2] = 0; // colors
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4);  // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8);   // size
entry.writeUInt32LE(6 + 16, 12);      // offset
fs.writeFileSync('icon.ico', Buffer.concat([header, entry, png]));

console.log('Generated icon.png (' + png.length + ' bytes) and icon.ico');
