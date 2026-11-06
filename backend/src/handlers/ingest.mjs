import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { db } from '../lib/aws.mjs';
import { errorReply, parseJson, pathDeviceId, reply } from '../lib/http.mjs';
import { verifyDeviceRequest } from '../lib/security.mjs';
import { nextStatus, validateTelemetry } from '../lib/telemetry.mjs';
import { notifyAlert } from './notify.mjs';

const DAY = 86_400;

export async function handler(event) {
  try {
    const deviceId = pathDeviceId(event);
    if (deviceId !== process.env.DEVICE_ID) throw new Error('NO_ENCONTRADO');
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
    const request = { ...event, body };
    verifyDeviceRequest(request, process.env.DEVICE_HMAC_KEY);
    const reading = validateTelemetry(parseJson(body), deviceId);
    const now = Date.now();
    const receivedAt = new Date(now).toISOString();
    const PK = `DEVICE#${deviceId}`;
    const stateResult = await db.send(new GetCommand({
      TableName: process.env.DATA_TABLE,
      Key: { PK, SK: 'STATE' },
      ConsistentRead: true,
    }));
    const previous = stateResult.Item || {};
    if (reading.sequence <= (previous.lastSequence ?? -1)) {
      return reply(202, { accepted: false, reason: 'DUPLICADO', lastSequence: previous.lastSequence });
    }

    const thresholds = previous.thresholds || { warning: 75, critical: 150, kind: 'DEMO' };
    const transition = nextStatus(previous, reading, thresholds);
    const saveHistory = !previous.lastHistoryAt || now - Date.parse(previous.lastHistoryAt) >= 30_000;
    const state = {
      PK, SK: 'STATE', deviceId,
      status: transition.status,
      candidateLevel: transition.candidateLevel,
      candidateCount: transition.candidateCount,
      metric: reading.metric,
      unit: reading.unit,
      instant: reading.instant,
      average2s: reading.average2s,
      peak2s: reading.peak2s,
      sampleCount: reading.sampleCount,
      mode: reading.mode,
      alarmLevel: reading.alarmLevel,
      observedAt: reading.observedAt,
      lastSeenAt: receivedAt,
      lastSequence: reading.sequence,
      lastHistoryAt: saveHistory ? receivedAt : previous.lastHistoryAt,
      thresholds,
    };
    const items = [{ Put: {
      TableName: process.env.DATA_TABLE,
      Item: state,
      ConditionExpression: 'attribute_not_exists(PK) OR lastSequence < :sequence',
      ExpressionAttributeValues: { ':sequence': reading.sequence },
    } }];
    if (saveHistory) {
      items.push({ Put: {
        TableName: process.env.DATA_TABLE,
        Item: {
          PK, SK: `READING#${receivedAt}#${reading.sequence}`,
          deviceId, ...reading, receivedAt,
          expiresAt: Math.floor(now / 1000) + 7 * DAY,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      } });
    }
    let alertId = null;
    if (transition.changed && (transition.status !== 'NORMAL' || previous.status === 'OFFLINE')) {
      alertId = `${deviceId}-${reading.sequence}-${transition.status}`;
      items.push({ Put: {
        TableName: process.env.DATA_TABLE,
        Item: {
          PK, SK: `ALERT#${receivedAt}#${alertId}`,
          alertId, deviceId, status: transition.status,
          previousStatus: previous.status || 'NO_DATA',
          reason: previous.status === 'OFFLINE' ? 'RECOVERED' : 'THRESHOLD',
          value: reading.average2s, peak: reading.peak2s,
          unit: reading.unit, mode: reading.mode, occurredAt: receivedAt,
          expiresAt: Math.floor(now / 1000) + 90 * DAY,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      } });
    }
    try {
      await db.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (error) {
      if (error.name === 'TransactionCanceledException') {
        const latest = await db.send(new GetCommand({
          TableName: process.env.DATA_TABLE, Key: { PK, SK: 'STATE' }, ConsistentRead: true,
        }));
        if (reading.sequence <= (latest.Item?.lastSequence ?? -1)) {
          return reply(202, { accepted: false, reason: 'DUPLICADO' });
        }
      }
      throw error;
    }
    if (alertId) {
      try {
        await notifyAlert({ alertId, deviceId, status: state.status });
      } catch (pushError) {
        console.error('PUSH_FAILED', { alertId, error: pushError });
      }
    }
    return reply(202, { accepted: true, status: state.status, alertId });
  } catch (error) {
    return errorReply(error);
  }
}
