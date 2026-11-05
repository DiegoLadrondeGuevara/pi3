# Smart-PPE · prototipo IoT serverless

ESP32 por USB → puente Python en PC → API Gateway → Lambda → DynamoDB → SNS Mobile Push → app React Native. [Arquitectura y tablas](./ARQUITECTURA.md).

## Estado comprobado

- El ESP32 conectado en Windows aparece como **COM3 / CP210x**, emite a **115200 baudios** y el puente genera lotes cada 2 segundos. El 5 de noviembre de 2026 la prueba mostró repetidamente **1588.2 µg/m³**. Esto verifica el transporte serie, pero **no** la validez ni calibración de la medición.
- `backend/` empaqueta con Serverless Framework **3.40** y sus pruebas locales pasan.
- `mobile/` pasa TypeScript, lint y la exportación del bundle Android; aún no se ha generado un APK ni instalado en un teléfono.
- No se ha desplegado AWS: faltan credenciales, permisos de AWS Academy y datos de cuenta. Tampoco se ha probado push real.

La lectura actual se presenta como **concentración estimada de polvo**. El firmware instalado no ha sido identificado y el archivo `.ino` recibido no coincide con la salida serie. Los umbrales **75/150 µg/m³ son solo de demostración**. No usar la app para determinar exposición ocupacional ni declarar que un área es segura.

## Estructura

- `backend/serverless.yml`: API HTTP, Lambdas, DynamoDB, Cognito y EventBridge.
- `bridge/bridge.py`: lector serie y envío HTTPS firmado HMAC.
- `mobile/`: app Expo / React Native con Amplify Auth, una pantalla y push nativo.

## 1. Preparar AWS

El archivo `backend/serverless.yml` contiene `org: diegoladrondeguevara`, `app: smart-ppe` y el ID de cuenta `176375613060` proporcionados para el despliegue. La organización requiere iniciar sesión en Serverless Dashboard. El ID de cuenta en YAML sirve de referencia; las credenciales AWS activas determinan dónde se despliega. Comprobarlo con `aws sts get-caller-identity` antes de ejecutar `serverless deploy`.

Con `org` activa, ejecutar `npx serverless login` una vez en esta PC con acceso a esa organización. Sin esa sesión, Serverless v3 detiene incluso `serverless package`.

Si aparece `Tenant not found`, comprobar en Serverless Dashboard el **slug real de la organización**: el nombre de usuario y el nombre de organización pueden ser diferentes. Para continuar el despliegue directamente con las credenciales AWS mientras se corrige ese dato, crear una copia local del YAML sin `org` ni `app`:

```bash
sed '/^org:/d; /^app:/d' serverless.yml > .serverless-aws.yml
npx --no-install serverless package --config .serverless-aws.yml
npx --no-install serverless deploy --config .serverless-aws.yml --stage dev --region us-east-1
```

Esta copia queda ignorada por Git; `serverless.yml` conserva los valores proporcionados. Verificar antes `aws sts get-caller-identity` y que la cuenta sea `176375613060`.

En AWS Academy, `voclabs` puede denegar `iam:CreateRole`. Si existe un rol preconfigurado apto para Lambda (por ejemplo, `LabRole`), preparar la copia sin Dashboard **y con ese rol existente**:

```bash
npm run prepare:existing-role -- arn:aws:iam::176375613060:role/LabRole
npx --no-install serverless package --config .serverless-aws.yml
npx --no-install serverless deploy --config .serverless-aws.yml --stage dev --region us-east-1
```

Esto reemplaza las declaraciones de permisos IAM del servicio por el rol indicado. Antes de usarlo, comprobar que el rol confía en `lambda.amazonaws.com`, que el usuario puede ejecutar `iam:PassRole` y que el rol permite DynamoDB, SNS, logs y lectura de DynamoDB Streams. Si la cuenta restringe esos permisos, solicitar un rol apropiado al administrador del laboratorio.

En `backend/`, copiar `.env.example` a `.env` y definir:

```text
DEVICE_ID=sp32-001
DEVICE_HMAC_KEY=<secreto aleatorio de al menos 32 caracteres>
PAIRING_CODE=<código de vinculación largo y privado>
SNS_ANDROID_APP_ARN=<ARN de la aplicación SNS para Android, cuando exista>
SNS_IOS_APP_ARN=<ARN de la aplicación SNS para iOS, cuando exista>
```

El `.env` queda ignorado por Git. Usar **el mismo** `DEVICE_ID` y `DEVICE_HMAC_KEY` en el puente. El código de vinculación se entrega solo a quienes usarán el sensor. No desplegar con los valores `REEMPLAZAR_ANTES_DE_DESPLEGAR`.

```powershell
cd backend
npm ci
npx serverless package
npx serverless deploy --stage dev --region us-east-1
npx serverless info --stage dev --region us-east-1
```

El despliegue crea un API URL y Cognito. Obtener `UserPoolId` y `UserPoolClientId` en los outputs de CloudFormation. Si AWS Academy restringe Cognito, SNS, EventBridge o IAM, la cuenta no podrá desplegar todo el stack sin ajustar permisos. Serverless v3.40 valida `nodejs20.x`; ese runtime requiere migración posterior por su ciclo de soporte.

### Configurar push

Para Android hacen falta **dos archivos distintos** de Firebase: `google-services.json` para compilar la app y el JSON de **cuenta de servicio FCM HTTP v1** para crear una SNS Platform Application tipo `GCM`. Nunca subir ninguno al repositorio. Colocar el ARN resultante en `SNS_ANDROID_APP_ARN` y volver a desplegar. Para iOS se necesitan credenciales APNs y una SNS Platform Application tipo `APNS` o `APNS_SANDBOX`, según la compilación; colocar el ARN en `SNS_IOS_APP_ARN`.

Con credenciales AWS activas y permisos SNS, la aplicación Android se puede crear así, **después** de recibir el JSON de cuenta de servicio:

```powershell
cd backend
npm run setup:push:android -- C:\ruta\privada\firebase-service-account.json
```

CloudFormation no ofrece un recurso nativo para SNS Platform Application, por lo que esta configuración se hace en SNS o mediante su API antes de registrar teléfonos. El resto del backend se despliega con Serverless. Si no se configuran esos ARN, la API de registro responde `PUSH_NO_CONFIGURADO` y la app muestra “Push pendiente”; la consulta de lecturas sigue funcionando.

**Orden recomendado para la prueba:** primer deploy con ambos ARN vacíos → comprobar puente, DynamoDB y pantalla móvil → crear el proyecto Firebase para Android o preparar APNs para iPhone → crear la aplicación de plataforma en SNS y obtener su ARN → rellenar el ARN correspondiente en `backend/.env` → repetir `serverless deploy` → instalar una compilación nativa y probar el push.

## 2. Ejecutar el puente

En Windows, con el ESP32 conectado y sin un monitor serie abierto:

```powershell
cd bridge
python -m pip install -r requirements.txt
python bridge.py --port COM3 --dry-run
```

El modo `--dry-run` comprueba las lecturas y **no envía nada** a AWS. Para enviar:

```powershell
$env:SMART_PPE_API_URL = 'https://<api-id>.execute-api.us-east-1.amazonaws.com'
$env:DEVICE_ID = 'sp32-001'
$env:DEVICE_HMAC_KEY = '<el mismo secreto de backend/.env>'
python bridge.py --port COM3
```

La PC debe permanecer encendida, conectada a Internet y con el proceso abierto. El puente no modifica el firmware y descarta lotes si la red falla, evitando una alerta atrasada. El modo de lectura se mantiene `unknown` hasta verificar el firmware; `--mode simulated` marca explícitamente una demostración. No usar `--mode real` sin confirmar el sensor y su código cargado.

## 3. Compilar la app

En `mobile/`, copiar `.env.example` a `.env` y completar `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_COGNITO_USER_POOL_ID` y `EXPO_PUBLIC_COGNITO_CLIENT_ID` con los outputs del stack. `EXPO_PUBLIC_DEVICE_ID` debe coincidir con el puente.

```powershell
cd mobile
npm ci
npm run typecheck
npm run lint
npx expo start
```

La app tiene registro/inicio de sesión por correo, verificación del correo, vinculación por `PAIRING_CODE`, estado y últimas alertas. Usa Amplify como biblioteca de autenticación para el Cognito creado por Serverless. **AWS Amplify Hosting no hospeda una app nativa**; el build instalable se hace con Expo EAS.

Para recibir push con la app cerrada, crear una **compilación nativa**. Expo Go no sirve para esta prueba en Android. En EAS, configurar `GOOGLE_SERVICES_JSON` como variable de archivo apuntando a `google-services.json` y las cuatro variables `EXPO_PUBLIC_*` para el entorno de build. Después ejecutar:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

La primera compilación pide vincular un proyecto Expo/EAS y configurar credenciales de firma. La app pide permiso de notificaciones en el teléfono, obtiene un token nativo FCM/APNs y lo registra con el backend. El teléfono debe tener conexión; el sonido depende de sus ajustes del sistema. Las notificaciones remotas no son un sistema de alarma de seguridad garantizado.

## Comprobaciones locales

```powershell
cd backend; npm test; npx serverless package
cd ../bridge; python -m unittest -v
cd ../mobile; npm run typecheck; npm run lint
```

La prueba final pendiente requiere AWS Academy y un teléfono: desplegar, iniciar puente, vincular, registrar push y comprobar una transición con la app abierta, en segundo plano y cerrada. Comparar la alerta local del equipo con la móvil **solo** después de obtener el firmware realmente cargado: el protocolo serie actual no incluye el estado de su alarma física.
