# Ticket workflow

The canonical 8-step process for any change to this repo. **Source of truth.**
`CLAUDE.md` and the global rules under `~/.dotfiles/.claude/rules/` reference
this doc. If you change the workflow, change it here first.

---

## The eight steps

| # | Step | Automation |
|---|---|---|
| 1 | Worktree + branch off latest `main`; read the ticket fully | `/start-ticket <N>` |
| 2 | Implement, with TDD where it makes sense | manual |
| 3 | Code review via the `code-reviewer` subagent | `/finish-ticket` |
| 4 | Fix critical and significant findings | manual |
| 5 | Re-review if the fixes were substantial (see heuristic below) | `/finish-ticket` re-fires the reviewer |
| 6 | Open the PR — Conventional-Commit title, `Closes #NN` in body | `/finish-ticket` |
| 7 | When hosted CI is green, **merge** | `/ship-ticket <P>` |
| 8 | Cleanup — comment closeout note on the ticket(s), remove worktree, delete branch | `/ship-ticket <P>` |

Steps are sequential. No skipping. Step 7 is **gated** — see "Self-merge
authority" below.

---

## Per-PR checklist (mandatory)

Every PR clears this five-step checklist before it ships. This is the
mandatory checklist from `~/.dotfiles/.claude/rules/local-ci-and-admin-merge.md`,
restated here so this doc is self-contained.

1. **Code review** — invoke the `code-reviewer` subagent on the diff.
2. **Address findings** — fix every critical and significant item; defer
   minor items to the PR body.
3. **Run all CI jobs locally** — `npm run ci` mirrors every **required**
   hosted-CI job (lint → typecheck → build → test:coverage → test:smoke →
   test:e2e → audit). All must pass. Note: `mutation` runs on CI with
   `continue-on-error: true` and is not yet a required gate — but if you
   touch `src/utils/shell.ts`, run `npm run test:mutation` manually to
   check the security-perimeter score.
4. **Apply fixes** for anything that fails. If a fix touches behaviour
   outside the original review's scope, restart the checklist.
5. **Re-review on low confidence** — if step 4 was non-trivial, run
   `code-reviewer` again before declaring the PR ready.

These five steps run **every time**, regardless of hosted-CI status.
`/finish-ticket` automates steps 1–2 and 5; `npm run ci` is step 3.

### "Substantial fix" heuristic for step 5

`/finish-ticket` re-fires the reviewer automatically if **any** of these
hold for the diff between first review and current state:

- New files added that weren't in the original review.
- More than 50 net lines added since first review.
- Any new exported / publicly-used symbol introduced.
- The fix landed in an area flagged critical or significant by the first
  pass (not just minor lint nits).

If none of these hold, treat the fix as minor and skip re-review.

---

## Self-merge authority

By default in `~/.dotfiles/.claude/rules/collaboration.md`, agents do not
`gh pr merge` — the user merges. **For this project, that default is
relaxed under explicit conditions.** The agent may `gh pr merge` (via
`/ship-ticket`) when **all** of the following hold:

- A **checklist stamp** at `.claude/state/checklist-<sanitized-branch>.json`
  exists with `verdict=ship` AND `head_sha` matching the PR's current
  HEAD. The stamp is written by the agent in `/finish-ticket` immediately
  after each `code-reviewer` call. Missing / stale-SHA / non-ship stamp
  → `/ship-ticket` fails closed.
- Hosted CI is green at the merge moment — `gh pr checks <P>` shows
  every job passing or legitimately skipped, none in-flight, none stale.
- One PR per `/ship-ticket` invocation. The skill refuses a list of PRs.
  The agent never sweeps "all green PRs".
- The PR's title and body match what `/finish-ticket` produced — no
  silent edits between checklist completion and merge.

If any condition fails, `/ship-ticket` stops and reports. The user
merges manually from there. The stamp file is written to
`.claude/state/checklist-<sanitized-branch>.json` — this directory must
exist before the first run; `/start-ticket` should create it, or create
it manually with `mkdir -p .claude/state`.

**Adversarial limit:** an agent with Write access can forge the stamp
file. The gate is robust against accidental skip / context compaction /
config-not-loaded — not against deliberate bypass.

**This is not the admin-merge bypass** in
`~/.dotfiles/.claude/rules/local-ci-and-admin-merge.md`. That bypass is
for hosted-CI infrastructure failure and stays a separate, narrower
decision.

---

## Cleanup

After merge, `/ship-ticket` does:

1. For every ticket the PR closes (`gh pr view <P> --json
   closingIssuesReferences`), `gh issue comment <N>` with a one-paragraph
   closeout note: what shipped, anything to watch for, link to PR.
   `Closes #NN` in the PR body has already changed the issue state —
   the comment is the human-readable record, not the state change.
2. `git worktree remove ../ssm-<N>-<slug>` from the main repo. Never
   `--force` — if the worktree has uncommitted changes, stop and report.
3. `git branch -d <type>/<N>-<slug>` to drop the local branch.

Cleanup runs in the same session as the merge.

---

## Branches, commits, naming

- **Worktree:** `../ssm-<N>-<slug>` (the `ssm-` prefix avoids collisions
  with other repos in `~/dev/`).
- **Branch:** `<type>/<N>-<slug>` where `<type>` ∈ `feat`, `fix`, `chore`,
  `refactor`, `test`, `docs`. `<N>` is the GitHub issue number.
- **Commits:** Conventional-Commit format,
  `<type>(<scope>): <short summary>`. For TDD work, separate the failing-
  test commit from the implementation commit.
- **PR title:** Conventional-Commit format, under 70 characters. **PR body**
  must contain `Closes #NN` on its own line and a summary of what changed
  and why.

---

## Where to find what

| Question | File |
|---|---|
| Per-PR checklist (canonical) | `~/.dotfiles/.claude/rules/local-ci-and-admin-merge.md` |
| Default merge authority across projects | `~/.dotfiles/.claude/rules/collaboration.md` |
| Generic 9-step end-to-end process | `~/.dotfiles/.claude/rules/end-to-end-process.md` |
| TDD patterns, bug-fix process | `~/.dotfiles/.claude/rules/development-workflow.md` |
| This project's stack, naming, test commands | [`../CLAUDE.md`](../CLAUDE.md) |
| Local CI parity commands | [`developing.md`](developing.md) |
| Plugin development | [`plugins.md`](plugins.md) |
| Security model | [`security.md`](security.md) |

---

## One last thing

If you're an agent and the workflow seems to want you to do something
risky — sweep multiple PRs, force-push, bypass the checklist — **stop
and ask the user**. The conditions in this doc are deliberately tight;
when in doubt, default to the more conservative read.
