const FIELD_HEIGHT = 560;
const LANTERN_WIDTH = 28;
const LANTERN_HEIGHT = 62;

function drawMoth(ctx, x, y, size, spread = 1, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(size, size);

  const wing = ctx.createLinearGradient(-10, -29, 20, 30);
  wing.addColorStop(0, "#ffde9c");
  wing.addColorStop(.5, "#e9a96c");
  wing.addColorStop(1, "#86506a");

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side * spread, 1);
    ctx.lineWidth = 1.35;
    ctx.strokeStyle = "#fcd4a3";
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.bezierCurveTo(8, -8, 19, -27, 40, -29);
    ctx.bezierCurveTo(47, -30, 49, -25, 45, -18);
    ctx.bezierCurveTo(42, -8, 34, -1, 28, 4);
    ctx.bezierCurveTo(43, 13, 40, 23, 28, 23);
    ctx.bezierCurveTo(24, 31, 19, 30, 14, 25);
    ctx.bezierCurveTo(6, 22, 1, 13, 0, 1);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#633853a1";
    ctx.beginPath();
    ctx.moveTo(3, 4);
    ctx.quadraticCurveTo(23, -12, 39, -22);
    ctx.moveTo(6, 9);
    ctx.quadraticCurveTo(16, 9, 28, 18);
    ctx.moveTo(7, 9);
    ctx.quadraticCurveTo(16, 18, 18, 24);
    ctx.stroke();

    ctx.fillStyle = "#865064";
    ctx.beginPath();
    ctx.ellipse(29, -10, 5.5, 7, .69, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f8d896";
    ctx.beginPath();
    ctx.ellipse(29, -10, 2.2, 3, .69, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#f8cf91";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(2, -9);
    ctx.quadraticCurveTo(2, -20, 13, -23);
    ctx.moveTo(7, -20);
    ctx.lineTo(8, -24);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = "#503040";
  ctx.strokeStyle = "#ffda99";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 5, 4.5, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f3c58b";
  ctx.beginPath();
  ctx.ellipse(0, -8, 5, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMothEmblem(canvas, size) {
  drawMoth(canvas.getContext("2d"), canvas.width / 2, canvas.height / 2 + 3, size);
}

function gatePose(gate, elapsed) {
  const sway = Math.sin(elapsed * 1.65 + gate.phase);
  return {
    x: gate.x + sway * 8,
    top: gate.top,
    bottom: gate.bottom,
  };
}

function drawLantern(ctx, x, y, time, hanging) {
  ctx.save();
  ctx.translate(x, y);
  const edge = hanging ? -1 : 1;
  const reach = hanging ? y : FIELD_HEIGHT - y;

  ctx.strokeStyle = "#23172e";
  ctx.lineWidth = hanging ? 7 : 15;
  ctx.beginPath();
  ctx.moveTo(0, edge * 23);
  ctx.lineTo(0, edge * (reach + 3));
  ctx.stroke();
  ctx.strokeStyle = "#9a706b";
  ctx.lineWidth = hanging ? 1 : 2;
  ctx.beginPath();
  ctx.moveTo(-2, edge * 27);
  ctx.lineTo(-2, edge * reach);
  ctx.stroke();

  const glow = ctx.createRadialGradient(0, 0, 7, 0, 0, 87);
  glow.addColorStop(0, "rgba(255, 193, 93, .44)");
  glow.addColorStop(.38, "rgba(234, 137, 81, .21)");
  glow.addColorStop(1, "rgba(234, 137, 81, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-87, -87, 174, 174);

  const glass = ctx.createLinearGradient(-23, -21, 20, 22);
  glass.addColorStop(0, "#c78461");
  glass.addColorStop(.45, "#fff0ad");
  glass.addColorStop(.71, "#f8bd71");
  glass.addColorStop(1, "#af615b");
  ctx.fillStyle = glass;
  ctx.strokeStyle = "#5b3744";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(-21, -21, 42, 42, 7);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fff2be";
  ctx.globalAlpha = .73 + Math.sin(time * 5 + x) * .11;
  ctx.beginPath();
  ctx.ellipse(0, 4, 7, 12, .13, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const metal = ctx.createLinearGradient(-25, -28, 22, 30);
  metal.addColorStop(0, "#f8cf91");
  metal.addColorStop(.5, "#aa6b58");
  metal.addColorStop(1, "#60394a");
  ctx.fillStyle = metal;
  ctx.strokeStyle = "#43293e";
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-25, side * 20);
    ctx.lineTo(-15, side * 28);
    ctx.lineTo(0, side * 30);
    ctx.lineTo(15, side * 28);
    ctx.lineTo(25, side * 20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.strokeStyle = "#9a5c55bb";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-13, -19);
  ctx.quadraticCurveTo(-9, 0, -13, 19);
  ctx.moveTo(13, -19);
  ctx.quadraticCurveTo(9, 0, 13, 19);
  ctx.stroke();

  ctx.fillStyle = "#ffd496";
  ctx.beginPath();
  ctx.arc(0, edge * 28, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFireflies(ctx, width, time) {
  ctx.save();
  for (let index = 0; index < 35; index++) {
    const x = ((index * 149 + 23) % 797) / 797 * width + Math.sin(index * 2.9 + time * .36) * 12;
    const y = 58 + (index * 83 % 460) + Math.sin(index + time * .49) * 9;
    const flicker = (1 + Math.sin(index * 3.18 + time * 1.6)) / 2;
    const radius = index % 8 === 0 ? 1.65 : .85;
    ctx.globalAlpha = .15 + flicker * .66;
    ctx.fillStyle = "#ffd397";
    ctx.shadowColor = "#ffaa62";
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFlightLevels(ctx, width, levelCount) {
  ctx.save();
  ctx.strokeStyle = "#d6bfdc28";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 7]);
  ctx.beginPath();
  for (let level = 0; level < levelCount; level++) {
    const y = flightLevelY(level, levelCount);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawField(ctx, width, phase, run, time) {
  ctx.clearRect(0, 0, width, FIELD_HEIGHT);
  drawFireflies(ctx, width, time);

  if (phase === "menu" || phase === "connecting" || phase === "calibrating") {
    drawLantern(ctx, width * .14 + Math.sin(time * .8) * 5, 119, time, true);
    drawLantern(ctx, width * .86 + Math.sin(time * .75 + 2) * 5, 170, time, true);
    return;
  }

  drawFlightLevels(ctx, width, run.levelCount);
  for (const gate of run.gates) {
    const pose = gatePose(gate, run.elapsed);
    drawLantern(ctx, pose.x, pose.top - LANTERN_HEIGHT / 2, time, true);
    drawLantern(ctx, pose.x, pose.bottom + LANTERN_HEIGHT / 2, time, false);
  }

  ctx.save();
  ctx.shadowColor = "#ffd295";
  ctx.shadowBlur = 15;
  const flutter = .74 + Math.sin(time * 19) * .18;
  const recoil = run.recoil ? Math.sin(Math.PI * run.recoil.progress) : 0;
  drawMoth(ctx, run.moth.x - 18 * recoil, run.moth.y, .52, flutter, .3 + run.moth.tilt - .55 * recoil);
  ctx.restore();
}
