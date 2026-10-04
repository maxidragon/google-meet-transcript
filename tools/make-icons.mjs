/**
 * Draws the extension's icons from scratch, so the artwork is reproducible and
 * the colour lives in one place. Run with `npm run icons`.
 *
 * Deliberately not Google's palette: an extension that works on a Google
 * product must not look like one, and Google blue on a rounded square is the
 * shape of that mistake.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRAND = [109, 40, 217, 255];
const WHITE = [255, 255, 255, 255];
const ICON_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");

function roundedRectCoverage(x, y, rect) {
  const { left, top, right, bottom, radius } = rect;
  if (x < left || x > right || y < top || y > bottom) return 0;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const distance = Math.hypot(x - cx, y - cy);
  return Math.min(1, Math.max(0, radius - distance + 0.5));
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size / 128;
  const background = { left: 4 * s, top: 4 * s, right: size - 4 * s, bottom: size - 4 * s, radius: 26 * s };
  const bars = [
    { left: 26, top: 38, right: 102, bottom: 50 },
    { left: 26, top: 58, right: 102, bottom: 70 },
    { left: 26, top: 78, right: 78, bottom: 90 },
  ].map((bar) => ({
    left: bar.left * s, top: bar.top * s, right: bar.right * s, bottom: bar.bottom * s, radius: 6 * s,
  }));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const inBackground = roundedRectCoverage(px, py, background);
      if (inBackground <= 0) continue;
      const inBar = Math.max(...bars.map((bar) => roundedRectCoverage(px, py, bar)));
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(BRAND[channel] * (1 - inBar) + WHITE[channel] * inBar);
      }
      pixels[offset + 3] = Math.round(255 * inBackground);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ 0xffffffff;
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  const target = path.join(ICON_DIRECTORY, `icon${size}.png`);
  writeFileSync(target, encodePng(size, drawIcon(size)));
  console.log("wrote", path.relative(process.cwd(), target));
}
