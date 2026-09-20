#!/usr/bin/env node
/**
 * Generates the application icons.
 *
 * Written out rather than committed as binaries: a 300KB .ico in git that
 * nobody can diff is exactly the kind of opaque artifact this repository tries
 * not to accumulate. The mark is drawn from a few primitives here, so changing
 * it is a code change with a readable diff.
 *
 * PNG and ICO are both written by hand. Pulling an image library into a
 * security tool's dependency tree to draw a circle would fail rule AGENT-022.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'apps', 'desktop', 'icons');

// Brand-neutral: near-black plate, one accent, one muted ring.
const PLATE = [17, 21, 29, 255];
const ACCENT = [86, 189, 168, 255];
const MUTED = [92, 104, 124, 255];

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** Coverage of a rounded rectangle at a point, antialiased over ~1px. */
function roundedRect(x, y, size) {
  const inset = size * 0.055;
  const r = size * 0.22;
  const min = inset;
  const max = size - inset;
  const cx = Math.min(Math.max(x, min + r), max - r);
  const cy = Math.min(Math.max(y, min + r), max - r);
  const d = Math.hypot(x - cx, y - cy);
  if (x < min || x > max || y < min || y > max) return 0;
  return clamp01((r - d) / 1.2 + 0.5);
}

/** Coverage of a ring (annulus) centred on the plate. */
function ring(x, y, size, radiusRatio, thicknessRatio) {
  const c = size / 2;
  const radius = size * radiusRatio;
  const half = (size * thicknessRatio) / 2;
  const d = Math.abs(Math.hypot(x - c, y - c) - radius);
  return clamp01((half - d) / 1.2 + 0.5);
}

/** Coverage of a horizontal bar — the "link" through the ring. */
function bar(x, y, size) {
  const c = size / 2;
  const halfH = size * 0.043;
  const halfW = size * 0.30;
  const dy = Math.abs(y - c) - halfH;
  const dx = Math.abs(x - c) - halfW;
  return clamp01(-Math.max(dx, dy) / 1.2 + 0.5);
}

function over(dst, src, alpha) {
  const a = alpha * (src[3] / 255);
  for (let i = 0; i < 3; i += 1) dst[i] = Math.round(src[i] * a + dst[i] * (1 - a));
  dst[3] = Math.round(255 * a + dst[3] * (1 - a));
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = [0, 0, 0, 0];
      const cx = x + 0.5;
      const cy = y + 0.5;
      over(px, PLATE, roundedRect(cx, cy, size));
      over(px, MUTED, ring(cx, cy, size, 0.31, 0.055));
      over(px, ACCENT, ring(cx, cy, size, 0.20, 0.07));
      over(px, ACCENT, bar(cx, cy, size));
      pixels.set(px, (y * size + x) * 4);
    }
  }
  return pixels;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const pixels = render(size);
  // PNG scanlines are prefixed with a filter byte; 0 means "none".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO carrying PNG payloads — supported by Windows Vista and later. */
function ico(sizes) {
  const images = sizes.map((size) => ({ size, data: png(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.png'), png(512));
writeFileSync(join(outDir, 'icon.ico'), ico([16, 32, 48, 64, 128, 256]));
console.log(`Icons written to ${outDir}`);
