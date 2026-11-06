# Firmware ESP32 para Smart-PPE

Hay dos programas Arduino independientes para el mismo ESP32:

| Programa | Entrada | Uso |
| --- | --- | --- |
| [`simulacion/simulacion.ino`](./simulacion/simulacion.ino) | Niveles fijos 0 → 100 → 200 → 100 µg/m³, cada 8 s | Demostrar LEDs, puente, AWS y notificación. Nunca lee el sensor. |
| [`real/real.ino`](./real/real.ino) | GPIO34 conectado a Vo acondicionado | Leer el sensor óptico y generar una **estimación provisional** de polvo. |

Ambos usan LEDs verde GPIO25, amarillo GPIO26 y rojo GPIO33. El LED IRED del sensor real se controla desde GPIO27 (activo en `LOW`). Los dos imprimen a 115200 baudios líneas compatibles con el puente:

```text
Instantanio: 200.0 ug/m3 | Promedio (2s): 160.0 ug/m3 | Estado: CRITICAL | Modo: simulated
```

El puente detecta `Modo` y `Estado` sin agregar opciones. Los programas esperan a tener una ventana completa de 2 s; durante ese arranque imprimen `NO_DATA`, que no se envía como lectura. El estado cambia al subir a partir de 50 µg/m³ (amarillo) y por encima de 150 µg/m³ (rojo). Para bajar, usan histéresis de 40/135 µg/m³ y cinco evaluaciones consecutivas. **Son umbrales de demostración**, no límites de salud ocupacional.

## Antes de usar el programa real

El compañero confirmó por etiqueta el sensor [Sharp GP2Y1010AU0F](https://global.sharp/products/device/lineup/data/pdf/datasheet/gp2y1010au_e.pdf) y una placa ESP32 DevKit V1 CP2102 de 30 pines con USB-C. Ese sensor requiere 5 V y pulsos de 0,32 ms cada 10 ms, con lectura a los 0,28 ms. El código recibido tomaba una muestra cada 100 ms: servía para mostrar una tendencia, pero no respetaba el ciclo de pulsos de 10 ms. `real.ino` usa ese ciclo y 200 muestras para un promedio de 2 s. Aún no se ha confirmado con mediciones la adaptación de Vo al ADC ni la calibración.

1. Con el equipo apagado, trazar VCC, GND, Vo y control de IRED según el pinout del GP2Y1010AU0F. Verificar el circuito de LED que exige su hoja de datos. El dibujo recibido muestra componentes de 150 Ω y 220 µF, pero no basta para certificar cada conexión física; no inferir el pinout solo por colores.
2. Medir con multímetro el **máximo esperado** de Vo y el voltaje que realmente llega a GPIO34, con tierra común. Si Vo puede superar el rango del ESP32, instalar/verificar un divisor o acondicionamiento antes de encenderlo. El [ADC del ESP32 con atenuación de 11 dB](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html) tiene rango medible aproximado hasta 3100 mV; configurar atenuación no protege de un exceso eléctrico. El sensor Sharp de referencia puede entregar más de 3,4 V. Una medición puntual de Vo bajo polvo no demuestra cuál será su máximo.
3. En `real.ino`, cambiar `wiringVerified` a `true` **solo después** de la comprobación eléctrica y asignar `sensorVoltsPerAdcVolt = Vo_sensor / V_GPIO34`. Por ejemplo, si Vo mide 2,0 V y GPIO34 1,0 V, el factor es `2.0f`. Con los valores sin configurar, el programa deja el IRED apagado, enciende rojo y no envía lecturas.
4. `Voclean = 0.60` y `K = 0.17` son los valores recibidos del compañero. No hay evidencia de una calibración con referencia. Medir aire limpio para ajustar `Voclean` y comparar con un instrumento apropiado antes de ajustar `K` o usar valores como µg/m³. El valor calculado no mide PM2.5, PM10, sílice ni otros contaminantes por separado y no certifica aire seguro.

## Cargar y probar

1. Detener el puente con Ctrl+C y cerrar cualquier monitor serie; solo un programa puede usar COM3.
2. En Arduino IDE, abrir **uno** de los `.ino`, elegir placa ESP32 y puerto COM3, compilar y cargar. No cargar `real.ino` sin completar la verificación anterior.
3. Abrir monitor serie a 115200. En simulación aparecerá `Modo: simulated`; en lectura real, `Modo: real`. Esperar 2 s para la primera lectura válida. Confirmar que los LEDs siguen el estado impreso.
4. Cerrar monitor serie e iniciar el puente desde `bridge/`:

   ```powershell
   .\.venv\Scripts\python.exe -u .\bridge.py --port COM3 --interval 2
   ```

5. La app debe mostrar **Datos simulados** con el primer programa o **Modo real declarado** con el segundo. Una alerta llegará al teléfono cuando el estado cambie, si AWS Academy está activo y el teléfono sigue registrado.

No es necesario volver a desplegar el backend ni reconstruir el APK para reconocer `Modo` y `Estado`: la API ya acepta esos campos. Sí hay que ejecutar la versión **actualizada** del puente Python.
