const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pad = (value) => String(value).padStart(2, '0');

const stepped = (frame, points) => {
  let value = points[0][1];
  for (const [at, next] of points) {
    if (frame >= at) value = next;
  }
  return value;
};

export function getHudState(rawFrame) {
  const frame = clamp(Math.floor(rawFrame), 0, 2049);
  const seconds = Math.floor(frame / 30);
  const totalSeconds = 14 * 3600 + 8 * 60 + seconds;
  const timeText = `${pad(Math.floor(totalSeconds / 3600) % 24)}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
  const playerHp = stepped(frame, [
    [0, 100],
    [825, 95],
    [990, 89],
    [1305, 83],
    [1515, 76],
    [1695, 72],
  ]);
  const battery = frame < 900 ? 80 : frame < 1800 ? 79 : 78;

  let phase = 'establish';
  let taskTitle = '';
  let notice = '';
  let cleared = 0;
  let targetName = '';
  let targetHp = 0;

  if (frame >= 60 && frame < 195) {
    phase = 'accept';
    taskTitle = '普通任务已接收';
    notice = '前往瀑布观景台并完成打卡';
  } else if (frame >= 195 && frame < 405) {
    phase = 'travel';
    taskTitle = '普通任务·前往目标区域';
    notice = '路线确认';
  } else if (frame >= 405 && frame < 525) {
    phase = 'arrival';
    taskTitle = '普通任务·瀑布打卡';
    notice = '目标区域已到达';
  } else if (frame >= 525 && frame < 615) {
    phase = 'anomaly';
    taskTitle = '普通任务已暂停';
    notice = '检测到异常能量场';
  } else if (frame >= 615 && frame < 735) {
    phase = 'emerge';
    taskTitle = '突发事件·异常能量场';
    notice = '战斗模式启动';
  } else if (frame >= 735 && frame < 1152) {
    phase = 'combatA';
    taskTitle = '清除异常水灵';
    targetName = '瀑翼水灵·A';
    targetHp = stepped(frame, [
      [735, 100],
      [825, 84],
      [915, 67],
      [1005, 48],
      [1095, 26],
      [1140, 0],
    ]);
  } else if (frame >= 1152 && frame < 1167) {
    phase = 'switch';
    taskTitle = '清除异常水灵';
    notice = '目标切换';
    cleared = 1;
  } else if (frame >= 1167 && frame < 1809) {
    phase = 'combatB';
    taskTitle = '清除异常水灵';
    cleared = 1;
    targetName = '瀑翼水灵·B';
    targetHp = stepped(frame, [
      [1167, 100],
      [1275, 88],
      [1365, 74],
      [1455, 58],
      [1545, 39],
      [1650, 20],
      [1800, 0],
    ]);
  } else if (frame >= 1809 && frame < 1915) {
    phase = 'clear';
    taskTitle = '异常能量场已消散';
    notice = '原任务恢复';
    cleared = 2;
  } else if (frame >= 1915) {
    phase = 'settlement';
    taskTitle = '突发事件结算';
    notice = '原任务已完成';
    cleared = 2;
  }

  return {
    frame,
    phase,
    timeText,
    battery,
    playerHp,
    taskTitle,
    notice,
    cleared,
    targetName,
    targetHp,
  };
}
