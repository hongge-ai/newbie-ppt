#!/usr/bin/env python3
"""PPT Master - Agent Bridge Tests

Exercise the runtime protocol through its public functions: run lifecycle,
fence ordering, forward-only stages, inbox answers, and torn-write recovery.

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_agent_bridge

Dependencies:
    None (standard library only)
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import agent_bridge  # noqa: E402


class AgentBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.project = Path(self._tmp.name) / "demo_ppt169_20261101"
        self.project.mkdir()
        self.paths = agent_bridge.Paths(self.project)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def start(self, **kwargs):
        return agent_bridge.start_run(self.project, **kwargs)

    # -- lifecycle ---------------------------------------------------------

    def test_start_writes_lease_and_status(self) -> None:
        result = self.start(surface="web")
        self.assertFalse(result["resumed"])
        self.assertEqual(result["fence"], 1)
        self.assertTrue(self.paths.lease.is_file())
        status = json.loads(self.paths.status.read_text(encoding="utf-8"))
        self.assertEqual(status["run"]["run_id"], result["run_id"])
        self.assertEqual(status["state"], "running")
        self.assertEqual(status["surface"], "web")

    def test_end_releases_the_lease(self) -> None:
        self.start()
        agent_bridge.end_run(self.project, "done")
        self.assertFalse(self.paths.lease.exists())
        view = agent_bridge.effective_state(self.paths)
        self.assertEqual(view["state"], "done")

    def test_resume_keeps_run_id_and_fence(self) -> None:
        first = self.start()
        again = self.start(resume=True)
        self.assertEqual(again["run_id"], first["run_id"])
        self.assertEqual(again["fence"], first["fence"])

    def test_expired_lease_refuses_writes_until_resume(self) -> None:
        with patch.object(agent_bridge, "LEASE_TTL_SECONDS", 0):
            self.start()
        with self.assertRaises(agent_bridge.BridgeError) as caught:
            agent_bridge.set_progress(self.project, 1, 3)
        self.assertEqual(caught.exception.code, agent_bridge.EXIT_LEASE_HELD)
        # Resuming under the normal TTL gives the run a live lease again.
        self.start(resume=True)
        agent_bridge.set_progress(self.project, 1, 3)
        view = agent_bridge.effective_state(self.paths)
        self.assertEqual(view["progress"]["done"], 1)

    # -- workbench task binding -------------------------------------------

    def test_task_binding_survives_resume_and_end(self) -> None:
        first = self.start(task="t20261102-090000-abcd")
        self.assertEqual(first["task_id"], "t20261102-090000-abcd")
        self.assertEqual(
            agent_bridge.effective_state(self.paths)["task_id"],
            "t20261102-090000-abcd",
        )
        resumed = self.start(resume=True)
        self.assertEqual(resumed["task_id"], "t20261102-090000-abcd")
        agent_bridge.end_run(self.project, "done")
        # The lease is gone after run end; the binding lives in the event log
        # so a finished task can still be linked back to its project.
        self.assertEqual(
            agent_bridge.effective_state(self.paths)["task_id"],
            "t20261102-090000-abcd",
        )

    def test_takeover_inherits_the_task_binding(self) -> None:
        self.start(task="t20261102-090000-abcd")
        second = self.start(takeover=True, reason="manual")
        self.assertEqual(second["task_id"], "t20261102-090000-abcd")

    def test_new_run_without_a_task_clears_the_binding(self) -> None:
        self.start(task="t20261102-090000-abcd")
        agent_bridge.end_run(self.project, "done")
        self.start()
        self.assertIsNone(agent_bridge.effective_state(self.paths)["task_id"])

    def test_invalid_task_id_is_rejected(self) -> None:
        with self.assertRaises(agent_bridge.BridgeError) as caught:
            self.start(task="not-a-task-id")
        self.assertEqual(caught.exception.code, agent_bridge.EXIT_USAGE)

    # -- stages ------------------------------------------------------------

    def test_stage_order_is_forward_only(self) -> None:
        self.start()
        agent_bridge.enter_stage(self.project, "execute", label="pages")
        with self.assertRaises(agent_bridge.BridgeError):
            agent_bridge.enter_stage(self.project, "lock")
        view = agent_bridge.effective_state(self.paths)
        self.assertEqual(view["stage"], "execute")
        self.assertEqual(view["stage_index"], 9)

    def test_unknown_stage_is_rejected(self) -> None:
        self.start()
        with self.assertRaises(agent_bridge.BridgeError):
            agent_bridge.enter_stage(self.project, "not-a-stage")

    # -- inbox -------------------------------------------------------------

    def test_ask_then_answer(self) -> None:
        self.start()
        request = agent_bridge.open_request(
            self.project,
            kind="confirm",
            title="Stage 1",
            options=[{"id": "free_design", "label": "自由设计"}],
        )
        waiting = agent_bridge.effective_state(self.paths)
        self.assertEqual(waiting["state"], "waiting_user")
        self.assertEqual(waiting["blocking"]["req_id"], request["id"])

        response = agent_bridge.answer_request(
            self.project, request["id"], choice=["free_design"]
        )
        self.assertEqual(response["status"], "answered")
        running = agent_bridge.effective_state(self.paths)
        self.assertIsNone(running["blocking"])
        self.assertEqual(running["state"], "running")

    def test_second_answer_is_a_conflict(self) -> None:
        self.start()
        request = agent_bridge.open_request(self.project, kind="confirm", title="T")
        agent_bridge.answer_request(self.project, request["id"], choice=["a"])
        with self.assertRaises(agent_bridge.BridgeError) as caught:
            agent_bridge.answer_request(self.project, request["id"], choice=["b"])
        self.assertEqual(caught.exception.code, agent_bridge.EXIT_VERSION_CONFLICT)

    def test_wait_timeout_leaves_the_request_open(self) -> None:
        self.start()
        request = agent_bridge.open_request(self.project, kind="confirm", title="T")
        with self.assertRaises(agent_bridge.BridgeError) as caught:
            agent_bridge.wait_for_response(
                self.project,
                request["id"],
                timeout=0.1,
                keep_lease=False,
            )
        self.assertEqual(caught.exception.code, agent_bridge.EXIT_WAIT_TIMEOUT)
        self.assertIsNone(agent_bridge.read_response(self.project, request["id"]))
        self.assertTrue(agent_bridge.request_path(self.paths, request["id"]).is_file())

    # -- takeover and fencing ---------------------------------------------

    def test_takeover_bumps_fence_and_supersedes_open_requests(self) -> None:
        first = self.start()
        request = agent_bridge.open_request(self.project, kind="confirm", title="T")
        second = self.start(takeover=True, reason="manual")

        self.assertNotEqual(second["run_id"], first["run_id"])
        self.assertEqual(second["fence"], first["fence"] + 1)
        response = agent_bridge.read_response(self.project, request["id"])
        self.assertEqual(response["status"], "superseded")
        view = agent_bridge.effective_state(self.paths)
        self.assertIsNone(view["blocking"])

    def test_older_fence_events_are_ignored(self) -> None:
        first = self.start()
        agent_bridge.enter_stage(self.project, "execute")
        self.start(takeover=True)
        # A late write from the abandoned run carries the old fence; simulate
        # one by appending directly under the retired fence.
        with agent_bridge.FileLock(self.paths):
            agent_bridge._append_event(
                self.paths,
                "stage/enter",
                {"stage": "done", "index": 12, "label": "wrong"},
                run_id=first["run_id"],
                fence=first["fence"],
            )
        view = agent_bridge.effective_state(self.paths)
        self.assertNotEqual(view["stage"], "done")

    def test_live_lease_refuses_takeover_less_start(self) -> None:
        self.start()
        with self.assertRaises(agent_bridge.BridgeError) as caught:
            self.start()
        self.assertEqual(caught.exception.code, agent_bridge.EXIT_LEASE_HELD)

    # -- durability --------------------------------------------------------

    def test_torn_trailing_line_is_ignored(self) -> None:
        self.start()
        agent_bridge.set_progress(self.project, 1, 4)
        with open(self.paths.events, "a", encoding="utf-8") as handle:
            handle.write('{"v":1,"seq":999,"type":"progress","da')
        events = agent_bridge._iter_events(self.paths)
        self.assertTrue(all(event["seq"] != 999 for event in events))
        view = agent_bridge.effective_state(self.paths)
        self.assertEqual(view["progress"]["done"], 1)

    def test_rebuild_matches_the_live_view(self) -> None:
        self.start()
        agent_bridge.enter_stage(self.project, "execute", label="pages")
        agent_bridge.set_progress(self.project, 3, 8)
        before = agent_bridge.effective_state(self.paths)
        self.paths.status.unlink()
        agent_bridge.write_json_atomic(self.paths.status, agent_bridge.fold_status(self.paths))
        after = agent_bridge.effective_state(self.paths)
        self.assertEqual(after["stage"], before["stage"])
        self.assertEqual(after["progress"], before["progress"])
        self.assertEqual(after["source_seq"], before["source_seq"])

    def test_status_write_leaves_no_temp_files(self) -> None:
        self.start()
        agent_bridge.set_progress(self.project, 1, 2)
        leftovers = [item.name for item in self.paths.runtime.iterdir() if item.name.endswith(".tmp")]
        self.assertEqual(leftovers, [])

    def test_empty_runtime_reports_idle(self) -> None:
        self.paths.ensure()
        view = agent_bridge.effective_state(self.paths)
        self.assertEqual(view["state"], "idle")
        self.assertIsNone(view["stage"])


if __name__ == "__main__":
    unittest.main()
