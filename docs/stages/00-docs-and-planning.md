# Stage 00 — Docs and planning

Status: done
Owner(s): `orchestrator` (W0-docs), doc agent A (W0-docs), doc agent B (W0-docs)
Depends on: approved implementation plan, contracts brief
Blocks: Stage 01 (W0a) and therefore every later stage

## Goal
Every agent can start work from the repository alone. The rules, the architecture, the security model, the API
contract, the test strategy and one stage file per stage (with a tagged, measurable Definition of Done) are committed on
`main`. Names used in the docs (paths, endpoints, error codes, settings keys, env vars, cookies, LiveKit contracts) are
the ones implementation must use.

## Scope
### In scope
- Root docs: `AGENT.md`, `CLAUDE.md`, `README.md` (skeleton).
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/API.md`, `docs/TESTING.md`,
  `docs/DEPLOYMENT.md` (skeleton), `docs/PERFORMANCE.md` (skeleton).
- `docs/stages/00-docs-and-planning.md` … `docs/stages/10-hardening-qa-release.md` (11 files).
### Out of scope (and where it lives instead)
- Any code, config, lockfile or script: Stage 01 (W0a, `orchestrator`).
- `scripts/check-english.mjs`: Stage 01 (W0a). Until it exists, the English check runs as a one-line `perl` command
  (see DoD).
- Final README content (install, upgrade, backup, troubleshooting): Stage 09a (`infra`); docs polish: Stage 10 (`docs`).

## Owned paths
- `orchestrator`: `AGENT.md`, `CLAUDE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`
- doc agent A: `docs/stages/00-docs-and-planning.md` … `docs/stages/05-call-core.md`, `docs/API.md`
- doc agent B: `docs/stages/06-host-controls-collaboration.md` … `docs/stages/10-hardening-qa-release.md`,
  `docs/TESTING.md`, `docs/DEPLOYMENT.md`, `docs/PERFORMANCE.md`, `README.md`
### Consumes (must not edit)
- The approved implementation plan (outside the repo) and the contracts brief (scratchpad). Both are the source of truth;
  a doc that disagrees with them is wrong.

## Tasks
### Orchestrator
- [x] `AGENT.md`: agent rules (read AGENT.md and your stage doc first; stay in owned paths; never edit frozen files;
      new deps and contract changes go into the report), worktree protocol (`git merge-base --is-ancestor
      <waveBaseSha> HEAD`, `scripts/worktree-setup.sh <agent> <port>`), never `docker compose down` on the shared dev
      stack, heavy commands under `scripts/with-lock.sh`, gotchas from the plan, report format (branch, commit, files,
      DoD status, requests).
- [x] `CLAUDE.md`: exactly one line, `@AGENT.md`.
- [x] `docs/ROADMAP.md`: status table (stage, owner, wave, status), dependency graph, ownership map that covers every
      path of the repository layout, frozen-file list, wave base SHAs.
- [x] `docs/ARCHITECTURE.md`: topology, layers and conventions, data model, auth, rooms/joining, E2EE, call media,
      recording, headers (plan section 2).
- [x] `docs/SECURITY.md`: threat model including every statement required by plan section 2.7 (protected against SFU,
      network, DB and storage compromise; not against a malicious app server; no per-sender authenticity; metadata
      visible to the server; removed people keep the key until rotation; recordings readable by server/admins).
### Doc agent A
- [x] `docs/stages/00-docs-and-planning.md` … `docs/stages/05-call-core.md` in the stage template.
- [x] `docs/API.md`: conventions, every endpoint of plan section 2.4 plus the obviously required ones, SSE contract,
      LiveKit contracts, cookies, link formats, crypto derivations, settings keys and defaults.
### Doc agent B
- [x] `docs/stages/06-host-controls-collaboration.md` … `docs/stages/10-hardening-qa-release.md` in the stage template
      (Stage 09 has parts 9a and 9b).
- [x] `docs/TESTING.md`: test layers, locations, commands, Playwright projects, fake media, manual browser matrix.
- [x] `docs/DEPLOYMENT.md`, `docs/PERFORMANCE.md`: skeletons with headings and TODO markers owned by later stages.
- [x] `README.md`: skeleton (what blinq is, requirements, ports table, quick start placeholder, browser matrix
      placeholder, "remove `ADMIN_PASSWORD` after the first login").
### Review
- [x] Orchestrator cross-checks names against the contracts brief, resolves or accepts every "(decision)" item, then
      commits all docs in one W0-docs commit on `main`.

## Tests
- Unit: none (no code in this stage).
- API: none.
- E2E: none.
- Docs checks: the commands in the Definition of Done below.

## Definition of Done
- [x] [agent-manual] All 11 stage files exist with the exact names from the contracts brief — evidence: `ls docs/stages`
      matches the stage list in `docs/ROADMAP.md`.
- [x] [agent-manual] Every stage file has the template sections — evidence: `grep -L '^## Definition of Done'
      docs/stages/*.md` prints nothing, and each file has Goal, Scope, Owned paths, Tasks, Tests, Notes and gotchas.
- [x] [agent-manual] Every DoD item carries exactly one tag and an evidence pointer — evidence:
      `awk '/^## Definition of Done/{d=1;next} /^## /{d=0} d && /^- \[ \]/ && !/\[(auto|agent-manual|user)\].*evidence:/' docs/stages/*.md`
      prints nothing.
- [x] [agent-manual] Every DoD item listed in plan section 4 appears in its stage file — evidence: orchestrator
      checklist in the W0-docs review.
- [x] [agent-manual] No Cyrillic character in any doc — evidence:
      `perl -CSD -ne 'print "$ARGV:$.\n" if /\p{Cyrillic}/' AGENT.md CLAUDE.md README.md docs/*.md docs/stages/*.md`
      prints nothing.
- [x] [auto] `check-english` passes once it exists — evidence: `pnpm check:english` (first run in Stage 01 CI).
- [x] [agent-manual] The ROADMAP ownership map covers every layout path — evidence: ownership table in
      `docs/ROADMAP.md` checked against plan section 3; no path has two writers in the same wave.
- [x] [agent-manual] `docs/API.md` lists every endpoint of plan section 2.4 — evidence: endpoint index in
      `docs/API.md`.
- [x] [agent-manual] Names in all docs match the committed contracts — evidence: orchestrator review notes comparing
      error codes, settings keys, env vars, cookie names and LiveKit contracts with `shared/**` and
      `server/contracts/index.ts`.
- [x] [agent-manual] `CLAUDE.md` is exactly `@AGENT.md` — evidence: `cat CLAUDE.md`.
- [x] [agent-manual] Docs are committed on `main` in one W0-docs commit — evidence: `git log --oneline -1 -- docs`.

## Notes and gotchas
- The repository CI fails on any Cyrillic character in any tracked file, including docs and test fixtures. Hotkey tests
  for Cyrillic layouts must build their key values from code points (for example `String.fromCodePoint(0x44c)`), never
  from literal characters.
- Stage files are living checklists: agents tick their own boxes and the orchestrator updates `docs/ROADMAP.md` after
  each merge.
- "(decision)" marks a choice the plan left open. The orchestrator reviews each one before the W0-docs commit;
  anything it rejects is fixed in the docs, not in code.
