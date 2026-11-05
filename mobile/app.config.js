const { existsSync } = require('node:fs');
const { join } = require('node:path');

const localGoogleServices = join(__dirname, 'google-services.json');
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
  || (existsSync(localGoogleServices) ? localGoogleServices : undefined);

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
});
