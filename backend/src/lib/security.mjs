import { createHmac, timingSafeEqual } from 'node:crypto';

export function signature(secret, sentAt, method, path, body) {
  return createHmac('sha256', secret)
    .update(`${sentAt}\n${method.toUpperCase()}\n${path}\n${body}`)
    .digest('hex');
}

export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyDeviceRequest(event, secret, now = Date.now()) {
  if (!secret || secret.startsWith('REEMPLAZAR_')) throw new Error('CONFIGURACION_INCOMPLETA');
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const sentAt = headers['x-sent-at'];
  const supplied = headers['x-signature'];
  if (typeof sentAt !== 'string' || !/^\d{13}$/.test(sentAt)) throw new Error('FIRMA_INVALIDA');
  if (Math.abs(now - Number(sentAt)) > 60_000) throw new Error('FIRMA_INVALIDA');
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/i.test(supplied)) throw new Error('FIRMA_INVALIDA');
  const body = event.body || '';
  const method = event.requestContext?.http?.method || 'POST';
  const path = event.rawPath || '';
  if (!equalSecret(signature(secret, sentAt, method, path, body), supplied.toLowerCase())) {
    throw new Error('FIRMA_INVALIDA');
  }
}
