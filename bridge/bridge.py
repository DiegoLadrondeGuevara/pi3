"""Lee el firmware actual por USB y envía lotes firmados al backend Smart-PPE."""

from __future__ import annotations

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


LINE_RE = re.compile(
    r"Instantanio:\s*(-?\d+(?:\.\d+)?)\s*ug/m3\s*\|\s*"
    r"Promedio\s*\(2s\):\s*(-?\d+(?:\.\d+)?)\s*ug/m3",
    re.IGNORECASE,
)
MODE_RE = re.compile(r"\|\s*Modo:\s*(real|simulated)\b", re.IGNORECASE)
ALARM_RE = re.compile(r"\|\s*Estado:\s*(NORMAL|WARNING|CRITICAL)\b", re.IGNORECASE)
STATE_FILE = Path(__file__).with_name(".bridge-state.json")
ENV_FILE = Path(__file__).with_name(".env")


def load_local_env() -> None:
    """Carga solo la configuración del puente, sin sobrescribir el entorno del proceso."""
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


def parse_reading(line: str) -> SerialReading | None:
    match = LINE_RE.search(line)
    if not match:
        return None
    instant, average = (float(value) for value in match.groups())
    if not all(float("-inf") < value < float("inf") for value in (instant, average)):
        return None
    mode = MODE_RE.search(line)
    alarm = ALARM_RE.search(line)
    return SerialReading(
        max(0.0, instant), max(0.0, average),
        mode.group(1).lower() if mode else None,
        alarm.group(1).upper() if alarm else None,
    )


def parse_line(line: str) -> tuple[float, float] | None:
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


def save_sequence(device_id: str, sequence: int) -> None:
    temp = STATE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps({"deviceId": device_id, "lastSequence": sequence}), encoding="utf-8")
    temp.replace(STATE_FILE)


def next_sequence(previous: int, offset: float = 0.0, now: float | None = None) -> int:
    """Secuencia creciente aunque se cambie la PC que ejecuta el puente."""
    timestamp = time.time() if now is None else now
    return max(previous + 1, int((timestamp + offset) * 1000))


def choose_serial_port(ports: list) -> str:
    """Prefiere un único CP210x; si hay varios puertos exige selección explícita."""
    if not ports:
        raise ValueError("No se detectaron puertos serie. Conecta el ESP32 y revisa el controlador CP210x.")
    cp210x = [port for port in ports if
              (port.vid, port.pid) == (0x10C4, 0xEA60)
              or "cp210" in (port.description or "").lower()]
    if len(cp210x) == 1:
        return cp210x[0].device
    if len(ports) == 1 and (ports[0].vid is not None or "usb" in (ports[0].description or "").lower()):
        return ports[0].device
    available = ", ".join(f"{port.device} ({port.description})" for port in ports)
    raise ValueError(f"Varios puertos serie: {available}. Indica uno con --port COMx.")


def clock_offset(api_url: str, previous: float = 0.0) -> float:
    """Ajusta el reloj del puente a la fecha HTTPS de API Gateway."""
    started_at = time.time()
    try:
        try:
            response = urlopen(api_url.rstrip("/") + "/", timeout=8)
        except HTTPError as error:
            response = error  # La raíz puede devolver 404 y aun así incluir Date.
        finished_at = time.time()
        header = response.headers.get("Date")
        if not header:
            raise ValueError("La API no devolvió Date")
        server_time = parsedate_to_datetime(header).timestamp()
        return server_time - (started_at + finished_at) / 2
    except (URLError, TimeoutError, ValueError) as error:
        print(f"No se pudo sincronizar la hora con AWS: {error}", file=sys.stderr)
        return previous


def make_batch(device_id: str, sequence: int, mode: str, samples: list[tuple[float, float]], offset: float = 0.0, alarm_level: str | None = None) -> dict:
    latest_instant, latest_average = samples[-1]
    peak = max(max(instant for instant, _ in samples), latest_average)
    return {
        "schemaVersion": 1,
        "deviceId": device_id,
        "sequence": sequence,
        "observedAt": datetime.fromtimestamp(time.time() + offset, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "mode": mode,
        "metric": "dust_estimate",
        "unit": "ug/m3",
        "instant": round(latest_instant, 2),
        "average2s": round(latest_average, 2),
        "peak2s": round(peak, 2),
        "sampleCount": len(samples),
        "alarmLevel": alarm_level,
    }


def send_batch(api_url: str, device_id: str, secret: str, batch: dict, offset: float = 0.0) -> dict:
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


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description="Puente USB del ESP32 hacia Smart-PPE")
    parser.add_argument("--port", default="auto", help="Puerto serie o auto para detectar CP210x")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--device-id", default=os.getenv("DEVICE_ID", "sp32-001"))
    parser.add_argument("--mode", choices=["real", "simulated", "unknown"], default="unknown")
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--dry-run", action="store_true", help="Muestra lotes sin enviarlos a AWS")
    args = parser.parse_args()

    api_url = os.getenv("SMART_PPE_API_URL", "")
    secret = os.getenv("DEVICE_HMAC_KEY", "")
    if not args.dry_run and (not api_url.startswith("https://") or len(secret) < 32):
        parser.error("Configura SMART_PPE_API_URL (HTTPS) y DEVICE_HMAC_KEY (>=32 caracteres) en el entorno")
    if args.interval < 0.5 or args.interval > 30:
        parser.error("--interval debe estar entre 0.5 y 30 segundos")

    try:
        import serial
        from serial.tools import list_ports
    except ImportError:
        print("Falta pyserial: python -m pip install -r requirements.txt", file=sys.stderr)
        return 2

    try:
        port_name = choose_serial_port(list(list_ports.comports())) if args.port.lower() == "auto" else args.port
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2

    sequence = load_sequence(args.device_id)
    print(f"Leyendo {port_name} a {args.baud} baudios; modo={args.mode}; última secuencia={sequence}")
    offset = 0.0 if args.dry_run else clock_offset(api_url)
    next_sync = time.monotonic() + 300
    if abs(offset) > 30:
        print(f"Reloj local desfasado {round(offset)} s; lecturas ajustadas a la hora de AWS")
    try:
        with serial.Serial(port_name, args.baud, timeout=0.3) as port:
            samples: list[tuple[float, float]] = []
            batch_mode = args.mode
            batch_alarm: str | None = None
            window_start = time.monotonic()
            last_sample = window_start
            while True:
                raw = port.readline().decode("utf-8", errors="replace")
                parsed = parse_reading(raw)
                if parsed:
                    detected_mode = parsed.mode or args.mode
                    if samples and detected_mode != batch_mode:
                        samples = []  # No mezclar simulación y sensor en el mismo lote.
                    batch_mode = detected_mode
                    batch_alarm = parsed.alarm_level
                    samples.append((parsed.instant, parsed.average))
                    last_sample = time.monotonic()
                now = time.monotonic()
                if now - window_start < args.interval:
                    continue
                window_start = now
                if not args.dry_run and now >= next_sync:
                    offset = clock_offset(api_url, offset)
                    next_sync = now + 300
                if not samples:
                    if now - last_sample > 5:
                        print("Sin datos serie recientes; revisar USB/ESP32", file=sys.stderr)
                        last_sample = now
                    continue
                sequence = next_sequence(sequence, offset)
                batch = make_batch(args.device_id, sequence, batch_mode, samples, offset, batch_alarm)
                samples = []
                if args.dry_run:
                    print(json.dumps(batch, ensure_ascii=False))
                    continue
                save_sequence(args.device_id, sequence)
                try:
                    result = send_batch(api_url, args.device_id, secret, batch, offset)
                    print(f"seq={sequence} promedio={batch['average2s']} pico={batch['peak2s']} -> {result}")
                except HTTPError as error:
                    try:
                        detail = json.loads(error.read().decode("utf-8")).get("error")
                    except (UnicodeError, ValueError, AttributeError):
                        detail = None
                    reason = f" ({detail})" if isinstance(detail, str) else ""
                    print(f"Envío falló en seq={sequence}: HTTP {error.code}{reason}. Lote descartado para no alertar tarde.", file=sys.stderr)
                except (URLError, TimeoutError, ValueError) as error:
                    print(f"Envío falló en seq={sequence}: {error}. Lote descartado para no alertar tarde.", file=sys.stderr)
    except KeyboardInterrupt:
        print("Puente detenido")
        return 0
    except serial.SerialException as error:
        print(f"No se puede abrir o leer {port_name}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
