import { Amplify } from 'aws-amplify';

export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || '',
  userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID || '',
  clientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || '',
  deviceId: process.env.EXPO_PUBLIC_DEVICE_ID || 'sp32-001',
};

export const configured = Boolean(config.apiUrl && config.userPoolId && config.clientId);

if (configured) {
  Amplify.configure({ Auth: { Cognito: {
    userPoolId: config.userPoolId,
    userPoolClientId: config.clientId,
    loginWith: { email: true },
    signUpVerificationMethod: 'code',
  } } });
}
