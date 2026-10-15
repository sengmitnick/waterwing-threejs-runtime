export function createProofScenario() {
  return {
    fps: 30,
    durationFrames: 240,
    timeText: '14:08',
    battery: 87,
    actors: [
      { id: 'A', role: 'frontline', hp: 100, position: [-0.68, 1.2, 0.1], scale: 0.72 },
      { id: 'B', role: 'cover', hp: 100, position: [0.68, 1.25, -0.15], scale: 0.72 },
      { id: 'C', role: 'caster', hp: 100, position: [0, 1.86, -1.3], scale: 0.82 }
    ],
    attacks: [
      {
        id: 'A-1',
        source: 'A',
        frame: 30,
        kind: 'curved-shot',
        hitFrame: 65,
        damage: 6,
        target: [-0.06, 1.5, 6.66]
      },
      {
        id: 'B-0',
        source: 'B',
        frame: 38,
        kind: 'curved-shot',
        hitFrame: 76,
        damage: 0,
        target: [0.2, 1.57, 6.65]
      },
      {
        id: 'C-1',
        source: 'C',
        frame: 45,
        kind: 'high-arc',
        hitFrame: 92,
        damage: 6,
        target: [-0.055, 1.52, 6.7],
        apexHeight: 3.48
      },
      {
        id: 'B-1',
        source: 'B',
        frame: 99,
        kind: 'direct-shot',
        hitFrame: 122,
        damage: 6,
        target: [0.065, 1.49, 6.68]
      },
      {
        id: 'C-2',
        source: 'C',
        frame: 126,
        kind: 'high-arc',
        hitFrame: 168,
        damage: 0,
        target: [0.08, 1.54, 6.66],
        apexHeight: 3.38
      },
      {
        id: 'A-2',
        source: 'A',
        frame: 138,
        kind: 'curved-shot',
        hitFrame: 174,
        damage: 0,
        target: [-0.18, 1.54, 6.66]
      },
      {
        id: 'C-3',
        source: 'C',
        frame: 186,
        kind: 'high-arc',
        hitFrame: 228,
        damage: 6,
        target: [-0.07, 1.5, 6.71],
        apexHeight: 3.55
      }
    ],
    hits: [
      { frame: 72, source: 'player', target: 'A', damage: 20 },
      { frame: 82, source: 'teammate', target: 'B', damage: 18 },
      { frame: 148, source: 'player', target: 'A', damage: 18 },
      { frame: 160, source: 'teammate', target: 'B', damage: 14 },
      { frame: 176, source: 'teammate', target: 'C', damage: 16 }
    ],
    player: { hp: 100 }
  };
}
