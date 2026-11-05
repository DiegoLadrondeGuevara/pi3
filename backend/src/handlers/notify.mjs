import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PublishCommand } from '@aws-sdk/client-sns';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { db, sns } from '../lib/aws.mjs';

export function pushMessage(alert, platform) {
  const labels = {
    WARNING: ['Precaución', 'La lectura de polvo superó el umbral de prueba.'],
    CRITICAL: ['Alerta de polvo', 'Nivel elevado. Revisa el área y avisa al supervisor.'],
    OFFLINE: ['Sensor sin conexión', 'No hay lecturas recientes del dispositivo.'],
    NORMAL: ['Lectura restablecida', 'El estado volvió por debajo del umbral de prueba.'],
  };
  const [title, body] = labels[alert.status] || ['Smart-PPE', 'Nuevo evento del dispositivo.'];
  const data = { alertId: String(alert.alertId), deviceId: String(alert.deviceId), status: String(alert.status) };
  if (platform === 'android') {
    return JSON.stringify({
      default: body,
      GCM: JSON.stringify({ fcmV1Message: { message: {
        notification: { title, body }, data,
        android: { priority: 'high', notification: { channel_id: 'smart-ppe-alerts', sound: 'default' } },
      } } }),
    });
  }
  const aps = { alert: { title, body }, sound: 'default' };
  return JSON.stringify({ default: body, APNS: JSON.stringify({ aps, ...data }), APNS_SANDBOX: JSON.stringify({ aps, ...data }) });
}

export async function handler(event) {
  for (const record of event.Records || []) {
    if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) continue;
    const alert = unmarshall(record.dynamodb.NewImage);
    if (!alert.SK?.startsWith('ALERT#')) continue;
    const result = await db.send(new QueryCommand({
      TableName: process.env.PUSH_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `DEVICE#${alert.deviceId}` },
    }));
    for (const registration of result.Items || []) {
      if (!registration.enabled) continue;
      await sns.send(new PublishCommand({
        TargetArn: registration.endpointArn,
        MessageStructure: 'json',
        Message: pushMessage(alert, registration.platform),
      }));
    }
  }
}
