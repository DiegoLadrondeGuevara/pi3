import { readFileSync } from 'node:fs';
import { CreatePlatformApplicationCommand, SNSClient } from '@aws-sdk/client-sns';

const credentialPath = process.argv[2];
const name = process.argv[3] || 'smart-ppe-dev-android';
if (!credentialPath) {
  console.error('Uso: node scripts/setup-push-android.mjs <firebase-service-account.json> [nombre]');
  process.exit(2);
}
if (!/^[a-zA-Z0-9_.-]{1,256}$/.test(name)) throw new Error('Nombre SNS inválido');
const credentials = JSON.parse(readFileSync(credentialPath, 'utf8'));
if (credentials.type !== 'service_account' || !credentials.project_id || !credentials.private_key || !credentials.client_email) {
  throw new Error('Se requiere el JSON de cuenta de servicio FCM HTTP v1, no google-services.json');
}
const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const result = await sns.send(new CreatePlatformApplicationCommand({
  Name: name,
  Platform: 'GCM',
  Attributes: {
    PlatformPrincipal: 'none',
    PlatformCredential: JSON.stringify(credentials),
  },
}));
console.log(`SNS_ANDROID_APP_ARN=${result.PlatformApplicationArn}`);
