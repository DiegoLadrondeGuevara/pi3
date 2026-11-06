// Smart-PPE: demostración repetible. NO lee el sensor ni enciende su LED IRED.
// ESP32 a 115200 baudios. Compatible con bridge/bridge.py.
const int pinLedVerde = 25;
const int pinLedAmarillo = 26;
const int pinLedRojo = 33;

const unsigned long samplePeriodUs = 100000;  // 20 muestras = 2 segundos.
const int numReadings = 20;
float readings[numReadings] = {0};
int readIndex = 0;
int filled = 0;
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
  digitalWrite(pinLedRojo, state == CRITICAL ? HIGH : LOW);
}

void updateAlarm(float average) {
  // El promedio suaviza; la histéresis y 5 muestras confirman solo las bajadas.
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

float simulatedDust() {
  // Cada escalón dura 8 s: verde -> amarillo -> rojo -> amarillo -> verde.
  const float levels[] = {0.0f, 100.0f, 200.0f, 100.0f};
  return levels[(millis() / 8000UL) % 4];
}

void setup() {
  Serial.begin(115200);
  pinMode(pinLedVerde, OUTPUT);
  pinMode(pinLedAmarillo, OUTPUT);
  pinMode(pinLedRojo, OUTPUT);
  setLeds(NO_DATA);
  nextSampleUs = micros();
  Serial.println("Smart-PPE | Modo: simulated | ciclo 0-100-200-100 ug/m3");
}

void loop() {
  if ((int32_t)(micros() - nextSampleUs) < 0) return;
  nextSampleUs += samplePeriodUs;
  if ((int32_t)(micros() - nextSampleUs) >= 0) nextSampleUs = micros() + samplePeriodUs;

  const float instant = simulatedDust();
  total -= readings[readIndex];
  readings[readIndex] = instant;
  total += instant;
  readIndex = (readIndex + 1) % numReadings;
  if (filled < numReadings) ++filled;
  if (filled < numReadings) {
    Serial.println("Estado: NO_DATA | Modo: simulated | llenando ventana de 2 s");
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
  Serial.println(" | Modo: simulated");
}
