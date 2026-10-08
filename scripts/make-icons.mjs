#!/usr/bin/env node
// scripts/make-icons.mjs
//
// Generates the PWA / Apple touch icons in public/icons from the Field Notes
// compass mark.  Run from the repo root:
//
//     node scripts/make-icons.mjs
//
// Why not rasterise public/favicon.svg as-is?  That file draws the mark on a
// rounded-rect gradient, which leaves transparent corners.  iOS composites
// transparent home-screen pixels onto black and some Android launchers show a
// halo, so the installable icons need a full-bleed opaque square instead.  The
// SVG is therefore built in code: a flat #0a0a0a square (no corner radius) with
// the same compass mark drawn larger and with thicker strokes so it still reads
// at ~60 px.  Every output is flattened and has its alpha channel removed, so
// the PNGs contain zero transparency.
//
// Importing this module does not write anything; the CLI entry is guarded.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/** SVG coordinate space.  Matches favicon.svg so the numbers are comparable. */
const CANVAS = 512;
const CENTRE = CANVAS / 2;
export const BACKGROUND = '#0a0a0a';
const INK = '#7c9eff';

/**
 * Geometry of the mark in public/favicon.svg (512 space, centred at 256,256):
 * circle r=120, cross 136..376 (+/-120), diagonals 180..332 (+/-76), dot r=14,
 * stroke-width 14.  Everything below is derived by scaling these.
 */
const BASE = { circleR: 120, crossHalf: 120, diagHalf: 76, dotR: 14 };

/**
 * Thickened stroke width at the reference mark size.  22 is ~1.6x the
 * favicon's 14.  Other mark sizes scale the stroke proportionally so the
 * maskable icon is literally the same mark drawn smaller.
 */
const THICK_STROKE = 22;
const THICK_STROKE_AT_FRACTION = 0.68;

/**
 * Output specification.  `markFraction` is the width of the mark's bounding
 * box (circle diameter including the stroke) as a fraction of the canvas.
 * The maskable icon keeps the mark inside the central 80% "safe zone" circle
 * that launchers are allowed to crop to.
 */
export const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, markFraction: 0.68 },
  { file: 'icon-192.png', size: 192, markFraction: 0.68 },
  { file: 'icon-512.png', size: 512, markFraction: 0.68 },
  { file: 'icon-512-maskable.png', size: 512, markFraction: 0.56 },
];

const num = (n) => Number(n.toFixed(2));

/**
 * Builds the icon SVG as a string.
 * @param {{ size: number, markFraction: number }} spec
 * @returns {string}
 */
export function buildIconSvg({ size, markFraction }) {
  const stroke = THICK_STROKE * (markFraction / THICK_STROKE_AT_FRACTION);
  // Outer radius of the mark, measured to the outside edge of the circle's stroke.
  const halfExtent = (markFraction * CANVAS) / 2;
  const scale = (halfExtent - stroke / 2) / BASE.circleR;

  const r = num(BASE.circleR * scale);
  const cross = num(BASE.crossHalf * scale);
  const diag = num(BASE.diagHalf * scale);
  const dot = num(BASE.dotR * scale);
  const c = CENTRE;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    // Full-bleed square background.  Deliberately no rx: no rounded corners.
    `  <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="${BACKGROUND}"/>`,
    `  <g stroke="${INK}" stroke-width="${num(stroke)}" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    `    <circle cx="${c}" cy="${c}" r="${r}"/>`,
    `    <path d="M${c} ${num(c - cross)} L${c} ${num(c + cross)} M${num(c - cross)} ${c} L${num(c + cross)} ${c}"/>`,
    `    <path d="M${num(c - diag)} ${num(c - diag)} L${num(c + diag)} ${num(c + diag)}" opacity="0.5"/>`,
    `    <path d="M${num(c + diag)} ${num(c - diag)} L${num(c - diag)} ${num(c + diag)}" opacity="0.5"/>`,
    `  </g>`,
    `  <circle cx="${c}" cy="${c}" r="${dot}" fill="${INK}"/>`,
    `</svg>`,
  ].join('\n');
}

/**
 * Renders one icon spec to an opaque RGB PNG buffer.
 * @param {{ size: number, markFraction: number }} spec
 * @returns {Promise<Buffer>}
 */
export async function renderIcon(spec) {
  const svg = Buffer.from(buildIconSvg(spec), 'utf8');
  return sharp(svg)
    .resize(spec.size, spec.size, { fit: 'cover' })
    .flatten({ background: BACKGROUND })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Writes every icon in ICONS to <repo>/public/icons and prints what was written.
 * @param {string} [root] repo root; defaults to the parent of this script's directory
 */
export async function makeIcons(root = repoRoot()) {
  const outDir = path.join(root, 'public', 'icons');
  await mkdir(outDir, { recursive: true });

  for (const spec of ICONS) {
    const png = await renderIcon(spec);
    const outPath = path.join(outDir, spec.file);
    await writeFile(outPath, png);

    // Report the dimensions of the bytes actually written, not the requested ones.
    const meta = await sharp(png).metadata();
    const rel = path.relative(root, outPath).split(path.sep).join('/');
    console.log(
      `wrote ${rel} ${meta.width}x${meta.height} ` +
        `(${meta.channels} channels, alpha=${meta.hasAlpha ? 'yes' : 'no'}, ${png.length} bytes)`
    );
  }
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
  makeIcons().catch((err) => {
    console.error(`make-icons failed: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  });
}
