const entries = [
  {
    id: 'hover',
    kind: 'actor',
    group: '基础移动',
    label: '悬浮',
    code: 'HOVER',
    description: '原地悬浮与水体呼吸循环。',
    durationSeconds: 3.8,
  },
  {
    id: 'forward',
    kind: 'actor',
    group: '基础移动',
    label: '推进',
    code: 'FORWARD',
    description: '双翼下压、增厚并向后收束的前进动作。',
    durationSeconds: 2,
  },
  {
    id: 'emerge',
    kind: 'actor',
    group: '基础移动',
    label: '凝聚登场',
    code: 'EMERGE',
    description: '从水体凝聚成形并升入战斗位置。',
    durationSeconds: 3.1,
  },
  {
    id: 'charge-direct',
    kind: 'actor',
    group: '远程攻击',
    label: '直射蓄力',
    code: 'CHARGE DIRECT',
    description: '前排水怪收束水流并锁定玩家。',
    durationSeconds: 1.05,
  },
  {
    id: 'cast-direct',
    kind: 'actor',
    group: '远程攻击',
    label: '直射释放',
    code: 'CAST DIRECT',
    description: '前排水怪向玩家方向释放直射水弹。',
    durationSeconds: 0.92,
  },
  {
    id: 'charge-lob',
    kind: 'actor',
    group: '远程攻击',
    label: '高抛蓄力',
    code: 'CHARGE LOB',
    description: '后排水怪抬高姿态，积蓄高抛水弹。',
    durationSeconds: 1.5,
  },
  {
    id: 'cast-lob',
    kind: 'actor',
    group: '远程攻击',
    label: '高抛释放',
    code: 'CAST LOB',
    description: '后排水怪越过前排释放弧线水弹。',
    durationSeconds: 1.3,
  },
  {
    id: 'lunge',
    kind: 'actor',
    group: '近战反应',
    label: '扑击',
    code: 'LUNGE',
    description: '水怪压低重心后向玩家快速突进。',
    durationSeconds: 1.7,
  },
  {
    id: 'dodge',
    kind: 'actor',
    group: '近战反应',
    label: '闪避',
    code: 'DODGE',
    description: '水怪侧向收身并避开来袭攻击。',
    durationSeconds: 1.25,
  },
  {
    id: 'hit',
    kind: 'actor',
    group: '近战反应',
    label: '受击',
    code: 'HIT',
    description: '水怪被玩家攻击命中后的形变与回弹。',
    durationSeconds: 1.05,
  },
  {
    id: 'defeat',
    kind: 'actor',
    group: '退场',
    label: '溃散',
    code: 'DEFEAT',
    description: '生命清空后失去形态并溃散为水。',
    durationSeconds: 2.4,
  },
  {
    id: 'player-pulse',
    kind: 'effect',
    group: '水弹命中',
    label: '玩家水弹',
    code: 'PLAYER PULSE',
    description: '玩家第一视角发出的水系能量弹。',
    durationSeconds: 0.82,
  },
  {
    id: 'enemy-direct',
    kind: 'effect',
    group: '水弹命中',
    label: '怪物直射',
    code: 'ENEMY DIRECT',
    description: '前排水怪朝玩家直线泼射的水球。',
    durationSeconds: 0.82,
  },
  {
    id: 'enemy-lob',
    kind: 'effect',
    group: '水弹命中',
    label: '怪物高抛',
    code: 'ENEMY LOB',
    description: '后排水怪越过同伴的高弧度水球。',
    durationSeconds: 1.65,
  },
  {
    id: 'monster-impact',
    kind: 'effect',
    group: '水弹命中',
    label: '怪物受击水花',
    code: 'MONSTER IMPACT',
    description: '玩家攻击命中水怪时爆开的水花。',
    durationSeconds: 0.64,
  },
  {
    id: 'lens-impact',
    kind: 'effect',
    group: '水弹命中',
    label: '镜头泼水',
    code: 'LENS IMPACT',
    description: '怪物攻击命中玩家视野后的泼水反馈。',
    durationSeconds: 0.86,
  },
];

const derivedOrigins = Object.freeze({
  lunge: '推进底模衍生',
  dodge: '悬浮底模衍生',
  hit: '悬浮底模衍生',
});

export const REVIEW_ITEMS = Object.freeze(entries.map((entry) => Object.freeze({
  ...entry,
  modelOrigin: entry.kind === 'effect'
    ? '独立特效模型'
    : (derivedOrigins[entry.id] ?? '动作专用网格'),
})));
export const REVIEW_ITEM_IDS = Object.freeze(REVIEW_ITEMS.map(({ id }) => id));

const itemsById = new Map(REVIEW_ITEMS.map((item) => [item.id, item]));
const defaultItem = itemsById.get('forward');

export function getReviewItem(id) {
  return itemsById.get(id) ?? defaultItem;
}
