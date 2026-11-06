// Smart-PPE: lectura analógica de un sensor óptico tipo GP2Y1010AU0F.
// Antes de habilitar: identificar modelo, alimentación, salida Vo y divisor de
// voltaje. El sensor de la foto NO está identificado con certeza.
const int measurePin = 34;  // Salida Vo acondicionada hacia ADC1 del ESP32.
const int ledPower = 27;    // Control del LED IRED, activo en LOW.
const int pinLedVerde = 25;
const int pinLedAmarillo = 26;
const int pinLedRojo = 33;

// BLOQUEO INTENCIONAL: rellenar estos datos después de medir el circuito.
const bool wiringVerified = false;
const float sensorVoltsPerAdcVolt = 0.0f;  // Vo_sensor / voltaje_GPIO34.

// Valores de partida del código del compañero, NO calibración confirmada.
const float Voclean = 0.60f;
const float K = 0.17f;  // Voltios por 100 ug/m3, pendiente de calibración.

const unsigned long pulsePeriodUs = 10000;  // Pulso óptico cada 10 ms.
const int samplingTimeUs = 280;
const int deltaTimeUs = 40;
const int numReadings = 200;  // 100 Hz x 2 s.
const int reportEvery = 10;   // Una línea serie cada 100 ms.
float readings[numReadings] = {0};
int readIndex = 0;
int filled = 0;
int sampleNumber = 0;
int invalidCount = 0;
float total = 0;
unsigned long nextSampleUs = 0;

enum Alarm { NO_DATA, NORMAL, WARNING, CRITICAL };
Alarm alarmState = NO_DATA;
Alarm pendingState = NO_DATA;
int pendingCount = 0;

const char* alarmName(Alarm state) {
  if (state == NORMAL) return "NORMAL";
  if (state == WARNING) return "WARNING";
  return "CRITICAL";
}

void setLeds(Alarm state) {
  digitalWrite(pinLedVerde, state == NORMAL ? HIGH : LOW);
  digitalWrite(pinLedAmarillo, state == WARNING ? HIGH : LOW);
  // Si no hay datos válidos, rojo encendido: nunca indicar zona segura.
  digitalWrite(pinLedRojo, state == CRITICAL || state == NO_DATA ? HIGH : LOW);
}

void updateAlarm(float average) {
  Alarm target;
  if (alarmState == CRITICAL && average >= 135.0f) target = CRITICAL;
  else if (average > 150.0f) target = CRITICAL;
  else if (alarmState == WARNING && average >= 40.0f) target = WARNING;
  else if (average >= 50.0f) target = WARNING;
  else target = NORMAL;

  if (target == alarmState) {
    pendingState = NO_DATA;
    pendingCount = 0;
  } else if (target > alarmState || alarmState == NO_DATA) {
    alarmState = target;
    pendingState = NO_DATA;
    pendingCount = 0;
  } else {
    pendingCount = pendingState == target ? pendingCount + 1 : 1;
    pendingState = target;
    if (pendingCount >= 5) {
      alarmState = target;
      pendingState = NO_DATA;
      pendingCount = 0;
    }
  }
  setLeds(alarmState);
}

void clearWindow() {
  for (int i = 0; i < numReadings; ++i) readings[i] = 0;
  readIndex = 0;
  filled = 0;
  total = 0;
  alarmState = NO_DATA;
  pendingState = NO_DATA;
  pendingCount = 0;
  setLeds(NO_DATA);
}

void setup() {
  Serial.begin(115200);
  pinMode(ledPower, OUTPUT);
  digitalWrite(ledPower, HIGH);
  pinMode(pinLedVerde, OUTPUT);
  pinMode(pinLedAmarillo, OUTPUT);
  pinMode(pinLedRojo, OUTPUT);
  setLeds(NO_DATA);
  analogReadResolution(12);
  analogSetPinAttenuation(measurePin, ADC_11db);
  nextSampleUs = micros();
}

void loop() {
  if (!wiringVerified || sensorVoltsPerAdcVolt <= 0.0f || K <= 0.0f) {
    // No se activa el IRED ni se envían lecturas hasta verificar el hardware.
    Serial.println("ERROR: verificar modelo, alimentacion, Vo y divisor GPIO34; configurar real.ino");
    delay(2000);
    return;
  }
  if ((int32_t)(micros() - nextSampleUs) < 0) return;
  nextSampleUs += pulsePeriodUs;
  if ((int32_t)(micros() - nextSampleUs) >= 0) nextSampleUs = micros() + pulsePeriodUs;

  const unsigned long pulseStartedAt = micros();
  digitalWrite(ledPower, LOW);
  delayMicroseconds(samplingTimeUs);
  const uint32_t millivolts = analogReadMilliVolts(measurePin);
  // Apagar a los 320 us desde el inicio, descontando el tiempo de conversión.
  while (micros() - pulseStartedAt < (unsigned long)(samplingTimeUs + deltaTimeUs)) {}
  digitalWrite(ledPower, HIGH);
  const bool latePulse = micros() - pulseStartedAt > 350UL;

  // La entrada ADC debe mantenerse dentro del rango medible del ESP32.
  if (latePulse || millivolts < 150 || millivolts >= 3000) {
    if (++invalidCount >= 5) clearWindow();
    if (++sampleNumber % reportEvery == 0) {
      Serial.println("Estado: NO_DATA | Modo: real | ADC fuera de rango o pulso lento; revisar circuito");
    }
    return;
  }
  invalidCount = 0;
  const float voltage = millivolts * sensorVoltsPerAdcVolt / 1000.0f;
  const float instant = voltage > Voclean ? (voltage - Voclean) / K * 100.0f : 0.0f;
  total -= readings[readIndex];
  readings[readIndex] = instant;
  total += instant;
  readIndex = (readIndex + 1) % numReadings;
  if (filled < numReadings) ++filled;
  if (++sampleNumber % reportEvery != 0) return;
  if (filled < numReadings) {
    Serial.println("Estado: NO_DATA | Modo: real | llenando ventana de 2 s");
    return;
  }

  const float average = total / numReadings;
  updateAlarm(average);
  Serial.print("Instantanio: ");
  Serial.print(instant, 1);
  Serial.print(" ug/m3 | Promedio (2s): ");
  Serial.print(average, 1);
  Serial.print(" ug/m3 | Estado: ");
  Serial.print(alarmName(alarmState));
  Serial.println(" | Modo: real");
}
