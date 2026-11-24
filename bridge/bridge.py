"""Lee el firmware del ESP32 por USB y envia lotes firmados al backend Smart-PPE."""

import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import NamedTuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


# Acepta el nuevo formato "Instantaneo/Instantáneo" y el formato anterior.
LINE_RE = re.compile(
    r"Instant(?:áneo|aneo|anio):\s*(-?\d+(?:\.\d+)?)\s*ug/m3\s*\|\s*"
    r"Promedio\s*\(\s*2s\s*\):\s*(-?\d+(?:\.\d+)?)\s*ug/m3",
    re.IGNORECASE,
)
MODE_RE = re.compile(r"\|\s*Modo:\s*(real|simulated)\b", re.IGNORECASE)
ALARM_RE = re.compile(r"\|\s*Estado:\s*(NORMAL|WARNING|CRITICAL)\b", re.IGNORECASE)

STATE_FILE = Path(__file__).with_name(".bridge-state.json")
ENV_FILE = Path(__file__).with_name(".env")


def load_local_env():
    """Carga la configuracion local sin sobrescribir variables existentes."""
    try:
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return

    for line in lines:
        key, separator, value = line.strip().partition("=")
        if separator and key in {"DEVICE_ID", "SMART_PPE_API_URL", "DEVICE_HMAC_KEY"}:
            os.environ.setdefault(key, value.strip())


class SerialReading(NamedTuple):
    instant: float
    average: float
    mode: str | None
    alarm_level: str | None


def parse_reading(line: str):
    match = LINE_RE.search(line)
    if not match:
        return None

    instant, average = (float(value) for value in match.groups())

    if not all(float("-inf") < value < float("inf") for value in (instant, average)):
        return None

    mode = MODE_RE.search(line)
    alarm = ALARM_RE.search(line)

    # El firmware nuevo no envia Estado; se calcula usando los mismos
    # umbrales que controlan los LEDs del Arduino.
    if alarm:
        alarm_level = alarm.group(1).upper()
    elif average < 50.0:
        alarm_level = "NORMAL"
    elif average <= 150.0:
        alarm_level = "WARNING"
    else:
        alarm_level = "CRITICAL"

    return SerialReading(
        max(0.0, instant),
        max(0.0, average),
        mode.group(1).lower() if mode else None,
        alarm_level,
    )


def parse_line(line: str):
    """Compatibilidad con consumidores del formato serie anterior."""
    reading = parse_reading(line)
    return (reading.instant, reading.average) if reading else None


def sign(secret: str, sent_at: str, path: str, body: str) -> str:
    message = f"{sent_at}\nPOST\n{path}\n{body}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def load_sequence(device_id: str) -> int:
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if state.get("deviceId") == device_id:
            return int(state.get("lastSequence", -1))
    except (OSError, ValueError, TypeError):
        pass
    return -1


def save_sequence(device_id: str, sequence: int):
    temp = STATE_FILE.with_suffix(".tmp")
    temp.write_text(
        json.dumps({"deviceId": device_id, "lastSequence": sequence}),
        encoding="utf-8",
    )
    temp.replace(STATE_FILE)


def next_sequence(previous: int, offset: float = 0.0, now=None) -> int:
    timestamp = time.time() if now is None else now
    return max(previous + 1, int((timestamp + offset) * 1000))


def choose_serial_port(ports: list) -> str:
    """Prefiere un unico CP210x; si hay varios puertos exige seleccion."""
    if not ports:
        raise ValueError(
            "No se detectaron puertos serie. Conecta el ESP32 y revisa el controlador CP210x."
        )

    cp210x = [
        port for port in ports
        if (port.vid, port.pid) == (0x10C4, 0xEA60)
        or "cp210" in (port.description or "").lower()
    ]

    if len(cp210x) == 1:
        return cp210x[0].device

    if len(ports) == 1 and (
        ports[0].vid is not None or "usb" in (ports[0].description or "").lower()
    ):
        return ports[0].device

    available = ", ".join(
        f"{port.device} ({port.description})" for port in ports
    )
    raise ValueError(f"Varios puertos serie: {available}. Indica uno con --port COMx.")


def clock_offset(api_url: str) -> float:
    """Comprueba la API y ajusta el reloj usando su cabecera Date."""
    started_at = time.time()
    try:
        response = urlopen(api_url.rstrip("/") + "/", timeout=8)
    except HTTPError as error:
        # API Gateway puede responder 404 en / y aun asi estar disponible.
        response = error

    finished_at = time.time()
    header = response.headers.get("Date")
    if not header:
        raise ValueError("La API no devolvio la cabecera Date")
    server_time = parsedate_to_datetime(header).timestamp()
    return server_time - (started_at + finished_at) / 2


def connect_clock(api_url: str, attempts: int = 3) -> float:
    for attempt in range(1, attempts + 1):
        try:
            return clock_offset(api_url)
        except (URLError, TimeoutError, ValueError) as error:
            print(f"AWS no responde (intento {attempt}/{attempts}): {error}", file=sys.stderr)
            if attempt < attempts:
                time.sleep(2)
    raise RuntimeError("No se pudo conectar con AWS. Comprueba Internet, el laboratorio y SMART_PPE_API_URL.")


def make_batch(
    device_id: str,
    sequence: int,
    mode: str,
    samples: list[tuple[float, float]],
    offset: float = 0.0,
    alarm_level: str | None = None,
) -> dict:
    latest_instant, latest_average = samples[-1]
    peak = max(max(instant for instant, _ in samples), latest_average)

    return {
        "schemaVersion": 1,
        "deviceId": device_id,
        "sequence": sequence,
        "observedAt": datetime.fromtimestamp(
            time.time() + offset, timezone.utc
        ).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "mode": mode,
        "metric": "dust_estimate",
        "unit": "ug/m3",
        "instant": round(latest_instant, 2),
        "average2s": round(latest_average, 2),
        "peak2s": round(peak, 2),
        "sampleCount": len(samples),
        "alarmLevel": alarm_level,
    }


def send_batch(
    api_url: str,
    device_id: str,
    secret: str,
    batch: dict,
    offset: float = 0.0,
) -> dict:
    path = f"/v1/devices/{device_id}/telemetry"
    body = json.dumps(batch, ensure_ascii=False, separators=(",", ":"))
    sent_at = str(int((time.time() + offset) * 1000))

    request = Request(
        api_url.rstrip("/") + path,
        data=body.encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Sent-At": sent_at,
            "X-Signature": sign(secret, sent_at, path, body),
        },
        method="POST",
    )

    with urlopen(request, timeout=8) as response:
        return json.load(response)


def error_detail(error: HTTPError) -> str:
    try:
        data = json.loads(error.read().decode("utf-8"))
        return str(data.get("error") or data.get("message") or "")
    except (UnicodeError, ValueError, AttributeError):
        return ""


def deliver_batch(api_url: str, device_id: str, secret: str, batch: dict, offset: float):
    """Reintenta fallos breves; nunca reenvia datos viejos ni oculta fallos de configuracion."""
    for attempt in range(1, 4):
        try:
            result = send_batch(api_url, device_id, secret, batch, offset)
            if result.get("reason") == "DUPLICADO":
                # Otra laptop pudo haber enviado una secuencia mayor.
                batch["sequence"] = max(batch["sequence"] + 1, int(result.get("lastSequence") or 0) + 1)
                if attempt < 3:
                    print("Secuencia repetida; ajustando y reintentando.")
                    continue
            if result.get("accepted") is not True:
                raise RuntimeError(f"AWS no acepto la lectura: {result}")
            return result, offset
        except HTTPError as error:
            detail = error_detail(error)
            if detail == "LECTURA_VENCIDA" and attempt < 3:
                offset = connect_clock(api_url)
                batch["observedAt"] = datetime.fromtimestamp(
                    time.time() + offset, timezone.utc
                ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                print("Hora corregida con AWS; reintentando lectura.")
                continue
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise RuntimeError(f"AWS respondio HTTP {error.code} {detail}. Revisa .env o el laboratorio.") from error
            print(f"AWS respondio HTTP {error.code}; reintento {attempt}/2.", file=sys.stderr)
        except (URLError, TimeoutError) as error:
            if attempt == 3:
                raise RuntimeError(f"No se pudo enviar a AWS tras 3 intentos: {error}") from error
            print(f"Fallo de red; reintento {attempt}/2: {error}", file=sys.stderr)
        time.sleep(attempt)
    raise RuntimeError("No se pudo enviar la lectura")


def read_session(serial_port, args, api_url: str, secret: str, offset: float, sequence: int):
    samples = []
    batch_mode = args.mode
    batch_alarm = None
    window_start = time.monotonic()
    last_valid = window_start
    next_sync = window_start + 300
    first_unparsed = None
    failures = 0

    while True:
        raw = serial_port.readline().decode("utf-8", errors="replace").strip()
        parsed = parse_reading(raw)
        if parsed:
            detected_mode = parsed.mode or args.mode
            if samples and detected_mode != batch_mode:
                samples = []
            batch_mode = detected_mode
            batch_alarm = parsed.alarm_level
            samples.append((parsed.instant, parsed.average))
            last_valid = time.monotonic()
            first_unparsed = None
        elif raw and first_unparsed is None:
            first_unparsed = raw[:120]

        now = time.monotonic()
        if now - last_valid > 12:
            sample = f" Ejemplo recibido: {first_unparsed!r}." if first_unparsed else ""
            raise RuntimeError(f"El ESP32 no entrega lecturas reconocibles en 12 s.{sample} Revisa firmware, USB y 115200 baudios.")
        if now - window_start < args.interval:
            continue
        window_start = now
        if not samples:
            continue

        if not args.dry_run and now >= next_sync:
            try:
                offset = clock_offset(api_url)
            except (URLError, TimeoutError, ValueError) as error:
                print(f"No se pudo actualizar la hora: {error}", file=sys.stderr)
            next_sync = now + 300

        sequence = next_sequence(sequence, offset)
        batch = make_batch(args.device_id, sequence, batch_mode, samples, offset, batch_alarm)
        samples = []
        if args.dry_run:
            print(json.dumps(batch, ensure_ascii=False))
            continue

        try:
            result, offset = deliver_batch(api_url, args.device_id, secret, batch, offset)
            sequence = batch["sequence"]
            save_sequence(args.device_id, sequence)
            failures = 0
            print(f"seq={sequence} promedio={batch['average2s']} pico={batch['peak2s']} -> {result}")
        except RuntimeError as error:
            failures += 1
            print(f"Lectura descartada para evitar alertas atrasadas: {error}", file=sys.stderr)
            if failures >= 3:
                raise RuntimeError("Tres lecturas consecutivas fallaron. " + str(error)) from error


def main() -> int:
    load_local_env()

    parser = argparse.ArgumentParser(
        description="Puente USB del ESP32 hacia Smart-PPE"
    )
    parser.add_argument(
        "--port", default="auto",
        help="Puerto serie o auto para detectar CP210x",
    )
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--device-id", default=os.getenv("DEVICE_ID", "sp32-001"))
    parser.add_argument(
        "--mode", choices=["real", "simulated", "unknown"], default="unknown"
    )
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Muestra lotes sin enviarlos a AWS",
    )
    args = parser.parse_args()

    api_url = os.getenv("SMART_PPE_API_URL", "")
    secret = os.getenv("DEVICE_HMAC_KEY", "")

    if not args.dry_run and (
        not api_url.startswith("https://") or len(secret) < 32
    ):
        parser.error(
            "Configura SMART_PPE_API_URL (HTTPS) y DEVICE_HMAC_KEY "
            "(>=32 caracteres) en el entorno"
        )

    if args.interval < 0.5 or args.interval > 30:
        parser.error("--interval debe estar entre 0.5 y 30 segundos")

    try:
        import serial
        from serial.tools import list_ports
    except ImportError:
        print(
            "Falta pyserial: python -m pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 2

    sequence = load_sequence(args.device_id)
    try:
        offset = 0.0 if args.dry_run else connect_clock(api_url)
        if abs(offset) > 30:
            print(f"Reloj local desfasado {round(offset)} s; lecturas ajustadas a AWS")
        for attempt in range(1, 4):
            try:
                port_name = choose_serial_port(list(list_ports.comports())) if args.port.lower() == "auto" else args.port
                print(f"Leyendo {port_name} a {args.baud} baudios; modo={args.mode}; ultima secuencia={sequence}")
                with serial.Serial(port_name, args.baud, timeout=0.3) as port:
                    read_session(port, args, api_url, secret, offset, sequence)
            except (ValueError, serial.SerialException, RuntimeError) as error:
                if attempt == 3:
                    raise RuntimeError(f"No se pudo mantener la conexion serie tras 3 intentos: {error}") from error
                print(f"Puerto/ESP32: {error} Reintentando ({attempt}/2)...", file=sys.stderr)
                time.sleep(2)
    except KeyboardInterrupt:
        print("Puente detenido")
        return 0
    except RuntimeError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
