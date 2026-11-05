import { CognitoJwtVerifier } from 'aws-jwt-verify';

let verifier;

export async function handler(event) {
  try {
    const header = event.headers?.authorization || event.headers?.Authorization || '';
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
    if (!token) return { isAuthorized: false };
    verifier ||= CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID,
      tokenUse: 'access',
      clientId: process.env.COGNITO_CLIENT_ID,
    });
    const payload = await verifier.verify(token);
    return { isAuthorized: true, context: { sub: payload.sub } };
  } catch {
    return { isAuthorized: false };
  }
}
