import unittest
from types import SimpleNamespace

from bridge import choose_serial_port, make_batch, next_sequence, parse_line, parse_reading, sign


class BridgeTests(unittest.TestCase):
    def test_parses_current_firmware_and_clamps_negative_zero(self):
        self.assertEqual(parse_line("Instantanio: 0.0 ug/m3 | Promedio (2s): -0.0 ug/m3"), (0.0, 0.0))
        self.assertEqual(parse_line("Instantanio: 42.1 ug/m3 | Promedio (2s): 38.2 ug/m3"), (42.1, 38.2))
        self.assertIsNone(parse_line("rst:0x1 (POWERON_RESET)"))

    def test_batch_preserves_peak_and_unknown_mode(self):
        batch = make_batch("sp32-001", 3, "unknown", [(100, 80), (20, 60)])
        self.assertEqual(batch["peak2s"], 100)
        self.assertEqual(batch["average2s"], 60)
        self.assertEqual(batch["mode"], "unknown")

    def test_new_firmware_reports_mode_and_led_state(self):
        line = "Instantanio: 200.0 ug/m3 | Promedio (2s): 160.0 ug/m3 | Estado: CRITICAL | Modo: simulated"
        reading = parse_reading(line)
        self.assertEqual(reading, (200.0, 160.0, "simulated", "CRITICAL"))
        batch = make_batch("sp32-001", 4, reading.mode, [(reading.instant, reading.average)], alarm_level=reading.alarm_level)
        self.assertEqual(batch["mode"], "simulated")
        self.assertEqual(batch["alarmLevel"], "CRITICAL")

    def test_warmup_and_errors_are_not_sent_as_readings(self):
        self.assertIsNone(parse_reading("Estado: NO_DATA | Modo: real | Iniciando sensor"))
        self.assertIsNone(parse_reading("ERROR: revisar divisor de voltaje"))

    def test_auto_port_prefers_cp210x_without_assuming_com3(self):
        ports = [
            SimpleNamespace(device="COM7", description="Bluetooth", vid=None, pid=None),
            SimpleNamespace(device="COM8", description="CP210x USB to UART", vid=0x10C4, pid=0xEA60),
        ]
        self.assertEqual(choose_serial_port(ports), "COM8")
        with self.assertRaises(ValueError):
            choose_serial_port(ports[:1])
        with self.assertRaises(ValueError):
            choose_serial_port(ports[:1] + [SimpleNamespace(device="COM9", description="USB serial", vid=None, pid=None)])

    def test_sequence_survives_laptop_switch_and_clock_overlap(self):
        self.assertEqual(next_sequence(42, now=1_800_000_000), 1_800_000_000_000)
        self.assertEqual(next_sequence(1_800_000_000_000, now=1_800_000_000), 1_800_000_000_001)

    def test_hmac_is_stable(self):
        self.assertEqual(len(sign("x" * 32, "1234567890123", "/v1/devices/sp32-001/telemetry", "{}")), 64)


if __name__ == "__main__":
    unittest.main()
