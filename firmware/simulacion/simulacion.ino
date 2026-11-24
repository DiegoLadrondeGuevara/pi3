const int measurePin = 34; // Vo (Cable Negro)
const int ledPower   = 27; // LED IRED (Cable Verde)

// Pines para LEDs de Alerta
const int pinLedVerde    = 25;
const int pinLedAmarillo = 26;
const int pinLedRojo     = 33;

// Pin para el Buzzer Activo (Configurado en D14)
const int pinBuzzer      = 14; 

// Tiempos exactos del sensor (Toman 10 ms en total)
const int samplingTime = 280;
const int deltaTime    = 40;
const int sleepTime    = 9680;

// Parámetros de Calibración
float Voclean = 0.60;
float K       = 0.17;

// Promedio móvil ajustado a 100 ms por muestreo
const int numReadings = 20; 
float readings[numReadings];
int readIndex = 0;
float total = 0.0;
float averageDust = 0.0;

// Contador para pitido intermitente sin pausar el sistema
int contadorBuzzer = 0;

void setup() {
  Serial.begin(115200);

  pinMode(ledPower, OUTPUT);
  digitalWrite(ledPower, HIGH);

  pinMode(pinLedVerde, OUTPUT);
  pinMode(pinLedAmarillo, OUTPUT);
  pinMode(pinLedRojo, OUTPUT);
  
  pinMode(pinBuzzer, OUTPUT);
  digitalWrite(pinBuzzer, LOW); // Inicialmente apagado

  analogReadResolution(12);

  for (int i = 0; i < numReadings; i++) {
    readings[i] = 0.0;
  }
}

void loop() {
  // 1. Pulso y lectura analógica (Toma 10 ms)
  digitalWrite(ledPower, LOW);
  delayMicroseconds(samplingTime);

  int voMeasured = analogRead(measurePin);

  delayMicroseconds(deltaTime);
  digitalWrite(ledPower, HIGH);
  delayMicroseconds(sleepTime);

  // 2. Conversión a Voltaje y Densidad (ug/m3)
  float voltage = voMeasured * (3.3 / 4095.0);

  float dustDensity = 0.0;
  if (voltage > Voclean) {
    dustDensity = ((voltage - Voclean) / K) * 100.0;
  }

  // 3. Filtro de Promedio Móvil (20 muestras = 2 segundos)
  total = total - readings[readIndex];
  readings[readIndex] = dustDensity;
  total = total + readings[readIndex];
  readIndex = (readIndex + 1) % numReadings;
  averageDust = total / numReadings;

  // 4. Semáforo de Alerta y Control del Buzzer
  if (averageDust < 50.0) {
    // ESTADO VERDE (Seguro)
    digitalWrite(pinLedVerde, HIGH);
    digitalWrite(pinLedAmarillo, LOW);
    digitalWrite(pinLedRojo, LOW);
    digitalWrite(pinBuzzer, LOW);
    contadorBuzzer = 0;
  } 
  else if (averageDust >= 50.0 && averageDust <= 150.0) {
    // ESTADO AMARILLO (Precaución - Solo visual)
    digitalWrite(pinLedVerde, LOW);
    digitalWrite(pinLedAmarillo, HIGH);
    digitalWrite(pinLedRojo, LOW);
    digitalWrite(pinBuzzer, LOW);
    contadorBuzzer = 0;
  } 
  else {
    // ESTADO ROJO (Peligro - Alerta Visual y Sonora Intermitente)
    digitalWrite(pinLedVerde, LOW);
    digitalWrite(pinLedAmarillo, LOW);
    digitalWrite(pinLedRojo, HIGH);

    // Genera un pitido corto de 100ms cada 10 ciclos (1 segundo)
    contadorBuzzer++;
    if (contadorBuzzer >= 10) {
      digitalWrite(pinBuzzer, HIGH); // Emitir pulso corto
      contadorBuzzer = 0;
    } else {
      digitalWrite(pinBuzzer, LOW);  // Silencio entre pulsos
    }
  }

  // 5. Impresión en Monitor Serie
  Serial.print("Instantáneo: ");
  Serial.print(dustDensity, 1);
  Serial.print(" ug/m3 | Promedio (2s): ");
  Serial.print(averageDust, 1);
  Serial.println(" ug/m3");

  delay(90); // 90 ms + 10 ms del ciclo del sensor = 100 ms total
}