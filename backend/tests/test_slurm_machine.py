from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.contracts.models import (
    CreateJobRequest,
    SlurmJobOptions,
    SlurmNode,
    SlurmNodesResponse,
)
from celluniverse_backend.runners.slurm import (
    _parse_slurm_nodes,
    _parse_slurm_nodes_json,
    validate_slurm_machine,
    write_slurm_script,
)


class SlurmMachineTest(unittest.TestCase):
    def test_request_preserves_selected_machine(self) -> None:
        request = CreateJobRequest(
            firstFrame=0,
            lastFrame=0,
            runner="slurm",
            slurm={"enabled": True, "nodelist": "vulcan"},
        )

        self.assertEqual(request.slurm.nodelist, "vulcan")

    def test_selected_machine_is_written_as_nodelist_directive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job_dir = root / "job"
            job_dir.mkdir()
            config = BackendConfig(
                celluniverse={
                    "celluniverseCppRoot": root / "cpp",
                    "threads": 8,
                },
                limits={"maxThreads": 8},
            )

            script_path = write_slurm_script(
                config,
                ["/path/to/celluniverse", "0", "0"],
                job_dir=job_dir,
                stdout_path=job_dir / "stdout.log",
                stderr_path=job_dir / "stderr.log",
                options=SlurmJobOptions(enabled=True, nodelist="vulcan"),
            )

            script = script_path.read_text(encoding="utf-8")
            self.assertIn("#SBATCH --nodelist=vulcan\n", script)

    def test_omitted_machine_leaves_placement_to_slurm(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job_dir = root / "job"
            job_dir.mkdir()
            config = BackendConfig(
                celluniverse={
                    "celluniverseCppRoot": root / "cpp",
                    "threads": 8,
                },
                limits={"maxThreads": 8},
            )

            script_path = write_slurm_script(
                config,
                ["/path/to/celluniverse", "0", "0"],
                job_dir=job_dir,
                stdout_path=job_dir / "stdout.log",
                stderr_path=job_dir / "stderr.log",
                options=SlurmJobOptions(enabled=True),
            )

            script = script_path.read_text(encoding="utf-8")
            self.assertNotIn("#SBATCH --nodelist=", script)

    def test_slurm_values_reject_batch_script_line_breaks(self) -> None:
        with self.assertRaises(ValidationError):
            SlurmJobOptions(nodelist="vulcan\n#SBATCH --exclusive")

    def test_slurm_values_reject_same_line_option_injection(self) -> None:
        with self.assertRaises(ValidationError):
            SlurmJobOptions(memory="64G --exclusive")

    def test_blank_machine_is_normalized_to_automatic(self) -> None:
        self.assertIsNone(SlurmJobOptions(nodelist="   ").nodelist)

    @patch("celluniverse_backend.runners.slurm.inspect_slurm_nodes")
    def test_selected_machine_is_revalidated_and_supplies_its_partition(self, inventory_mock) -> None:
        inventory_mock.return_value = SlurmNodesResponse(
            available=True,
            nodes=[
                SlurmNode(
                    name="vulcan",
                    partitions=["openlab.p"],
                    state="idle",
                    cpusTotal=224,
                )
            ],
        )

        options = validate_slurm_machine(
            SlurmJobOptions(nodelist="vulcan", nodes=1, cpusPerTask=32)
        )

        self.assertEqual(options.nodelist, "vulcan")
        self.assertEqual(options.partition, "openlab.p")

    def test_specific_machine_requires_one_node(self) -> None:
        with self.assertRaisesRegex(ValueError, "node count of 1"):
            validate_slurm_machine(SlurmJobOptions(nodelist="vulcan", nodes=2))

    @patch("celluniverse_backend.runners.slurm.inspect_slurm_nodes")
    def test_unavailable_machine_is_rejected(self, inventory_mock) -> None:
        inventory_mock.return_value = SlurmNodesResponse(
            available=True,
            nodes=[
                SlurmNode(
                    name="circinus-2",
                    partitions=["openlab.p"],
                    state="down",
                    cpusTotal=24,
                    selectable=False,
                )
            ],
        )

        with self.assertRaisesRegex(ValueError, "currently unavailable"):
            validate_slurm_machine(SlurmJobOptions(nodelist="circinus-2", cpusPerTask=24))

    @patch("celluniverse_backend.runners.slurm.inspect_slurm_nodes")
    def test_machine_memory_capacity_is_enforced(self, inventory_mock) -> None:
        inventory_mock.return_value = SlurmNodesResponse(
            available=True,
            nodes=[
                SlurmNode(
                    name="circinus-2",
                    partitions=["openlab.p"],
                    state="idle",
                    cpusTotal=24,
                    memoryMb=96000,
                )
            ],
        )

        with self.assertRaisesRegex(ValueError, "128G was requested"):
            validate_slurm_machine(
                SlurmJobOptions(nodelist="circinus-2", cpusPerTask=24, memory="128G")
            )

    def test_node_inventory_is_naturally_sorted_and_marks_down_nodes_unavailable(self) -> None:
        nodes = _parse_slurm_nodes(
            "\n".join(
                [
                    "circinus-10|openlab.p*|idle|24|0/24/0/24|96000|(null)|none",
                    "vulcan|openlab.p*|mixed|224|16/208/0/224|512000|(null)|none",
                    "circinus-2|openlab.p*|down*|24|0/0/24/24|96000|(null)|Not responding",
                    "circinus-3|openlab.p*|idle*|24|0/24/0/24|96000|(null)|Not responding",
                    "malformed",
                ]
            )
        )

        self.assertEqual(
            [node.name for node in nodes],
            ["circinus-2", "circinus-3", "circinus-10", "vulcan"],
        )
        self.assertFalse(nodes[0].selectable)
        self.assertEqual(nodes[0].state, "down")
        self.assertFalse(nodes[1].selectable)
        self.assertTrue(nodes[2].selectable)
        self.assertEqual(nodes[3].cpusIdle, 208)
        self.assertEqual(nodes[3].partitions, ["openlab.p"])
        self.assertIsNone(nodes[3].gres)

    def test_json_node_inventory_uses_structured_slurm_fields(self) -> None:
        nodes, diagnostics = _parse_slurm_nodes_json(
            """
            {
              "errors": [],
              "nodes": [
                {
                  "name": "vulcan",
                  "partitions": ["openlab.p"],
                  "state": "idle",
                  "state_flags": [],
                  "cpus": 224,
                  "alloc_cpus": 0,
                  "idle_cpus": 224,
                  "real_memory": 512000,
                  "gres": "",
                  "reason": ""
                },
                {
                  "name": "circinus-2",
                  "partitions": ["openlab.p"],
                  "state": "down",
                  "state_flags": ["NOT_RESPONDING"],
                  "cpus": 24,
                  "alloc_cpus": 0,
                  "idle_cpus": 0,
                  "real_memory": 96000,
                  "gres": "",
                  "reason": "Not responding"
                }
              ]
            }
            """
        )

        self.assertEqual(diagnostics, [])
        self.assertEqual([node.name for node in nodes], ["circinus-2", "vulcan"])
        self.assertFalse(nodes[0].selectable)
        self.assertEqual(nodes[1].cpusOther, 0)
        self.assertTrue(nodes[1].selectable)


if __name__ == "__main__":
    unittest.main()
