import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.env.CHROME_PATH ?? (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome'
);
const expectedFinalActions = [
  'hover',
  'forward',
  'emerge',
  'charge-direct',
  'cast-direct',
  'charge-lob',
  'cast-lob',
  'lunge',
  'dodge',
  'hit',
  'defeat',
];

let server;
let browser;
let page;
let baseUrl;
const errors = [];

test.before(async () => {
  server = await createServer({
    root: projectRoot,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: process.platform === 'darwin'
      ? ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=metal']
      : ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'],
  });
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', request => errors.push(`${request.method()} ${request.url()}`));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(new URL('waterwing-blender-forward.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 12000 });
  try {
    await page.waitForFunction(() => window.waterwingBlenderPreview?.ready === true, { timeout: 30000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      return {
        preview: window.waterwingBlenderPreview ?? null,
        status: document.querySelector('#status')?.textContent ?? null,
        userAgent: navigator.userAgent,
        webgl2: Boolean(canvas.getContext('webgl2')),
        webgl: Boolean(canvas.getContext('webgl')),
      };
    });
    console.error('Waterwing browser startup diagnostics', JSON.stringify({ errors, diagnostics }, null, 2));
    throw error;
  }
});

test.after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

test('Blender forward review defaults to one model and can show three independent clones', { timeout: 40000 }, async () => {
  const result = await page.evaluate(() => {
    const initial = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setCloneCount(3);
    const trio = window.waterwingBlenderPreview.getState();
    return { initial, trio };
  });
  assert.equal(result.initial.assetVersion, 'waterwing-forward-v1');
  assert.equal(result.initial.clip, 'WW_forward_loop_v1');
  assert.equal(result.initial.cloneCount, 1);
  assert.equal(result.initial.rootMotion, false);
  assert.equal(result.trio.cloneCount, 3);
  assert.equal(new Set(result.trio.skeletonUuids).size, 3);
  assert.equal(result.trio.anchorCount, 7);
  assert.equal(result.trio.finiteBounds, true);
  assert.equal(result.trio.canvasCount, 1);
});

test('deterministic seeking changes pose and closes the four-second loop', { timeout: 40000 }, async () => {
  const samples = [];
  for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
    samples.push(await page.evaluate(value => {
      window.waterwingBlenderPreview.setPhase(value);
      return window.waterwingBlenderPreview.getState();
    }, phase));
  }
  assert.ok(samples.every(sample => sample.finiteBounds));
  assert.notEqual(samples[0].poseFingerprint, samples[1].poseFingerprint);
  assert.notEqual(samples[1].poseFingerprint, samples[2].poseFingerprint);
  assert.equal(samples[0].poseFingerprint, samples[4].poseFingerprint);
  assert.deepEqual(errors, []);
});

test('the same review page switches to the dedicated hover asset', { timeout: 40000 }, async () => {
  const result = await page.evaluate(async () => {
    window.waterwingBlenderPreview.setCloneCount(1);
    window.waterwingBlenderPreview.setMaterialMode('clay');
    await window.waterwingBlenderPreview.setAction('forward');
    window.waterwingBlenderPreview.setPhase(0.25);
    const forward = window.waterwingBlenderPreview.getState();
    await window.waterwingBlenderPreview.setAction('hover');
    window.waterwingBlenderPreview.setPhase(0);
    const start = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(0.25);
    const quarter = window.waterwingBlenderPreview.getState();
    return { forward, start, quarter };
  });
  const hover = result.quarter;
  assert.deepEqual(hover.availableActions, expectedFinalActions);
  assert.equal(hover.action, 'hover');
  assert.equal(hover.assetVersion, 'waterwing-hover-v1');
  assert.equal(hover.clip, 'WW_hover_loop_v1');
  assert.equal(hover.durationSeconds, 6);
  assert.equal(hover.finiteBounds, true);
  assert.notEqual(result.start.poseFingerprint, result.quarter.poseFingerprint);
  assert.ok(Math.abs(result.start.instanceWorldY[0] - result.quarter.instanceWorldY[0]) >= 0.3);
  const forwardAspect = result.forward.boundsSize[1] / result.forward.boundsSize[0];
  const hoverAspect = result.quarter.boundsSize[1] / result.quarter.boundsSize[0];
  assert.ok(
    hoverAspect >= 0.24 && hoverAspect <= 0.31,
    `hover silhouette is outside the natural lift envelope: ${JSON.stringify({ forwardAspect, hoverAspect })}`,
  );
  assert.ok(
    result.quarter.boundsSize[1] <= 2.25,
    `hover silhouette is over-deformed: ${JSON.stringify({ boundsSize: result.quarter.boundsSize })}`,
  );
  assert.deepEqual(errors, []);
});

test('the review page exposes the complete final-film action family and approved water look', { timeout: 40000 }, async () => {
  const result = await page.evaluate(async () => {
    const buttonActions = [...document.querySelectorAll('[data-action]')].map(button => button.dataset.action);
    const materialBadge = document.querySelector('#material-profile-badge')?.textContent ?? '';
    const actionStates = [];
    for (const actionId of buttonActions) {
      await window.waterwingBlenderPreview.setAction(actionId);
      window.waterwingBlenderPreview.setPhase(0.62);
      const state = window.waterwingBlenderPreview.getState();
      actionStates.push({
        action: state.action,
        sourceAction: state.sourceAction,
        actorAssetFamily: state.actorAssetFamily,
        materialVersion: state.materialProfile?.aqueousLookVersion,
        finiteBounds: state.finiteBounds,
        canvasCount: state.canvasCount,
      });
    }
    await window.waterwingBlenderPreview.setAction('cast-lob');
    window.waterwingBlenderPreview.setPhase(0.62);
    return {
      buttonActions,
      materialBadge,
      actionStates,
      state: window.waterwingBlenderPreview.getState(),
    };
  });

  assert.deepEqual(result.buttonActions, expectedFinalActions);
  assert.deepEqual(result.state.availableActions, expectedFinalActions);
  assert.equal(result.state.action, 'cast-lob');
  assert.equal(result.state.sourceAction, 'directCast');
  assert.equal(result.state.actorAssetFamily, 'blender-clear-water-v10');
  assert.equal(result.state.materialProfile.aqueousLookVersion, 'waterwing-clear-water-flight-forward-v10');
  assert.match(result.materialBadge, /浅青晶透.*V10.*弱水核/);
  for (const [index, actionState] of result.actionStates.entries()) {
    assert.equal(actionState.action, expectedFinalActions[index]);
    assert.equal(actionState.actorAssetFamily, 'blender-clear-water-v10');
    assert.equal(actionState.materialVersion, 'waterwing-clear-water-flight-forward-v10');
    assert.equal(actionState.finiteBounds, true);
    assert.equal(actionState.canvasCount, 1);
  }
  assert.equal(result.state.finiteBounds, true);
  assert.equal(result.state.canvasCount, 1);
  assert.deepEqual(errors, []);
});

test('the control rail remains scrollable in a short desktop viewport', { timeout: 40000 }, async () => {
  const shortPage = await browser.newPage();
  try {
    await shortPage.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await shortPage.goto(new URL('waterwing-blender-forward.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await shortPage.waitForFunction(() => window.waterwingBlenderPreview?.ready === true, { timeout: 30000 });
    const result = await shortPage.evaluate(() => {
      const panel = document.querySelector('.panel');
      const status = document.querySelector('#status');
      const before = panel.scrollTop;
      panel.scrollTop = panel.scrollHeight;
      const statusRect = status.getBoundingClientRect();
      return {
        before,
        after: panel.scrollTop,
        clientHeight: panel.clientHeight,
        scrollHeight: panel.scrollHeight,
        overflowY: getComputedStyle(panel).overflowY,
        statusTop: statusRect.top,
        statusBottom: statusRect.bottom,
        viewportHeight: innerHeight,
      };
    });

    assert.match(result.overflowY, /auto|scroll/);
    assert.ok(result.scrollHeight > result.clientHeight);
    assert.ok(result.after > result.before);
    assert.ok(result.statusTop >= 0);
    assert.ok(result.statusBottom <= result.viewportHeight);
  } finally {
    await shortPage.close();
  }
});

test('the actor emergence button uses the shared six-second hybrid runtime without a second preview rise', { timeout: 40000 }, async () => {
  const result = await page.evaluate(async () => {
    await window.waterwingBlenderPreview.setAction('emerge');
    window.waterwingBlenderPreview.setPhase(0);
    const start = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(0.08);
    const onset = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(0.48);
    const formation = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(0.83);
    const overshoot = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(1);
    const end = window.waterwingBlenderPreview.getState();
    return { start, onset, formation, overshoot, end };
  });
  assert.equal(result.start.assetVersion, 'waterwing-emerge-v2');
  assert.equal(result.start.sourceAssetVersion, 'waterwing-emerge-v2');
  assert.equal(result.start.sourceAction, 'emerge');
  assert.equal(result.start.clip, 'WW_emerge_hybrid_v3');
  assert.equal(result.start.durationSeconds, 6);
  assert.equal(result.start.loop, false);
  assert.equal(result.start.emergenceState.actorVisible, false);
  assert.equal(result.start.emergenceState.surfaceAnchor[1], -1.05);
  assert.ok(Math.abs(result.start.emergenceState.actorLift) < 1e-6);
  assert.ok(result.onset.emergenceState.surfaceChannels.ripple > 0);
  assert.ok(result.formation.emergenceState.sourceProgress > 0.16);
  assert.equal(result.overshoot.emergenceState.carrierOffset, 0.04);
  assert.ok(Math.abs(result.end.emergenceState.carrierOffset) < 1e-6);
  assert.ok(Math.abs(result.end.emergenceState.actorLift - 1.05) < 1e-6);
  assert.ok(result.end.emergenceState.hiddenAuxiliaryNames.length >= 10);
  assert.equal(result.end.emergenceState.hiddenAuxiliaryVisibleCount, 0);
  assert.equal(result.start.instanceWorldY[0], result.end.instanceWorldY[0]);
  assert.notEqual(result.start.poseFingerprint, result.formation.poseFingerprint);
  assert.equal(result.end.phase, 1);
  assert.equal(result.end.playing, false);
  assert.deepEqual(errors, []);
});

test('the dodge preview follows a banked side-forward arc and settles upright', { timeout: 40000 }, async () => {
  const result = await page.evaluate(async () => {
    await window.waterwingBlenderPreview.setAction('dodge');
    window.waterwingBlenderPreview.setPhase(0);
    const start = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(0.15);
    const preload = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(0.48);
    const middle = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(1);
    const end = window.waterwingBlenderPreview.getState();
    return { start, preload, middle, end };
  });
  assert.equal(result.middle.assetVersion, 'waterwing-dodge-v2');
  assert.equal(result.middle.clip, 'WW_dodge_v2');
  assert.equal(result.middle.durationSeconds, 3);
  assert.equal(result.middle.loop, false);
  assert.notEqual(result.start.poseFingerprint, result.middle.poseFingerprint);
  assert.ok(result.preload.instanceWorldX[0] < result.start.instanceWorldX[0] - 0.1);
  assert.ok(result.preload.instanceWorldRotationZ[0] > 0.03);
  assert.ok(result.middle.instanceWorldX[0] - result.start.instanceWorldX[0] >= 2);
  assert.ok(result.middle.instanceWorldZ[0] - result.start.instanceWorldZ[0] >= 0.3);
  assert.ok(result.middle.instanceWorldY[0] - result.start.instanceWorldY[0] >= 0.2);
  assert.ok(result.middle.instanceWorldRotationZ[0] < -0.12);
  assert.ok(Math.abs(result.end.instanceWorldRotationZ[0]) <= 0.01);
  assert.deepEqual(errors, []);
});

test('the direct-cast preview exposes the rounded waterball release event without looping', { timeout: 40000 }, async () => {
  const result = await page.evaluate(async () => {
    await window.waterwingBlenderPreview.setAction('directCast');
    window.waterwingBlenderPreview.setPhase(0);
    const start = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(2.4 / 4.4);
    const release = window.waterwingBlenderPreview.getState();
    window.waterwingBlenderPreview.setPhase(0.72);
    const flight = window.waterwingBlenderPreview.getState();
    return { start, release, flight };
  });
  assert.equal(result.release.assetVersion, 'waterwing-direct-cast-v2');
  assert.equal(result.release.clip, 'WW_direct_cast_v2');
  assert.ok(Math.abs(result.release.durationSeconds - 4.4) < 1e-5);
  assert.equal(result.release.loop, false);
  assert.equal(result.release.projectileAsset, 'enemy-direct-waterball-v2.glb');
  assert.equal(result.release.projectileVisible, true);
  assert.equal(result.flight.projectileVisible, true);
  assert.ok(result.flight.projectileWorldPosition[2] - result.release.projectileWorldPosition[2] >= 4);
  assert.notEqual(result.start.poseFingerprint, result.release.poseFingerprint);
  assert.deepEqual(errors, []);
});
