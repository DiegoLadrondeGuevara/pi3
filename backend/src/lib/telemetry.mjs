const MODES = new Set(['real', 'simulated', 'unknown']);
const LEVELS = new Set(['NORMAL', 'WARNING', 'CRITICAL']);

export function validateTelemetry(body, expectedDeviceId, now = Date.now()) {
  if (body.schemaVersion !== 1 || body.deviceId !== expectedDeviceId) throw new Error('TELEMETRIA_INVALIDA');
  if (!Number.isSafeInteger(body.sequence) || body.sequence < 0) throw new Error('SECUENCIA_INVALIDA');
  const observedMs = Date.parse(body.observedAt);
  if (!Number.isFinite(observedMs) || Math.abs(now - observedMs) > 120_000) throw new Error('LECTURA_VENCIDA');
  if (body.metric !== 'dust_estimate' || body.unit !== 'ug/m3' || !MODES.has(body.mode)) {
    throw new Error('METRICA_INVALIDA');
  }
  for (const key of ['instant', 'average2s', 'peak2s']) {
    if (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < 0 || body[key] > 100_000) {
      throw new Error('VALOR_INVALIDO');
    }
  }
  if (body.peak2s < body.instant || body.peak2s < body.average2s) throw new Error('PICO_INVALIDO');
  if (!Number.isInteger(body.sampleCount) || body.sampleCount < 1 || body.sampleCount > 1000) {
    throw new Error('MUESTRAS_INVALIDAS');
  }
  if (body.alarmLevel !== null && body.alarmLevel !== undefined && !LEVELS.has(body.alarmLevel)) {
    throw new Error('ALARMA_INVALIDA');
  }
  return {
    schemaVersion: 1,
    deviceId: body.deviceId,
    sequence: body.sequence,
    observedAt: new Date(observedMs).toISOString(),
    mode: body.mode,
    metric: body.metric,
    unit: body.unit,
    instant: body.instant,
    average2s: body.average2s,
    peak2s: body.peak2s,
    sampleCount: body.sampleCount,
    alarmLevel: body.alarmLevel ?? null,
  };
}

export function nextStatus(previous = {}, reading, thresholds = { warning: 75, critical: 150 }) {
  const current = previous.status || 'NO_DATA';
  const value = reading.average2s;
  let target = reading.alarmLevel || (value >= thresholds.critical ? 'CRITICAL' : value >= thresholds.warning ? 'WARNING' : 'NORMAL');
  // Histeresis solo al bajar: evita alternar cerca de un umbral.
  if (!reading.alarmLevel && current === 'CRITICAL' && value >= thresholds.critical * 0.8) target = 'CRITICAL';
  if (!reading.alarmLevel && current === 'WARNING' && target === 'NORMAL' && value >= thresholds.warning * 0.8) target = 'WARNING';

  if (current === 'NO_DATA' || current === 'OFFLINE') {
    return { status: target, candidateLevel: null, candidateCount: 0, changed: current !== target };
  }
  if (target === current) return { status: current, candidateLevel: null, candidateCount: 0, changed: false };
  const rank = { NORMAL: 0, WARNING: 1, CRITICAL: 2 };
  const required = reading.alarmLevel || target === 'CRITICAL' ? 1 : rank[target] > rank[current] ? 2 : 3;
  const count = previous.candidateLevel === target ? (previous.candidateCount || 0) + 1 : 1;
  if (count >= required) return { status: target, candidateLevel: null, candidateCount: 0, changed: true };
  return { status: current, candidateLevel: target, candidateCount: count, changed: false };
}
