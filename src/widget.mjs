import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { minify } from 'terser';

const root = join(import.meta.dirname, '..');
// Telegram limits for sendWidget's `html` parameter.
export const MAX_RAW = 32768, MAX_PACKED = 4096;

/**
 * Inlines the shared codec into the widget template, minifies the script with
 * terser and squeezes the markup. Pass `{ minify: false }` for readable output
 * (whitespace is still squeezed) when debugging in dist/preview.html.
 */
export async function buildWidget({ template = join(root, 'templates', 'pixelart.widget.html'), minify: min = true } = {}) {
  const codec = readFileSync(join(root, 'src', 'codec.mjs'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^export /gm, '');
  const src = readFileSync(template, 'utf8').replace('/*CODEC*/', () => codec).replace(/\r/g, '');

  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('widget template has no <script>');
  // Wrap in a function so the widget's names never leak into (or collide in) the global scope.
  // That also lets terser shorten every name.
  let js = `(()=>{\n${m[1].replace(/\n\s*/g, '\n').trim()}\n})()`;
  if (min) {
    // inline_script: escapes "</script" inside strings so the output stays safe in a <script> tag.
    ({ code: js } = await minify(js, { compress: { passes: 2 }, format: { inline_script: true } }));
  }
  // Markup and CSS are one rule/element per line, so line breaks can just go.
  const squeeze = (s) => s.replace(/\n\s*/g, '').trim();
  const html = `${squeeze(src.slice(0, m.index))}<script>${js}</script>${squeeze(src.slice(m.index + m[0].length))}`;

  const raw = Buffer.byteLength(html);
  const packed = deflateSync(html, { level: 9 }).length;
  if (html.includes('\0')) throw new Error('widget HTML must not contain NUL characters');
  if (raw > MAX_RAW || packed > MAX_PACKED) {
    throw new Error(`widget too large: ${raw}/${MAX_RAW} bytes raw, ${packed}/${MAX_PACKED} bytes compressed`);
  }
  return { html, raw, packed };
}
