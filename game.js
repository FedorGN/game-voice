const stage = document.querySelector("#stage");
const canvas = document.querySelector("#field");
const ctx = canvas.getContext("2d");
const overlay = document.querySelector("#overlay");
const screens = {
  menu: document.querySelector("#intro"),
  connecting: document.querySelector("#setup"),
  calibrating: document.querySelector("#setup"),
  ready: document.querySelector("#ready"),
  training: document.querySelector("#training"),
  paused: document.querySelector("#paused"),
  over: document.querySelector("#game-over"),
};
const scoreLabel = document.querySelector("#score");
const recordLabel = document.querySelector("#record");
const flightSettings = document.querySelector("#flight-settings");
const difficultySelect = document.querySelector("#difficulty");
const flightLevelsSelect = document.querySelector("#flight-levels");
const flightLevelsHint = document.querySelector("#flight-levels-hint");
const immortalityToggle = document.querySelector("#immortality");
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
const pitchValueLabel = document.querySelector("#pitch-value-label");
const pitchValue = document.querySelector("#pitch-value");
const pitchMarker = document.querySelector("#pitch-marker");
const flightPitch = document.querySelector("#flight-pitch");
const flightPitchWindow = document.querySelector("#flight-pitch-window");
const flightPitchLabels = document.querySelector("#flight-pitch-labels");
const flightPitchMarker = document.querySelector("#flight-pitch-marker");
const voiceLegend = document.querySelector("#voice-legend");
const readyTitle = document.querySelector("#ready-title");
const quitReadyButton = document.querySelector("#quit-ready");
const voiceButton = document.querySelector("#start-voice");
const trainingTitle = document.querySelector("#training-title");
const trainingNotes = document.querySelector("#training-notes");
const trainingFeedback = document.querySelector("#training-feedback");
const overTitle = document.querySelector("#over-title");
const resumeButton = document.querySelector("#resume");

const MOTH_RADIUS = 15;
const NOTE_HOLD_TIME = .78;
const ANALYSIS_INTERVAL = 1 / 30;
const FLIGHT_ANALYSIS_INTERVAL = 1 / 75;
const VOICE_START_SILENCE = .18;
const VOICE_GRACE = .10;
const FLIGHT_TOP_Y = .15;
const FLIGHT_BOTTOM_Y = .84;
const MOTH_RESPONSE_TIME = .075;
const MOTH_VERTICAL_SPEED = 1100;
const TRAINING_TOLERANCE = .25;
const PIANO_ECHO_DELAY_MS = 180;
const PIANO_TUNING_CENTS = [-5, -5, 0, 2, 7];
const MIN_RANGE_RATIO = 2 ** (3 / 12);
const STABLE_NOTE_RATIO = 2 ** (1.35 / 12);
const MAX_FLIGHT_LEVELS = 7;
const RECOIL_DURATION = .34;
const MAX_RECOIL_DISTANCE = 140;
const DIFFICULTY_KEY = "night-flight-difficulty";
const FLIGHT_LEVELS_KEY = "night-flight-levels";
const IMMORTALITY_KEY = "night-flight-immortality";
const PITCH_RANGE_KEY = "night-flight-pitch-range";
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const formatScore = (score) => String(score).padStart(2, "0");

function readNumber(key, fallback, max, min = 0) {
  try {
    const value = localStorage.getItem(key);
    const number = Number(value);
    return value !== null && Number.isInteger(number) && number >= min && number <= max
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

function readSavedPitchRange() {
  try {
    const { low, high } = JSON.parse(localStorage.getItem(PITCH_RANGE_KEY)) ?? {};
    if (!Number.isFinite(low) || !Number.isFinite(high) || low < MIN_PITCH_HZ ||
        high > MAX_PITCH_HZ || high < low * MIN_RANGE_RATIO) return null;

    const notes = naturalNotesInRange(low, high);
    return notes.length >= 2 ? { low, notes } : null;
  } catch {
    return null;
  }
}

function savePitchRange(high) {
  savedPitchRange = pitchRange;
  try {
    localStorage.setItem(PITCH_RANGE_KEY, JSON.stringify({ low: pitchRange.low, high }));
  } catch {
    // Keep the completed calibration for this session if storage is unavailable.
  }
}

let phase = "menu";
let width = 840;
let best = readNumber("night-flight-record", 0, Number.MAX_SAFE_INTEGER);
let difficultyLevel = readNumber(DIFFICULTY_KEY, 5, 10, 1);
let flightLevelCount = Math.min(MAX_FLIGHT_LEVELS, readNumber(FLIGHT_LEVELS_KEY, 5, 10, 2));
let immortalityEnabled = readNumber(IMMORTALITY_KEY, 1, 1) === 1;
let run;
let microphone = null;
let microphoneRequest = 0;
let selectedDevice = "";
let calibration = null;
let savedPitchRange = readSavedPitchRange();
let pitchRange = savedPitchRange ?? { low: null, notes: null };
let sensitivityAmount = readNumber("night-flight-sensitivity", 65, 100);
let voiceFlight;
let trainingLevel = 0;
const trainingPlayback = { player: null, quietUntil: 0, failed: false };
let analysisElapsed = 0;
let waveformTime = 0;

function resetVoiceFlight(silence = 0) {
  voiceFlight = { armed: silence >= VOICE_START_SILENCE, notes: [], pitch: null, voicedFor: 0, silence };
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

function maxAvailableFlightLevels() {
  const { notes } = pitchRange;
  return notes === null ? MAX_FLIGHT_LEVELS : Math.min(MAX_FLIGHT_LEVELS, notes.length);
}

function noteLevelPosition(pitch) {
  const { notes } = run;
  const index = notes.findIndex((note) => note >= pitch);
  const upper = index === -1 ? notes.length - 1 : Math.max(1, index);
  const lower = upper - 1;
  return lower + (pitch - notes[lower]) / (notes[upper] - notes[lower]);
}

function flightLevelSpacing(levelCount) {
  return FIELD_HEIGHT * (FLIGHT_BOTTOM_Y - FLIGHT_TOP_Y) / (levelCount - 1);
}

function flightLevelY(level, levelCount) {
  return FIELD_HEIGHT * FLIGHT_BOTTOM_Y - level * flightLevelSpacing(levelCount);
}

function flightLevelTop(level) {
  return `${(1 - level / (run.levelCount - 1)) * 100}%`;
}

function setMothLevel(level) {
  run.moth.level = level;
  run.moth.y = flightLevelY(level, run.levelCount);
}

function drawFlightPitchLabels() {
  flightPitch.style.setProperty("--flight-pitch-step", `${100 / (run.levelCount - 1)}%`);
  flightPitchLabels.replaceChildren(...run.notes.map((note, level) => {
    const label = document.createElement("span");
    label.className = "flight-pitch-label";
    label.style.top = flightLevelTop(level);
    label.textContent = noteName(note);
    return label;
  }));
}

function noteLabel(frequency) {
  return frequency === null ? "—" : noteName(nearestNaturalNote(frequency));
}

function frequencyLabel(frequency) {
  return frequency === null ? "— Гц" : `${Math.round(frequency)} Гц`;
}

function selectTrainingNote(level) {
  trainingLevel = level;
  for (let i = 0; i < trainingNotes.children.length; i++) {
    trainingNotes.children[i].setAttribute("aria-pressed", String(i === level));
  }
  drawFlightPitch();
}

function stopTrainingPlayback() {
  const { player } = trainingPlayback;
  if (!player) return;
  trainingPlayback.player = null;
  trainingPlayback.quietUntil = performance.now() + PIANO_ECHO_DELAY_MS;
  player.pause();
}

function hearsTrainingPlayback() {
  return trainingPlayback.player !== null || performance.now() < trainingPlayback.quietUntil;
}

function playTrainingNote(level) {
  if (phase !== "training" || document.hidden) return;
  stopTrainingPlayback();
  const note = run.notes[level];
  const octave = clamp(4 + Math.round((note - 69) / 12), 1, PIANO_TUNING_CENTS.length);
  const sampleNote = 69 + (octave - 4) * 12;
  const sampleTuning = PIANO_TUNING_CENTS[octave - 1] / 100;
  const player = new Audio(`assets/piano/A${octave}.wav`);
  player.preservesPitch = false;
  player.playbackRate = 2 ** ((note - sampleNote - sampleTuning) / 12);
  trainingPlayback.player = player;
  trainingPlayback.failed = false;
  resetVoiceFlight();
  analysisElapsed = 0;
  meterFill.style.width = "0%";
  updatePitchDisplay(null);
  selectTrainingNote(level);

  const stop = () => {
    if (trainingPlayback.player === player) stopTrainingPlayback();
  };
  const fail = () => {
    if (trainingPlayback.player !== player) return;
    trainingPlayback.failed = true;
    stopTrainingPlayback();
    drawFlightPitch();
  };
  player.addEventListener("ended", stop);
  player.addEventListener("pause", stop);
  player.addEventListener("error", fail);
  void player.play().catch(fail);
}

function setTrainingFeedback(message, inTune = false) {
  if (trainingFeedback.textContent !== message) trainingFeedback.textContent = message;
  if (trainingFeedback.dataset.inTune !== String(inTune)) trainingFeedback.dataset.inTune = String(inTune);
}

function drawFlightPitch() {
  const training = phase === "training";
  const targetGate = run.gates.find((gate) => !gate.scored);
  const targetLevel = training ? trainingLevel : targetGate?.level;
  const labels = flightPitchLabels.children;
  for (let level = 0; level < labels.length; level++) {
    const label = labels[level];
    const current = String(level === targetLevel);
    if (label.getAttribute("aria-current") !== current) label.setAttribute("aria-current", current);
  }

  let safeTop = targetGate ? targetGate.top + MOTH_RADIUS : null;
  let safeBottom = targetGate ? targetGate.bottom - MOTH_RADIUS : null;
  if (training) {
    const note = run.notes[trainingLevel];
    safeTop = flightLevelY(noteLevelPosition(note + TRAINING_TOLERANCE), run.levelCount);
    safeBottom = flightLevelY(noteLevelPosition(note - TRAINING_TOLERANCE), run.levelCount);
  }
  flightPitchWindow.hidden = safeTop === null;
  if (safeTop !== null) {
    const top = FIELD_HEIGHT * FLIGHT_TOP_Y;
    const height = FIELD_HEIGHT * (FLIGHT_BOTTOM_Y - FLIGHT_TOP_Y);
    const inset = (portion) => training ? `max(-10px, ${portion * 100}%)` : `${clamp(portion, 0, 1) * 100}%`;
    flightPitchWindow.style.top = inset((safeTop - top) / height);
    flightPitchWindow.style.bottom = inset((top + height - safeBottom) / height);
  }

  const frequency = voiceFlight.pitch;
  flightPitchMarker.hidden = frequency === null;
  if (frequency === null) {
    if (training) {
      if (trainingPlayback.failed) setTrainingFeedback("Не удалось проиграть ноту. Попробуй ещё раз.");
      else setTrainingFeedback(hearsTrainingPlayback() ? "Послушай ноту" : "Спой выбранную ноту");
    }
    return;
  }

  const level = noteLevelPosition(noteNumberForPitch(frequency));
  flightPitchMarker.style.setProperty("--pitch-top", flightLevelTop(level));
  const targetY = flightLevelY(training ? level : clamp(level, 0, run.levelCount - 1), run.levelCount);
  const inTune = safeTop !== null && targetY > safeTop && targetY < safeBottom;
  if (flightPitchMarker.dataset.inTune !== String(inTune)) flightPitchMarker.dataset.inTune = String(inTune);
  if (training) {
    const direction = targetY > safeBottom ? "Пой выше" : "Пой ниже";
    setTrainingFeedback(inTune ? "В ноте" : direction, inTune);
  }

  const label = `Частота голоса ${frequencyLabel(frequency)}`;
  if (flightPitchMarker.getAttribute("aria-label") !== label) flightPitchMarker.setAttribute("aria-label", label);
}

function updatePitchDisplay(frequency) {
  const calibrating = phase === "calibrating";
  const label = calibrating ? frequencyLabel(frequency) : noteLabel(frequency);
  if (pitchValue.textContent !== label) pitchValue.textContent = label;
  if (calibrating && calibrationNote.textContent !== label) calibrationNote.textContent = label;
  const { notes } = pitchRange;
  const hasPosition = frequency !== null && notes !== null;
  pitchMarker.hidden = !hasPosition;
  if (hasPosition) {
    const low = notes[0];
    const position = (noteNumberForPitch(frequency) - low) / (notes.at(-1) - low);
    pitchMarker.style.left = `${clamp(position, 0, 1) * 100}%`;
  }
}

function updatePitchRange() {
  const { notes } = pitchRange;
  const low = notes ? noteName(notes[0]) : (pitchRange.low === null ? "Низкая" : frequencyLabel(pitchRange.low));
  const high = notes ? noteName(notes.at(-1)) : "Высокая";
  document.querySelector("#low-note").textContent = low;
  document.querySelector("#high-note").textContent = high;

  const maximum = maxAvailableFlightLevels();
  for (const option of flightLevelsSelect.options) option.disabled = Number(option.value) > maximum;
  flightLevelsSelect.value = String(Math.min(flightLevelCount, maximum));
  flightLevelsHint.hidden = maximum === MAX_FLIGHT_LEVELS;
  flightLevelsHint.textContent = flightLevelsHint.hidden ? "" : `В этом диапазоне доступно до ${maximum} уровней.`;
  flightLevelsSelect.title = flightLevelsHint.textContent;
}

function updateVoiceLegend(silent = false) {
  if (voiceLegend.dataset.silent === String(silent)) return;
  voiceLegend.dataset.silent = String(silent);
  voiceLegend.textContent = silent ? "В тишине высота сохраняется" : "Выше тон — выше полёт";
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

function listensToVoice(currentPhase) {
  return currentPhase === "calibrating" || currentPhase === "ready" || currentPhase === "playing" ||
    ((currentPhase === "over" || currentPhase === "training") && !document.hidden);
}

function setPhase(next) {
  if (next !== "training" || document.hidden) stopTrainingPlayback();
  phase = next;
  analysisElapsed = 0;
  stage.dataset.phase = next;
  overlay.hidden = next === "playing";
  pauseButton.hidden = next !== "playing";
  flightSettings.hidden = next !== "menu" && next !== "ready" && next !== "over";
  Object.values(screens).forEach((screen) => { screen.hidden = screen !== screens[next]; });

  const active = listensToVoice(next);
  if (microphone) {
    microphone.stream.getAudioTracks().forEach((track) => { track.enabled = active; });
    if (!active) {
      meterFill.style.width = "0%";
      updatePitchDisplay(null);
    }
  }
  pitchScale.hidden = microphone === null;
  pitchValueLabel.textContent = next === "calibrating" ? "Частота" : "Нота";
  flightPitch.hidden = next !== "ready" && next !== "training" && next !== "playing" && next !== "paused";
  flightPitchMarker.hidden = true;
  updateVoiceLegend();
  const adjustable = microphone !== null && (next === "ready" || next === "over" || next === "training");
  calibrateButton.disabled = !adjustable;
  deviceSelect.disabled = !adjustable;

  if (next === "connecting") setMicStatus("Подключение");
  else if (next === "calibrating") setMicStatus("Калибровка", "on");
  else if (microphone) setMicStatus(active ? "Слушает" : "На паузе", active ? "on" : "off");
  else setMicStatus("Выключен");
}

function resetRun() {
  const levelCount = Math.min(flightLevelCount, maxAvailableFlightLevels());
  const { notes } = pitchRange;
  run = {
    elapsed: 0,
    score: 0,
    levelCount,
    notes: notes ? Array.from({ length: levelCount }, (_, level) =>
      notes[Math.round((notes.length - 1) * level / (levelCount - 1))]) : [],
    moth: { x: mothX(), tilt: 0 },
    gates: [],
    recoil: null,
  };
  setMothLevel((run.levelCount - 1) / 2);
  drawFlightPitchLabels();
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
  stopTrainingPlayback();
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
  pitchRange = savedPitchRange ?? { low: null, notes: null };
  updatePitchRange();
  updatePitchDisplay(null);
}

function returnToMenu({ focus = true } = {}) {
  releaseMicrophone();
  showMicError();
  resetRun();
  setPhase("menu");
  if (focus) voiceButton.focus();
}

function prepareFlight(destination = "ready") {
  resetRun();
  resetVoiceFlight();
  setPhase(destination);
  if (destination === "training") {
    trainingPlayback.failed = false;
    trainingNotes.replaceChildren(...run.notes.map((note, level) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button secondary training-note";
      button.textContent = noteName(note);
      button.title = `Проиграть ${button.textContent}`;
      button.setAttribute("aria-label", button.title);
      button.addEventListener("click", () => playTrainingNote(level));
      return button;
    }));
    selectTrainingNote(0);
    trainingTitle.focus({ preventScroll: true });
  } else {
    readyTitle.focus({ preventScroll: true });
  }
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
      return "Не удалось подключить микрофон. Проверь подключение и попробуй снова.";
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

async function startVoice(deviceId = selectedDevice, destination = "ready") {
  releaseMicrophone();
  showMicError();
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !Audio) {
    showMicError("Открой игру через localhost или HTTPS в браузере с доступом к микрофону.");
    return;
  }

  const request = microphoneRequest;
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
        showMicError("Микрофон отключился. Подключи его снова и попробуй ещё раз.");
      });
    });
    if (pitchRange.notes) prepareFlight(destination);
    else beginCalibration(destination);
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

function beginCalibration(destination = "ready") {
  if (!microphone) return;
  pitchRange = { low: null, notes: null };
  resetRun();
  setPhase("calibrating");
  updatePitchRange();
  updatePitchDisplay(null);
  calibration = { destination };
  showCalibrationStep("low");
}

function showCalibrationStep(note, message = "") {
  calibration.note = note;
  calibration.capture = null;
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
  const { note, capture, destination } = calibration;
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
    const notes = naturalNotesInRange(pitchRange.low, calibrated);
    if (notes.length < 2) {
      showCalibrationStep("high", "Нужно хотя бы две ноты из До, Ре, Ми, Фа, Соль, Ля и Си. Попробуй взять ноту выше.");
      return;
    }
    pitchRange.notes = notes;
    savePitchRange(calibrated);
    updatePitchRange();
    calibration = null;
    prepareFlight(destination);
  }
}

function trackPitch(frequency, delta) {
  const waitingForNote = phase === "ready" || phase === "over";
  if (frequency === null) {
    voiceFlight.voicedFor = 0;
    voiceFlight.silence += delta;
    const grace = waitingForNote ? VOICE_START_SILENCE : VOICE_GRACE;
    if (voiceFlight.silence >= grace) {
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
    if (waitingForNote && voiceFlight.armed && voiceFlight.voicedFor >= .09) {
      if (phase === "over") resetRun();
      startFlight();
    }
  }
  if (phase === "playing") updateVoiceLegend(voiceFlight.pitch === null);
}

function updateVoice(delta) {
  if (!microphone || !listensToVoice(phase) || hearsTrainingPlayback()) return;
  analysisElapsed += delta;
  const liveFlight = phase === "playing" || phase === "training";
  const analysisInterval = liveFlight ? FLIGHT_ANALYSIS_INTERVAL : ANALYSIS_INTERVAL;
  if (analysisElapsed < analysisInterval) return;
  const interval = analysisElapsed;
  analysisElapsed = 0;
  const { analyser, samples, analyze } = microphone;
  analyser.getFloatTimeDomainData(samples);
  const { level, frequency } = analyze(samples, minimumMicLevel());
  meterFill.style.width = `${meterPosition(level)}%`;
  if (phase === "calibrating") updateCalibration(frequency, interval);
  else trackPitch(frequency, interval);
  updatePitchDisplay(phase === "playing" || phase === "training" ? voiceFlight.pitch : frequency);
}

function pickGateLevel(previousLevel) {
  const { unusedLevels, levelChange } = run.course;
  const distance = (run.levelCount - 1) * levelChange * (.8 + .2 * Math.random());
  const targetShift = Math.max(1, Math.floor(distance + Math.random()));
  const options = [...unusedLevels].filter((level) => level !== previousLevel);
  const difference = (level) => Math.abs(Math.abs(level - previousLevel) - targetShift);
  const minimum = Math.min(...options.map(difference));
  const closest = options.filter((level) => difference(level) === minimum);
  return closest[Math.floor(Math.random() * closest.length)];
}

function addGate(x) {
  const { unusedLevels, halfGap } = run.course;
  if (unusedLevels.size === 0) {
    for (let level = 0; level < run.levelCount; level++) unusedLevels.add(level);
  }
  const previous = run.gates.at(-1);
  const level = previous ? pickGateLevel(previous.level) : Math.round(run.moth.level);
  unusedLevels.delete(level);

  const center = flightLevelY(level, run.levelCount);
  run.gates.push({
    x,
    level,
    top: Math.max(LANTERN_HEIGHT, center - halfGap),
    bottom: Math.min(FIELD_HEIGHT - LANTERN_HEIGHT, center + halfGap),
    phase: Math.random() * Math.PI * 2,
    scored: false,
  });
}

function fillCourse() {
  if (run.gates.length === 0) addGate(Math.min(width + 37, run.moth.x + 395));
  while (run.gates.at(-1).x < width + 32) {
    addGate(run.gates.at(-1).x + run.course.spacing + Math.random() * 48);
  }
}

function startFlight() {
  const level = difficultyLevel - 1;
  const difficulty = level / 9;
  const tolerance = Math.min(70 - 20 * difficulty, flightLevelSpacing(run.levelCount) * (.48 - .12 * difficulty));
  run.course = {
    speed: 130 + level * 12,
    spacing: 337 - level * 9,
    levelChange: .2 + difficulty * .8,
    halfGap: MOTH_RADIUS + tolerance,
    unusedLevels: new Set(),
    immortal: immortalityEnabled,
  };
  setMothLevel(clamp(noteLevelPosition(noteNumberForPitch(voiceFlight.pitch)), 0, run.levelCount - 1));
  fillCourse();
  setPhase("playing");
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
  resetVoiceFlight(voiceFlight.silence);
  setPhase("over");
  overTitle.focus({ preventScroll: true });
}

function moveMoth(delta) {
  if (delta <= 0) return;
  const { moth, levelCount } = run;
  const response = 1 - Math.exp(-delta / MOTH_RESPONSE_TIME);
  const previousY = moth.y;
  if (voiceFlight.pitch !== null) {
    const target = clamp(noteLevelPosition(noteNumberForPitch(voiceFlight.pitch)), 0, levelCount - 1);
    const maxStep = MOTH_VERTICAL_SPEED * delta / flightLevelSpacing(levelCount);
    const step = clamp((target - moth.level) * response, -maxStep, maxStep);
    setMothLevel(moth.level + step);
  }
  const tilt = clamp((moth.y - previousY) / (delta * 900), -.28, .28);
  moth.tilt += (tilt - moth.tilt) * response;
}

function updateRecoil(delta) {
  const { recoil } = run;
  const next = Math.min(1, recoil.progress + delta / RECOIL_DURATION);
  const shift = recoil.distance * ((1 - recoil.progress) ** 2 - (1 - next) ** 2);
  for (const gate of run.gates) gate.x += shift;
  recoil.progress = next;
  if (next === 1) run.recoil = null;
}

function updateFlight(delta) {
  if (delta <= 0) return;
  run.elapsed += delta;
  moveMoth(delta);
  if (run.recoil) {
    updateRecoil(delta);
    return;
  }
  const { moth } = run;
  if (moth.y <= 19 + MOTH_RADIUS || moth.y >= FIELD_HEIGHT - 23 - MOTH_RADIUS) {
    finishFlight();
    return;
  }
  const speed = run.course.speed + Math.min(70, run.score * 2.6);
  for (const gate of run.gates) gate.x -= speed * delta;
  for (const gate of run.gates) {
    if (gate.scored) continue;
    const pose = gatePose(gate, run.elapsed);
    if (hitLanterns(moth, pose)) {
      if (run.course.immortal) {
        run.recoil = { progress: 0, distance: Math.min(MAX_RECOIL_DISTANCE, width * .35) };
      } else {
        finishFlight();
      }
      return;
    }
    if (gate.x + LANTERN_WIDTH + MOTH_RADIUS + 8 < moth.x) {
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
document.querySelector("#start-training").addEventListener("click", () => { void startVoice(selectedDevice, "training"); });
document.querySelector("#practice-ready").addEventListener("click", () => prepareFlight("training"));
document.querySelector("#training-to-flight").addEventListener("click", () => prepareFlight());
document.querySelector("#quit-training").addEventListener("click", () => returnToMenu());
captureNoteButton.addEventListener("click", captureNote);
document.querySelector("#cancel-setup").addEventListener("click", () => returnToMenu());
quitReadyButton.addEventListener("click", () => returnToMenu());
document.querySelector("#quit-paused").addEventListener("click", () => returnToMenu());
document.querySelector("#quit-over").addEventListener("click", () => returnToMenu());
pauseButton.addEventListener("click", togglePause);
resumeButton.addEventListener("click", togglePause);
calibrateButton.addEventListener("click", () => beginCalibration(phase === "training" ? "training" : "ready"));
deviceSelect.addEventListener("change", () => {
  void startVoice(deviceSelect.value, phase === "training" ? "training" : "ready");
});
difficultySelect.addEventListener("change", () => {
  difficultyLevel = Number(difficultySelect.value);
  storeNumber(DIFFICULTY_KEY, difficultyLevel);
});
flightLevelsSelect.addEventListener("change", () => {
  flightLevelCount = Number(flightLevelsSelect.value);
  storeNumber(FLIGHT_LEVELS_KEY, flightLevelCount);
  if (phase === "ready") resetRun();
});
immortalityToggle.addEventListener("change", () => {
  immortalityEnabled = immortalityToggle.checked;
  storeNumber(IMMORTALITY_KEY, Number(immortalityEnabled));
});
sensitivity.addEventListener("input", () => {
  sensitivityAmount = Number(sensitivity.value);
  storeNumber("night-flight-sensitivity", sensitivityAmount);
  drawSensitivity();
});

document.addEventListener("keydown", (event) => {
  if (event.target.closest?.("input, select, textarea")) return;
  if (event.code === "Escape" && (phase === "playing" || phase === "paused")) {
    event.preventDefault();
    if (!event.repeat) togglePause();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "playing") togglePause();
  else if (phase === "over" || phase === "training") {
    resetVoiceFlight();
    setPhase(phase);
    if (phase === "training") drawFlightPitch();
  }
});
window.addEventListener("pagehide", () => returnToMenu({ focus: false }));

recordLabel.textContent = formatScore(best);
difficultySelect.value = String(difficultyLevel);
updatePitchRange();
immortalityToggle.checked = immortalityEnabled;
const brandMoth = document.querySelector("#brand-moth");
drawMothEmblem(brandMoth, .65);
document.querySelector('link[rel="icon"]').href = brandMoth.toDataURL();
drawMothEmblem(document.querySelector("#intro-moth"), 1.73);
flightPitch.style.setProperty("--flight-pitch-top", `${FLIGHT_TOP_Y * 100}%`);
flightPitch.style.setProperty("--flight-pitch-bottom", `${100 - FLIGHT_BOTTOM_Y * 100}%`);
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
  else if (phase === "ready" || phase === "training") moveMoth(delta);
  if (phase === "playing" || phase === "ready" || phase === "training") drawFlightPitch();
  drawField(ctx, width, phase, run, waveformTime);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
