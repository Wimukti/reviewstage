#!/usr/bin/env bash
# lib-limits.sh — the resource floors, defined once.
#
# Sourced by lib-common.sh (which the job scripts use) and by doctor.sh (which deliberately does
# NOT source lib-common.sh: that one creates directories and pulls in notify.sh, and the doctor
# writes nothing). The floors used to be written out in both places and drifted — the doctor
# defaulted MIN_FREE_DISK_MB to 1024 while the jobs defaulted it to 500, so the health check
# FAILed at a level every job script was perfectly happy with. One definition, both readers.
#
# Inert on purpose: assignments only, no side effects.

# Refuse to start a review below this much available RAM (MB). An agent run needs headroom,
# and a small server usually shares the box with whatever else you run on it.
MIN_FREE_MB="${MIN_FREE_MB:-800}"
# …and below this much free disk on $ROOT (MB). A full volume used to be a SILENT success: the
# agent wrote nothing, every `>` redirection failed unnoticed and the dashboard announced a
# ready review with no findings. Guard at the front, and check every write that matters.
MIN_FREE_DISK_MB="${MIN_FREE_DISK_MB:-500}"
