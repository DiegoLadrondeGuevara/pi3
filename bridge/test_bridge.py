import unittest

from bridge import make_batch, parse_line, sign


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

    def test_hmac_is_stable(self):
        self.assertEqual(len(sign("x" * 32, "1234567890123", "/v1/devices/sp32-001/telemetry", "{}")), 64)


if __name__ == "__main__":
    unittest.main()
