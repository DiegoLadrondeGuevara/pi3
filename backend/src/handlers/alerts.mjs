import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db } from '../lib/aws.mjs';
import { requireAccess } from '../lib/access.mjs';
import { errorReply, pathDeviceId, reply, workerSub } from '../lib/http.mjs';

export async function handler(event) {
  try {
    const deviceId = pathDeviceId(event);
    await requireAccess(deviceId, workerSub(event));
    const requested = Number(event.queryStringParameters?.limit || 10);
    const limit = Number.isInteger(requested) ? Math.min(20, Math.max(1, requested)) : 10;
    const result = await db.send(new QueryCommand({
      TableName: process.env.DATA_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `DEVICE#${deviceId}`, ':prefix': 'ALERT#' },
      ScanIndexForward: false,
      Limit: limit,
    }));
    return reply(200, { deviceId, alerts: (result.Items || []).map(({ PK, SK, expiresAt, ...item }) => item) });
  } catch (error) {
    return errorReply(error);
  }
}
