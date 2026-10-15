import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => readFileSync(path.join(projectRoot, relativePath), 'utf8');

test('the public preview does not require project-only waterfall footage', () => {
  const html = read('waterwing-blender-forward.html');
  const preview = read('src/blender-forward/preview.js');

  assert.doesNotMatch(html, /waterfall-review\.mp4|\/media\//);
  assert.doesNotMatch(preview, /waterfall-review\.mp4|\/media\//);
});

test('the public preview accepts an optional local background video', () => {
  const html = read('waterwing-blender-forward.html');
  const preview = read('src/blender-forward/preview.js');

  assert.match(html, /id="background-video-input"/);
  assert.match(html, /type="file"/);
  assert.match(html, /accept="video\/\*"/);
  assert.match(preview, /URL\.createObjectURL/);
  assert.match(preview, /URL\.revokeObjectURL/);
});

test('the Vite build uses relative URLs for GitHub Pages', () => {
  const config = read('vite.config.js');

  assert.match(config, /base:\s*['"]\.\/['"]/);
  assert.match(config, /waterwing-blender-forward\.html/);
  assert.doesNotMatch(config, /waterwing-battle-hud\.html/);
});

test('the public source tree contains no machine-specific user path', () => {
  const source = read('src/img2threejs-forward/createWaterwingForwardPropulsionModel.ts');

  assert.doesNotMatch(source, /\/Users\/seng\//);
  assert.doesNotMatch(source, /Application Support\/ChatCut/);
});
