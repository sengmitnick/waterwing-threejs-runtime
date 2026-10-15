const Component = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const props = item.props || {};

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smooth = (start, end, value) => {
    const x = clamp((value - start) / Math.max(1, end - start), 0, 1);
    return x * x * (3 - 2 * x);
  };
  const animatedStep = (valueFrame, points, transitionFrames) => {
    let current = points[0][1];
    for (let index = 1; index < points.length; index += 1) {
      const at = points[index][0];
      const next = points[index][1];
      if (valueFrame < at) return Math.round(current);
      if (valueFrame < at + transitionFrames) {
        const progress = smooth(at, at + transitionFrames, valueFrame);
        return Math.round(current + (next - current) * progress);
      }
      current = next;
    }
    return Math.round(current);
  };
  const pulseAt = (at, width) => {
    const distance = Math.abs(frame - at);
    return clamp(1 - distance / width, 0, 1);
  };
  const pad = (value) => String(value).padStart(2, "0");

  const safeLeft = 312;
  const safeWidth = 1296;
  const safeRight = safeLeft + safeWidth;
  const accent = props.accentColor;
  const dim = props.dimColor;
  const font = props.fontFamily;
  const baseParts = props.baseTime.split(":").map(Number);
  const baseSeconds = baseParts[0] * 3600 + baseParts[1] * 60 + baseParts[2];
  const totalSeconds = baseSeconds + Math.floor(frame / fps);
  const timeText = `${pad(Math.floor(totalSeconds / 3600) % 24)}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;

  const playerHp = animatedStep(
    frame,
    [[0, 100], [825, 95], [990, 89], [1305, 83], [1515, 76], [1695, 72]],
    10,
  );
  const playerRatio = clamp(playerHp / 100, 0, 1);
  const battery = frame < 900 ? 80 : frame < 1800 ? 79 : 78;
  const batteryWidth = 64 * battery / 100;

  let phase = "现实建立";
  let taskTitle = "";
  let notice = "";
  let cleared = 0;
  let targetName = "";
  let targetHp = 0;
  let targetRole = "";

  if (frame >= 60 && frame < 195) {
    phase = "普通任务";
    taskTitle = props.acceptTitle;
    notice = props.acceptNotice;
  } else if (frame >= 195 && frame < 405) {
    phase = "普通任务";
    taskTitle = props.travelTitle;
    notice = props.travelNotice;
  } else if (frame >= 405 && frame < 525) {
    phase = "普通任务";
    taskTitle = props.arrivalTitle;
    notice = props.arrivalNotice;
  } else if (frame >= 525 && frame < 615) {
    phase = "系统提示";
    taskTitle = props.anomalyTitle;
    notice = props.anomalyNotice;
  } else if (frame >= 615 && frame < 735) {
    phase = "突发事件";
    taskTitle = props.eventTitle;
    notice = props.battleNotice;
  } else if (frame >= 735 && frame < 1152) {
    phase = "突发事件";
    taskTitle = props.combatTitle;
    targetName = props.targetAName;
    targetRole = props.targetARole;
    targetHp = animatedStep(frame, [[735, 100], [825, 84], [915, 67], [1005, 48], [1095, 26], [1140, 0]], 10);
  } else if (frame >= 1152 && frame < 1167) {
    phase = "突发事件";
    taskTitle = props.combatTitle;
    notice = props.switchNotice;
    cleared = 1;
  } else if (frame >= 1167 && frame < 1809) {
    phase = "突发事件";
    taskTitle = props.combatTitle;
    cleared = 1;
    targetName = props.targetBName;
    targetRole = props.targetBRole;
    targetHp = animatedStep(frame, [[1167, 100], [1275, 88], [1365, 74], [1455, 58], [1545, 39], [1650, 20], [1800, 0]], 10);
  } else if (frame >= 1809 && frame < 1915) {
    phase = "突发事件";
    taskTitle = props.clearTitle;
    notice = props.clearNotice;
    cleared = 2;
  } else if (frame >= 1915) {
    phase = "任务结算";
    taskTitle = props.settlementTitle;
    notice = props.settlementNotice;
    cleared = 2;
  }

  const targetRatio = clamp(targetHp / 100, 0, 1);
  const isEstablish = frame < 60;
  const isAccept = frame >= 60 && frame < 195;
  const isAnomaly = frame >= 525 && frame < 615;
  const isBattleBoot = frame >= 615 && frame < 735;
  const isBattle = frame >= 615 && frame < 1915;
  const hasTarget = (frame >= 735 && frame < 1152) || (frame >= 1167 && frame < 1809);
  const isSwitch = frame >= 1152 && frame < 1167;
  const isClear = frame >= 1809 && frame < 1915;
  const isSettlement = frame >= 1915;
  const topHudVisible = !isEstablish && !isAnomaly;
  const entryAlpha = smooth(60, 70, frame);
  const rootOpacity = isEstablish ? 0 : entryAlpha;

  const acceptIn = smooth(60, 72, frame);
  const acceptOut = 1 - smooth(176, 194, frame);
  const acceptOpacity = isAccept ? acceptIn * acceptOut : 0;
  const acceptScale = 0.96 + 0.04 * acceptIn;
  const acceptY = 14 * (1 - acceptIn);

  const anomalyLocal = frame - 525;
  const anomalyIn = smooth(525, 537, frame);
  const anomalyOut = 1 - smooth(595, 614, frame);
  const anomalyOpacity = isAnomaly ? anomalyIn * anomalyOut : 0;
  const ringCycleA = (anomalyLocal % 42) / 42;
  const ringCycleB = ((anomalyLocal + 21) % 42) / 42;
  const ringScaleA = 0.42 + ringCycleA * 1.18;
  const ringScaleB = 0.42 + ringCycleB * 1.18;
  const ringOpacityA = 0.72 * (1 - ringCycleA);
  const ringOpacityB = 0.72 * (1 - ringCycleB);
  const scanY = 355 + ((anomalyLocal * 5) % 300);

  const battleBootIn = smooth(615, 629, frame);
  const battleBootOut = 1 - smooth(708, 734, frame);
  const battleBootOpacity = isBattleBoot ? battleBootIn * battleBootOut : 0;
  const reticlePulse = 0.28 + Math.sin(frame * 0.16) * 0.08;
  const targetHitFlash = Math.max(
    pulseAt(825, 15), pulseAt(915, 15), pulseAt(1005, 15),
    pulseAt(1095, 15), pulseAt(1140, 17), pulseAt(1275, 15),
    pulseAt(1365, 15), pulseAt(1455, 15), pulseAt(1545, 15),
    pulseAt(1650, 15), pulseAt(1800, 17),
  );
  const playerHitFlash = Math.max(
    pulseAt(825, 14), pulseAt(990, 14), pulseAt(1305, 14),
    pulseAt(1515, 14), pulseAt(1695, 14),
  );

  let feedback = "";
  if (pulseAt(825, 24) > 0) feedback = "正面交锋·双方受击";
  else if (pulseAt(915, 24) > 0) feedback = "技能命中·目标受损";
  else if (pulseAt(990, 24) > 0) feedback = "水球命中·生命下降";
  else if (pulseAt(1005, 24) > 0) feedback = "水压命中·目标失衡";
  else if (pulseAt(1095, 24) > 0) feedback = "连续命中·目标濒危";
  else if (pulseAt(1140, 30) > 0) feedback = "前哨水灵已清除";
  else if (isSwitch) feedback = props.switchNotice;
  else if (pulseAt(1275, 24) > 0) feedback = "水压命中·护体削弱";
  else if (pulseAt(1305, 24) > 0) feedback = "水球命中·生命下降";
  else if (pulseAt(1365, 24) > 0) feedback = "技能命中·目标受损";
  else if (pulseAt(1455, 24) > 0) feedback = "连续命中·目标失衡";
  else if (pulseAt(1515, 24) > 0) feedback = "高抛水球·侧移规避";
  else if (pulseAt(1545, 24) > 0) feedback = "反击命中·目标濒危";
  else if (pulseAt(1650, 24) > 0) feedback = "蓄力水压·核心暴露";
  else if (pulseAt(1695, 24) > 0) feedback = "水球擦中·生命下降";
  else if (pulseAt(1800, 34) > 0) feedback = "后排水灵已清除";

  const feedbackVisible = feedback.length > 0 && isBattle;
  const feedbackOpacity = feedbackVisible ? 1 : 0;
  const progressText = `${props.objectivePrefix} ${cleared} / 2`;
  const topTaskText = isSettlement ? props.settlementTitle : taskTitle;
  const targetBarWidth = 430 * targetRatio;
  const playerBarWidth = 430 * playerRatio;
  const settlementIn = smooth(1915, 1933, frame);
  const settlementCount = Math.min(2, Math.max(0, Math.floor((frame - 1915) / 14)));
  const settlementCountText = `${props.objectivePrefix} ${settlementCount} / 2`;
  const clearIn = smooth(1809, 1822, frame);

  const textEdge = "0 0 2px #053B28, 0 1px 2px #021F16, 0 0 9px rgba(57,255,136,0.32)";
  const rootStyle = {
    position: "absolute",
    inset: 0,
    width: "1920px",
    height: "1080px",
    backgroundColor: "transparent",
    color: accent,
    fontFamily: font,
    opacity: rootOpacity,
    pointerEvents: "none",
    textShadow: textEdge,
  };
  const microLabelStyle = {
    fontSize: "16px",
    fontWeight: 650,
    letterSpacing: "0.13em",
    lineHeight: 1,
    opacity: 0.78,
    WebkitTextStroke: "0.3px #063A28",
  };
  const topValueStyle = {
    fontSize: "29px",
    fontWeight: 760,
    letterSpacing: "0.07em",
    lineHeight: 1,
    WebkitTextStroke: "0.45px #043724",
  };
  const thinPanel = {
    backgroundColor: "rgba(3,48,32,0.18)",
    borderTop: `1px solid ${dim}`,
    borderBottom: `1px solid ${dim}`,
    boxShadow: "0 2px 11px rgba(3,38,27,0.22)",
  };

  const acceptCardStyle = {
    position: "absolute",
    left: 606,
    top: 112,
    width: 708,
    minHeight: 124,
    padding: "20px 30px 18px",
    boxSizing: "border-box",
    textAlign: "center",
    opacity: acceptOpacity,
    transform: `translateY(${acceptY}px) scale(${acceptScale})`,
    backgroundColor: "rgba(4,52,35,0.20)",
    borderTop: `1px solid ${accent}`,
    borderBottom: `1px solid ${accent}`,
    boxShadow: "0 8px 24px rgba(3,34,24,0.18), 0 0 14px rgba(57,255,136,0.12)",
  };
  const anomalyWrapStyle = {
    position: "absolute",
    inset: 0,
    opacity: anomalyOpacity,
  };
  const ringBaseStyle = {
    position: "absolute",
    left: 760,
    top: 410,
    width: 400,
    height: 210,
    border: `2px solid ${accent}`,
    borderRadius: "50%",
    transformOrigin: "50% 50%",
    boxShadow: "0 0 16px rgba(57,255,136,0.18)",
  };
  const ringAStyle = {
    ...ringBaseStyle,
    opacity: ringOpacityA,
    transform: `perspective(700px) rotateX(66deg) scale(${ringScaleA})`,
  };
  const ringBStyle = {
    ...ringBaseStyle,
    opacity: ringOpacityB,
    transform: `perspective(700px) rotateX(66deg) scale(${ringScaleB})`,
  };
  const scanLineStyle = {
    position: "absolute",
    left: safeLeft + 130,
    top: scanY,
    width: safeWidth - 260,
    height: 1,
    backgroundColor: accent,
    opacity: 0.30,
    boxShadow: `0 0 12px ${accent}`,
  };
  const bootStyle = {
    ...thinPanel,
    position: "absolute",
    left: 666,
    top: 164,
    width: 588,
    padding: "12px 24px",
    textAlign: "center",
    opacity: battleBootOpacity,
    transform: `translateY(${12 * (1 - battleBootIn)}px)`,
  };
  const feedbackStyle = {
    ...thinPanel,
    position: "absolute",
    left: 690,
    top: 162,
    width: 540,
    padding: "10px 20px",
    textAlign: "center",
    opacity: feedbackOpacity,
  };
  const playerWrapStyle = {
    position: "absolute",
    left: safeLeft + 24,
    top: 872,
    width: 470,
    height: 136,
    opacity: isBattle ? 1 : 0,
    transform: `translateX(${playerHitFlash * 4}px)`,
  };
  const playerBarStyle = {
    position: "relative",
    marginTop: 12,
    width: 430,
    height: 30,
    transform: "perspective(420px) rotateX(7deg) rotateY(4deg) skewX(-9deg)",
    border: `1.5px solid ${accent}`,
    backgroundColor: "rgba(4,46,31,0.25)",
    boxShadow: `0 5px 0 rgba(10,92,61,0.28), 0 0 12px rgba(57,255,136,${0.20 + playerHitFlash * 0.20})`,
    overflow: "hidden",
  };
  const playerFillStyle = {
    position: "absolute",
    left: 0,
    top: 0,
    width: playerBarWidth,
    height: 30,
    background: "linear-gradient(180deg, rgba(205,255,229,0.72) 0%, rgba(57,255,136,0.72) 42%, rgba(20,172,95,0.52) 100%)",
  };
  const targetWrapStyle = {
    position: "absolute",
    right: 1920 - safeRight + 24,
    top: 872,
    width: 470,
    height: 136,
    textAlign: "right",
    opacity: hasTarget ? 1 : 0,
    transform: `translateX(${-targetHitFlash * 4}px)`,
  };
  const targetBarStyle = {
    position: "relative",
    marginTop: 12,
    marginLeft: 40,
    width: 430,
    height: 30,
    transform: "perspective(420px) rotateX(7deg) rotateY(-4deg) skewX(9deg)",
    border: `1.5px solid ${accent}`,
    backgroundColor: "rgba(4,46,31,0.25)",
    boxShadow: `0 5px 0 rgba(10,92,61,0.28), 0 0 12px rgba(57,255,136,${0.20 + targetHitFlash * 0.22})`,
    overflow: "hidden",
  };
  const targetFillStyle = {
    position: "absolute",
    right: 0,
    top: 0,
    width: targetBarWidth,
    height: 30,
    background: "linear-gradient(180deg, rgba(205,255,229,0.72) 0%, rgba(57,255,136,0.72) 42%, rgba(20,172,95,0.52) 100%)",
  };
  const clearStyle = {
    ...thinPanel,
    position: "absolute",
    left: 650,
    top: 360,
    width: 620,
    padding: "20px 28px",
    textAlign: "center",
    opacity: isClear ? clearIn : 0,
    transform: `scale(${0.96 + clearIn * 0.04})`,
  };
  const settlementStyle = {
    position: "absolute",
    left: safeLeft + 34,
    top: 276,
    width: 470,
    padding: "24px 28px 22px",
    boxSizing: "border-box",
    opacity: isSettlement ? settlementIn : 0,
    transform: `translateX(${-18 * (1 - settlementIn)}px)`,
    backgroundColor: "rgba(3,48,32,0.20)",
    borderLeft: `2px solid ${accent}`,
    borderTop: `1px solid ${dim}`,
    borderBottom: `1px solid ${dim}`,
    boxShadow: "0 9px 22px rgba(3,34,24,0.20)",
  };

  // Registered copy defaults: 普通任务已接收 / 检测到异常能量场 / 突发事件结算 / 异常水灵 2 / 2
  return (
    <div style={rootStyle}>
      {topHudVisible && (
        <div>
          <div style={{position:"absolute",left:safeLeft + 24,top:64,width:270,height:70}}>
            <div style={microLabelStyle}>{props.timeLabel}</div>
            <div style={{...topValueStyle,marginTop:9}}>{timeText}</div>
            <div style={{position:"absolute",left:0,top:59,width:190,height:1,backgroundColor:accent,opacity:0.42}} />
          </div>

          <div style={{position:"absolute",right:1920 - safeRight + 24,top:64,width:260,height:70,textAlign:"right"}}>
            <div style={microLabelStyle}>{props.batteryLabel}</div>
            <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:11,marginTop:9}}>
              <div style={{fontSize:25,fontWeight:760,letterSpacing:"0.05em",WebkitTextStroke:"0.35px #043724"}}>{battery}</div>
              <div style={{position:"relative",width:74,height:27,border:`2px solid ${accent}`,borderRadius:4,boxShadow:"0 0 9px rgba(57,255,136,0.24)"}}>
                <div style={{position:"absolute",right:-8,top:7,width:5,height:9,backgroundColor:accent,borderRadius:"0 2px 2px 0"}} />
                <div style={{position:"absolute",left:4,top:4,width:batteryWidth,height:15,backgroundColor:accent,opacity:0.72}} />
              </div>
            </div>
          </div>

          <div style={{position:"absolute",left:688,top:60,width:544,height:78,textAlign:"center"}}>
            <div style={microLabelStyle}>{phase}</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:13,marginTop:11}}>
              <div style={{width:62,height:1,backgroundColor:accent,opacity:0.38}} />
              <div style={{fontSize:21,fontWeight:760,letterSpacing:"0.08em",WebkitTextStroke:"0.4px #043724"}}>{topTaskText}</div>
              {isBattle && <div style={{fontSize:18,fontWeight:720,opacity:0.84}}>{progressText}</div>}
              <div style={{width:62,height:1,backgroundColor:accent,opacity:0.38}} />
            </div>
          </div>
        </div>
      )}

      <div style={acceptCardStyle}>
        <div style={{fontSize:17,fontWeight:650,letterSpacing:"0.20em",opacity:0.72}}>普通任务</div>
        <div style={{fontSize:31,fontWeight:780,letterSpacing:"0.10em",marginTop:12,WebkitTextStroke:"0.5px #043724"}}>{props.acceptTitle}</div>
        <div style={{fontSize:18,fontWeight:560,letterSpacing:"0.08em",marginTop:11,opacity:0.84}}>{props.acceptNotice}</div>
      </div>

      <div style={anomalyWrapStyle}>
        <div style={{position:"absolute",left:610,top:124,width:700,textAlign:"center"}}>
          <div style={{fontSize:17,fontWeight:650,letterSpacing:"0.22em",opacity:0.78}}>{props.anomalyTitle}</div>
          <div style={{fontSize:34,fontWeight:820,letterSpacing:"0.12em",marginTop:13,WebkitTextStroke:"0.65px #043724"}}>{props.anomalyNotice}</div>
          <div style={{width:420,height:1,margin:"16px auto 0",backgroundColor:accent,opacity:0.48}} />
        </div>
        <div style={ringAStyle} />
        <div style={ringBStyle} />
        <div style={scanLineStyle} />
        <div style={{position:"absolute",left:946,top:493,width:28,height:28,border:`2px solid ${accent}`,borderRadius:"50%",opacity:0.66,boxShadow:`0 0 16px ${accent}`}} />
      </div>

      <div style={bootStyle}>
        <div style={{fontSize:16,fontWeight:650,letterSpacing:"0.18em",opacity:0.74}}>{props.eventTitle}</div>
        <div style={{fontSize:25,fontWeight:780,letterSpacing:"0.12em",marginTop:7}}>{props.battleNotice}</div>
      </div>

      <div style={feedbackStyle}>
        <div style={{fontSize:19,fontWeight:740,letterSpacing:"0.10em"}}>{feedback}</div>
      </div>

      {hasTarget && (
        <div style={{position:"absolute",left:874,top:454,width:172,height:138,opacity:reticlePulse}}>
          <svg width="172" height="138" viewBox="0 0 172 138">
            <path d="M45 69 H18 M127 69 H154 M86 40 V16 M86 98 V122" stroke={accent} strokeWidth="2" fill="none" />
            <path d="M54 48 Q86 30 118 48 M54 90 Q86 108 118 90" stroke={accent} strokeWidth="1.5" fill="none" opacity="0.70" />
            <circle cx="86" cy="69" r="5" fill={accent} opacity="0.82" />
          </svg>
        </div>
      )}

      <div style={playerWrapStyle}>
        <div style={{display:"flex",alignItems:"baseline",gap:12}}>
          <div style={{fontSize:18,fontWeight:760,letterSpacing:"0.13em"}}>{props.playerLabel}</div>
          <div style={{fontSize:15,opacity:0.72}}>{playerHp >= 85 ? props.playerStable : props.playerWarning}</div>
        </div>
        <div style={playerBarStyle}>
          <div style={playerFillStyle} />
          <div style={{position:"absolute",left:0,top:0,width:"100%",height:1,backgroundColor:"#D8FFE9",opacity:0.64}} />
          <div style={{position:"absolute",left:107,top:0,width:1,height:30,backgroundColor:dim,opacity:0.32}} />
          <div style={{position:"absolute",left:215,top:0,width:1,height:30,backgroundColor:dim,opacity:0.32}} />
          <div style={{position:"absolute",left:322,top:0,width:1,height:30,backgroundColor:dim,opacity:0.32}} />
        </div>
        <div style={{display:"flex",justifyContent:"space-between",width:430,marginTop:10}}>
          <div style={{fontSize:18,fontWeight:760,letterSpacing:"0.06em"}}>{playerHp} / 100</div>
          <div style={{fontSize:15,opacity:0.68}}>{props.skillLabel}</div>
        </div>
      </div>

      <div style={targetWrapStyle}>
        <div style={{display:"flex",justifyContent:"flex-end",alignItems:"baseline",gap:12}}>
          <div style={{fontSize:15,opacity:0.72}}>{targetRole}</div>
          <div style={{fontSize:18,fontWeight:760,letterSpacing:"0.12em"}}>{targetName}</div>
        </div>
        <div style={targetBarStyle}>
          <div style={targetFillStyle} />
          <div style={{position:"absolute",left:0,top:0,width:"100%",height:1,backgroundColor:"#D8FFE9",opacity:0.64}} />
          <div style={{position:"absolute",left:107,top:0,width:1,height:30,backgroundColor:dim,opacity:0.32}} />
          <div style={{position:"absolute",left:215,top:0,width:1,height:30,backgroundColor:dim,opacity:0.32}} />
          <div style={{position:"absolute",left:322,top:0,width:1,height:30,backgroundColor:dim,opacity:0.32}} />
        </div>
        <div style={{display:"flex",justifyContent:"space-between",width:430,marginLeft:40,marginTop:10}}>
          <div style={{fontSize:15,opacity:0.68}}>{props.targetState}</div>
          <div style={{fontSize:18,fontWeight:760,letterSpacing:"0.06em"}}>{targetHp} / 100</div>
        </div>
      </div>

      <div style={clearStyle}>
        <div style={{fontSize:16,fontWeight:650,letterSpacing:"0.20em",opacity:0.76}}>{props.eventTitle}</div>
        <div style={{fontSize:30,fontWeight:820,letterSpacing:"0.12em",marginTop:9}}>{props.clearTitle}</div>
        <div style={{fontSize:18,fontWeight:650,letterSpacing:"0.12em",marginTop:10,opacity:0.84}}>异常水灵 2 / 2</div>
      </div>

      <div style={settlementStyle}>
        <div style={{fontSize:16,fontWeight:650,letterSpacing:"0.20em",opacity:0.74}}>任务结算</div>
        <div style={{fontSize:31,fontWeight:820,letterSpacing:"0.10em",marginTop:11}}>{props.settlementTitle}</div>
        <div style={{width:310,height:1,backgroundColor:accent,opacity:0.46,marginTop:14}} />
        <div style={{fontSize:19,fontWeight:700,letterSpacing:"0.10em",marginTop:15}}>{settlementCountText}</div>
        <div style={{fontSize:17,fontWeight:600,letterSpacing:"0.08em",marginTop:10,opacity:0.82}}>{notice}</div>
        <div style={{display:"flex",gap:28,marginTop:18}}>
          <div>
            <div style={microLabelStyle}>剩余生命</div>
            <div style={{fontSize:25,fontWeight:780,marginTop:8}}>{playerHp}</div>
          </div>
          <div>
            <div style={microLabelStyle}>设备电量</div>
            <div style={{fontSize:25,fontWeight:780,marginTop:8}}>{battery}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
