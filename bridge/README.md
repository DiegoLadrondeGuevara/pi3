# Ejecutar Smart-PPE desde una laptop Windows

El único comando de arranque prepara Python, detecta el puerto USB del ESP32, lee sus mediciones en tiempo real y las envía a AWS. No cambia el firmware de la placa. El equipo usa un sensor **GP2Y1010AU0F analógico**; el ejemplo `ESP32_PMS5003_demo.ino` de un PMS5003 UART corresponde a otro sensor.

## Una sola vez en la laptop

1. Instala **Git** y **Python 3.10 o superior** para Windows. Durante la instalación de Python, habilita su acceso desde la terminal. Conecta el ESP32 por USB-C a la laptop e instala el controlador CP210x si Windows no crea un puerto COM.
2. Abre PowerShell y clona el proyecto:

   ```powershell
   cd $HOME\Documents
   git clone https://github.com/DiegoLadrondeGuevara/pi3.git
   cd .\pi3\bridge
   ```

3. Copia **privadamente** `bridge/.env` de la PC donde ya funciona el puente a la misma carpeta `bridge` de la laptop. También puedes ejecutar el script una vez para que cree `.env` desde `.env.example` y pegar allí `DEVICE_HMAC_KEY`. El script corrige automáticamente un archivo llamado `env` sin el punto inicial. Esa clave debe ser **exactamente la misma** del backend desplegado. No la subas a Git ni la pegues en el chat. El puente usa HTTPS firmado, no credenciales de AWS.

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

   La primera vez crea `.venv` e instala `pyserial`; después reutiliza el entorno. Comprueba `.env` sin mostrar la clave, detecta el CP210x aunque no sea `COM3`, sincroniza el reloj con AWS y arranca el puente. Si se desconecta el USB, reintenta el puerto; si falla la red, reintenta el envío. Tras varios fallos seguidos, termina con un diagnóstico. Los lotes que ya quedaron viejos se descartan para evitar alertas retrasadas.

   El modo predeterminado es `unknown` si el firmware no informa `Modo`, porque la placa aún requiere validar calibración. Si el firmware imprime `| Modo: real` o `| Modo: simulated`, el puente usa ese dato. No selecciones `-Mode real` hasta confirmar la conexión y calibración del sensor.

4. Espera líneas como `seq=... -> {'accepted': True, ...}`. Abre la app y pulsa **Actualizar**. Detén el puente con Ctrl+C al terminar. Si la app cambia de estado pero no llega la notificación, revisa el flujo SNS/FCM del backend: el puente ya entregó la lectura.

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

Si `git pull --ff-only` informa que las ramas divergen, **no borres `.env`**. Consulta con el responsable antes de forzar el repositorio; los cambios locales podrían perderse.

El puente genera secuencias basadas en la hora ajustada con AWS, por lo que cambiar de PC no requiere copiar `.bridge-state.json`. Cierra el puente en una PC antes de abrirlo en la otra. Si AWS dice `FIRMA_INVALIDA`, la clave local no coincide con el backend. Si sale `No se detectaron puertos serie`, comprueba cable USB de datos y controlador CP210x. Si el puerto está ocupado, cierra el Monitor Serie de Arduino. Si aparece `no entrega lecturas reconocibles`, confirma que el firmware imprime `Instantáneo: ... ug/m3 | Promedio (2s): ... ug/m3` a 115200 baudios. Si la app muestra **Sensor sin conexión**, revisa que el puente siga abierto y produzca líneas `accepted: True`.

La alimentación USB-C desde un cargador puede mantener los LEDs locales, pero **el envío al celular sigue dependiendo del puente en la laptop** hasta que se implemente conectividad Wi-Fi en el ESP32.
