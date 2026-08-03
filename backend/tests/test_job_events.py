from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from celluniverse_backend.api.routes import _stream_job_events


class JobEventStreamTests(unittest.TestCase):
    def test_job_event_stream_skips_existing_history(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            event_path = Path(temp_dir) / "events.ndjson"
            old_event = {"type": "log.line", "payload": {"line": "old"}}
            event_path.write_text(f"{json.dumps(old_event)}\n", encoding="utf-8")
            start_offset = event_path.stat().st_size
            stream = _stream_job_events(event_path, start_offset, poll_interval=0)

            new_event = {"type": "job.updated", "payload": {"state": "running"}}
            with event_path.open("a", encoding="utf-8") as handle:
                handle.write(f"{json.dumps(new_event)}\n")

            try:
                message = next(stream)
            finally:
                stream.close()

            self.assertTrue(message.startswith("event: job.updated\n"))
            self.assertEqual(json.loads(message.split("data: ", 1)[1]), new_event)

    def test_job_event_stream_recovers_after_truncation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            event_path = Path(temp_dir) / "events.ndjson"
            old_event = {"type": "log.line", "payload": {"line": "long historical line"}}
            event_path.write_text(f"{json.dumps(old_event)}\n", encoding="utf-8")
            start_offset = event_path.stat().st_size
            stream = _stream_job_events(event_path, start_offset, poll_interval=0)

            replacement_event = {"type": "job.updated"}
            event_path.write_text(f"{json.dumps(replacement_event)}\n", encoding="utf-8")

            try:
                message = next(stream)
            finally:
                stream.close()

            self.assertEqual(json.loads(message.split("data: ", 1)[1]), replacement_event)


if __name__ == "__main__":
    unittest.main()
