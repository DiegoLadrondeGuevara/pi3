import { fetchAuthSession } from 'aws-amplify/auth';
import { config } from './amplify';

export type SensorStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE' | 'NO_DATA' | 'SERVICE_ERROR';
export type Status = {
  deviceId: string; status: SensorStatus; stale: boolean;
  average2s?: number; peak2s?: number; instant?: number;
  observedAt?: string; lastSeenAt?: string; mode?: 'real' | 'simulated' | 'unknown';
  thresholds?: { warning: number; critical: number; kind: string };
};
export type Alert = {
  alertId: string; status: SensorStatus; previousStatus: string;
  reason: string; value?: number; peak?: number; occurredAt: string;
};

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
  if (!token) throw new Error('Tu sesión venció. Vuelve a ingresar.');
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('Tu sesión venció. Vuelve a ingresar.');
    if (response.status === 403) throw new Error('Dispositivo sin vincular o acceso denegado.');
    throw new Error(payload.error || `Error de servidor (${response.status}).`);
  }
  return payload as T;
}

const base = `/v1/devices/${encodeURIComponent(config.deviceId)}`;
export const getStatus = () => request<Status>(`${base}/status`);
export const getAlerts = () => request<{ alerts: Alert[] }>(`${base}/alerts?limit=8`);
export const claimDevice = (pairingCode: string) => request<{ assigned: boolean }>(`${base}/claim`, 'POST', { pairingCode });
export const registerPush = (platform: string, token: string, installationId: string) =>
  request<{ registered: boolean }>(`${base}/push-registration`, 'POST', { platform, token, installationId });
