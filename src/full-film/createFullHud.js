import * as THREE from 'three';

import {
  FULL_FILM_CANVAS,
  FULL_WIDTH_OPTICAL_FIELD,
  HUD_SAFE_FRAME,
} from '../game/opticalField.js';

const WIDTH = FULL_FILM_CANVAS.width;
const HEIGHT = FULL_FILM_CANVAS.height;
const FIELD = FULL_WIDTH_OPTICAL_FIELD;
const SAFE = HUD_SAFE_FRAME;

function make(tag, className = '', id = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (id) element.id = id;
  return element;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const percent = (value, maximum) => clamp((value / maximum) * 100, 0, 100);

function projectToField(anchor, camera) {
  const point = new THREE.Vector3(...anchor).project(camera);
  return {
    x: (point.x * 0.5 + 0.5) * FIELD.width,
    y: (-point.y * 0.5 + 0.5) * FIELD.height,
    visible: point.z > -1 && point.z < 1,
  };
}

export function resolveTargetHudDirection(target) {
  if (!target) return { visible: false, direction: 'none' };
  return {
    visible: true,
    direction: target.inViewport ? 'visible' : target.direction,
  };
}

function drawLensWater(canvas, frame, intensity) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, WIDTH, HEIGHT);
  if (intensity <= 0.001) return;
  context.save();
  context.globalCompositeOperation = 'screen';
  const wash = context.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.42, 60, WIDTH * 0.5, HEIGHT * 0.48, WIDTH * 0.38);
  wash.addColorStop(0, `rgba(205,249,255,${0.11 * intensity})`);
  wash.addColorStop(0.46, `rgba(105,211,235,${0.055 * intensity})`);
  wash.addColorStop(1, 'rgba(56,151,189,0)');
  context.fillStyle = wash;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  const drops = [
    [0.18, 0.31, 0.055, 0.13], [0.43, 0.21, 0.07, 0.15],
    [0.69, 0.35, 0.052, 0.12], [0.85, 0.2, 0.038, 0.09],
    [0.1, 0.7, 0.034, 0.085], [0.61, 0.73, 0.047, 0.1],
  ];
  drops.forEach(([nx, ny, nrx, nry], index) => {
    const x = nx * WIDTH;
    const y = ny * HEIGHT;
    const rx = nrx * WIDTH;
    const ry = nry * HEIGHT;
    const wobble = Math.sin(frame * 0.11 + index * 1.7) * 5;
    context.beginPath();
    for (let p = 0; p <= 56; p += 1) {
      const angle = (p / 56) * Math.PI * 2;
      const irregular = 1
        + Math.sin(angle * 5 + index * 0.9 + frame * 0.018) * 0.04
        + Math.sin(angle * 3 - index * 0.6) * 0.018;
      const px = x + Math.cos(angle) * (rx + wobble) * irregular;
      const py = y + Math.sin(angle) * ry * irregular;
      if (p === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    const gradient = context.createRadialGradient(x - rx * 0.28, y - ry * 0.3, 8, x, y, Math.max(rx, ry));
    gradient.addColorStop(0, `rgba(232,253,255,${0.07 * intensity})`);
    gradient.addColorStop(0.7, `rgba(93,210,236,${0.02 * intensity})`);
    gradient.addColorStop(1, `rgba(210,252,255,${0.08 * intensity})`);
    context.fillStyle = gradient;
    context.fill();
    context.lineWidth = 2 + intensity * 2.5;
    context.strokeStyle = `rgba(214,252,255,${0.16 * intensity})`;
    context.stroke();
  });
  context.restore();
}

function createHealthPanel({ id, code, label, fillId, valueId, directionId = '' }) {
  const root = make('div', 'hud-health-panel', id);
  const card = make('div', 'hud-health-card');
  const head = make('div', 'hud-health-head');
  const identity = make('div', 'hud-health-identity');
  const codeElement = make('span', 'hud-health-code');
  codeElement.textContent = code;
  const nameElement = make('span', 'hud-health-name');
  nameElement.textContent = label;
  identity.append(codeElement, nameElement);
  const reading = make('div', 'hud-health-reading');
  const value = make('span', 'hud-health-value', valueId);
  value.textContent = '100';
  const direction = directionId ? make('span', 'hud-health-direction', directionId) : null;
  reading.append(value);
  if (direction) reading.append(direction);
  head.append(identity, reading);
  const track = make('div', 'hud-health-track');
  const fill = make('div', 'hud-health-fill', fillId);
  track.appendChild(fill);
  card.append(head, track);
  root.appendChild(card);
  return { root, card, fill, value, code: codeElement, name: nameElement, direction };
}

export function createFullHud(container) {
  const style = document.createElement('style');
  style.textContent = `
    #waterwing-full-hud { position:absolute; inset:0; width:${WIDTH}px; height:${HEIGHT}px; pointer-events:none; overflow:hidden; color:#eafffa; font-family:"Noto Sans SC","Source Han Sans SC",sans-serif; font-weight:650; text-rendering:geometricPrecision; -webkit-font-smoothing:antialiased; }
    #waterwing-full-hud * { box-sizing:border-box; }
    #waterwing-optical-field, #waterwing-optical-stage { position:absolute; left:0; top:0; width:${WIDTH}px; height:${HEIGHT}px; overflow:hidden; background:transparent; }
    #waterwing-optical-field { isolation:isolate; }
    #hud-safe-layout { position:absolute; z-index:3; left:${SAFE.left}px; top:${SAFE.top}px; width:${SAFE.width}px; height:${SAFE.height}px; background:transparent; border:none; outline:none; }
    .hud-label { color:#72ffbf; font-size:17px; line-height:22px; letter-spacing:4px; -webkit-text-stroke:.45px rgba(0,28,23,.92); paint-order:stroke fill; text-shadow:0 2px 2px rgba(0,19,18,.9),0 0 8px rgba(57,255,165,.4); }
    #hud-time-cluster { position:absolute; left:22px; top:18px; width:250px; background:transparent; }
    #hud-time { margin-top:2px; color:#dffff5; font-size:36px; line-height:42px; letter-spacing:3px; font-variant-numeric:tabular-nums; -webkit-text-stroke:.7px rgba(0,22,21,.95); paint-order:stroke fill; text-shadow:0 2px 3px rgba(0,16,16,.96),0 0 10px rgba(71,255,181,.42); }
    #hud-battery-cluster { position:absolute; right:22px; top:18px; min-width:220px; text-align:right; background:transparent; }
    #hud-battery { margin-top:8px; display:flex; align-items:center; justify-content:flex-end; gap:12px; }
    #hud-battery-shell { position:relative; width:92px; height:28px; padding:4px; border:2px solid #95ffd0; border-radius:4px; background:rgba(0,21,20,.2); filter:drop-shadow(0 2px 2px rgba(0,14,14,.9)); }
    #hud-battery-shell:after { content:""; position:absolute; right:-8px; top:7px; width:6px; height:11px; border-radius:0 2px 2px 0; background:#95ffd0; }
    #hud-battery-fill { height:100%; background:linear-gradient(90deg,#2bed9d,#a3ffd1); box-shadow:0 0 8px rgba(57,239,154,.62); }
    #hud-battery-value { min-width:58px; color:#effff9; font-size:24px; line-height:28px; font-variant-numeric:tabular-nums; text-shadow:0 2px 3px rgba(0,16,16,.96); }
    #hud-task { position:absolute; z-index:4; left:50%; top:65px; width:370px; transform:translateX(-50%); padding:6px 18px 9px; text-align:center; color:#efffff; border-bottom:1px solid rgba(100,255,220,.72); background:linear-gradient(90deg,transparent,rgba(0,25,30,.3),transparent); filter:drop-shadow(0 2px 2px rgba(0,8,12,.75)); }
    #hud-task-code { color:#72ffbf; font-size:15px; line-height:20px; letter-spacing:4px; }
    #hud-task-line { display:flex; justify-content:center; align-items:baseline; gap:20px; margin-top:3px; }
    #hud-task-label { font-size:23px; letter-spacing:3px; -webkit-text-stroke:.45px rgba(0,20,20,.9); paint-order:stroke fill; }
    #hud-task-status { color:#ffd579; font-size:17px; letter-spacing:2px; }
    #hud-task-progress { margin-top:5px; color:#bffff0; font-size:17px; letter-spacing:2px; font-variant-numeric:tabular-nums; }
    #hud-notice { position:absolute; z-index:4; left:50%; top:188px; transform:translateX(-50%); min-width:480px; padding:5px 28px 9px; text-align:center; color:#d9fff8; font-size:22px; letter-spacing:4px; -webkit-text-stroke:.55px rgba(0,20,24,.94); paint-order:stroke fill; text-shadow:0 2px 3px rgba(0,16,20,.92),0 0 10px rgba(84,245,225,.42); border-bottom:1px solid rgba(102,255,231,.55); background:linear-gradient(90deg,transparent,rgba(0,25,30,.24),transparent); }
    .hud-health-panel { position:absolute; z-index:5; bottom:24px; width:338px; height:82px; }
    #hud-player-hp { left:22px; }
    #hud-target-hp { right:22px; opacity:0; }
    .hud-health-card { position:absolute; inset:0; padding:10px 14px 12px; transform:none; background:linear-gradient(90deg,rgba(2,30,30,.34),rgba(0,26,30,.12)); border-left:2px solid rgba(111,255,211,.85); border-bottom:1px solid rgba(160,255,231,.55); box-shadow:0 4px 12px rgba(0,12,15,.22); }
    #hud-target-hp .hud-health-card { border-left:0; border-right:2px solid rgba(255,214,121,.9); background:linear-gradient(270deg,rgba(38,28,5,.3),rgba(28,28,8,.09)); }
    .hud-health-head { display:flex; align-items:center; justify-content:space-between; gap:14px; color:#e7fff8; font-size:17px; line-height:21px; letter-spacing:2px; text-shadow:0 2px 3px rgba(0,16,18,.94); }
    .hud-health-identity { display:flex; align-items:baseline; gap:9px; min-width:0; }
    .hud-health-code { color:#72ffbf; font-size:15px; letter-spacing:2px; white-space:nowrap; }
    #hud-target-hp .hud-health-code { color:#ffd579; }
    .hud-health-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .hud-health-reading { display:flex; align-items:center; gap:9px; }
    .hud-health-value { color:#f4fffb; font-size:22px; font-variant-numeric:tabular-nums; }
    .hud-health-direction { min-width:24px; color:#ffe18a; text-align:right; font-size:20px; }
    .hud-health-track { position:relative; height:12px; margin-top:10px; overflow:hidden; border:1px solid rgba(190,255,238,.7); background:rgba(0,15,17,.35); }
    .hud-health-track:after { content:""; position:absolute; inset:0; background:repeating-linear-gradient(90deg,transparent 0 27px,rgba(0,20,20,.38) 27px 29px); }
    .hud-health-fill { height:100%; width:100%; transform-origin:left center; background:linear-gradient(90deg,#21d99a,#8dffc1); box-shadow:0 0 8px rgba(74,255,190,.6); }
    #hud-target-fill { background:linear-gradient(90deg,#ffc45f,#fff0a0); box-shadow:0 0 8px rgba(255,202,91,.58); }
    #hud-reticle { position:absolute; z-index:5; width:68px; height:68px; margin:-34px 0 0 -34px; border:2px solid rgba(255,226,128,.84); border-left-color:transparent; border-bottom-color:transparent; border-radius:50%; opacity:0; filter:drop-shadow(0 0 5px rgba(255,217,90,.55)); }
    #hud-target-bearing { position:absolute; z-index:5; top:50%; width:58px; height:96px; margin-top:-48px; display:flex; align-items:center; justify-content:center; opacity:0; color:#ffe18a; font-size:46px; text-shadow:0 0 10px rgba(255,195,75,.7),0 2px 3px rgba(0,16,20,.95); }
    #hud-target-bearing[data-direction="left"] { left:24px; }
    #hud-target-bearing[data-direction="right"] { right:24px; }
    #hud-result { position:absolute; z-index:5; left:50%; top:50%; width:720px; transform:translate(-50%,-50%); text-align:center; opacity:0; color:#efffff; text-shadow:0 3px 3px rgba(0,18,20,.94),0 0 12px rgba(93,255,230,.35); }
    #hud-result-title { font-size:54px; letter-spacing:10px; }
    #hud-result-rule { width:460px; height:1px; margin:16px auto; background:linear-gradient(90deg,transparent,#7dffe9,transparent); }
    #hud-result-meta { font-size:22px; letter-spacing:5px; color:#a9fff0; }
    #hud-lens-water { position:absolute; z-index:1; inset:0; width:${WIDTH}px; height:${HEIGHT}px; }
    #hud-transition-flash { position:absolute; z-index:6; inset:0; opacity:0; background:radial-gradient(ellipse at 50% 50%,rgba(238,255,255,.98) 0%,rgba(121,235,255,.72) 23%,rgba(41,173,202,.22) 53%,rgba(4,27,40,0) 78%); mix-blend-mode:screen; }
  `;
  document.head.appendChild(style);

  const root = make('div', '', 'waterwing-full-hud');
  const optical = make('div', '', 'waterwing-optical-field');
  const stage = make('div', '', 'waterwing-optical-stage');
  const safeLayout = make('div', '', 'hud-safe-layout');

  const lensCanvas = make('canvas', '', 'hud-lens-water');
  lensCanvas.width = WIDTH;
  lensCanvas.height = HEIGHT;
  stage.appendChild(lensCanvas);

  const notice = make('div', '', 'hud-notice');
  stage.appendChild(notice);

  const task = make('div', '', 'hud-task');
  const taskCode = make('div', '', 'hud-task-code');
  const taskLine = make('div', '', 'hud-task-line');
  const taskLabel = make('span', '', 'hud-task-label');
  const taskStatus = make('span', '', 'hud-task-status');
  taskLine.append(taskLabel, taskStatus);
  const taskProgress = make('div', '', 'hud-task-progress');
  task.append(taskCode, taskLine, taskProgress);
  stage.appendChild(task);

  const reticle = make('div', '', 'hud-reticle');
  const targetBearing = make('div', '', 'hud-target-bearing');
  stage.append(reticle, targetBearing);

  const result = make('div', '', 'hud-result');
  const resultTitle = make('div', '', 'hud-result-title');
  resultTitle.textContent = '入侵已清除';
  const resultRule = make('div', '', 'hud-result-rule');
  const resultMeta = make('div', '', 'hud-result-meta');
  resultMeta.textContent = '双人协同 · 清除 3 / 3';
  result.append(resultTitle, resultRule, resultMeta);
  stage.appendChild(result);

  const timeCluster = make('div', '', 'hud-time-cluster');
  const timeLabel = make('div', 'hud-label');
  timeLabel.textContent = '时间';
  const time = make('div', '', 'hud-time');
  timeCluster.append(timeLabel, time);

  const batteryCluster = make('div', '', 'hud-battery-cluster');
  const batteryLabel = make('div', 'hud-label');
  batteryLabel.textContent = '电量';
  const battery = make('div', '', 'hud-battery');
  const batteryShell = make('div', '', 'hud-battery-shell');
  const batteryFill = make('div', '', 'hud-battery-fill');
  batteryShell.appendChild(batteryFill);
  const batteryValue = make('span', '', 'hud-battery-value');
  battery.append(batteryShell, batteryValue);
  batteryCluster.append(batteryLabel, battery);

  const playerPanel = createHealthPanel({
    id: 'hud-player-hp', code: '玩家生命', label: '',
    fillId: 'hud-player-fill', valueId: 'hud-player-value',
  });
  const targetPanel = createHealthPanel({
    id: 'hud-target-hp', code: '锁定目标', label: '未锁定',
    fillId: 'hud-target-fill', valueId: 'hud-target-value', directionId: 'hud-target-direction',
  });

  safeLayout.append(timeCluster, batteryCluster, playerPanel.root, targetPanel.root);
  stage.appendChild(safeLayout);
  const transitionFlash = make('div', '', 'hud-transition-flash');
  stage.appendChild(transitionFlash);
  optical.appendChild(stage);
  root.appendChild(optical);
  container.appendChild(root);

  function update(state, camera) {
    time.textContent = state.hud.timeText;
    playerPanel.value.textContent = String(Math.ceil(state.hud.playerHp)).padStart(3, '0');
    playerPanel.fill.style.width = `${percent(state.hud.playerHp, state.player.maxHp)}%`;
    playerPanel.fill.style.background = state.hud.playerHp < 50
      ? 'linear-gradient(90deg,#ff9d5c,#ffe78f)'
      : 'linear-gradient(90deg,#21d99a,#8dffc1)';
    batteryFill.style.width = `${state.hud.battery}%`;
    batteryValue.textContent = `${state.hud.battery}%`;
    notice.textContent = state.hud.notice;
    taskCode.textContent = state.hud.task.code;
    taskLabel.textContent = state.hud.task.label;
    taskStatus.textContent = state.hud.task.status;
    taskProgress.textContent = state.hud.task.progressText;
    taskStatus.style.color = state.hud.task.status === '已清除' ? '#7dffb3' : '#ffd579';

    const targetState = resolveTargetHudDirection(state.hud.target);
    let targetPoint = null;
    if (targetState.visible) {
      const target = state.hud.target;
      targetPanel.root.style.opacity = String(0.55 + target.lockProgress * 0.45);
      targetPanel.code.textContent = '锁定目标';
      targetPanel.name.textContent = target.name;
      targetPanel.value.textContent = String(Math.ceil(target.hp)).padStart(3, '0');
      targetPanel.fill.style.width = `${percent(target.hp, target.maxHp)}%`;
      targetPanel.direction.textContent = targetState.direction === 'left' ? '◀' : targetState.direction === 'right' ? '▶' : '◆';
      if (target.inViewport) {
        const point = projectToField(target.anchor, camera);
        if (point.visible && point.x > 50 && point.x < WIDTH - 50 && point.y > 80 && point.y < HEIGHT - 125) {
          targetPoint = point;
        }
      }
    } else {
      targetPanel.root.style.opacity = '0';
      targetPanel.direction.textContent = '';
    }

    const bearingVisible = targetState.visible && targetState.direction !== 'visible' && state.phase !== 'epilogue';
    targetBearing.style.opacity = bearingVisible ? '1' : '0';
    targetBearing.dataset.direction = targetState.direction;
    targetBearing.textContent = targetState.direction === 'left' ? '◀' : targetState.direction === 'right' ? '▶' : '';

    reticle.style.opacity = targetPoint && state.phase !== 'epilogue' ? '1' : '0';
    if (targetPoint) {
      reticle.style.left = `${targetPoint.x}px`;
      reticle.style.top = `${targetPoint.y}px`;
      reticle.style.transform = `rotate(${(state.frame * 0.7) % 360}deg)`;
    }

    if (state.phase === 'epilogue') {
      result.style.opacity = String(clamp((state.frame - 1860) / 28, 0, 1));
      notice.style.opacity = '0';
    } else {
      result.style.opacity = '0';
      notice.style.opacity = state.frame < 12 ? String(state.frame / 12) : '1';
    }
    const waterfallCut = state.frame >= 1618 && state.frame <= 1632
      ? Math.sin(((state.frame - 1618) / 14) * Math.PI) * 0.88
      : 0;
    const epilogueCut = state.frame >= 1856 && state.frame <= 1872
      ? Math.sin(((state.frame - 1856) / 16) * Math.PI) * 0.96
      : 0;
    transitionFlash.style.opacity = String(Math.max(waterfallCut, epilogueCut));
    drawLensWater(lensCanvas, state.frame, state.lensWater.intensity);
  }

  return {
    element: root,
    opticalField: FIELD,
    update,
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
