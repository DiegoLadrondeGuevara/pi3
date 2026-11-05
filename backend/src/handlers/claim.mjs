import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { db } from '../lib/aws.mjs';
import { equalSecret } from '../lib/security.mjs';
import { errorReply, parseJson, pathDeviceId, reply, workerSub } from '../lib/http.mjs';

export async function handler(event) {
  try {
    const deviceId = pathDeviceId(event);
    if (deviceId !== process.env.DEVICE_ID) throw new Error('NO_ENCONTRADO');
    const sub = workerSub(event);
    const code = parseJson(event.body).pairingCode;
    if (!process.env.PAIRING_CODE || process.env.PAIRING_CODE.startsWith('REEMPLAZAR_')) {
      throw new Error('CONFIGURACION_INCOMPLETA');
    }
    if (!equalSecret(code, process.env.PAIRING_CODE)) throw new Error('CODIGO_INVALIDO');
    await db.send(new PutCommand({
      TableName: process.env.DATA_TABLE,
      Item: { PK: `USER#${sub}`, SK: `DEVICE#${deviceId}`, role: 'worker', assignedAt: new Date().toISOString() },
    }));
    return reply(200, { assigned: true, deviceId });
  } catch (error) {
    return errorReply(error);
  }
}
