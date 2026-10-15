import { highArcPoint } from '../math/highArc.js';
import { interpolateAngle, normalizeDegrees, shortestAngularDelta } from './angularMotion.js';
import { sampleBackgroundYaw } from './backgroundHeadMotion.js';
import { FULL_WIDTH_OPTICAL_FIELD, HUD_SAFE_FRAME } from './opticalField.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const degreesToRadians = (degrees) => degrees * Math.PI / 180;
const opticalAspect = FULL_WIDTH_OPTICAL_FIELD.width / FULL_WIDTH_OPTICAL_FIELD.height;
const HALF_VIEWPORT_DEGREES = Math.atan(Math.tan(degreesToRadians(42 / 2)) * opticalAspect) * 180 / Math.PI + 8;

function finiteVector(vector) {
  return Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite);
}

export function validateFullEncounterScenario(scenario) {
  if (scenario?.fps !== 30 || scenario?.durationFrames !== 2040) throw new Error('full encounter must be 2040 frames at 30 fps');
  const field = scenario.opticalField;
  if (!field
    || field.left !== FULL_WIDTH_OPTICAL_FIELD.left
    || field.top !== FULL_WIDTH_OPTICAL_FIELD.top
    || field.width !== FULL_WIDTH_OPTICAL_FIELD.width
    || field.height !== FULL_WIDTH_OPTICAL_FIELD.height
    || field.right !== FULL_WIDTH_OPTICAL_FIELD.right
    || field.bottom !== FULL_WIDTH_OPTICAL_FIELD.bottom
    || field.left + field.width !== field.right
    || field.top + field.height !== field.bottom) {
    throw new Error('optical field must fit the waterfall width at the 600:800 design ratio');
  }
  if (scenario.arena?.minAzimuthDegrees !== -180
    || scenario.arena?.maxAzimuthDegrees !== 180
    || !finiteVector(scenario.arena?.cameraOrigin)) {
    throw new Error('full encounter must define a 360-degree arena');
  }
  if (!Number.isInteger(scenario.healthDrainFrames) || scenario.healthDrainFrames < 8) {
    throw new Error('health changes must be spread across multiple frames');
  }
  if (!scenario.task || scenario.task.total !== 3 || !scenario.task.code || !scenario.task.label) {
    throw new Error('full encounter must declare the three-target anomaly task');
  }
  const ids = scenario.actors?.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(['A', 'B', 'C'])) throw new Error('actors must keep stable A B C identity');
  const actorIds = new Set(ids);
  if (!Number.isInteger(scenario.cameraTransitionFrames) || scenario.cameraTransitionFrames < 1) {
    throw new Error('camera transition must span at least one frame');
  }
  if (!Array.isArray(scenario.targetWindows)
    || scenario.targetWindows.length !== 5
    || scenario.targetWindows.some((window) => !actorIds.has(window.targetId)
      || !Number.isInteger(window.startFrame)
      || !Number.isInteger(window.endFrame)
      || window.endFrame <= window.startFrame)) {
    throw new Error('invalid target lock schedule');
  }
  for (const actor of scenario.actors) {
    if (!Number.isFinite(actor.emergenceAzimuthDegrees)
      || actor.emergenceAzimuthDegrees < scenario.arena.minAzimuthDegrees
      || actor.emergenceAzimuthDegrees > scenario.arena.maxAzimuthDegrees
      || !Array.isArray(actor.azimuthKeyframes)
      || actor.azimuthKeyframes.length < 2
      || actor.azimuthKeyframes.some(([keyFrame, azimuth]) => !Number.isFinite(keyFrame)
        || !Number.isFinite(azimuth)
        || azimuth < scenario.arena.minAzimuthDegrees
        || azimuth > scenario.arena.maxAzimuthDegrees)
      || !Number.isFinite(actor.radius)
      || actor.radius <= 0
      || !Number.isFinite(actor.height)
      || actor.hp !== 100
      || actor.scale <= 0) throw new Error(`invalid actor ${actor.id}`);
  }
  for (const attack of scenario.enemyAttacks) {
    if (!actorIds.has(attack.source) || attack.hitFrame <= attack.launchFrame || attack.damage > 8 || !finiteVector(attack.target)) {
      throw new Error(`invalid enemy attack ${attack.id}`);
    }
  }
  for (const event of scenario.hits) {
    if (!actorIds.has(event.target) || event.frame <= event.launchFrame || event.damage > 18 || !finiteVector(event.origin)) {
      throw new Error(`invalid hit ${event.id}`);
    }
  }
  return scenario;
}

function damageProgress(frame, impactFrame, drainFrames) {
  return smooth((frame - impactFrame) / drainFrames);
}

function damageTaken(scenario, target, frame) {
  return scenario.hits
    .filter((event) => event.target === target && event.frame <= frame)
    .reduce((total, event) => total + event.damage * damageProgress(frame, event.frame, scenario.healthDrainFrames), 0);
}

function actorHp(scenario, actor, frame) {
  return Math.max(0, actor.hp - damageTaken(scenario, actor.id, frame));
}

function recentHit(scenario, actorId, frame, span = 14) {
  return scenario.hits.findLast((event) => event.target === actorId && frame >= event.frame && frame < event.frame + span);
}

function actionFor(scenario, actor, frame, hp) {
  if (frame < 240) return { id: 'hover', progress: (frame % 114) / 114, visible: false };
  if (frame < 450) return { id: 'emerge', progress: (frame - 240) / 210, visible: true };
  if (hp <= 0) return { id: 'defeat', progress: clamp01((frame - actor.defeatFrame) / 42), visible: frame < actor.defeatFrame + 42 };

  const struck = recentHit(scenario, actor.id, frame);
  if (struck) return { id: 'hit', progress: (frame - struck.frame) / 14, visible: true, eventId: struck.id };

  const lunge = scenario.enemyAttacks.find((event) => event.source === actor.id && event.kind === 'lunge' && frame >= event.launchFrame - 14 && frame <= event.hitFrame + 18);
  if (lunge) {
    if (frame <= lunge.hitFrame) return { id: 'lunge', progress: (frame - (lunge.launchFrame - 14)) / (lunge.hitFrame - (lunge.launchFrame - 14)), visible: true, eventId: lunge.id };
    return { id: 'dodge', progress: (frame - lunge.hitFrame) / 18, visible: true, eventId: lunge.id };
  }

  const attack = scenario.enemyAttacks.find((event) => event.source === actor.id && event.kind !== 'lunge' && frame >= event.launchFrame - (actor.id === 'C' ? 24 : 18) && frame <= event.launchFrame + 11);
  if (attack) {
    const chargeLength = actor.id === 'C' ? 24 : 18;
    if (frame < attack.launchFrame) {
      return { id: actor.id === 'C' ? 'charge-lob' : 'charge-direct', progress: (frame - (attack.launchFrame - chargeLength)) / chargeLength, visible: true, eventId: attack.id };
    }
    return { id: actor.id === 'C' ? 'cast-lob' : 'cast-direct', progress: (frame - attack.launchFrame) / 11, visible: true, eventId: attack.id };
  }

  const advanceWindows = actor.id === 'A'
    ? [[450, 620], [730, 910], [1010, 1135]]
    : actor.id === 'B'
      ? [[470, 640], [700, 930], [1030, 1190]]
      : [[1380, 1450], [1570, 1630], [1695, 1730]];
  const advance = advanceWindows.find(([start, end]) => frame >= start && frame < end);
  if (advance) return { id: 'forward', progress: ((frame - advance[0]) % 60) / 60, visible: true };
  return { id: 'hover', progress: (frame % 114) / 114, visible: true };
}

export function polarToWorld({ azimuthDegrees, radius, height }, cameraOrigin) {
  const radians = degreesToRadians(azimuthDegrees);
  return [
    cameraOrigin[0] + Math.sin(radians) * radius,
    height,
    cameraOrigin[2] - Math.cos(radians) * radius,
  ];
}

export function signedBearingDelta(targetDegrees, cameraDegrees) {
  return shortestAngularDelta(targetDegrees, cameraDegrees);
}

function sampleActorAzimuth(actor, frame) {
  const keys = actor.azimuthKeyframes;
  if (frame <= keys[0][0]) return keys[0][1];
  const endIndex = keys.findIndex(([keyFrame]) => keyFrame >= frame);
  if (endIndex < 0) return keys.at(-1)[1];
  const [endFrame, endAzimuth] = keys[endIndex];
  const [startFrame, startAzimuth] = keys[endIndex - 1];
  return interpolateAngle(startAzimuth, endAzimuth, smooth((frame - startFrame) / (endFrame - startFrame)));
}

function actorPolarState(actor, frame) {
  const phase = actor.id.charCodeAt(0) * 0.37;
  const authoredAzimuth = sampleActorAzimuth(actor, frame);
  return {
    azimuthDegrees: normalizeDegrees(authoredAzimuth + Math.sin(frame * 0.018 + phase) * (actor.id === 'C' ? 2.4 : 1.35)),
    radius: actor.radius + Math.cos(frame * 0.015 + phase) * (actor.id === 'C' ? 0.18 : 0.1),
    height: actor.height + Math.sin(frame * 0.031 + phase) * (actor.id === 'C' ? 0.14 : 0.07),
  };
}

function baseActorTransform(scenario, actor, frame, action) {
  const polar = actorPolarState(actor, frame);
  const phase = actor.id.charCodeAt(0) * 0.37;
  const azimuthRadians = degreesToRadians(polar.azimuthDegrees);
  const radialX = Math.sin(azimuthRadians);
  const radialZ = -Math.cos(azimuthRadians);
  const tangentX = Math.cos(azimuthRadians);
  const tangentZ = Math.sin(azimuthRadians);
  const [baseX, baseY, baseZ] = polarToWorld(polar, scenario.arena.cameraOrigin);
  let x = baseX;
  let y = baseY;
  let z = baseZ;
  let yaw = -azimuthRadians + Math.sin(frame * 0.019 + actor.id.charCodeAt(0) * 0.37) * 0.08;
  let pitch = Math.cos(frame * 0.017 + phase) * 0.035;
  let roll = -Math.sin(frame * 0.022 + phase) * 0.08;
  let scale = actor.scale;
  let opacity = 1;

  if (action.id === 'emerge') {
    const t = smooth(action.progress);
    y -= (1 - t) * 1.25;
    x += radialX * (1 - t) * 0.45;
    z += radialZ * (1 - t) * 0.45;
    opacity = clamp01((action.progress - 0.06) / 0.2);
  }
  if (action.id === 'forward') {
    const surge = Math.sin(Math.PI * action.progress);
    x -= radialX * surge * 0.72;
    z -= radialZ * surge * 0.72;
    const strafe = (actor.id === 'A' ? 1 : actor.id === 'B' ? -1 : 0.45) * surge * 0.2;
    x += tangentX * strafe;
    z += tangentZ * strafe;
  }
  if (action.id === 'lunge') {
    const t = smooth(action.progress);
    x -= radialX * t * 3.15;
    z -= radialZ * t * 3.15;
    const sweep = (actor.id === 'A' ? 0.42 : -0.42) * Math.sin(Math.PI * t);
    x += tangentX * sweep;
    z += tangentZ * sweep;
    pitch = -0.12;
  }
  if (action.id === 'dodge') {
    const t = smooth(action.progress);
    x -= radialX * (1 - t) * 3.15;
    z -= radialZ * (1 - t) * 3.15;
    const sidestep = (actor.id === 'A' ? -1 : 1) * (0.35 + t * 0.82);
    x += tangentX * sidestep;
    z += tangentZ * sidestep;
    roll += (actor.id === 'A' ? -1 : 1) * 0.5 * Math.sin(Math.PI * t);
    yaw += (actor.id === 'A' ? 1 : -1) * 0.28 * t;
  }
  if (action.id === 'hit') {
    const pulse = Math.sin(action.progress * Math.PI);
    const recoil = (actor.id === 'B' ? -1 : 1) * pulse * 0.12;
    x += tangentX * recoil + radialX * pulse * 0.22;
    z += tangentZ * recoil + radialZ * pulse * 0.22;
    roll += (actor.id === 'B' ? -1 : 1) * pulse * 0.18;
  }
  if (action.id === 'defeat') {
    const t = smooth(action.progress);
    y -= t * 1.15;
    scale *= 1 - t * 0.08;
    roll += (actor.id === 'A' ? -1 : 1) * t * 0.24;
    opacity = 1 - clamp01((action.progress - 0.68) / 0.32);
  }

  return {
    position: [x, y, z],
    rotation: [pitch, yaw, roll],
    scale,
    opacity,
    azimuthDegrees: polar.azimuthDegrees,
    distance: polar.radius,
  };
}

function actorState(scenario, actor, frame) {
  const hp = actorHp(scenario, actor, frame);
  const action = actionFor(scenario, actor, frame, hp);
  const transform = baseActorTransform(scenario, actor, frame, action);
  const worldVisible = frame < 1860 && action.visible && transform.opacity > 0;
  return {
    id: actor.id,
    role: actor.role,
    hp,
    maxHp: actor.hp,
    azimuthDegrees: transform.azimuthDegrees,
    distance: transform.distance,
    worldVisible,
    inViewport: worldVisible && Math.abs(transform.azimuthDegrees) <= HALF_VIEWPORT_DEGREES,
    visible: worldVisible,
    action,
    transform,
    healthAnchor: [transform.position[0], transform.position[1] + 1.18 * transform.scale, transform.position[2]],
  };
}

function lerpPoint(start, end, progress) {
  const t = clamp01(progress);
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t,
  };
}

function actorPositionAt(scenario, actorId, frame) {
  const actor = scenario.actors.find(({ id }) => id === actorId);
  const hp = actorHp(scenario, actor, Math.max(0, frame - 1));
  const action = actionFor(scenario, actor, frame, hp);
  const [x, y, z] = baseActorTransform(scenario, actor, frame, action).position;
  return { x, y, z };
}

function enemyProjectileState(scenario, event, frame) {
  if (frame < event.launchFrame || frame > event.hitFrame) return null;
  if (actorHp(scenario, scenario.actors.find(({ id }) => id === event.source), event.launchFrame) <= 0) return null;
  const progress = clamp01((frame - event.launchFrame) / (event.hitFrame - event.launchFrame));
  const launch = actorPositionAt(scenario, event.source, event.launchFrame);
  const start = { x: launch.x, y: launch.y + (event.source === 'C' ? 0.5 : 0.16), z: launch.z + 0.18 };
  const end = { x: event.target[0], y: event.target[1], z: event.target[2] };
  let position;
  if (event.kind === 'enemy-lob') position = highArcPoint(start, end, progress, event.apexHeight);
  else {
    position = lerpPoint(start, end, progress);
    position.x += Math.sin(Math.PI * progress) * (event.source === 'A' ? -0.22 : 0.22);
    position.y += Math.sin(Math.PI * progress) * 0.16;
  }
  return {
    id: event.id,
    source: event.source,
    target: 'player',
    allegiance: 'enemy',
    kind: event.kind,
    damage: event.damage,
    progress,
    start: [start.x, start.y, start.z],
    end: [end.x, end.y, end.z],
    arcHeight: event.kind === 'enemy-lob' ? event.apexHeight : 0,
    position,
    scale: event.kind === 'enemy-lob' ? 0.16 + progress * 0.32 : 0.11 + progress * 0.22,
    rotation: [0, 0, 0],
  };
}

function allyProjectileState(scenario, event, frame) {
  if (frame < event.launchFrame || frame > event.frame) return null;
  const progress = clamp01((frame - event.launchFrame) / (event.frame - event.launchFrame));
  const target = actorPositionAt(scenario, event.target, event.frame);
  const start = { x: event.origin[0], y: event.origin[1], z: event.origin[2] };
  const end = { x: target.x, y: target.y + 0.08, z: target.z + 0.12 };
  const position = lerpPoint(start, end, progress);
  position.y += Math.sin(Math.PI * progress) * (event.source === 'teammate' ? 0.18 : 0.08);
  return {
    id: event.id,
    source: event.source,
    target: event.target,
    allegiance: event.source === 'player' ? 'player' : 'teammate',
    kind: 'player-direct',
    damage: event.damage,
    progress,
    start: [start.x, start.y, start.z],
    end: [end.x, end.y, end.z],
    arcHeight: 0,
    position,
    scale: 0.1 + Math.sin(Math.PI * progress) * 0.08,
    rotation: [0, 0, 0],
  };
}

function playerState(scenario, frame) {
  const damage = scenario.enemyAttacks
    .filter((event) => event.damage > 0 && event.hitFrame <= frame)
    .reduce((total, event) => total + event.damage * damageProgress(frame, event.hitFrame, scenario.healthDrainFrames), 0);
  return { hp: Math.max(0, scenario.player.hp - damage), maxHp: scenario.player.hp };
}

function phaseFor(frame) {
  if (frame < 120) return 'system-wake';
  if (frame < 240) return 'rift-warning';
  if (frame < 450) return 'condensation';
  if (frame < 810) return 'first-exchange';
  if (frame < 1140) return 'close-assault';
  if (frame < 1410) return 'frontline-break';
  if (frame < 1710) return 'c-pressure';
  if (frame < 1860) return 'joint-finish';
  return 'epilogue';
}

function targetFor(scenario, frame, actors) {
  const preferred = scenario.targetWindows
    .find(({ startFrame, endFrame }) => frame >= startFrame && frame < endFrame)?.targetId;
  if (!preferred) return null;
  return actors.find(({ id, worldVisible }) => id === preferred && worldVisible)?.id
    ?? actors.find(({ worldVisible }) => worldVisible)?.id
    ?? null;
}

function cameraYawFor(scenario, frame, actors, targetId) {
  const backgroundYaw = sampleBackgroundYaw(frame);
  if (!targetId) return { yawDegrees: backgroundYaw, lockProgress: 0, backgroundYaw };
  const windowIndex = scenario.targetWindows.findIndex(({ startFrame, endFrame }) => frame >= startFrame && frame < endFrame);
  const window = scenario.targetWindows[windowIndex];
  const target = actors.find(({ id }) => id === targetId);
  const lockProgress = smooth((frame - window.startFrame) / scenario.cameraTransitionFrames);
  const targetCorrection = Math.max(-34, Math.min(34, shortestAngularDelta(target.azimuthDegrees, backgroundYaw)));
  const yawDegrees = normalizeDegrees(backgroundYaw + targetCorrection * lockProgress);
  return {
    yawDegrees,
    lockProgress,
    backgroundYaw,
  };
}

function timeText(scenario, frame) {
  const startSeconds = scenario.timeStart.hour * 3600 + scenario.timeStart.minute * 60 + scenario.timeStart.second;
  const current = (startSeconds + Math.floor(frame / scenario.fps)) % (24 * 3600);
  const hour = Math.floor(current / 3600);
  const minute = Math.floor((current % 3600) / 60);
  const second = current % 60;
  return [hour, minute, second].map((value) => String(value).padStart(2, '0')).join(':');
}

function taskState(scenario, actors, phase) {
  const cleared = actors.filter(({ hp }) => hp <= 0.001).length;
  const status = phase === 'epilogue'
    ? '已清除'
    : phase === 'system-wake'
      ? '接入中'
      : phase === 'rift-warning'
        ? '异常检测'
        : '战斗中';
  return {
    code: scenario.task.code,
    label: scenario.task.label,
    status,
    cleared,
    total: scenario.task.total,
    progressText: `清除 ${cleared} / ${scenario.task.total}`,
  };
}

function eventEffects(scenario, frame) {
  const impacts = [
    ...scenario.hits.filter((event) => frame >= event.frame && frame < event.frame + 14).map((event) => ({ ...event, kind: 'monster-hit', age: frame - event.frame })),
    ...scenario.enemyAttacks
      .filter((event) => event.damage > 0 && frame >= event.hitFrame && frame < event.hitFrame + 18)
      .map((event) => ({ ...event, kind: 'lens-hit', age: frame - event.hitFrame })),
  ];
  const lensWater = scenario.enemyAttacks
    .filter((event) => event.damage > 0 && frame >= event.hitFrame && frame < event.hitFrame + 22)
    .reduce((amount, event) => Math.max(amount, 1 - (frame - event.hitFrame) / 22), 0);
  return { impacts, lensWater };
}

export function simulateFullEncounterFrame(scenario, requestedFrame) {
  const frame = Math.max(0, Math.min(scenario.durationFrames - 1, Math.round(requestedFrame)));
  let actors = scenario.actors.map((actor) => actorState(scenario, actor, frame));
  const projectiles = [
    ...scenario.enemyAttacks.map((event) => enemyProjectileState(scenario, event, frame)),
    ...scenario.hits.map((event) => allyProjectileState(scenario, event, frame)),
  ].filter(Boolean);
  const player = playerState(scenario, frame);
  const targetId = targetFor(scenario, frame, actors);
  let target = actors.find(({ id }) => id === targetId);
  const cameraTracking = cameraYawFor(scenario, frame, actors, targetId);
  const headSway = Math.sin(frame * 0.024) * 0.035;
  const dodgePulse = scenario.enemyAttacks
    .filter((event) => event.kind === 'lunge' && frame >= event.hitFrame - 6 && frame < event.hitFrame + 12)
    .reduce((amount, event) => Math.max(amount, Math.sin(clamp01((frame - (event.hitFrame - 6)) / 18) * Math.PI)), 0);
  const cameraPosition = [
    scenario.arena.cameraOrigin[0] + headSway + dodgePulse * 0.2,
    scenario.arena.cameraOrigin[1] + Math.cos(frame * 0.019) * 0.018,
    scenario.arena.cameraOrigin[2],
  ];
  const yawRadians = degreesToRadians(cameraTracking.yawDegrees);
  const lookDistance = 8;
  const camera = {
    position: cameraPosition,
    yawDegrees: cameraTracking.yawDegrees,
    lookAt: [
      cameraPosition[0] + Math.sin(yawRadians) * lookDistance,
      target ? target.transform.position[1] * 0.72 : 0.2,
      cameraPosition[2] - Math.cos(yawRadians) * lookDistance,
    ],
    roll: -dodgePulse * 0.025,
  };
  actors = actors.map((actor) => ({
    ...actor,
    inViewport: actor.worldVisible
      && Math.abs(signedBearingDelta(actor.azimuthDegrees, camera.yawDegrees)) <= HALF_VIEWPORT_DEGREES,
  }));
  target = actors.find(({ id }) => id === targetId);
  const targetDelta = target ? signedBearingDelta(target.azimuthDegrees, camera.yawDegrees) : 0;
  const hudTarget = target ? {
    id: target.id,
    name: `瀑翼水灵 ${target.id}`,
    hp: target.hp,
    maxHp: target.maxHp,
    anchor: target.healthAnchor,
    inViewport: target.inViewport,
    direction: target.inViewport ? 'visible' : targetDelta < 0 ? 'left' : 'right',
    lockProgress: cameraTracking.lockProgress,
  } : null;
  const effects = eventEffects(scenario, frame);
  const phase = phaseFor(frame);
  const notice = {
    'system-wake': '系统接入中',
    'rift-warning': '突发事件 / 域外入侵',
    condensation: '水体凝聚中 · 目标 3',
    'first-exchange': '双人协同 / 前排压制',
    'close-assault': '近战突袭 / 保持移动',
    'frontline-break': '前排单位正在瓦解',
    'c-pressure': '锁定远程单位 C',
    'joint-finish': '联合终结',
    epilogue: '事件已清除',
  }[phase];
  const task = taskState(scenario, actors, phase);

  return {
    frame,
    seconds: frame / scenario.fps,
    phase,
    camera,
    actors,
    player,
    projectiles,
    impacts: effects.impacts,
    lensWater: { intensity: effects.lensWater },
    hud: {
      opticalField: { ...scenario.opticalField },
      safeFrame: { ...(scenario.hudSafeFrame ?? HUD_SAFE_FRAME) },
      timeText: timeText(scenario, frame),
      battery: frame < 1350 ? scenario.battery : scenario.battery - 1,
      playerHp: player.hp,
      targetId,
      target: hudTarget,
      notice,
      task,
      cornerBrackets: false,
    },
  };
}
