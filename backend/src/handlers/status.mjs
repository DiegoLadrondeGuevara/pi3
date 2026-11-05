import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { db } from '../lib/aws.mjs';
import { requireAccess } from '../lib/access.mjs';
import { errorReply, pathDeviceId, reply, workerSub } from '../lib/http.mjs';

export async function handler(event) {
  try {
    const deviceId = pathDeviceId(event);
    await requireAccess(deviceId, workerSub(event));
    const result = await db.send(new GetCommand({
      TableName: process.env.DATA_TABLE,
      Key: { PK: `DEVICE#${deviceId}`, SK: 'STATE' },
      ConsistentRead: true,
    }));
    if (!result.Item) return reply(200, { deviceId, status: 'NO_DATA', stale: true });
    const item = result.Item;
    const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(item.lastSeenAt)) / 1000));
    const stale = ageSeconds > 30;
    return reply(200, {
      deviceId, status: stale ? 'OFFLINE' : item.status,
      stale, ageSeconds,
      metric: item.metric, unit: item.unit,
      instant: item.instant, average2s: item.average2s, peak2s: item.peak2s,
      observedAt: item.observedAt, lastSeenAt: item.lastSeenAt,
      mode: item.mode, thresholds: item.thresholds,
    });
  } catch (error) {
    return errorReply(error);
  }
}
