# Four real pull requests, reviewed with ReviewStage on 11/01/26

The kept findings were posted on 11/01/26 as inline review comments under the maintainer's
own GitHub account. The links are in each section. Dates are MM/DD/YY.

Who decided: the maintainer delegated the keep or drop decisions to the assistant that ran
the reviews. Each decision below rests on a check of the code at the reviewed commit, and the
file and line are given so anyone can repeat the check.

## Method

- Four open PRs on public repositories, chosen on 10/31/26 from GitHub search for recent,
  non-bot, mid-size PRs. No relation to the maintainer.
- ReviewStage 1.2.2 plus the fixes in #46 to #48, run on a MacBook, Standard effort, Opus 5.5,
  the default pr-review skill, with the disproof pass on. One run per PR, no re-runs.
- Each finding was then checked by a person against the code at the reviewed commit, with the
  file and line given below.
- Cost and time are what the CLI reported for the run (`usage.json`). The cost is the API-rate
  value the CLI prints, not an extra charge on a subscription.

| PR | Reviewed commit | Size | Findings | Run time | Reported cost |
|---|---|---|---|---|---|
| pyvisa/pyvisa #1000 | `b23028a` | +64 / -2, 3 files | 1 question | 92 s | $0.45 |
| dbfixtures/pytest-redis #1107 | `6118a6d` | +334 / -0, 8 files | 1 should-fix, 1 question | 116 s | $0.55 |
| Python-roborock/python-roborock #1000 | `cab602e` | +200 / -1, 2 files | 1 should-fix | 72 s | $0.50 |
| coder/xum #7845 | `3611f12` | +672 / -71, 4 files | 1 blocker, refuted by the disproof pass | 51 s | $0.59 |

## 1. pyvisa/pyvisa #1000: "Preserve operators and quoted values in optional resource filters"

**What the PR does.** It replaces plain string replacement in `filter2()` with one regex pass
that skips quoted text and keeps `!=` intact.

**Finding (question, low confidence), `pyvisa/rname.py:939`.** The translation turns `!` into
` not `. In C and in the VISA expression syntax, `!` binds tighter than `==`, so `!VI_X==1`
means `(!VI_X)==1`. Python reads ` not VI_X==1` as `not (VI_X==1)`. For `VI_X = 2`, C gives
false and Python gives true. This is older behavior, not new in the PR, but the PR rewrites
this code, and all new tests put parentheses after `!`, so none shows the difference.

**Check.** Correct. `python3 -c "print(not 2==1, (not 2)==1)"` prints `True False`. The new
`!(?!=)` pattern only stops `!` from eating `!=`; it does not change precedence.

**Decision: keep, as a question.** The difference is real, the PR rewrites that code, and a
question is the right weight for behavior that is older than the PR.

**Posted:** https://github.com/pyvisa/pyvisa/pull/1000#discussion_r4434109950

## 2. dbfixtures/pytest-redis #1107: "Allow passing any redis-server option to redis_proc"

**What the PR does.** It adds an `options` list, a `--redis-option` flag and a `redis_options`
ini setting, and passes each entry to `redis-server`. A guard refuses options that
pytest-redis sets itself (`port`, `bind`, `dir`, ...) and `requirepass`.

**Context on the PR.** CodeRabbit had found that a quoted name such as `'port 6390'` got past
the guard. The author fixed that in `6118a6d` with an `OPTION_NAME` check. ReviewStage
reviewed that fixed commit.

**Finding A (should-fix, medium confidence, disproof pass: stands),
`pytest_redis/executor/process.py:44`.** Two directives still get around the guard.
`include /path/extra.conf` loads a file that can set `port`, so the server moves and the
executor waits on the old port until the 60 s timeout. `user default on >secret ...` (and
`aclfile`) sets a password on the default user, so the client fixture fails with `NOAUTH`.
Both pass `OPTION_NAME` and are not in `MANAGED_OPTIONS`.

**Check.** Correct. `MANAGED_OPTIONS` at `process.py:44-60` lists `bind`, `port`, `dir` and
twelve others, and not `include`, `user` or `aclfile`. `_extra_options()` at `process.py:222`
checks only that set plus `set_by_setting`.

**Finding B (question, low confidence), `pytest_redis/factories/proc.py:130`.**
`options or config.options` treats `options=[]` the same as "not given", so an explicit empty
list cannot turn off the ini options. The `modules` argument works the same way, so this can
be on purpose.

**Check.** Correct as described. Whether it is a defect is the maintainer's call.

**Decision A: keep.** It is the same class of bypass the author already fixed once on this PR.

**Posted:** https://github.com/dbfixtures/pytest-redis/pull/1107#discussion_r4434110047

**Decision B: drop.** `options=[]` works like `modules`, so it reads as a design choice. Posting
it would add noise next to finding A.

## 3. Python-roborock/python-roborock #1000: "serve V1 maps from the simulator"

**What the PR does.** The V1 test simulator answers `get_map_v1` with an encrypted, compressed
binary map, and tests parse and render it.

**Context on the PR.** An automated Gemini review on the PR said "No blocking issues found".
Copilot could not review it (quota).

**Finding (should-fix, high confidence, disproof pass: weakened),
`roborock/testing/v1_simulator.py:189`.** `_path_point` packs each point as `<HH` with
`x = 20000 + index * 10`. At index 4,554, `x` is 65,540, which does not fit an unsigned short,
so `struct.pack` raises `struct.error` and the map request returns an RPC error. The disproof
pass noted that only `advance_path()` reaches that index and the current tests use 7 to 40
points.

**Check.** Correct. `v1_simulator.py:191` is
`struct.pack("<HH", 20000 + index * 10, 21000 + index * 7)`. The `y` value overflows at index
6,363 for the same reason.

**Decision: keep.** The overflow is real. The body already says that current tests do not
reach it, which is the honest weight.

**Posted:** https://github.com/Python-roborock/python-roborock/pull/1000#discussion_r4434110162

## 4. coder/xum #7845: "share one origin fetch across a burst of worktree creations"

**What the PR does.** Many sub-agent worktrees created at once each ran their own
`git fetch origin <trunk>`. The PR lets them share one fetch.

**Context on the PR.** Codex reviewed seven rounds and found P2 items about the fetch key,
all answered by the author. The Codex security review on the final commit found no issues.
The PR was merged on 10/31/26, before this review ran. The review is of its final commit.

**Finding (blocker, high confidence at draft time), `src/node/worktree/WorktreeManager.ts:923`.**
The draft said the shared fetch runs without the no-hooks git environment, so an untrusted
repository's own `core.sshCommand` or `credential.helper` could run during worktree creation.

**ReviewStage's disproof pass refuted it:** the fetch runs only when `remoteSyncAllowed` is
true (`WorktreeManager.ts:304`), which requires a trusted project, and for a trusted project
`getGitExecOptions` returns no env at all.

**Check.** The disproof pass is right. `WorktreeManager.ts:304` sets
`remoteSyncAllowed = !skipRemoteSync && gitHooksAllowed(params.trusted)`, line 441 returns
before any fetch when it is false, and `getGitExecOptions` (line 184) returns `undefined` for
the env when hooks are allowed. On `main` the fetch also received only a signal. There is no
path where an untrusted project reaches the fetch. This finding should not be posted.

One product note from this case: the review summary still read "Do not merge yet" after the
disproof pass refuted the only finding. The summary must be rebuilt after the pass.

**Decision: drop.** Refuted by the disproof pass, and confirmed by reading the code. Nothing
was posted on this PR.

## Result

Four PRs, six draft findings. Three were kept, one was kept as a question, two were dropped.
One of the dropped ones was a confident blocker that was wrong.

## What this shows

- Three of four PRs had one real, checkable defect or open question that no bot on the PR had
  raised.
- One PR drew a confident false positive. The disproof pass caught it before a person saw it,
  and a person confirmed the refutation in two minutes. Posted as written, it would have told a
  maintainer "do not merge" for no reason.
- Running the tool on real PRs also found three ReviewStage bugs the same morning: fork PRs
  could not be fetched, a Mac without coreutils has no `timeout`, and a refused model run was
  reported as a crash. All three are fixed on `main`.
