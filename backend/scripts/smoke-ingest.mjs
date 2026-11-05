import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const apiUrl = process.argv[2]?.replace(/\/$/, '');
if (!/^https:\/\/[a-z0-9-]+\.execute-api\.us-east-1\.amazonaws\.com$/.test(apiUrl || '')) {
  throw new Error('Uso: npm run smoke:ingest -- https://<api-id>.execute-api.us-east-1.amazonaws.com');
}
const settings = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(line => /^[A-Z_]+=/.test(line))
    .map(line => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const deviceId = settings.DEVICE_ID;
const secret = settings.DEVICE_HMAC_KEY;
if (!/^[a-zA-Z0-9-]{1,64}$/.test(deviceId || '') || !secret || secret.length < 32) {
  throw new Error('DEVICE_ID o DEVICE_HMAC_KEY faltante en backend/.env');
}
const path = `/v1/devices/${deviceId}/telemetry`;
const body = JSON.stringify({
  schemaVersion: 1, deviceId, sequence: 0,
  observedAt: new Date().toISOString(), mode: 'simulated',
  metric: 'dust_estimate', unit: 'ug/m3',
  instant: 20, average2s: 20, peak2s: 20, sampleCount: 1,
  alarmLevel: null,
});
const sentAt = String(Date.now());
const signature = createHmac('sha256', secret)
  .update(`${sentAt}\nPOST\n${path}\n${body}`)
  .digest('hex');
const response = await fetch(`${apiUrl}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sent-at': sentAt, 'x-signature': signature },
  body,
});
console.log(`HTTP ${response.status}: ${await response.text()}`);
if (!response.ok) process.exitCode = 1;
