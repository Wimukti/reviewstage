#!/usr/bin/env python3
"""Unit tests for the run-liveness verdict (bin/rs_state.py): the flock, the pid file and the
status file's age each keep a run "reviewing"; only all three dead means "stalled".
Run: python3 -m unittest bin/test_rs_state.py"""
import fcntl
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rs_state as S  # noqa: E402


class Decide(unittest.TestCase):
    def test_lock_wins(self):
        self.assertEqual(S.decide(True, False, 10_000), S.REVIEWING)

    def test_live_pid_wins(self):
        self.assertEqual(S.decide(False, True, 10_000), S.REVIEWING)

    def test_fresh_status_is_startup_grace(self):
        self.assertEqual(S.decide(False, False, S.STARTUP_GRACE - 1), S.REVIEWING)

    def test_everything_dead_is_stalled(self):
        self.assertEqual(S.decide(False, False, S.STARTUP_GRACE), S.STALLED)
        self.assertEqual(S.decide(False, False, None), S.STALLED)


class Probe(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.udir = Path(self.tmp.name)
        self.procs = []

    def tearDown(self):
        for p in self.procs:
            try:
                p.kill()
                p.wait(timeout=5)
            except Exception:
                pass
        self.tmp.cleanup()

    def _status(self, text, age):
        f = self.udir / "status"
        f.write_text(text)
        old = time.time() - age
        os.utime(f, (old, old))

    def _dead_pid(self):
        p = subprocess.Popen(["true"])
        p.wait()                                # reaped: the pid no longer exists
        (self.udir / "pid").write_text(str(p.pid))
        return p.pid

    def test_lock_held_is_reviewing(self):
        self._status("checking out the branch", 10_000)
        lock = self.udir / ".lock"
        fd = os.open(lock, os.O_RDWR | os.O_CREAT)
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            pr = S.probe(self.udir)
            self.assertEqual(pr["state"], S.REVIEWING)
            self.assertTrue(pr["lock_held"])
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
        self.assertFalse(S.flock_held(lock))

    def test_lock_free_live_pid_is_reviewing(self):
        self._status("queued", 10_000)
        p = subprocess.Popen(["sleep", "30"])
        self.procs.append(p)
        (self.udir / "pid").write_text(str(p.pid))
        pr = S.probe(self.udir)
        self.assertEqual(pr["state"], S.REVIEWING)
        self.assertFalse(pr["lock_held"])
        self.assertTrue(pr["pid_alive"])

    def test_lock_free_dead_pid_fresh_status_is_reviewing(self):
        self._dead_pid()
        self._status("queued", 5)
        pr = S.probe(self.udir)
        self.assertEqual(pr["state"], S.REVIEWING)
        self.assertFalse(pr["pid_alive"])
        self.assertLess(pr["status_age"], S.STARTUP_GRACE)

    def test_lock_free_dead_pid_old_status_is_stalled(self):
        self._dead_pid()
        self._status("reviewing the diff", S.STARTUP_GRACE + 60)
        pr = S.probe(self.udir)
        self.assertEqual(pr["state"], S.STALLED)
        self.assertFalse(pr["lock_held"])
        self.assertFalse(pr["pid_alive"])

    def test_zombie_child_counts_as_dead(self):
        # The server never wait()s on its reviews; a finished one is a zombie until reaped.
        p = subprocess.Popen(["true"])
        self.procs.append(p)
        if os.path.exists("/proc"):
            deadline = time.time() + 5
            while time.time() < deadline and S._proc_state(p.pid) != "Z":
                time.sleep(0.05)
        else:
            time.sleep(0.5)                     # no /proc (macOS): `true` is long gone by now
        self.assertFalse(S.pid_alive(p.pid))

    def test_missing_or_garbage_pid_is_dead(self):
        self.assertEqual(S.read_pid(self.udir / "pid"), 0)
        (self.udir / "pid").write_text("not-a-pid")
        self.assertEqual(S.read_pid(self.udir / "pid"), 0)
        self.assertFalse(S.pid_alive(0))

    def test_no_status_file_and_nothing_alive_is_stalled(self):
        self.assertEqual(S.probe(self.udir)["state"], S.STALLED)


if __name__ == "__main__":
    unittest.main()


class NamedMarkers(unittest.TestCase):
    """The QA job keeps its markers as qa.lock / qa.pid / qa.status in the shared PR dir, so
    probe() has to be told the names — it used to be hardcoded to a review's user dir, which is
    why the QA page trusted the flock alone and never polled."""

    def setUp(self):
        self.d = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d, True)

    def test_probe_reads_prefixed_markers(self):
        (self.d / "qa.status").write_text("building the QA guide")
        p = S.probe(self.d, lock="qa.lock", pid="qa.pid", status="qa.status")
        self.assertEqual(p["state"], S.REVIEWING)          # inside the startup grace
        self.assertEqual(p["pid"], 0)

    def test_an_old_status_with_no_lock_or_pid_is_stalled(self):
        f = self.d / "qa.status"
        f.write_text("building the QA guide")
        os.utime(f, (0, time.time() - 10_000))
        p = S.probe(self.d, lock="qa.lock", pid="qa.pid", status="qa.status")
        self.assertEqual(p["state"], S.STALLED)


class JobState(unittest.TestCase):
    def test_a_dead_job_on_a_progress_status_is_a_failure(self):
        state, why = S.job_state(False, "building the QA guide", has_output=False)
        self.assertEqual(state, "failed")
        self.assertIn("without reporting why", why)

    def test_an_existing_guide_survives_a_failed_regenerate(self):
        state, why = S.job_state(False, "failed: the agent exited 1", has_output=True)
        self.assertEqual(state, "done")
        self.assertIn("exited 1", why)

    def test_terminal_states(self):
        self.assertEqual(S.job_state(False, "done", True), ("done", ""))
        self.assertEqual(S.job_state(False, "stopped", False), ("stopped", ""))
        self.assertEqual(S.job_state(False, "", False), ("none", ""))
        self.assertEqual(S.job_state(True, "", False), ("running", ""))

    def test_job_alive_ignores_the_grace_once_the_status_is_terminal(self):
        (self.dir / "qa.status").write_text("done")
        self.assertFalse(S.job_alive(self.dir, "done", lock="qa.lock", pid="qa.pid",
                                     status="qa.status"))

    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, True)
