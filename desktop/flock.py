#!/usr/bin/env python3
"""`flock` for macOS, which ships without it.

The review scripts use three shapes of util-linux flock, and nothing else:

    flock -n 9            take an exclusive non-blocking lock on fd 9 (opened by the shell)
    flock -w 3600 8       take an exclusive lock on fd 8, waiting up to 3600 s
    flock -n FILE cmd …   lock FILE non-blocking, run cmd under it, exit with cmd's status

Exit status 1 when a non-blocking or timed lock cannot be taken, as util-linux does, so
`flock -n 9 || exit 0` guards behave identically. Installed by the desktop launcher into
~/.reviewstage/bin, which it prepends to the server's PATH.
"""
import fcntl
import os
import subprocess
import sys
import time


def usage():
    sys.stderr.write("usage: flock [-n] [-w SECS] FD | flock [-n] [-w SECS] FILE CMD [ARG…]\n")
    sys.exit(64)


def take(fd, nonblock, wait):
    flags = fcntl.LOCK_EX
    if nonblock:
        flags |= fcntl.LOCK_NB
        try:
            fcntl.flock(fd, flags)
            return True
        except BlockingIOError:
            return False
    if wait is None:
        fcntl.flock(fd, flags)
        return True
    deadline = time.monotonic() + wait
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.2)


def main(argv):
    nonblock, wait = False, None
    i = 0
    while i < len(argv) and argv[i].startswith("-"):
        a = argv[i]
        if a in ("-n", "--nonblock", "--nb"):
            nonblock = True
        elif a in ("-w", "--wait", "--timeout"):
            i += 1
            if i >= len(argv):
                usage()
            wait = float(argv[i])
        elif a in ("-x", "--exclusive"):
            pass
        else:
            usage()
        i += 1
    rest = argv[i:]
    if not rest:
        usage()
    if len(rest) == 1 and rest[0].isdigit():
        return 0 if take(int(rest[0]), nonblock, wait) else 1
    path, cmd = rest[0], rest[1:]
    if not cmd:
        usage()
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    if not take(fd, nonblock, wait):
        return 1
    try:
        return subprocess.call(cmd)
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
