import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { db } from '../lib/aws.mjs';
import { notifyAlert } from './notify.mjs';

export async function handler() {
  const deviceId = process.env.DEVICE_ID;
  const PK = `DEVICE#${deviceId}`;
  const result = await db.send(new GetCommand({
    TableName: process.env.DATA_TABLE,
    Key: { PK, SK: 'STATE' },
    ConsistentRead: true,
  }));
  const state = result.Item;
  if (!state || state.status === 'OFFLINE' || Date.now() - Date.parse(state.lastSeenAt) <= 30_000) {
    return { changed: false };
  }
  const now = Date.now();
  const occurredAt = new Date(now).toISOString();
  const alertId = `${deviceId}-${state.lastSequence}-OFFLINE`;
  try {
    await db.send(new TransactWriteCommand({ TransactItems: [
      { Put: {
        TableName: process.env.DATA_TABLE,
        Item: { ...state, status: 'OFFLINE', candidateLevel: null, candidateCount: 0 },
        ConditionExpression: 'lastSequence = :seq AND lastSeenAt = :seen AND #status <> :offline',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':seq': state.lastSequence, ':seen': state.lastSeenAt, ':offline': 'OFFLINE' },
      } },
      { Put: {
        TableName: process.env.DATA_TABLE,
        Item: {
          PK, SK: `ALERT#${occurredAt}#${alertId}`, alertId, deviceId,
          status: 'OFFLINE', previousStatus: state.status, reason: 'NO_DATA',
          value: state.average2s, peak: state.peak2s, unit: state.unit,
          mode: state.mode, occurredAt,
          expiresAt: Math.floor(now / 1000) + 90 * 86_400,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      } },
    ] }));
    try {
      await notifyAlert({ alertId, deviceId, status: 'OFFLINE' });
    } catch (pushError) {
      console.error('PUSH_FAILED', { alertId, error: pushError });
    }
    return { changed: true, alertId };
  } catch (error) {
    if (error.name === 'TransactionCanceledException') return { changed: false, reason: 'RACE_OR_DUPLICATE' };
    throw error;
  }
}
