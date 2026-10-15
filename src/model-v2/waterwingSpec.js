export const WATERWING_V2 = Object.freeze({
  triangleBudget: Object.freeze([12000, 25000]),
  requiredNodes: Object.freeze([
    'WaterwingSpirit',
    'pose-root',
    'body',
    'wing-left-pivot',
    'wing-right-pivot',
    'wing-left',
    'wing-right',
    'tail-pivot',
    'tail',
    'weak-core',
    'health-anchor',
    'muzzle-anchor',
    'impact-anchor',
    'emerge-anchor'
  ]),
  forbiddenName: /(face|eye|mouth|hand|arm|leg|foot|claw|armor|spike|weapon|gun)/i,
  coreToBodyMax: 0.05,
  actionFiles: Object.freeze({
    emerge: Object.freeze({ file: 'waterwing-emerge.glb', clip: 'emerge-from-water' }),
    idle: Object.freeze({ file: 'waterwing-idle.glb', clip: 'idle-hover' }),
    charge: Object.freeze({ file: 'waterwing-charge.glb', clip: 'charge-waterball' }),
    cast: Object.freeze({ file: 'waterwing-cast.glb', clip: 'cast-waterball' }),
    lunge: Object.freeze({ file: 'waterwing-lunge.glb', clip: 'lunge-attack' }),
    dodge: Object.freeze({ file: 'waterwing-dodge.glb', clip: 'dodge-bank' }),
    hit: Object.freeze({ file: 'waterwing-hit.glb', clip: 'hit-recoil' }),
    forward: Object.freeze({ file: 'waterwing-forward.glb', clip: 'forward-swim-loop' })
  }),
  projectileFiles: Object.freeze({
    player: Object.freeze({ file: 'waterball-player.glb', defaultClip: 'flight-loop' }),
    enemy: Object.freeze({ file: 'waterball-enemy.glb', defaultClip: 'direct-flight-loop' })
  })
});
