import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const root = join(import.meta.dirname, '..');
// Telegram limits for sendWidget's `html` parameter.
export const MAX_RAW = 32768, MAX_PACKED = 4096;

/** Inlines the shared codec into the widget template and squeezes whitespace. */
export function buildWidget(template = join(root, 'templates', 'pixelart.widget.html')) {
  const codec = readFileSync(join(root, 'src', 'codec.mjs'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^export /gm, '');
  const html = readFileSync(template, 'utf8')
    .replace('/*CODEC*/', () => codec)
    .replace(/\r/g, '')
    .replace(/\n\s*/g, '\n')
    .trim();
  const raw = Buffer.byteLength(html);
  const packed = deflateSync(html, { level: 9 }).length;
  if (html.includes('\0')) throw new Error('widget HTML must not contain NUL characters');
  if (raw > MAX_RAW || packed > MAX_PACKED) {
    throw new Error(`widget too large: ${raw}/${MAX_RAW} bytes raw, ${packed}/${MAX_PACKED} bytes compressed`);
  }
  return { html, raw, packed };
}
