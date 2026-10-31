#!/usr/bin/env python3
"""`timeout` for macOS, which ships without coreutils.

The job scripts use one shape: `timeout DURATION cmd [arg…]`, where DURATION is a number of
seconds with an optional s/m/h suffix (25m, 900s, 20). Stdin, stdout and stderr pass straight
through, so `printf … | timeout 25m claude -p …` still feeds the prompt. On expiry the whole
process group gets SIGTERM, then SIGKILL after 5 s, and the exit status is 124 as GNU timeout
returns. Installed by the desktop launcher into ~/.reviewstage/bin, which it prepends to the
server's PATH.
"""
import os
import signal
import subprocess
import sys
import time

UNITS = {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}


def seconds(text):
    unit = text[-1] if text and text[-1] in "smhd" else ""
    number = text[: -1] if unit else text
    return float(number) * UNITS[unit]


def main(argv):
    if len(argv) < 2:
        sys.stderr.write("usage: timeout DURATION COMMAND [ARG…]\n")
        return 125
    try:
        limit = seconds(argv[0])
    except ValueError:
        sys.stderr.write(f"timeout: invalid time interval '{argv[0]}'\n")
        return 125
    try:
        proc = subprocess.Popen(argv[1:], start_new_session=True)
    except FileNotFoundError:
        sys.stderr.write(f"timeout: failed to run command '{argv[1]}': No such file or directory\n")
        return 127
    try:
        return proc.wait(timeout=limit)
    except subprocess.TimeoutExpired:
        pass
    os.killpg(proc.pid, signal.SIGTERM)
    deadline = time.time() + 5
    while time.time() < deadline:
        if proc.poll() is not None:
            return 124
        time.sleep(0.1)
    os.killpg(proc.pid, signal.SIGKILL)
    proc.wait()
    return 124


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
