import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { db } from './aws.mjs';

export async function requireAccess(deviceId, sub) {
  const result = await db.send(new GetCommand({
    TableName: process.env.DATA_TABLE,
    Key: { PK: `USER#${sub}`, SK: `DEVICE#${deviceId}` },
  }));
  if (!result.Item) throw new Error('SIN_ACCESO');
}
