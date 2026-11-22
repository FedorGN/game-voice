const stage = document.querySelector("#stage");
const canvas = document.querySelector("#field");
const ctx = canvas.getContext("2d");
const overlay = document.querySelector("#overlay");
const screens = {
  menu: document.querySelector("#intro"),
  connecting: document.querySelector("#setup"),
  calibrating: document.querySelector("#setup"),
  ready: document.querySelector("#ready"),
  paused: document.querySelector("#paused"),
  over: document.querySelector("#game-over"),
};
const scoreLabel = document.querySelector("#score");
const recordLabel = document.querySelector("#record");
const pauseButton = document.querySelector("#pause");
const micStatus = document.querySelector("#mic-status");
const micError = document.querySelector("#mic-error");
const sensitivity = document.querySelector("#sensitivity");
const sensitivityValue = document.querySelector("#sensitivity-value");
const meterFill = document.querySelector("#meter-fill");
const meterThreshold = document.querySelector("#meter-threshold");
const calibrateButton = document.querySelector("#calibrate");
const deviceField = document.querySelector("#device-field");
const deviceSelect = document.querySelector("#microphone");
const progress = document.querySelector("#calibration-progress");
const setupTitle = document.querySelector("#setup-title");
const setupDescription = document.querySelector("#setup-description");
const calibrationReadout = document.querySelector("#calibration-readout");
const calibrationStep = document.querySelector("#calibration-step");
const calibrationNote = document.querySelector("#calibration-note");
const calibrationMessage = document.querySelector("#calibration-message");
const captureNoteButton = document.querySelector("#capture-note");
const pitchScale = document.querySelector("#pitch-scale");
const pitchValue = document.querySelector("#pitch-value");
const pitchMarker = document.querySelector("#pitch-marker");
const flightPitch = document.querySelector("#flight-pitch");
const flightPitchMarker = document.querySelector("#flight-pitch-marker");
const voiceLegend = document.querySelector("#voice-legend");
const keyboardLegend = document.querySelector("#keyboard-legend");
const readyTitle = document.querySelector("#ready-title");
const readyDescription = document.querySelector("#ready-description");
const quitReadyButton = document.querySelector("#quit-ready");
const voiceButton = document.querySelector("#start-voice");
const launchButton = document.querySelector("#launch");
const retryButton = document.querySelector("#retry");
const resumeButton = document.querySelector("#resume");

const MOTH_RADIUS = 15;
const FLAP_VELOCITY = -282;
const GRAVITY = 720;
const NOTE_HOLD_TIME = .78;
const ANALYSIS_INTERVAL = 1 / 30;
const VOICE_GRACE = .18;
const VOICE_TOP_Y = .15;
const VOICE_BOTTOM_Y = .84;
const MIN_RANGE_RATIO = 2 ** (3 / 12);
const STABLE_NOTE_RATIO = 2 ** (1.35 / 12);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const formatScore = (score) => String(score).padStart(2, "0");

function readNumber(key, fallback, max) {
  try {
    const value = localStorage.getItem(key);
    const number = Number(value);
    return value !== null && Number.isInteger(number) && number >= 0 && number <= max
      ? number
      : fallback;
  } catch {
    return fallback;
  }
}

function storeNumber(key, number) {
  try {
    localStorage.setItem(key, String(number));
  } catch {
    // Private or restricted pages can still play with session-only settings.
  }
}

let phase = "menu";
let mode = "keyboard";
let width = 840;
let best = readNumber("night-flight-record", 0, Number.MAX_SAFE_INTEGER);
let run;
let microphone = null;
let microphoneRequest = 0;
let selectedDevice = "";
let calibration = null;
let pitchRange = { low: null, high: null };
let sensitivityAmount = readNumber("night-flight-sensitivity", 65, 100);
let voiceFlight;
let analysisElapsed = 0;
let waveformTime = 0;

function resetVoiceFlight() {
  voiceFlight = { armed: false, notes: [], pitch: null, voicedFor: 0, silence: 0 };
}

function minimumMicLevel() {
  return .004 + .055 * (1 - sensitivityAmount / 100) ** 1.7;
}

function meterPosition(level) {
  const decibels = 20 * Math.log10(Math.max(level, .001));
  return clamp((decibels + 60) / 52, 0, 1) * 100;
}

function drawSensitivity() {
  sensitivity.value = String(sensitivityAmount);
  sensitivityValue.value = `${sensitivityAmount}%`;
  meterThreshold.style.left = `${meterPosition(minimumMicLevel())}%`;
}

function medianNote(notes) {
  const sorted = [...notes].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2;
}

function pitchFraction(frequency) {
  const { low, high } = pitchRange;
  return clamp(Math.log(frequency / low) / Math.log(high / low), 0, 1);
}

function noteLabel(frequency) {
  return frequency === null ? "— Гц" : `${Math.round(frequency)} Гц`;
}

function updatePitchDisplay(frequency) {
  const label = noteLabel(frequency);
  if (pitchValue.textContent !== label) pitchValue.textContent = label;
  if (phase === "calibrating" && calibrationNote.textContent !== label) calibrationNote.textContent = label;
  const hasPosition = frequency !== null && pitchRange.high !== null;
  pitchMarker.hidden = !hasPosition;
  flightPitchMarker.hidden = !hasPosition;
  if (hasPosition) {
    const position = pitchFraction(frequency) * 100;
    pitchMarker.style.left = `${position}%`;
    flightPitchMarker.style.top = `${100 - position}%`;
  }
}

function updatePitchRange() {
  const low = pitchRange.low === null ? "Низкая" : noteLabel(pitchRange.low);
  const high = pitchRange.high === null ? "Высокая" : noteLabel(pitchRange.high);
  document.querySelector("#low-note").textContent = low;
  document.querySelector("#high-note").textContent = high;
  document.querySelector("#flight-pitch-low").textContent = low;
  document.querySelector("#flight-pitch-high").textContent = high;
}

function updateVoiceLegend(silent = false) {
  if (voiceLegend.dataset.silent === String(silent)) return;
  voiceLegend.dataset.silent = String(silent);
  voiceLegend.textContent = silent ? "Спой, чтобы удержать высоту" : "Выше тон — выше полёт";
}

function setMicStatus(message, kind = "off") {
  micStatus.textContent = message;
  micStatus.dataset.kind = kind;
}

function showMicError(message = "") {
  micError.textContent = message;
  micError.hidden = message === "";
  if (message) setMicStatus("Недоступен", "error");
}

function setPhase(next) {
  phase = next;
  analysisElapsed = 0;
  stage.dataset.phase = next;
  overlay.hidden = next === "playing";
  pauseButton.hidden = next !== "playing";
  Object.values(screens).forEach((screen) => { screen.hidden = screen !== screens[next]; });

  const active = next === "calibrating" || next === "ready" || next === "playing";
  if (microphone) {
    microphone.stream.getAudioTracks().forEach((track) => { track.enabled = active; });
    if (!active) {
      meterFill.style.width = "0%";
      updatePitchDisplay(null);
    }
  }
  pitchScale.hidden = microphone === null;
  flightPitch.hidden = mode !== "voice" || pitchRange.high === null ||
    (next !== "ready" && next !== "playing" && next !== "paused");
  voiceLegend.hidden = mode !== "voice" || next === "menu";
  keyboardLegend.hidden = !voiceLegend.hidden;
  updateVoiceLegend();
  const adjustable = microphone !== null && (next === "ready" || next === "over");
  calibrateButton.disabled = !adjustable;
  deviceSelect.disabled = !adjustable;

  if (next === "connecting") setMicStatus("Подключение");
  else if (next === "calibrating") setMicStatus("Калибровка", "on");
  else if (microphone) setMicStatus(active ? "Слушает" : "На паузе", active ? "on" : "off");
  else setMicStatus("Выключен");
}

function resetRun() {
  run = {
    elapsed: 0,
    score: 0,
    moth: { x: mothX(), y: FIELD_HEIGHT * .49, velocity: 0 },
    gates: [],
    particles: [],
  };
  scoreLabel.textContent = formatScore(0);
}

function mothX() {
  return Math.min(151, width * .27);
}

function resizeField() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const bounds = canvas.getBoundingClientRect();
  if (bounds.height < 1 || bounds.width < 1) return;
  canvas.width = Math.round(bounds.width * pixelRatio);
  canvas.height = Math.round(bounds.height * pixelRatio);
  width = canvas.width / canvas.height * FIELD_HEIGHT;
  const scale = canvas.height / FIELD_HEIGHT;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  run.moth.x = mothX();
  drawField(ctx, width, phase, run, waveformTime);
}

function releaseMicrophone() {
  microphoneRequest += 1;
  calibration = null;
  if (microphone) {
    const { stream, context } = microphone;
    microphone = null;
    stream.getTracks().forEach((track) => track.stop());
    if (context.state !== "closed") void context.close().catch(() => {});
  }
  meterFill.style.width = "0%";
  pitchScale.hidden = true;
  flightPitch.hidden = true;
  deviceField.hidden = true;
  pitchRange = { low: null, high: null };
  updatePitchRange();
  updatePitchDisplay(null);
}

function returnToMenu({ focus = true } = {}) {
  releaseMicrophone();
  showMicError();
  mode = "keyboard";
  resetRun();
  setPhase("menu");
  if (focus) voiceButton.focus();
}

function prepareFlight(inputMode) {
  mode = inputMode;
  resetRun();
  resetVoiceFlight();
  const singing = mode === "voice";
  readyTitle.textContent = singing ? "Диапазон настроен" : "Готов к полёту?";
  readyDescription.textContent = singing
    ? "Сделай короткую паузу, затем запой. Тяни ноту, чтобы удерживать высоту."
    : "Нажми пробел или коснись поля.";
  launchButton.hidden = singing;
  quitReadyButton.hidden = !singing;
  setPhase("ready");
  (singing ? readyTitle : launchButton).focus({ preventScroll: true });
}

function startKeyboard() {
  releaseMicrophone();
  showMicError();
  prepareFlight("keyboard");
}

function microphoneError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Разреши микрофон в настройках сайта и попробуй снова.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Микрофон не найден. Подключи его или выбери другое устройство.";
    case "NotReadableError":
    case "AbortError":
      return "Не удалось открыть микрофон. Проверь доступ в системе и попробуй снова.";
    default:
      return "Не удалось подключить микрофон. Можно играть пробелом или тапом.";
  }
}

async function updateDevices(request) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (request !== microphoneRequest || !microphone) return;
    const inputs = devices.filter(({ kind, deviceId }) =>
      kind === "audioinput" && deviceId && deviceId !== "default" && deviceId !== "communications"
    );
    deviceSelect.replaceChildren(new Option("Системный микрофон", ""));
    inputs.forEach((device, index) => {
      deviceSelect.add(new Option(device.label || `Микрофон ${index + 1}`, device.deviceId));
    });
    deviceSelect.value = inputs.some((device) => device.deviceId === selectedDevice) ? selectedDevice : "";
    deviceField.hidden = inputs.length === 0;
  } catch {
    if (request === microphoneRequest) deviceField.hidden = true;
  }
}

async function startVoice(deviceId = selectedDevice) {
  releaseMicrophone();
  showMicError();
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !Audio) {
    showMicError("Для голосового режима открой игру через localhost или HTTPS в браузере с доступом к микрофону.");
    return;
  }

  const request = microphoneRequest;
  mode = "voice";
  setupTitle.textContent = "Подключаем микрофон";
  setupDescription.textContent = "Разреши доступ к микрофону в браузере.";
  calibrationReadout.hidden = true;
  calibrationMessage.hidden = true;
  captureNoteButton.hidden = true;
  progress.hidden = true;
  resetRun();
  setPhase("connecting");
  let stream;
  let context;
  try {
    context = new Audio();
    // Start audio in the same user gesture that requests permission.
    const resumed = context.resume();
    void resumed.catch(() => {});
    const input = { autoGainControl: false, noiseSuppression: false, echoCancellation: false };
    if (deviceId) input.deviceId = { exact: deviceId };
    stream = await navigator.mediaDevices.getUserMedia({ audio: input });
    if (request !== microphoneRequest) {
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      return;
    }
    await resumed;
    if (request !== microphoneRequest) {
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      return;
    }
    const analyser = context.createAnalyser();
    analyser.fftSize = 2 ** Math.ceil(Math.log2(context.sampleRate * .075));
    context.createMediaStreamSource(stream).connect(analyser);
    microphone = {
      stream,
      context,
      analyser,
      samples: new Float32Array(analyser.fftSize),
      analyze: createPitchAnalyzer(context.sampleRate, analyser.fftSize),
    };
    selectedDevice = deviceId;
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (microphone?.stream !== stream) return;
        returnToMenu({ focus: false });
        selectedDevice = "";
        showMicError("Микрофон отключился. Подключи его снова или играй пробелом.");
      });
    });
    beginCalibration();
    void updateDevices(request);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") void context.close().catch(() => {});
    if (request !== microphoneRequest) return;
    selectedDevice = "";
    returnToMenu();
    showMicError(microphoneError(error));
  }
}

function beginCalibration() {
  if (!microphone) return;
  pitchRange = { low: null, high: null };
  resetRun();
  setPhase("calibrating");
  updatePitchRange();
  updatePitchDisplay(null);
  showCalibrationStep("low");
}

function showCalibrationStep(note, message = "") {
  calibration = { note, capture: null };
  const low = note === "low";
  setupTitle.textContent = low ? "Низкая нота" : "Высокая нота";
  setupDescription.textContent = low
    ? "Нажми кнопку и протяни удобное низкое «у» около секунды."
    : "Нажми кнопку и протяни удобное высокое «у» около секунды.";
  calibrationStep.textContent = low ? "Шаг 1 из 2" : "Шаг 2 из 2";
  calibrationReadout.hidden = false;
  calibrationMessage.textContent = message;
  calibrationMessage.hidden = !message;
  progress.hidden = true;
  captureNoteButton.textContent = low ? "Задать низкую ноту" : "Задать высокую ноту";
  captureNoteButton.hidden = false;
  captureNoteButton.focus();
}

function captureNote() {
  if (!calibration || calibration.capture) return;
  calibration.capture = { elapsed: 0, stableFor: 0, silence: 0, notes: [] };
  setupDescription.textContent = "Тяни «у» на одной высоте, пока шкала не заполнится.";
  calibrationMessage.hidden = true;
  captureNoteButton.hidden = true;
  progress.value = 0;
  progress.hidden = false;
  setupTitle.focus({ preventScroll: true });
}

function updateCalibration(frequency, delta) {
  const { note, capture } = calibration;
  if (!capture) return;
  capture.elapsed += delta;
  if (capture.elapsed >= 8) {
    showCalibrationStep(note, "Не удалось уловить ровную ноту. Попробуй ещё раз или повысь чувствительность.");
    return;
  }
  if (frequency === null) {
    capture.silence += delta;
    if (capture.silence >= .12) {
      capture.notes.length = 0;
      capture.stableFor = 0;
      progress.value = 0;
    }
    return;
  }

  capture.silence = 0;
  const anchor = capture.notes[0] ?? frequency;
  const ratio = frequency / anchor;
  if (ratio > STABLE_NOTE_RATIO || ratio < 1 / STABLE_NOTE_RATIO) {
    capture.notes.length = 0;
    capture.stableFor = 0;
  }
  capture.notes.push(frequency);
  capture.stableFor += delta;
  progress.value = Math.min(1, capture.stableFor / NOTE_HOLD_TIME);
  if (capture.stableFor < NOTE_HOLD_TIME) return;

  const calibrated = medianNote(capture.notes);
  if (note === "low") {
    pitchRange.low = calibrated;
    updatePitchRange();
    showCalibrationStep("high");
  } else if (calibrated < pitchRange.low * MIN_RANGE_RATIO) {
    showCalibrationStep("high", "Возьми ноту заметно выше первой и попробуй ещё раз.");
  } else {
    pitchRange.high = calibrated;
    updatePitchRange();
    calibration = null;
    prepareFlight("voice");
  }
}

function trackPitch(frequency, delta) {
  if (frequency === null) {
    voiceFlight.voicedFor = 0;
    voiceFlight.silence += delta;
    if (voiceFlight.silence >= VOICE_GRACE) {
      voiceFlight.pitch = null;
      voiceFlight.notes.length = 0;
      voiceFlight.armed = true;
    }
  } else {
    voiceFlight.silence = 0;
    voiceFlight.voicedFor += delta;
    voiceFlight.notes.push(frequency);
    if (voiceFlight.notes.length > 3) voiceFlight.notes.shift();
    voiceFlight.pitch = medianNote(voiceFlight.notes);
    if (phase === "ready" && voiceFlight.armed && voiceFlight.voicedFor >= .09) startFlight();
  }
  if (phase === "playing") updateVoiceLegend(voiceFlight.pitch === null);
}

function updateVoice(delta) {
  if (!microphone || (phase !== "calibrating" && phase !== "ready" && phase !== "playing")) return;
  analysisElapsed += delta;
  if (analysisElapsed < ANALYSIS_INTERVAL) return;
  const interval = analysisElapsed;
  analysisElapsed = 0;
  const { analyser, samples, analyze } = microphone;
  analyser.getFloatTimeDomainData(samples);
  const { level, frequency } = analyze(samples, minimumMicLevel());
  meterFill.style.width = `${meterPosition(level)}%`;
  if (phase === "calibrating") updateCalibration(frequency, interval);
  else trackPitch(frequency, interval);
  updatePitchDisplay(phase === "playing" ? voiceFlight.pitch : frequency);
}

function addGate(x) {
  const difficulty = Math.min(1, run.score / 35);
  const previous = run.gates.at(-1);
  const center = previous
    ? clamp(previous.center + (Math.random() - .5) * 190, 168, 395)
    : FIELD_HEIGHT / 2;
  run.gates.push({ x, center, gap: 204 - 35 * difficulty, phase: Math.random() * Math.PI * 2, scored: false });
}

function fillCourse() {
  if (run.gates.length === 0) addGate(Math.min(width + 37, run.moth.x + 395));
  while (run.gates.at(-1).x < width + 32) {
    addGate(run.gates.at(-1).x + 285 + Math.random() * 48);
  }
}

function startFlight() {
  fillCourse();
  setPhase("playing");
}

function flap() {
  if (mode !== "keyboard") return;
  if (phase === "ready") startFlight();
  if (phase !== "playing") return;
  run.moth.velocity = FLAP_VELOCITY;
  for (let n = 0; n < 7; n++) {
    run.particles.push({
      x: run.moth.x + (Math.random() - .5) * 14,
      y: run.moth.y + (Math.random() - .5) * 15,
      dx: -54 - Math.random() * 110,
      dy: (Math.random() - .36) * 65,
      life: .28 + Math.random() * .31,
      size: 1 + Math.random() * 1.65,
    });
  }
}

function circleHitsBox(moth, left, top, right, bottom) {
  const x = moth.x - clamp(moth.x, left, right);
  const y = moth.y - clamp(moth.y, top, bottom);
  return x * x + y * y <= MOTH_RADIUS * MOTH_RADIUS;
}

function hitLanterns(moth, pose) {
  const { x, top, bottom } = pose;
  return (
    circleHitsBox(moth, x - 4, 0, x + 4, top - LANTERN_HEIGHT) ||
    circleHitsBox(moth, x - LANTERN_WIDTH, top - LANTERN_HEIGHT, x + LANTERN_WIDTH, top) ||
    circleHitsBox(moth, x - LANTERN_WIDTH, bottom, x + LANTERN_WIDTH, bottom + LANTERN_HEIGHT) ||
    circleHitsBox(moth, x - 7.5, bottom + LANTERN_HEIGHT, x + 7.5, FIELD_HEIGHT)
  );
}

function finishFlight() {
  document.querySelector("#final-score").textContent = formatScore(run.score);
  document.querySelector("#final-record").textContent = formatScore(best);
  setPhase("over");
  retryButton.focus({ preventScroll: true });
}

function moveMoth(delta) {
  const { moth } = run;
  if (mode === "voice" && voiceFlight.pitch !== null) {
    const target = FIELD_HEIGHT * (VOICE_BOTTOM_Y - (VOICE_BOTTOM_Y - VOICE_TOP_Y) * pitchFraction(voiceFlight.pitch));
    const distance = (target - moth.y) * (1 - Math.exp(-delta / .12));
    const step = clamp(distance, -520 * delta, 520 * delta);
    moth.y += step;
    moth.velocity = step / delta;
    return;
  }
  moth.velocity += GRAVITY * delta;
  if (mode === "voice") moth.velocity = clamp(moth.velocity, 0, 290);
  moth.y += moth.velocity * delta;
}

function updateFlight(delta) {
  if (delta <= 0) return;
  run.elapsed += delta;
  moveMoth(delta);
  const { moth } = run;
  if (moth.y <= 19 + MOTH_RADIUS || moth.y >= FIELD_HEIGHT - 23 - MOTH_RADIUS) {
    finishFlight();
    return;
  }
  const speed = 178 + Math.min(70, run.score * 2.6);
  for (const gate of run.gates) {
    gate.x -= speed * delta;
    const pose = gatePose(gate, run.elapsed);
    if (hitLanterns(moth, pose)) {
      finishFlight();
      return;
    }
    if (!gate.scored && gate.x + LANTERN_WIDTH + MOTH_RADIUS + 8 < moth.x) {
      gate.scored = true;
      run.score += 1;
      scoreLabel.textContent = formatScore(run.score);
      if (run.score > best) {
        best = run.score;
        recordLabel.textContent = formatScore(best);
        storeNumber("night-flight-record", best);
      }
    }
  }
  if (run.gates[0].x < -60) run.gates.shift();
  fillCourse();
  for (const particle of run.particles) {
    particle.x += particle.dx * delta;
    particle.y += particle.dy * delta;
    particle.life -= delta;
  }
  run.particles = run.particles.filter((particle) => particle.life > 0);
}

function togglePause() {
  if (phase === "playing") {
    setPhase("paused");
    resumeButton.focus({ preventScroll: true });
  } else if (phase === "paused") {
    resetVoiceFlight();
    setPhase("playing");
  }
}

voiceButton.addEventListener("click", () => { void startVoice(); });
document.querySelector("#start-keyboard").addEventListener("click", startKeyboard);
launchButton.addEventListener("click", flap);
captureNoteButton.addEventListener("click", captureNote);
document.querySelector("#cancel-setup").addEventListener("click", () => returnToMenu());
quitReadyButton.addEventListener("click", () => returnToMenu());
document.querySelector("#quit-paused").addEventListener("click", () => returnToMenu());
document.querySelector("#quit-over").addEventListener("click", () => returnToMenu());
pauseButton.addEventListener("click", togglePause);
resumeButton.addEventListener("click", togglePause);
retryButton.addEventListener("click", () => prepareFlight(mode));
calibrateButton.addEventListener("click", beginCalibration);
deviceSelect.addEventListener("change", () => { void startVoice(deviceSelect.value); });
sensitivity.addEventListener("input", () => {
  sensitivityAmount = Number(sensitivity.value);
  storeNumber("night-flight-sensitivity", sensitivityAmount);
  drawSensitivity();
});

stage.addEventListener("pointerdown", (event) => {
  if (event.button === 0 && event.isPrimary && !event.target.closest("button")) flap();
});

document.addEventListener("keydown", (event) => {
  if (event.target.closest?.("input, select, textarea")) return;
  const button = event.target.closest?.("button:not([hidden])");
  if (event.code === "Escape" && (phase === "playing" || phase === "paused")) {
    event.preventDefault();
    if (!event.repeat) togglePause();
  } else if (mode === "keyboard" && event.code === "Space" && (!button || button === launchButton || button.closest("[hidden]"))) {
    if (phase !== "menu" && phase !== "ready" && phase !== "playing") return;
    event.preventDefault();
    if (event.repeat) return;
    if (phase === "menu") startKeyboard();
    flap();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "playing") togglePause();
});
window.addEventListener("pagehide", () => returnToMenu({ focus: false }));

recordLabel.textContent = formatScore(best);
const brandMoth = document.querySelector("#brand-moth");
drawMothEmblem(brandMoth, .65);
document.querySelector('link[rel="icon"]').href = brandMoth.toDataURL();
drawMothEmblem(document.querySelector("#intro-moth"), 1.73);
flightPitch.style.setProperty("--flight-pitch-top", `${VOICE_TOP_Y * 100}%`);
flightPitch.style.setProperty("--flight-pitch-bottom", `${100 - VOICE_BOTTOM_Y * 100}%`);
drawSensitivity();
resetRun();
resetVoiceFlight();
setPhase("menu");
resizeField();
new ResizeObserver(resizeField).observe(stage);

let previousFrame = performance.now();
function frame(now) {
  const delta = clamp((now - previousFrame) / 1000, 0, .045);
  previousFrame = now;
  waveformTime = now / 1000;
  updateVoice(delta);
  if (phase === "playing") updateFlight(delta);
  drawField(ctx, width, phase, run, waveformTime);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
