import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStatus, validateTelemetry } from '../src/lib/telemetry.mjs';
import { signature, verifyDeviceRequest } from '../src/lib/security.mjs';
import { pushMessage } from '../src/handlers/notify.mjs';

const reading = (average2s, alarmLevel = null) => ({ average2s, alarmLevel });

test('el nivel de precaución exige dos lotes, el crítico es inmediato y bajar exige tres', () => {
  let state = { status: 'NORMAL' };
  let next = nextStatus(state, reading(80));
  assert.equal(next.status, 'NORMAL');
  assert.equal(next.candidateCount, 1);
  next = nextStatus({ ...state, ...next }, reading(80));
  assert.equal(next.status, 'WARNING');
  next = nextStatus({ ...state, ...next }, reading(180));
  assert.equal(next.status, 'CRITICAL');
  state = { ...state, ...next };
  for (let i = 0; i < 2; i++) {
    next = nextStatus(state, reading(0));
    assert.equal(next.status, 'CRITICAL');
    state = { ...state, ...next };
  }
  next = nextStatus(state, reading(0));
  assert.equal(next.status, 'NORMAL');
});

test('un alarmLevel del firmware prevalece sobre los umbrales de demo', () => {
  assert.equal(nextStatus({ status: 'NORMAL' }, reading(5, 'CRITICAL')).status, 'CRITICAL');
});

test('telemetría rechaza antigüedad, pico inválido y métrica no confirmada', () => {
  const now = Date.now();
  const base = {
    schemaVersion: 1, deviceId: 'sp32-001', sequence: 2,
    observedAt: new Date(now).toISOString(), mode: 'unknown',
    metric: 'dust_estimate', unit: 'ug/m3',
    instant: 10, average2s: 9, peak2s: 11, sampleCount: 20, alarmLevel: null,
  };
  assert.equal(validateTelemetry(base, 'sp32-001', now).sequence, 2);
  assert.throws(() => validateTelemetry({ ...base, observedAt: new Date(now - 200_000).toISOString() }, 'sp32-001', now), /LECTURA_VENCIDA/);
  assert.throws(() => validateTelemetry({ ...base, peak2s: 8 }, 'sp32-001', now), /PICO_INVALIDO/);
  assert.throws(() => validateTelemetry({ ...base, metric: 'pm25' }, 'sp32-001', now), /METRICA_INVALIDA/);
});

test('firma HMAC válida, firma alterada y marca de tiempo vencida', () => {
  const secret = 'a'.repeat(32);
  const now = Date.now();
  const sentAt = String(now);
  const path = '/v1/devices/sp32-001/telemetry';
  const body = '{"x":1}';
  const event = {
    headers: { 'x-sent-at': sentAt, 'x-signature': signature(secret, sentAt, 'POST', path, body) },
    requestContext: { http: { method: 'POST' } }, rawPath: path, body,
  };
  assert.doesNotThrow(() => verifyDeviceRequest(event, secret, now));
  assert.throws(() => verifyDeviceRequest({ ...event, body: '{"x":2}' }, secret, now), /FIRMA_INVALIDA/);
  assert.throws(() => verifyDeviceRequest(event, secret, now + 61_000), /FIRMA_INVALIDA/);
});

test('mensaje SNS contiene alerta y datos para abrir el evento', () => {
  const message = JSON.parse(pushMessage({ alertId: 'abc', deviceId: 'sp32-001', status: 'CRITICAL' }, 'android'));
  const fcm = JSON.parse(message.GCM).fcmV1Message.message;
  assert.equal(fcm.data.alertId, 'abc');
  assert.equal(fcm.android.priority, 'high');
  assert.equal(fcm.android.notification.channel_id, 'smart-ppe-alerts');
});
