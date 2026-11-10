import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { A, PAL, enc, dec, diff, crop } from '../src/codec.mjs';
import { applyPayload, blank, toPng } from '../src/canvas.mjs';
import { buildWidget, MAX_PACKED } from '../src/widget.mjs';

const rand = (n) => Math.floor(Math.random() * n);
const randomImage = (W) => Array.from({ length: W * W }, () => rand(PAL.length + 1));

test('state encoding round-trips and fits chat_data (1024 bytes)', () => {
  for (const W of [1, 8, 16, 24, 32]) {
    const p = randomImage(W);
    const s = enc(W, p);
    assert.ok(Buffer.byteLength(s) <= 1024, `${W}: ${s.length}`);
    assert.deepEqual(dec(s), { W, p });
  }
  assert.equal(dec(''), undefined);
  assert.equal(dec(null), undefined);
});

test('the widget and bot converge through 64-byte sync requests, including resizes', () => {
  for (let trial = 0; trial < 200; trial++) {
    let server = blank(), local = blank(), synced = enc(server.W, server.p);
    for (let step = 0; step < 20; step++) {
      // random local edit: paint some pixels, fill a range, or resize
      const r = rand(10);
      if (r === 0) { const W = [8, 16, 24, 32][rand(4)]; local = { W, p: crop(local.p, local.W, W) }; }
      else if (r === 1) local.p.fill(rand(17), rand(local.p.length));
      else for (let k = rand(40); k--;) local.p[rand(local.p.length)] = rand(17);
      // sync loop, exactly like the widget: diff against the last state the bot confirmed
      for (let guard = 0; ; guard++) {
        assert.ok(guard < 200, 'sync did not converge');
        const S = dec(synced);
        const [runs, complete] = diff(crop(S.p, S.W, local.W), local.p, local.W);
        if (!runs && S.W === local.W) break;
        const q = A[local.W] + runs;
        assert.ok(Buffer.byteLength('!' + q) <= 64, `payload too long: ${q.length}`);
        assert.equal(applyPayload(server, q), false);
        synced = enc(server.W, server.p);
        if (complete) assert.deepEqual(dec(synced), local);
      }
    }
  }
});

test('export flag and malformed payloads', () => {
  const st = blank();
  assert.equal(applyPayload(st, '!Q'), true);
  for (const bad of ['', '!', 'h', 'A', 'Q' + 'A'.repeat(64), 'QAAA', 'QAAAA_', 'Q____B', 'Q*AAAB']) {
    const before = JSON.stringify(st);
    assert.throws(() => applyPayload(st, bad), undefined, JSON.stringify(bad));
    assert.equal(JSON.stringify(st), before, 'bad payload must not half-apply');
  }
});

test('PNG export decodes to the right pixels', () => {
  const st = blank();
  st.p[0] = 9; // ff004d
  const png = toPng(st, 2);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 32); // width
  const idatLen = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.deepEqual([...raw.subarray(1, 5)], [0xff, 0x00, 0x4d, 255]); // pixel (0,0)
  assert.deepEqual([...raw.subarray(1 + 4 * 2, 1 + 4 * 3)], [0, 0, 0, 0]); // pixel (2,0) transparent
});

test('widget HTML fits Telegram limits', () => {
  const { html, packed } = buildWidget();
  assert.ok(packed <= MAX_PACKED);
  assert.ok(!html.includes('/*CODEC*/') && !html.includes('export '));
});
