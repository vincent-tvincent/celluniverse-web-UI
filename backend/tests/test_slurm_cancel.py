from __future__ import annotations

import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.contracts.models import CreateJobRequest
from celluniverse_backend.jobs.manager import JobManager
from celluniverse_backend.runners.slurm import (
    cancel_slurm_job,
    slurm_job_accounting_state,
    slurm_job_state,
)


class SlurmCancelCommandTest(unittest.TestCase):
    @patch("celluniverse_backend.runners.slurm.subprocess.run")
    @patch("celluniverse_backend.runners.slurm.inspect_slurm")
    def test_scancel_success_uses_resolved_binary_and_timeout(
        self,
        inspect_mock,
        run_mock,
    ) -> None:
        inspect_mock.return_value = SimpleNamespace(scancel="/pkg/slurm/bin/scancel")
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="",
            stderr="",
        )

        cancel_slurm_job("12345")

        run_mock.assert_called_once_with(
            ["/pkg/slurm/bin/scancel", "12345"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )

    @patch("celluniverse_backend.runners.slurm.subprocess.run")
    @patch("celluniverse_backend.runners.slurm.inspect_slurm")
    def test_scancel_failure_is_reported(
        self,
        inspect_mock,
        run_mock,
    ) -> None:
        inspect_mock.return_value = SimpleNamespace(scancel="/pkg/slurm/bin/scancel")
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="Access denied\n",
        )

        with self.assertRaisesRegex(
            RuntimeError,
            r"Slurm cancel failed for job 12345: Access denied",
        ):
            cancel_slurm_job("12345")

    @patch("celluniverse_backend.runners.slurm.subprocess.run")
    @patch("celluniverse_backend.runners.slurm.inspect_slurm")
    def test_squeue_timeout_is_bounded_and_strict_mode_reports_it(
        self,
        inspect_mock,
        run_mock,
    ) -> None:
        inspect_mock.return_value = SimpleNamespace(squeue="/pkg/slurm/bin/squeue")
        run_mock.side_effect = subprocess.TimeoutExpired(
            cmd=["squeue"],
            timeout=5,
        )

        self.assertIsNone(slurm_job_state("12345"))
        with self.assertRaisesRegex(RuntimeError, r"state query timed out"):
            slurm_job_state("12345", strict=True)

    @patch("celluniverse_backend.runners.slurm.subprocess.run")
    @patch("celluniverse_backend.runners.slurm.inspect_slurm")
    def test_sacct_reads_the_exact_allocation_state(
        self,
        inspect_mock,
        run_mock,
    ) -> None:
        inspect_mock.return_value = SimpleNamespace(sacct="/pkg/slurm/bin/sacct")
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=(
                "12345|CANCELLED by 41699|\n"
                "12345.batch|CANCELLED|\n"
            ),
            stderr="",
        )

        self.assertEqual(
            slurm_job_accounting_state("12345", strict=True),
            "CANCELLED",
        )


class JobManagerSlurmCancelTest(unittest.TestCase):
    def _manager(self, root: Path) -> JobManager:
        config = BackendConfig(
            celluniverse={
                "celluniverseCppRoot": root / "cpp",
                "threads": 1,
            },
            runtime={
                "runtimeRoot": root / "runtime",
                "maxConcurrentJobs": 1,
            },
            limits={"maxThreads": 1},
        )
        return JobManager(config, Mock())

    def _write_status(
        self,
        manager: JobManager,
        *,
        state: str,
        runner: str,
        slurm_job_id: str | None,
        slurm_state: str | None = None,
        started_at: str | None = None,
    ) -> str:
        job_id = "job_cancel_test"
        manager.job_dir(job_id, create=True)
        manager._write_status_dict(
            job_id,
            {
                "id": job_id,
                "state": state,
                "runner": runner,
                "slurmJobId": slurm_job_id,
                "slurmState": slurm_state,
                "startedAt": started_at,
            },
        )
        return job_id

    def test_submitted_queued_slurm_job_uses_scheduler_cancel(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="queued",
                runner="slurm",
                slurm_job_id="12345",
                slurm_state="PENDING",
            )

            with patch.object(manager, "_start_cancel_thread") as start_cancel:
                status = manager.cancel_job(job_id)

            self.assertEqual(status["state"], "cancelling")
            start_cancel.assert_called_once_with(job_id)

    def test_cancel_waits_for_inflight_slurm_submission_to_return_its_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="running",
                runner="slurm",
                slurm_job_id=None,
            )

            with patch.object(manager, "_start_cancel_thread") as start_cancel:
                status = manager.cancel_job(job_id)

            self.assertEqual(status["state"], "cancelling")
            start_cancel.assert_not_called()

    def test_worker_claim_and_cancel_transition_are_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="queued",
                runner="slurm",
                slurm_job_id=None,
            )
            request = CreateJobRequest(
                firstFrame=0,
                lastFrame=0,
                runner="slurm",
                slurm={"enabled": True},
            )
            job_dir = manager.job_dir(job_id)
            (job_dir / "request.json").write_text(
                request.model_dump_json(),
                encoding="utf-8",
            )
            (job_dir / "argv.json").write_text("[]\n", encoding="utf-8")

            worker_read_status = threading.Event()
            release_worker = threading.Event()
            original_get_status = manager.get_status

            def gated_get_status(target_job_id: str):
                status = original_get_status(target_job_id)
                if (
                    threading.current_thread().name == "claim-worker"
                    and not worker_read_status.is_set()
                ):
                    worker_read_status.set()
                    release_worker.wait(timeout=2)
                return status

            with (
                patch.object(manager, "get_status", side_effect=gated_get_status),
                patch.object(manager, "_run_slurm_job"),
            ):
                worker = threading.Thread(
                    target=manager._run_job,
                    args=(job_id,),
                    name="claim-worker",
                )
                worker.start()
                self.assertTrue(worker_read_status.wait(timeout=2))
                cancel = threading.Thread(
                    target=manager.cancel_job,
                    args=(job_id,),
                    name="cancel-worker",
                )
                cancel.start()
                release_worker.set()
                worker.join(timeout=2)
                cancel.join(timeout=2)

            self.assertFalse(worker.is_alive())
            self.assertFalse(cancel.is_alive())
            status = manager.get_status(job_id)
            self.assertEqual(status["state"], "cancelling")
            self.assertIsNone(status["slurmJobId"])

    def test_backend_only_queued_job_is_cancelled_without_scancel(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="queued",
                runner="slurm",
                slurm_job_id=None,
            )

            with patch.object(manager, "_start_cancel_thread") as start_cancel:
                status = manager.cancel_job(job_id)

            self.assertEqual(status["state"], "cancelled")
            start_cancel.assert_not_called()

    @patch("celluniverse_backend.jobs.manager.cancel_slurm_job")
    def test_successful_scheduler_cancel_sets_terminal_slurm_state(
        self,
        cancel_mock,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="cancelling",
                runner="slurm",
                slurm_job_id="12345",
                slurm_state="RUNNING",
                started_at="2026-07-29T00:00:00+00:00",
            )

            manager._finish_cancel_job(job_id)

            cancel_mock.assert_called_once_with("12345")
            status = manager.get_status(job_id)
            self.assertEqual(status["state"], "cancelled")
            self.assertEqual(status["slurmState"], "CANCELLED")
            self.assertEqual(status["error"], "Cancelled by user")

    @patch(
        "celluniverse_backend.jobs.manager.slurm_job_state",
        return_value="RUNNING",
    )
    @patch(
        "celluniverse_backend.jobs.manager.cancel_slurm_job",
        side_effect=RuntimeError("Slurm cancel failed for job 12345: denied"),
    )
    def test_failed_scheduler_cancel_restores_retryable_state(
        self,
        cancel_mock,
        state_mock,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="cancelling",
                runner="slurm",
                slurm_job_id="12345",
                slurm_state="RUNNING",
                started_at="2026-07-29T00:00:00+00:00",
            )

            manager._finish_cancel_job(job_id)

            cancel_mock.assert_called_once_with("12345")
            state_mock.assert_called_once_with("12345", strict=True)
            status = manager.get_status(job_id)
            self.assertEqual(status["state"], "running")
            self.assertEqual(status["slurmState"], "RUNNING")
            self.assertIn("Slurm cancel failed", status["error"])

    @patch(
        "celluniverse_backend.jobs.manager.cancel_slurm_job",
        side_effect=RuntimeError("Slurm cancel failed for job 12345: already done"),
    )
    def test_cancel_failure_uses_existing_exit_marker(
        self,
        cancel_mock,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="cancelling",
                runner="slurm",
                slurm_job_id="12345",
                slurm_state="RUNNING",
                started_at="2026-07-29T00:00:00+00:00",
            )
            (manager.job_dir(job_id) / "slurm-exit-code.txt").write_text(
                "0\n",
                encoding="utf-8",
            )

            manager._finish_cancel_job(job_id)

            cancel_mock.assert_called_once_with("12345")
            status = manager.get_status(job_id)
            self.assertEqual(status["state"], "completed")
            self.assertEqual(status["slurmState"], "COMPLETED")
            self.assertEqual(status["exitCode"], 0)
            self.assertIsNone(status["error"])

    @patch(
        "celluniverse_backend.jobs.manager.slurm_job_accounting_state",
        return_value="CANCELLED",
    )
    @patch(
        "celluniverse_backend.jobs.manager.slurm_job_state",
        return_value=None,
    )
    @patch(
        "celluniverse_backend.jobs.manager.cancel_slurm_job",
        side_effect=RuntimeError("Slurm cancel timed out for job 12345"),
    )
    def test_cancel_timeout_uses_accounting_to_confirm_terminal_state(
        self,
        cancel_mock,
        state_mock,
        accounting_mock,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="cancelling",
                runner="slurm",
                slurm_job_id="12345",
                slurm_state="RUNNING",
                started_at="2026-07-29T00:00:00+00:00",
            )

            manager._finish_cancel_job(job_id)

            cancel_mock.assert_called_once_with("12345")
            state_mock.assert_called_once_with("12345", strict=True)
            accounting_mock.assert_called_once_with("12345", strict=True)
            status = manager.get_status(job_id)
            self.assertEqual(status["state"], "cancelled")
            self.assertEqual(status["slurmState"], "CANCELLED")

    def test_terminal_cancel_is_not_overwritten_by_stale_monitor_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="cancelled",
                runner="slurm",
                slurm_job_id="12345",
                slurm_state="CANCELLED",
            )

            recorded = manager._record_slurm_state(job_id, "RUNNING")

            self.assertFalse(recorded)
            status = manager.get_status(job_id)
            self.assertEqual(status["state"], "cancelled")
            self.assertEqual(status["slurmState"], "CANCELLED")

    def test_cancel_thread_registration_prevents_duplicate_start(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="cancelling",
                runner="slurm",
                slurm_job_id="12345",
            )
            cancel_thread = Mock()

            with patch(
                "celluniverse_backend.jobs.manager.threading.Thread",
                return_value=cancel_thread,
            ) as thread_class:
                manager._start_cancel_thread(job_id)
                manager._start_cancel_thread(job_id)

            thread_class.assert_called_once()
            cancel_thread.start.assert_called_once_with()

    @patch("celluniverse_backend.jobs.manager.submit_slurm_job", return_value="12345")
    @patch("celluniverse_backend.jobs.manager.write_slurm_script")
    @patch(
        "celluniverse_backend.jobs.manager.validate_slurm_machine",
        side_effect=lambda options: options,
    )
    @patch(
        "celluniverse_backend.jobs.manager.normalize_slurm_options",
        side_effect=lambda options: options,
    )
    @patch("celluniverse_backend.jobs.manager.inspect_slurm")
    def test_submission_persists_id_without_resurrecting_cancelled_state(
        self,
        inspect_mock,
        normalize_mock,
        validate_mock,
        write_script_mock,
        submit_mock,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manager = self._manager(root)
            job_id = self._write_status(
                manager,
                state="cancelling",
                runner="slurm",
                slurm_job_id=None,
            )
            inspect_mock.return_value = SimpleNamespace(
                available=True,
                diagnostics=[],
            )
            write_script_mock.return_value = manager.job_dir(job_id) / "job.sbatch"
            request = CreateJobRequest(
                firstFrame=0,
                lastFrame=0,
                runner="slurm",
                slurm={"enabled": True},
            )
            stdout_path = manager.job_dir(job_id) / "stdout.log"
            stderr_path = manager.job_dir(job_id) / "stderr.log"
            stdout_path.touch()
            stderr_path.touch()
            manager._stop.set()

            with patch.object(manager, "_start_cancel_thread") as start_cancel:
                manager._run_slurm_job(
                    job_id,
                    request,
                    ["/path/to/celluniverse", "0", "0"],
                    stdout_path,
                    stderr_path,
                )

            submit_mock.assert_called_once()
            status = manager.get_status(job_id)
            self.assertEqual(status["state"], "cancelling")
            self.assertEqual(status["slurmJobId"], "12345")
            start_cancel.assert_called_once_with(job_id)

    def test_restart_resumes_submitted_slurm_cancellation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = self._manager(Path(temporary))
            job_id = self._write_status(
                manager,
                state="cancelling",
                runner="slurm",
                slurm_job_id="12345",
                slurm_state="RUNNING",
                started_at="2026-07-29T00:00:00+00:00",
            )
            recovered_thread = Mock()

            with (
                patch(
                    "celluniverse_backend.jobs.manager.threading.Thread",
                    return_value=recovered_thread,
                ) as thread_class,
                patch.object(manager, "_start_cancel_thread") as start_cancel,
            ):
                manager._recover_interrupted_jobs()

            recovered_thread.start.assert_called_once_with()
            thread_class.assert_called_once()
            start_cancel.assert_called_once_with(job_id)


if __name__ == "__main__":
    unittest.main()
