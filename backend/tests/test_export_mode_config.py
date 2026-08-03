from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import yaml

from celluniverse_backend.config.exposed import ExposedParameterModule
from celluniverse_backend.config.merge import materialize_effective_config
from celluniverse_backend.contracts.models import CreateJobRequest


class ExportModeConfigTest(unittest.TestCase):
    def test_request_defaults_to_full_for_existing_clients(self) -> None:
        request = CreateJobRequest(
            firstFrame=0,
            lastFrame=0,
            inputPath="/tmp/raw",
            initialCsvPath="/tmp/initial.csv",
        )
        self.assertEqual(request.exportMode, "full")

    def test_fixed_export_mode_wins_over_uploaded_yaml(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.yaml"
            destination = root / "job" / "effective-config.yaml"
            source.write_text("simulation:\n  export_mode: full\n", encoding="utf-8")
            module = ExposedParameterModule(
                id="test",
                label="Test",
                baseConfig=str(source),
                groups=[],
            )
            materialize_effective_config(
                source,
                destination,
                module,
                {},
                fixed_overrides={"simulation.export_mode": "compact"},
            )
            data = yaml.safe_load(destination.read_text(encoding="utf-8"))
            self.assertEqual(data["simulation"]["export_mode"], "compact")


if __name__ == "__main__":
    unittest.main()
