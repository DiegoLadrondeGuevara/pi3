import { CreatePlatformEndpointCommand, SetEndpointAttributesCommand } from '@aws-sdk/client-sns';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { db, sns } from '../lib/aws.mjs';
import { requireAccess } from '../lib/access.mjs';
import { errorReply, parseJson, pathDeviceId, reply, workerSub } from '../lib/http.mjs';

export async function handler(event) {
  try {
    const deviceId = pathDeviceId(event);
    const sub = workerSub(event);
    await requireAccess(deviceId, sub);
    const { platform, token, installationId } = parseJson(event.body);
    if (!['android', 'ios'].includes(platform) || typeof token !== 'string' || token.length < 10 || token.length > 4096) {
      throw new Error('TOKEN_INVALIDO');
    }
    if (typeof installationId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(installationId)) {
      throw new Error('INSTALACION_INVALIDA');
    }
    const platformArn = platform === 'android' ? process.env.SNS_ANDROID_APP_ARN : process.env.SNS_IOS_APP_ARN;
    if (!platformArn) throw new Error('PUSH_NO_CONFIGURADO');
    const created = await sns.send(new CreatePlatformEndpointCommand({
      PlatformApplicationArn: platformArn,
      Token: token,
    }));
    await sns.send(new SetEndpointAttributesCommand({
      EndpointArn: created.EndpointArn,
      Attributes: { Token: token, Enabled: 'true' },
    }));
    await db.send(new PutCommand({
      TableName: process.env.PUSH_TABLE,
      Item: {
        PK: `DEVICE#${deviceId}`,
        SK: `USER#${sub}#INSTALL#${installationId}`,
        endpointArn: created.EndpointArn,
        platform,
        enabled: true,
        tokenUpdatedAt: new Date().toISOString(),
      },
    }));
    return reply(200, { registered: true });
  } catch (error) {
    return errorReply(error);
  }
}
