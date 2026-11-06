# Ejecutar el puente Smart-PPE en otra laptop Windows

Este procedimiento mantiene la **simulación que ya está cargada en el ESP32**. No hay que cargar los archivos `ESP32_PMS5003_demo.ino` recibidos: tanto el archivo suelto como el incluido en `Simulacion_ESP32_PMS5003.zip` son idénticos y corresponden a otro sensor, el **PMS5003 por UART**. El equipo de este proyecto usa un **GP2Y1010AU0F analógico**. El ZIP incluye además un simulador HTML independiente de la app Android.

## Una sola vez en la laptop

1. Instala **Git** y **Python 3.10 o superior** para Windows. Durante la instalación de Python, habilita su acceso desde la terminal. Conecta el ESP32 por USB-C a la laptop e instala el controlador CP210x si Windows no crea un puerto COM.
2. Abre PowerShell y clona el proyecto:

   ```powershell
   cd $HOME\Documents
   git clone https://github.com/DiegoLadrondeGuevara/pi3.git
   cd .\pi3\bridge
   ```

3. Copia **privadamente** `bridge/.env` de la PC donde ya funciona el puente a la misma carpeta `bridge` de la laptop. También puedes dejar que el script cree un `.env` desde `.env.example` y pegar allí `DEVICE_HMAC_KEY`. Ese valor debe ser **exactamente el mismo** del backend desplegado. No lo subas a Git, no lo pegues en el chat y no copies credenciales temporales de AWS Academy: el puente usa HTTPS firmado, no la CLI de AWS.

   ```powershell
   notepad .\.env
   ```

   Verifica que `DEVICE_ID=sp32-001` y `SMART_PPE_API_URL=https://rg1jwjgy83.execute-api.us-east-1.amazonaws.com`. No cambies el HMAC si el backend no fue redesplegado con otra clave.

## Cada vez que inicies la práctica

1. Enciende el laboratorio de AWS Academy. En CloudShell puedes verificar que el stack sigue presente:

   ```bash
   aws cloudformation describe-stacks --stack-name smart-ppe-dev --region us-east-1 --query 'Stacks[0].StackStatus' --output text
   ```

   Si responde `UPDATE_COMPLETE` o `CREATE_COMPLETE`, no hace falta desplegarlo de nuevo. La VM EC2 que se usó para desplegar **no necesita permanecer encendida** para recibir lecturas: API Gateway, Lambda y DynamoDB son serverless. Si el stack ya no existe, hay que desplegarlo de nuevo siguiendo el README principal antes de probar el puente. El teléfono debe tener la app instalada y estar vinculado a `sp32-001`.
2. Conecta el ESP32 a la laptop por USB-C y cierra el Monitor Serie de Arduino u otros programas que usen su puerto.
3. En PowerShell, desde `pi3\bridge`, ejecuta:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\start-bridge.ps1
   ```

   La primera vez el script crea `.venv` e instala `pyserial`; en las siguientes reutiliza el entorno. Detecta automáticamente un CP210x aunque no sea `COM3`, comprueba `bridge/.env` sin mostrar la clave, sincroniza la hora con AWS y arranca el puente en modo `simulated` para el firmware actual.

4. Espera líneas como `seq=... -> {'accepted': True, ...}`. Abre la app y pulsa **Actualizar**. Cuando el ciclo pase de normal a alerta, comprueba la notificación Android. Detén el puente con Ctrl+C al terminar.

## Comandos útiles

Ver los puertos serie detectados:

```powershell
.\.venv\Scripts\python.exe -m serial.tools.list_ports -v
```

Si hay más de un CP210x o la detección falla, indica el puerto observado, por ejemplo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-bridge.ps1 -Port COM8
```

Para revisar datos sin enviarlos a AWS:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-bridge.ps1 -DryRun
```

Para traer cambios posteriores del repositorio:

```powershell
cd $HOME\Documents\pi3
git pull --ff-only
cd .\bridge
```

El puente genera secuencias basadas en la hora ajustada con AWS, por lo que cambiar de PC no requiere copiar `.bridge-state.json`. Mantén el reloj de Windows razonablemente sincronizado y cierra el puente en una PC antes de abrirlo en la otra. Si ves `DUPLICADO`, espera unos segundos y comprueba que solo una PC está enviando. Si ves `FIRMA_INVALIDA`, la clave local no coincide con la del backend. Si la app muestra **Sensor sin conexión**, revisa que el puente siga abierto, que el USB aparezca como COM y que el laboratorio esté activo.

La alimentación USB-C desde un cargador puede mantener los LEDs locales, pero **el envío al celular sigue dependiendo del puente en la laptop** hasta que se implemente conectividad Wi-Fi en el ESP32.
