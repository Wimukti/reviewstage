"""rs_state.py — is a spawned review job alive? Three independent signals, any one suffices.

The dashboard used to answer that with the per-PR flock alone. server.py writes `status`
("queued") and THEN spawns run-review.sh, which only takes the flock after bash has sourced
lib-common.sh and validated the environment. The SPA fetches the PR the moment the start call
returns, so it routinely looked at a "queued" status with a free lock and concluded "stalled" —
and, because the page only polls while reviewing, the wrong verdict stuck on screen.

Signals, in the order they are checked:
  1. the flock on <udir>/.lock — exact while run-review.sh is past its first lines;
  2. the pid file — the process the server spawned is still alive (zombies count as dead);
  3. the status file's mtime — anything written within STARTUP_GRACE seconds is a run that is
     starting up or progressing; a real stall is old.
"stalled" needs all three to say dead.

Pure functions; no server imports, so this stays unit-testable (bin/test_rs_state.py).
"""
import errno
import fcntl
import os
import time

STARTUP_GRACE = 90          # seconds a freshly written status counts as a live run

REVIEWING = "reviewing"
STALLED = "stalled"


def flock_held(path):
    """True while some process holds an exclusive flock on `path`."""
    if not path.exists():
        return False
    try:
        fd = os.open(path, os.O_RDWR)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    except OSError:
        return True
    finally:
        os.close(fd)


def read_pid(pidfile):
    try:
        return int(pidfile.read_text().strip())
    except (OSError, ValueError):
        return 0


def _proc_state(pid):
    """Linux: the process state letter from /proc/<pid>/stat ('Z' = zombie); '' elsewhere."""
    try:
        with open(f"/proc/{pid}/stat") as fh:
            stat = fh.read()
    except OSError:
        return ""
    # comm may contain spaces; the state follows the closing paren.
    return stat.rpartition(")")[2].split()[0] if ")" in stat else ""


def pid_alive(pid):
    """Is `pid` a live (non-zombie) process? The server never wait()s on the reviews it spawns,
    so a finished child lingers as a zombie that os.kill(pid, 0) happily accepts — reap it here
    if it is ours, and read /proc for anyone else's."""
    if pid <= 0:
        return False
    try:
        done, _ = os.waitpid(pid, os.WNOHANG)
        if done == pid:
            return False                        # our child, just exited: reaped now
    except ChildProcessError:
        pass                                    # not our child (server restarted) — probe below
    except OSError:
        pass
    try:
        os.kill(pid, 0)
    except OSError as e:
        if e.errno == errno.ESRCH:
            return False
        if e.errno == errno.EPERM:
            return True                         # exists, owned by someone else
        return False
    return _proc_state(pid) != "Z"


def group_alive(pid):
    """Is anything left in the process GROUP the review was started in (start_new_session puts
    bash and every child — claude, git — in a group led by `pid`)? bash can be gone while the
    agent it started keeps running; that is exactly the case a Stop button must cover."""
    if pid <= 0:
        return False
    try:
        os.killpg(pid, 0)
    except OSError as e:
        return e.errno == errno.EPERM
    return True


def status_age(status_file, now=None):
    """Seconds since the status file was last written, or None when it does not exist."""
    try:
        mtime = status_file.stat().st_mtime
    except OSError:
        return None
    return max(0.0, (now if now is not None else time.time()) - mtime)


def decide(lock_held, alive, age, grace=STARTUP_GRACE):
    """The verdict for a run whose status text says it is still in progress."""
    if lock_held or alive:
        return REVIEWING
    if age is not None and age < grace:
        return REVIEWING
    return STALLED


# Terminal status texts: a run whose status says it finished is only alive while it still
# holds the lock (a re-run that has not written its first line yet).
TERMINAL = ("done", "posted", "dry-run", "failed", "stopped")


def probe(udir, now=None, grace=STARTUP_GRACE, lock=".lock", pid="pid", status="status"):
    """Inspect one run dir. Returns a dict with the verdict and every signal that fed it, so the
    caller can log a diagnosable line when the answer is 'stalled'.

    The three file names are parameters because not every job keeps its markers under the same
    names: a review owns its user dir (.lock / pid / status), while the QA guide shares the PR
    dir with the review and prefixes everything (qa.lock / qa.pid / qa.status). Both then get
    the same three signals instead of the QA page trusting the flock alone.
    """
    pid = read_pid(udir / pid)
    lock = flock_held(udir / lock)
    alive = pid_alive(pid) if pid else False
    age = status_age(udir / status, now)
    return {
        "state": decide(lock, alive, age, grace),
        "lock_held": lock,
        "pid": pid,
        "pid_alive": alive,
        "status_age": None if age is None else round(age),
    }


def job_alive(udir, status_text=None, now=None, grace=STARTUP_GRACE, **names):
    """Is this job genuinely in flight? Lock held, OR a live pid, OR a status written inside the
    startup grace — but never on the grace alone once the status says the run is over."""
    p = probe(udir, now, grace, **names)
    if p["lock_held"]:
        return True
    text = (status_text or "").strip()
    if text.startswith("failed") or text in TERMINAL:
        return p["pid_alive"]
    return p["state"] == REVIEWING


def job_state(alive, status_text, has_output):
    """(state, failure) for one job, exactly as rs_profile.job_state does for a profile build.

    A job that is not alive and whose status is still a progress line died without reporting
    (OOM, the box rebooted, a `die` before the first status) — that is a failure, not "never
    run" and not "still building". An existing artefact survives a failed re-run: the state
    stays `done` and the failure text rides alongside, so a bad regenerate never hides a
    perfectly good guide.
    """
    text = (status_text or "").strip()
    if alive:
        return "running", ""
    if text.startswith("failed"):
        failure = text
    elif text and text not in TERMINAL:
        failure = f"failed: the job exited without reporting why (last status: {text})"
    else:
        failure = ""
    if has_output:
        return "done", failure
    if failure:
        return "failed", failure
    if text == "stopped":
        return "stopped", ""
    return "none", ""
