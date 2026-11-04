import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeadless } from '../src/platform/headless.ts';
import { resolveAsset } from '../src/config.ts';

test('headless platform counts output and keeps a manual clock', async () => {
  const p = createHeadless();
  const tex = await p.renderer.loadTexture('x.png');
  p.renderer.beginFrame(640, 480);
  p.renderer.drawImage(tex, 0, 0, 16, 16, 0, 0, 8, 8, 1, 1, 0, 0xffffff, 1);
  p.renderer.endFrame();
  p.tick(16);
  assert.deepEqual(p.stats, { frames: 1, draws: 1, sounds: 0, texts: [] });
  assert.equal(p.now(), 16);
});

test('asset paths resolve against configured bases', () => {
  const cfg = { projectBase: '/kr/pj/demo/', sharedAssetBase: '/kr/sa/' };
  assert.equal(resolveAsset(cfg, './sprites/a.png'), '/kr/pj/demo/sprites/a.png');
  assert.equal(resolveAsset(cfg, '/sa/~admin/coin.png'), '/kr/sa/~admin/coin.png');
  assert.throws(() => resolveAsset(cfg, 'http://evil/x.png'), /unrecognised asset path/);
});
