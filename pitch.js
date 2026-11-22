const NATURAL_NOTE_NAMES = { 0: "До", 2: "Ре", 4: "Ми", 5: "Фа", 7: "Соль", 9: "Ля", 11: "Си" };
const MIN_PITCH_HZ = 60;
const MAX_PITCH_HZ = 1100;

function noteNumberForPitch(frequency) {
  return 69 + 12 * Math.log2(frequency / 440);
}

function noteName(noteNumber) {
  return `${NATURAL_NOTE_NAMES[noteNumber % 12]}${Math.floor(noteNumber / 12) - 1}`;
}

function isNaturalNote(noteNumber) {
  return NATURAL_NOTE_NAMES[noteNumber % 12] !== undefined;
}

function nearestNaturalNote(frequency) {
  const pitch = noteNumberForPitch(frequency);
  const note = Math.round(pitch);
  if (isNaturalNote(note)) return note;
  return pitch < note ? note - 1 : note + 1;
}

function naturalNotesInRange(low, high) {
  // Allow for the pitch estimator rounding an in-tune endpoint off the note.
  const tolerance = .07;
  const first = Math.ceil(noteNumberForPitch(low) - tolerance);
  const last = Math.floor(noteNumberForPitch(high) + tolerance);
  const notes = [];
  for (let note = first; note <= last; note++) {
    if (isNaturalNote(note)) notes.push(note);
  }
  return notes;
}

function createPitchAnalyzer(sampleRate, sampleCount) {
  const stride = Math.max(1, Math.round(sampleRate / 12000));
  const rate = sampleRate / stride;
  const signal = new Float32Array(Math.floor(sampleCount / stride));
  const minLag = Math.floor(rate / MAX_PITCH_HZ);
  const maxLag = Math.ceil(rate / MIN_PITCH_HZ);
  const comparisonLength = Math.min(signal.length - maxLag - 1, Math.round(rate * .038));
  const difference = new Float64Array(maxLag + 2);
  difference[0] = 1;

  // YIN's cumulative mean normalized difference, DOI: 10.1121/1.1458024.
  return (samples, minimumLevel) => {
    let mean = 0;
    let energy = 0;
    for (const sample of samples) {
      mean += sample;
      energy += sample * sample;
    }
    mean /= samples.length;
    const level = Math.sqrt(Math.max(0, energy / samples.length - mean * mean));
    if (level < minimumLevel) return { level, frequency: null };

    for (let index = 0; index < signal.length; index++) {
      let sum = 0;
      for (let offset = 0; offset < stride; offset++) sum += samples[index * stride + offset];
      signal[index] = sum / stride;
    }

    let cumulative = 0;
    const start = signal.length - comparisonLength - maxLag - 1;
    for (let lag = 1; lag <= maxLag + 1; lag++) {
      let squared = 0;
      for (let index = start; index < start + comparisonLength; index++) {
        const difference = signal[index] - signal[index + lag];
        squared += difference * difference;
      }
      cumulative += squared;
      difference[lag] = cumulative > 0 ? squared * lag / cumulative : 1;

      const center = difference[lag - 1];
      const before = difference[lag - 2];
      const after = difference[lag];
      if (lag > minLag && center < .16 && center <= before && center <= after) {
        const curvature = 2 * (before - 2 * center + after);
        const offset = curvature > 0 ? (before - after) / curvature : 0;
        const frequency = rate / (lag - 1 + offset);
        if (frequency >= MIN_PITCH_HZ && frequency <= MAX_PITCH_HZ) return { level, frequency };
      }
    }
    return { level, frequency: null };
  };
}
