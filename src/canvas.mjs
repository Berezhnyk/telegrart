import { deflateSync, crc32 } from 'node:zlib';
import { A, PAL, crop } from './codec.mjs';

export const blank = () => ({ W: 16, p: Array(256).fill(0) }); // must match the widget's default state

/**
 * Applies a widget sync payload (see codec.mjs) to `st` in place.
 * Validates everything first so a bad payload never half-applies.
 * @returns {boolean} true when the widget asked for a PNG export.
 */
export function applyPayload(st, q) {
  if (typeof q !== 'string' || q.length < 1 || q.length > 64) throw new Error('bad payload length');
  const exp = q[0] === '!';
  const o = exp ? 1 : 0;
  const W = A.indexOf(q[o]);
  if (W < 1 || W > 32) throw new Error('bad size');
  if ((q.length - o - 1) % 5) throw new Error('bad run length');
  const d = (k) => {
    const v = A.indexOf(q[k]);
    if (v < 0) throw new Error('bad char');
    return v;
  };
  const runs = [];
  for (let k = o + 1; k < q.length; k += 5) {
    const i = d(k) * 64 + d(k + 1), n = d(k + 2) * 64 + d(k + 3) + 1, c = d(k + 4);
    if (i + n > W * W || c > PAL.length) throw new Error('run out of range');
    runs.push([i, n, c]);
  }
  if (W !== st.W) { st.p = crop(st.p, st.W, W); st.W = W; }
  for (const [i, n, c] of runs) st.p.fill(c, i, i + n);
  return exp;
}

/** Renders the image as an RGBA PNG, each pixel scaled to a `scale`×`scale` block. */
export function toPng({ W, p }, scale = Math.max(1, Math.floor(512 / W))) {
  const w = W * scale, row = w * 4 + 1, raw = Buffer.alloc(row * w);
  const rgb = PAL.map((h) => [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)));
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const v = p[Math.floor(y / scale) * W + Math.floor(x / scale)];
      if (!v) continue; // transparent
      const o = y * row + 1 + x * 4;
      raw.set(rgb[v - 1], o);
      raw[o + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(td.length + 8);
    out.writeUInt32BE(data.length, 0);
    td.copy(out, 4);
    out.writeUInt32BE(crc32(td), td.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
