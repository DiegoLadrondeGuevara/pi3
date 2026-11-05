import { readFileSync, writeFileSync } from 'node:fs';

const roleArn = process.argv[2];
const sourcePath = new URL('../serverless.yml', import.meta.url);
const outputPath = new URL('../.serverless-aws.yml', import.meta.url);
const source = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const accountId = /^  accountId: ['"]?(\d{12})['"]?$/m.exec(source)?.[1];
const roleAccount = /^arn:aws:iam::(\d{12}):role\/[a-zA-Z0-9+=,.@_/-]+$/.exec(roleArn || '')?.[1];
if (!accountId || roleAccount !== accountId) {
  throw new Error(`Indica el ARN de un rol IAM existente en la cuenta ${accountId || 'configurada'}`);
}

const withoutDashboard = source.replace(/^(org|app):[^\n]*\n/gm, '');
const iamStart = withoutDashboard.indexOf('\n  iam:\n');
const packageStart = withoutDashboard.indexOf('\npackage:\n', iamStart);
if (iamStart < 0 || packageStart < 0) throw new Error('No se encontró el bloque IAM esperado en serverless.yml');
const prepared = withoutDashboard.slice(0, iamStart)
  + `\n  iam:\n    role: ${roleArn}\n`
  + withoutDashboard.slice(packageStart);
writeFileSync(outputPath, prepared, { mode: 0o600 });
console.log('Preparado .serverless-aws.yml con rol existente; org/app originales quedan en serverless.yml.');
