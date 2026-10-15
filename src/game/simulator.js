import { CAMERA, WATERWING } from '../config.js';
import { highArcPoint } from '../math/highArc.js';

const clamp01 = value => Math.max(0, Math.min(1, value));

function finiteVector(vector, length) {
  return Array.isArray(vector) && vector.length === length && vector.every(Number.isFinite);
}

export function validateScenario(scenario) {
  if (!Number.isFinite(scenario?.fps) || scenario.fps <= 0) throw new Error('scenario fps must be positive');
  if (!Number.isInteger(scenario?.durationFrames) || scenario.durationFrames <= 0) {
    throw new Error('scenario durationFrames must be a positive integer');
  }
  if (!Array.isArray(scenario.actors) || scenario.actors.length === 0) throw new Error('scenario actors are required');
  const actorIds = new Set();
  for (const actor of scenario.actors) {
    if (!actor?.id || actorIds.has(actor.id)) throw new Error('actor ids must be present and unique');
    actorIds.add(actor.id);
    if (!finiteVector(actor.position, 3) || !Number.isFinite(actor.scale) || actor.scale <= 0) {
      throw new Error(`actor ${actor.id} has an invalid transform`);
    }
    if (!Number.isFinite(actor.hp) || actor.hp <= 0) throw new Error(`actor ${actor.id} has invalid hp`);
  }
  for (const attack of scenario.attacks ?? []) {
    if (!actorIds.has(attack.source)) throw new Error(`attack ${attack.id} source is not a declared actor`);
    if (!Number.isInteger(attack.frame) || !Number.isInteger(attack.hitFrame) || attack.hitFrame <= attack.frame) {
      throw new Error(`attack ${attack.id} hitFrame must be greater than frame`);
    }
    if (!finiteVector(attack.target, 3) || !Number.isFinite(attack.damage) || attack.damage < 0) {
      throw new Error(`attack ${attack.id} has invalid target or damage`);
    }
  }
  for (const hit of scenario.hits ?? []) {
    if (!actorIds.has(hit.target)) throw new Error(`hit target ${hit.target} is not a declared actor`);
    if (!Number.isInteger(hit.frame) || !Number.isFinite(hit.damage) || hit.damage < 0) {
      throw new Error('hit has invalid frame or damage');
    }
  }
  if (!Number.isFinite(scenario.player?.hp) || scenario.player.hp <= 0) throw new Error('player hp must be positive');
  return scenario;
}

function lerpPoint(start, end, progress) {
  const t = clamp01(progress);
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t
  };
}

function damageTaken(hits, target, frame) {
  return hits
    .filter(hit => hit.target === target && hit.frame <= frame)
    .reduce((total, hit) => total + hit.damage, 0);
}

function recentHit(hits, target, frame, duration = 10) {
  return hits.find(hit => hit.target === target && frame >= hit.frame && frame < hit.frame + duration);
}

function attackSourceAlive(attack, scenario) {
  const actor = scenario.actors.find(candidate => candidate.id === attack.source);
  return Boolean(actor && actor.hp - damageTaken(scenario.hits, actor.id, attack.frame) > 0);
}

function actorTransform(actor, scenario, frame) {
  const [baseX, baseY, baseZ] = actor.position;
  const phase = actor.id.charCodeAt(0) * 0.17;
  const hover = Math.sin(frame * 0.11 + phase) * 0.045;
  let x = baseX;
  let y = baseY + hover;
  let z = baseZ;
  let pitch = 0;
  let yaw = 0;
  let roll = Math.sin(frame * 0.055 + phase) * 0.055;
  let state = 'hover';

  if (actor.id === 'A') {
    if (frame >= 24 && frame < 30) state = 'telegraph';
    if (frame >= 30 && frame <= 66) {
      const t = clamp01((frame - 30) / 36);
      const surge = Math.sin(Math.PI * t);
      x = baseX + 0.48 * surge;
      y += 0.16 * surge;
      z = baseZ + 1.82 * surge;
      yaw = -0.18 + 0.36 * t;
      roll = -0.3 * Math.sin(Math.PI * t);
      state = 'advance';
    } else if (frame > 66 && frame < 92) {
      state = 'recover';
    } else if (frame >= 132 && frame <= 166) {
      const t = clamp01((frame - 132) / 34);
      const surge = Math.sin(Math.PI * t);
      x = baseX + 0.36 * surge;
      z = baseZ + 1.25 * surge;
      yaw = 0.14 - 0.28 * t;
      roll = 0.22 * Math.sin(Math.PI * t);
      state = 'advance';
    }
  }

  if (actor.id === 'B') {
    x = baseX + Math.sin(frame * 0.045 + 0.8) * 0.22;
    z = baseZ + Math.cos(frame * 0.038 + 0.4) * 0.16;
    yaw = Math.sin(frame * 0.045 + 0.8) * -0.14;
    roll = Math.cos(frame * 0.05) * 0.08;
    if (frame >= 30 && frame < 90) state = 'cover';
    if (frame >= 38 && frame <= 76) state = 'fire';
    if (frame >= 90 && frame < 99) state = 'aim';
    if (frame >= 99 && frame <= 122) state = 'fire';
    if (frame > 122 && frame < 146) state = 'recover';
    if (frame >= 146) state = 'cover';
  }

  if (actor.id === 'C') {
    x = baseX + Math.sin(frame * 0.052) * 0.28;
    y = baseY + Math.sin(frame * 0.077 + 1.4) * 0.13;
    z = baseZ + Math.cos(frame * 0.034) * 0.08;
    yaw = Math.cos(frame * 0.052) * 0.09;
    roll = -Math.sin(frame * 0.052) * 0.12;
    state = 'strafe';
    const cast = scenario.attacks.find(attack => attack.source === 'C' && frame >= attack.frame - 12 && frame <= attack.frame + 7);
    if (cast) state = frame < cast.frame ? 'charge' : 'cast';
  }

  const hit = recentHit(scenario.hits, actor.id, frame);
  const recoil = hit ? Math.sin(((frame - hit.frame) / 10) * Math.PI) : 0;
  if (hit) {
    state = 'stagger';
    z -= recoil * 0.18;
    roll += (hit.source === 'player' ? -1 : 1) * recoil * 0.14;
  }

  return {
    position: [x, y, z],
    rotation: [pitch, yaw, roll],
    scale: actor.scale * (1 - recoil * 0.035),
    opacity: 1,
    state
  };
}

function attackStartPosition(attack, actorsAtLaunch) {
  const actor = actorsAtLaunch.find(candidate => candidate.id === attack.source);
  const [x, y, z] = actor.transform.position;
  const lift = attack.source === 'C' ? 0.22 : 0.08;
  return { x, y: y + lift, z: z + 0.08 };
}

function projectileState(attack, scenario, frame) {
  if (!attackSourceAlive(attack, scenario)) return null;
  if (frame < attack.frame || frame > attack.hitFrame) return null;
  const progress = clamp01((frame - attack.frame) / (attack.hitFrame - attack.frame));
  const actorsAtLaunch = scenario.actors.map(actor => ({
    ...actor,
    transform: actorTransform(actor, scenario, attack.frame)
  }));
  const start = attackStartPosition(attack, actorsAtLaunch);
  const end = { x: attack.target[0], y: attack.target[1], z: attack.target[2] };
  let position;
  if (attack.kind === 'high-arc') {
    position = highArcPoint(start, end, progress, attack.apexHeight);
  } else if (attack.kind === 'curved-shot') {
    position = lerpPoint(start, end, progress);
    position.x += Math.sin(Math.PI * progress) * -0.42;
    position.y += Math.sin(Math.PI * progress) * 0.28;
  } else {
    position = lerpPoint(start, end, progress);
    position.y += Math.sin(Math.PI * progress) * 0.12;
  }
  return {
    id: attack.id,
    source: attack.source,
    kind: attack.kind,
    progress,
    position,
    scale: attack.kind === 'high-arc' ? 0.2 + progress * 0.58 : 0.18 + progress * 0.32,
    rotation: [progress * 1.7, progress * 2.3, progress * 1.1],
    damage: attack.damage
  };
}

function lensWaterState(scenario, frame) {
  const intensity = scenario.attacks
    .filter(
      attack =>
        attackSourceAlive(attack, scenario) && attack.damage > 0 && frame >= attack.hitFrame && frame < attack.hitFrame + 18
    )
    .reduce((maximum, attack) => Math.max(maximum, 1 - (frame - attack.hitFrame) / 18), 0);
  return { intensity, source: intensity > 0 ? 'incoming-water' : null };
}

function impactState(scenario, frame) {
  const actorHits = scenario.hits
    .filter(hit => frame >= hit.frame - 5 && frame < hit.frame + 9)
    .map(hit => ({ ...hit, age: frame - hit.frame, kind: 'actor-hit' }));
  const playerHits = scenario.attacks
    .filter(attack => attackSourceAlive(attack, scenario) && frame >= attack.hitFrame && frame < attack.hitFrame + 9)
    .map(attack => ({
      frame: attack.hitFrame,
      source: attack.source,
      target: 'player',
      damage: attack.damage,
      age: frame - attack.hitFrame,
      kind: attack.damage > 0 ? 'lens-hit' : 'near-miss'
    }));
  return [...actorHits, ...playerHits];
}

export function simulateFrame(scenario, requestedFrame) {
  const frame = Math.max(0, Math.min(scenario.durationFrames - 1, Math.round(requestedFrame)));
  const actors = scenario.actors.map(actor => {
    const hp = Math.max(0, actor.hp - damageTaken(scenario.hits, actor.id, frame));
    const transform = actorTransform(actor, scenario, frame);
    return {
      id: actor.id,
      role: actor.role,
      hp,
      maxHp: actor.hp,
      visible: hp > 0,
      state: hp > 0 ? transform.state : 'defeated',
      transform,
      healthAnchor: [
        transform.position[0],
        transform.position[1] + WATERWING.healthAnchorY * transform.scale,
        transform.position[2]
      ]
    };
  });

  const projectiles = scenario.attacks
    .map(attack => projectileState(attack, scenario, frame))
    .filter(Boolean);
  const playerDamage = scenario.attacks
    .filter(attack => attackSourceAlive(attack, scenario) && attack.damage > 0 && attack.hitFrame <= frame)
    .reduce((total, attack) => total + attack.damage, 0);
  const player = { hp: Math.max(0, scenario.player.hp - playerDamage), maxHp: scenario.player.hp };
  const preferredTarget = frame < 120 ? 'A' : frame < 180 ? 'B' : 'C';
  const targetId = [preferredTarget, 'A', 'B', 'C'].find(
    (id, index, list) => list.indexOf(id) === index && actors.some(actor => actor.id === id && actor.visible)
  ) ?? null;
  const sway = Math.sin(frame * 0.045) * 0.018;
  const camera = {
    position: [CAMERA.position[0] + sway, CAMERA.position[1] + Math.cos(frame * 0.041) * 0.009, CAMERA.position[2]],
    lookAt: [CAMERA.lookAt[0] + sway * 0.35, CAMERA.lookAt[1], CAMERA.lookAt[2]]
  };

  return {
    frame,
    seconds: frame / scenario.fps,
    camera,
    actors,
    player,
    projectiles,
    impacts: impactState(scenario, frame),
    lensWater: lensWaterState(scenario, frame),
    hud: {
      timeText: scenario.timeText,
      battery: scenario.battery,
      playerHp: player.hp,
      targetId,
      enemies: actors.map(actor => ({
        id: actor.id,
        hp: actor.hp,
        maxHp: actor.maxHp,
        anchor: actor.healthAnchor,
        targeted: actor.id === targetId
      }))
    }
  };
}
