import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeadless } from '../src/platform/headless.ts';
import { resolveAsset } from '../src/config.ts';

test('headless platform counts output and keeps a manual clock', async () => {
  const p = createHeadless();
  const tex = await p.renderer.loadTexture('x.png');
  p.renderer.beginFrame();
  p.renderer.drawImage(tex, 0, 0, 16, 16, 0, 0, 8, 8, 1, 1, 0, 0xffffff, 1);
  p.renderer.endFrame();
  p.tick(16);
  assert.deepEqual(p.stats, { frames: 1, draws: 1, sounds: 0, log: [] });
  assert.equal(p.now(), 16);
});

test('asset paths resolve against configured bases', () => {
  const cfg = { projectBase: '/kr/pj/demo/', sharedAssetBase: '/kr/sa/' };
  assert.equal(resolveAsset(cfg, './sprites/a.png'), '/kr/pj/demo/sprites/a.png');
  assert.equal(resolveAsset(cfg, '/sa/~admin/coin.png'), '/kr/sa/~admin/coin.png');
  assert.throws(() => resolveAsset(cfg, 'http://evil/x.png'), /unrecognised asset path/);
});

test('file store partitions by project and enforces quotas', async () => {
  const { FileStore, memoryBackend, PROJECT_QUOTA, TOTAL_QUOTA } = await import('../src/platform/filestore.ts');
  const be = memoryBackend(), warns: string[] = [];
  const st = new FileStore(be, (m) => { warns.push(m); });
  await st.open('a');
  st.write('save.ini', 'x=1');
  await st.open('b');
  assert.equal(st.read('save.ini'), null);
  await st.open('a');
  assert.equal(st.read('save.ini'), 'x=1');
  // Per-project: a write past the quota is refused and the old contents stay.
  st.write('save.ini', 'y'.repeat(PROJECT_QUOTA));
  assert.equal(st.read('save.ini'), 'x=1');
  assert.equal(warns.length, 1);
  // Total: fill other projects, then the oldest of them are evicted for a new write.
  let t = 0;
  const now = Date.now;
  Date.now = () => ++t;
  try {
    const big = 'z'.repeat(PROJECT_QUOTA - 100), n = Math.floor(TOTAL_QUOTA / PROJECT_QUOTA);
    for (let i = 0; i < n; i++) { await st.open('p' + i); st.write('f', big); }
    await st.open('a');
    assert.equal(st.read('save.ini'), 'x=1');
    st.write('more', big);
    assert.equal(warns.length, 1);
    assert.equal(be.data.has('p0\0f'), false);
    assert.equal(be.data.has('p1\0f'), true);
    assert.equal(be.data.has('a\0more'), true);
  } finally { Date.now = now; }
  st.remove('more');
  assert.equal(st.read('more'), null);
  assert.equal(be.data.has('a\0more'), false);
});

test('GM GLSL ES 1.00 shaders are rewritten as 3.00 for WebGL2', async () => {
  const { glslTo300 } = await import('../src/platform/glsl.ts');
  const fs = glslTo300(`precision mediump float;
varying vec2 v_vTexcoord;
uniform sampler2D gm_BaseTexture; uniform sampler2D texture; uniform vec4 u_Uvs;
void main() { vec4 c; for (float i = u_Uvs.y; i < u_Uvs.w; i += 0.1) c = texture2D(texture, v_vTexcoord); gl_FragColor = c * texture2D(gm_BaseTexture, v_vTexcoord); }`, true);
  assert.match(fs, /^#version 300 es\n/);
  assert.match(fs, /out vec4 gm_FragColor;/);
  assert.match(fs, /in vec2 v_vTexcoord;/);
  assert.match(fs, /uniform sampler2D texture_;/);
  assert.match(fs, /c = texture\(texture_, v_vTexcoord\); gm_FragColor = c \* texture\(gm_BaseTexture,/);
  const vs = glslTo300('attribute vec3 in_Position;\nvarying vec4 v_vColour;\nvoid main() { gl_Position = vec4(in_Position, 1.0); }', false);
  assert.equal(vs, '#version 300 es\nin vec3 in_Position;\nout vec4 v_vColour;\nvoid main() { gl_Position = vec4(in_Position, 1.0); }');
  const v3 = '#version 300 es\nvoid main() {}';
  assert.equal(glslTo300(v3, true), v3);
});
