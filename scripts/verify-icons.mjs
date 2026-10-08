#!/usr/bin/env node
// scripts/verify-icons.mjs
//
// Verifies the PNG icons in public/icons are complete and fully opaque:
//
//   (a) walks the PNG container by hand (8-byte signature, then
//       length / type / data / CRC chunks), recomputes every chunk's CRC32,
//       and requires an IHDR first, at least one IDAT, and a closing IEND --
//       so a truncated file fails even when a decoder is lenient;
//   (b) fully decodes the file with sharp (ensureAlpha + raw) and checks the
//       decoded width and height equal the expected square size;
//   (c) checks that every pixel's alpha byte is 255;
//   (d) for the maskable icon, additionally checks that every pixel outside
//       the central 80% "safe zone" circle is background colour.
//
// Prints one PASS line per file, or a FAIL line with the reason.  The CLI exits
// with code 1 if anything fails.  Importing this module runs nothing; use
// `checkIcon(filePath, expectedSize, options)` to reuse the per-file check.
//
// Targets Node 20 (used in CI): no import.meta.dirname, no zlib.crc32, etc.
//
// Usage:  node scripts/verify-icons.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/** Files to check, relative to the repo root, with their expected square size. */
export const ICONS = [
  { file: 'public/icons/apple-touch-icon.png', size: 180 },
  { file: 'public/icons/icon-192.png', size: 192 },
  { file: 'public/icons/icon-512.png', size: 512 },
  { file: 'public/icons/icon-512-maskable.png', size: 512, maskable: true },
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Expected background of the icons (#0a0a0a) and the per-channel tolerance. */
const BACKGROUND_RGB = [0x0a, 0x0a, 0x0a];
const BACKGROUND_TOLERANCE = 2;

/** Maskable safe zone: a circle of radius 40% of the icon's size, centred. */
const SAFE_ZONE_RADIUS_FRACTION = 0.4;

const COLOR_TYPE_NAMES = {
  0: 'greyscale',
  2: 'RGB',
  3: 'palette',
  4: 'greyscale+alpha',
  6: 'RGBA',
};

// ---------------------------------------------------------------------------
// CRC32 (ISO 3309, the polynomial PNG uses), table-driven.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit CRC
 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const hex32 = (n) => '0x' + n.toString(16).padStart(8, '0');

// ---------------------------------------------------------------------------
// Chunk walk.
// ---------------------------------------------------------------------------

/**
 * Walks the PNG container without decoding pixel data.  Throws an Error with
 * a descriptive message on the first structural problem.
 *
 * @param {Buffer} buf
 * @returns {{ chunks: Array<{type: string, length: number, offset: number}>,
 *             ihdr: {width: number, height: number, bitDepth: number, colorType: number} }}
 */
export function walkPngChunks(buf) {
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('missing PNG signature (not a PNG file)');
  }

  const chunks = [];
  let ihdr = null;
  let sawIEND = false;
  let offset = PNG_SIGNATURE.length;

  const lastChunkDesc = () =>
    chunks.length
      ? `${chunks[chunks.length - 1].type} chunk at offset ${chunks[chunks.length - 1].offset}`
      : 'the signature';

  while (offset < buf.length) {
    const remaining = buf.length - offset;
    if (remaining < 8) {
      throw new Error(
        `truncated: ${remaining} stray byte(s) after ${lastChunkDesc()}, not enough for a chunk header; no IEND`
      );
    }

    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new Error(`corrupt chunk type ${JSON.stringify(type)} at offset ${offset}`);
    }
    if (chunks.length === 0 && type !== 'IHDR') {
      throw new Error(`first chunk is ${type}, expected IHDR`);
    }

    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > buf.length) {
      const available = Math.max(0, buf.length - dataStart);
      throw new Error(
        `truncated: ${type} chunk at offset ${offset} declares ${length} data bytes ` +
          `but only ${available} remain (file ends ${crcEnd - buf.length} bytes early); no IEND`
      );
    }

    const storedCrc = buf.readUInt32BE(dataEnd);
    const computedCrc = crc32(buf.subarray(offset + 4, dataEnd)); // CRC covers type + data
    if (storedCrc !== computedCrc) {
      throw new Error(
        `CRC mismatch in ${type} chunk at offset ${offset}: stored ${hex32(storedCrc)}, computed ${hex32(computedCrc)}`
      );
    }

    if (type === 'IHDR') {
      if (length !== 13) throw new Error(`IHDR chunk has ${length} bytes, expected 13`);
      ihdr = {
        width: buf.readUInt32BE(dataStart),
        height: buf.readUInt32BE(dataStart + 4),
        bitDepth: buf[dataStart + 8],
        colorType: buf[dataStart + 9],
      };
    }

    chunks.push({ type, length, offset });
    offset = crcEnd;

    if (type === 'IEND') {
      sawIEND = true;
      break;
    }
  }

  if (!sawIEND) {
    throw new Error(`no IEND chunk (file ends cleanly after ${lastChunkDesc()}, but is incomplete)`);
  }
  if (offset !== buf.length) {
    throw new Error(`${buf.length - offset} trailing byte(s) after IEND`);
  }
  if (!chunks.some((c) => c.type === 'IDAT')) {
    throw new Error('no IDAT chunk (no image data)');
  }

  return { chunks, ihdr };
}

// ---------------------------------------------------------------------------
// Per-file check.
// ---------------------------------------------------------------------------

/**
 * Runs every check against one PNG.
 *
 * @param {string} filePath  path to the PNG (absolute, or relative to cwd)
 * @param {number} expectedSize  expected width and height in pixels
 * @param {{ maskable?: boolean }} [options]  maskable: also require the mark to
 *   stay inside the central 80% safe-zone circle
 * @returns {Promise<{ file: string, ok: boolean, errors: string[], width: number|null,
 *   height: number|null, pixels: number, chunks: string[], colorType: string|null }>}
 */
export async function checkIcon(filePath, expectedSize, options = {}) {
  const { maskable = false } = options;
  const result = {
    file: filePath,
    ok: false,
    errors: [],
    width: null,
    height: null,
    pixels: 0,
    chunks: [],
    colorType: null,
  };

  try {
    const buf = await readFile(filePath);

    // (a) container structure and CRCs
    const { chunks, ihdr } = walkPngChunks(buf);
    result.chunks = chunks.map((c) => c.type);
    result.colorType = `${ihdr.colorType} (${COLOR_TYPE_NAMES[ihdr.colorType] || 'unknown'})`;
    if (ihdr.width !== expectedSize || ihdr.height !== expectedSize) {
      result.errors.push(`IHDR declares ${ihdr.width}x${ihdr.height}, expected ${expectedSize}x${expectedSize}`);
    }

    // (b) full decode
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    result.width = info.width;
    result.height = info.height;
    result.pixels = info.width * info.height;
    if (info.width !== expectedSize || info.height !== expectedSize) {
      result.errors.push(`decoded ${info.width}x${info.height}, expected ${expectedSize}x${expectedSize}`);
    }
    if (info.channels !== 4) {
      result.errors.push(`decoded ${info.channels} channels after ensureAlpha(), expected 4`);
    } else if (data.length !== result.pixels * 4) {
      result.errors.push(`decoded buffer is ${data.length} bytes, expected ${result.pixels * 4}`);
    } else {
      // (c) every alpha byte must be 255
      let notOpaque = 0;
      let firstBad = -1;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) {
          notOpaque += 1;
          if (firstBad < 0) firstBad = (i - 3) / 4;
        }
      }
      if (notOpaque > 0) {
        const x = firstBad % info.width;
        const y = Math.floor(firstBad / info.width);
        result.errors.push(
          `${notOpaque} of ${result.pixels} pixels are not fully opaque ` +
            `(first at x=${x}, y=${y}, alpha=${data[firstBad * 4 + 3]})`
        );
      }

      // (d) maskable: nothing but background outside the safe-zone circle
      if (maskable) {
        const cx = info.width / 2;
        const cy = info.height / 2;
        const safeR2 = (SAFE_ZONE_RADIUS_FRACTION * Math.min(info.width, info.height)) ** 2;
        let outside = 0;
        let firstOut = -1;
        for (let p = 0; p < result.pixels; p += 1) {
          const x = p % info.width;
          const y = Math.floor(p / info.width);
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= safeR2) continue;
          const o = p * 4;
          const isBg =
            Math.abs(data[o] - BACKGROUND_RGB[0]) <= BACKGROUND_TOLERANCE &&
            Math.abs(data[o + 1] - BACKGROUND_RGB[1]) <= BACKGROUND_TOLERANCE &&
            Math.abs(data[o + 2] - BACKGROUND_RGB[2]) <= BACKGROUND_TOLERANCE;
          if (!isBg) {
            outside += 1;
            if (firstOut < 0) firstOut = p;
          }
        }
        if (outside > 0) {
          const x = firstOut % info.width;
          const y = Math.floor(firstOut / info.width);
          result.errors.push(
            `maskable: ${outside} non-background pixel(s) outside the central 80% safe zone (first at x=${x}, y=${y})`
          );
        }
      }
    }
  } catch (err) {
    result.errors.push(err && err.message ? err.message : String(err));
  }

  result.ok = result.errors.length === 0;
  return result;
}

/**
 * Formats a checkIcon() result as a single PASS / FAIL line.
 * @param {Awaited<ReturnType<typeof checkIcon>>} result
 * @param {string} [label] display name; defaults to result.file
 */
export function formatResult(result, label = result.file) {
  if (result.ok) {
    const counts = new Map();
    for (const t of result.chunks) counts.set(t, (counts.get(t) || 0) + 1);
    const chunkSummary = [...counts].map(([t, n]) => (n > 1 ? `${t}x${n}` : t)).join(' ');
    return (
      `PASS ${label} ${result.width}x${result.height}, ${result.pixels} pixels, all alpha=255, ` +
      `colour type ${result.colorType}, ${result.chunks.length} chunks (${chunkSummary}) with valid CRCs, IEND present`
    );
  }
  return `FAIL ${label}: ${result.errors.join('; ')}`;
}

/**
 * Checks every icon in `icons` (paths relative to `root`), printing one line
 * each.  Resolves to true when all pass.
 */
export async function verifyIcons(icons = ICONS, root = repoRoot()) {
  let allOk = true;
  for (const icon of icons) {
    const result = await checkIcon(path.join(root, icon.file), icon.size, { maskable: Boolean(icon.maskable) });
    console.log(formatResult(result, icon.file));
    if (!result.ok) allOk = false;
  }
  return allOk;
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const argvPath = path.resolve(process.argv[1]);
  const modulePath = fileURLToPath(import.meta.url);
  return process.platform === 'win32'
    ? argvPath.toLowerCase() === modulePath.toLowerCase()
    : argvPath === modulePath;
}

if (isMainModule()) {
  verifyIcons()
    .then((ok) => {
      if (ok) {
        console.log(`All ${ICONS.length} icons passed.`);
      } else {
        console.log('Icon verification FAILED.');
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error(`verify-icons crashed: ${err && err.message ? err.message : err}`);
      process.exitCode = 1;
    });
}
