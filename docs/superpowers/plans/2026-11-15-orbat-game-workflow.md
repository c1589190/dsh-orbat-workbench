# 文游编制协作工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans; user explicitly directs responsibility areas and DeepSeek Flash. Each checkbox is independently verifiable. No git repository exists; do not create commits or fake a git diff.

**Goal:** Support usable game-oriented historical ORBAT editing, factual provenance, unknown quantities, safe mass editing/templates/catalog, and native-lossless plus upstream-compatible interchange.

**Architecture:** Preserve existing node values and shared application/transaction architecture. Namespaced per-field evidence accompanies legacy numeric fields. Implement a versioned native export separately from the Army_Editor projection; both UI and AI invoke the same backend. Preserve existing per-document revision and conflict behavior; all mutation through Workspace/application only.

**Tech Stack:** Node >=22 ES modules, node:test, existing DSH tools/client React and resvg/milsymbol; pnpm.

**Spec:** `docs/superpowers/specs/2026-11-15-orbat-game-workflow.md` (user selected approach B and explicitly asked implementation).

## Global Constraints
- No git repository/worktree, no git init or commits; preserve `/home/cna/bqty/.workbench/`, human edits and live DSH server. Tests use temporary directories; never open the live data directory in another Workspace process.
- One production-code-writing agent at a time. Read-only investigations can run concurrently. A separate test responsibility writes and verifies RED before the implementation responsibility writes code (user responsibility-area method + TDD). Every dispatched child explicitly uses `deepseek-official/deepseek-flash` unless unavailable.
- Maintain `expectedRevision` and atomic rollback; never blindly retry CONFLICT. Human UI and AI tool actions call one implementation. No raw shell/script overwrites of workspace data.
- Unit names are normal names without newly inserted `【示意】`; provenance is separately retrievable. Existing names change only by a targeted conflict-safe user-authorized transaction.
- Legacy numeric fields remain backward compatible; direct values never repeat descendant totals; old zero is not automatically known or unknown.
- Do not assume public Army_Editor preserves unknown extensions. Native backup must round-trip richer data, compatibility exports must report loss and never silently claim full fidelity.

## Common Contract
- Metadata namespace: `node.custom.orbat` with `version:1` and optional `personnel:{status,source}`, `equipmentList:{status,source}`, `observedTotals:{...}`. Equipment item metadata is `item.orbat:{status,source}`. `status` enum: `actual`, `standard`, `estimate`, `unknown`, `legacy-ambiguous`. `source` object has optional string `title,url,page,date,method,note`, validated as safe JSON; zero in legacy scalar fields remains a placeholder for unknown only when the explicit status says unknown. Do not replace unrelated `custom` data.
- New completeness computation preserves old `stats` scalar fields and adds `coverage:{personnel:{known,unknown,estimated,legacyAmbiguous},equipment:{known,knownTotal,unknown,estimated,legacyAmbiguous}}`. `personnel.known` sums actual/standard/estimate and unlabelled nonzero legacy values; `equipment.known` maps each equipment name to its known subtotal and `knownTotal` sums these quantities. Both exclude items marked unknown/legacy-ambiguous even if a stale numeric placeholder is nonzero. Each `estimated` sums corresponding estimated quantities, while `unknown` and `legacyAmbiguous` count affected nodes/items (not quantities). Status absent on legacy nonzero means recorded legacy, legacy zero is ambiguous; unannotated legacy empty equipment lists are also ambiguous, not proof of no equipment. Explicit equipmentList actual + empty list is known empty; equipmentList unknown/legacy-ambiguous counts one incomplete list independently of individually unknown items. Output label is incomplete if unknown or ambiguous count > 0. Source totals are annotations, not descendants or additive totals.
- Shared planned mutation action `plan` takes `{edits:[{documentId,expectedRevision,operations}],summary}`; returns `{plan:{edits,summary,baseSequence},diffs,stats, warnings}` without writes. `commitPlan` takes that plan and invokes the same existing transaction on exact node IDs/revisions; stale conflict, no automatic rescan. Additional selective operations compile to exact update/add operations before plan; transaction limit and validation still apply.
- Native backup `kind:'orbat-native',version:1,documents:[{id,name,revision,root}],catalog:{...},templates:{...}` (safe JSON) preserves document/node identity and revision as well as metadata, quantities and resources. Default merge into a nonempty workspace rejects conflicting IDs; explicit clone import regenerates IDs and returns an identity mapping/loss report. Full-workspace backup additionally preserves sequence/history or explicitly names those omissions; no unsupported promise of full workspace restore. Compatibility `mil-org` and `mil-bundle` remain supported; return payload and deterministic loss report separately, and do not present them as lossless.
- Workspace state with catalog/templates must use a new version 2, explicitly read/migrate version 1, and preserve resources across every state builder, create/edit/import/reopen. Store `resources:{revision,catalog,templates}` and guard any mutation of shared catalog/templates with its own expected resource revision in the same serialized atomic commit as document changes; otherwise a stale client could overwrite another editor's library. Existing old-version readers must reject version 2 rather than silently drop resources. Upgrade only when the old process is stopped/disposed: the current old running Host holds memory and cannot be made safe by a version number alone. Do not open the same live data directory from another process. Test actual nonempty equipment-library import and alias conflicts; reject unsupported maps with a named warning or preserve them, never silently discard.
- Plan `baseSequence` is diagnostic only; guards are per touched document and every copied source document. Duplicate document edits reject or have explicitly tested ordering. Commit must never trust client-provided diff/stats; recompute on the server. For all evidence writes introduce namespace-scoped merge operations that preserve unrelated `custom`, fail if it is incompatible, and patch equipment by resolved stable item identity/occurrence without replacing untouched entries. Unknown operations/guards must fail rather than be ignored.
- `validateRoot` currently validates a normalized copy but `stats` walks the original; a missing-field persisted tree can pass validation and then throw. Add a separate RED test and normalize the preserved tree when loading, or reject malformed persisted trees before stats; no valid input can produce NaN/TypeError. Preserve legacy raw scalar sums while coverage adds known/incomplete semantics.
- Evidence metadata can affect stack fingerprints: do not discard source or silently merge indistinguishable-looking nodes in a way that makes evidence inaccessible. Rendered stack semantics and access to each source need dedicated tests. All fields and outputs must guard unsafe keys and rendered URLs must avoid unsafe schemes.

## Review Focus
1. Legacy zero vs explicit actual zero vs unknown, including empty/partial equipment and subtree sums; pin in evidence-model tests.
2. Filtered batch preview changes nothing; old revision or changed source fails entire commit; preserve unrelated equipment and metadata; pin in transaction tests.
3. Duplicate template into same/across documents with fresh IDs and stable names, catalog collision and unsafe JSON; pin in native/transaction tests.
4. Real exported upstream file may drop metadata/catalog: warn and separately test native roundtrip; no invented guarantee.
5. Concurrent human draft, old workspace and existing skill/name changes survive upgrades; pin in application/UI policy and conflict tests.

## Responsibility 1: Evidence-aware quantity and aggregation
**Files:** `src/model.js`, new `src/evidence.js` if helpful; test `tests/evidence-model.test.js`; renderer consumer integration reserved for area 4.
**Interfaces:** consume existing `normalizeRoot`, `normalizeNodePatch`, `stats`; produce Common Contract metadata and `coverage` without breaking existing scalar fields or non-ORBAT custom data.
- [x] Independent test agent writes behavior tests: explicit actual0, unknown0, estimate10, legacy0, known 3+unknown and source totals not added; malformed status/sources fail closed and unrelated custom survives.
- [x] Run `node --test tests/evidence-model.test.js`; record expected RED.
- [x] One writer implements normalize/patch/validation/stats with no unrelated file edits; `node --test tests/evidence-model.test.js tests/model.test.js` passes.
- [x] Controller reviews schema, data safety and tests; record observed status in `docs/progress.md`.

## Responsibility 2: Native interchange, catalog and template persistence
**Files:** `src/workspace.js`, `src/model.js` only if controller coordinates, new persistence helper if needed; test `tests/native-interchange.test.js`.
**Interfaces:** Common Contract native shape. `Workspace` exposes native import/export and safe catalog/templates operations; preserve old file behavior except explicit added support for nonempty equipment library.
- [x] Test agent writes RED tests for native identity-preserving roundtrip, explicit clone mode ID mapping, identity conflict atomicity, version1→2 migration, old reader fail-closed, library+template persistence through transaction/reopen, invalid/prototype keys, compatible export loss report and successful nonempty custom-library import (collision must reject without writes).
- [x] Run `node --test tests/native-interchange.test.js`; record RED. (15 tests: 14 RED after implementation began; the unsupported-version case passes because v3 was already rejected.)
- [x] One writer implements persisted catalog/templates and import/export with versioning and documented loss report; no mutation of live workspace.
- [x] Run test file and relevant existing workspace tests; controller reviews backward compatibility and persists status. (168/168; unknown versions fail closed; actual older binary cannot be retested locally.)

## Responsibility 3: Shared query, planner and batch operations
**Files:** `src/workspace.js`, `src/application.js`, `src/tools.js`, optionally `src/batch.js`; test `tests/batch-workflow.test.js`.
**Interfaces:** Common Contract `plan` / `commitPlan`, action/tool surfaces for paginated query, personnel and equipment ops, provenance, template cloning and directory; service-level operations shared by UI and AI.
- [x] Test agent writes RED for scoped filters including >200 matches and cursor consistency, exact before/after, no preview side effects, equipment upsert preservation, unknown delta rejection, stale plan, source+target conflicts and all-or-nothing. (Written by the controller directly per user instruction; no separate RED snapshot was archived.)
- [x] Run `node --test tests/batch-workflow.test.js`; record RED.
- [x] One writer implements shared operations and explicit schemas; `node --test tests/batch-workflow.test.js tests/tools.test.js tests/application.test.js` passes.
- [x] Controller reviews stale-plan protection, complete tool parity and safe item keys.

## Responsibility 4: Renderer and client workflow
**Files:** `src/render.js`, `src/client-ui.js`, `src/client-policy.js`, generated `client.js` built only after writers finish; tests `tests/game-ui.test.js` and `tests/game-render.test.js`.
**Interfaces:** Consume metadata/coverage from areas 1–3, `plan` and `commitPlan`; normal names only, show unknown/partial totals as incomplete, preserve old preview modes and human drafts.
- [ ] Test agent writes RED for actual0 vs unknown, partial estimates in SVG/list/editor, escape and stacking, edit equipment safely, scoped batch preview/commit and stale-draft retention.
- [ ] Run `node --test tests/game-ui.test.js tests/game-render.test.js`; record RED.
- [ ] One writer adds structured equipment editor, details/provenance, filtered batch/template entry UI and renderer coverage. Run targeted tests, then `pnpm run build` after ensuring no simultaneous writer touches source or generated artifact.
- [ ] Controller reviews UI against every shared data operation and existing rendering tests; actual GUI verification kept separate.

## Responsibility 5: Packaged skill and documentation
**Files:** `skills/orbat-workbench/SKILL.md`, `docs/TOOLS.md`, `README.md`, appropriate skill tests; avoid editing other areas' code.
- [x] Record no-new-guidance baseline for game task; independent test agent adds pressure/retrieval scenarios and documents failure. Verify RED before changing skill. (Baseline is the earlier `docs/SKILL_TEST.md` run recorded before this upgrade.)
- [x] One writer updates existing skill for complete usable game output, provenance/uncertainty outside names, all new tool interfaces, direct totals, concurrent human preservation and compatibility limits; updates docs.
- [x] Rerun scenarios with skill and all automated skill tests; controller reads transcripts to verify. (Automated skill/provider/content tests pass; a fresh model scenario was not rerun under the user's no-delegation instruction, so model behavior is not claimed verified.)

## Responsibility 6: Integration, current data and release verification
**Files:** `docs/progress.md`, relevant tests; no direct data-file edits.
- [x] Compare all changed source against initial snapshots; run `pnpm run build && pnpm test && pnpm run check`, report exact exit and test count. Independently review model migration, conflicts, exports and GUI/tool parity. (Final: build OK, 191/191 tests, check rc=0. No formal initial-snapshot diff was automated; reviewed through git history.)
- [x] Check currently running Host is actually using new backend and client; do not promise refresh/HMR unless observed. Never launch a replacement server or mutate profile merely to force deployment. (Observed old backend: live workspace still version 1, no `knownTotal`, no new tool schemas. Documented; restart required to activate areas 2–5. No server restarted.)
- [x] Via `orbat_changes`, `orbat_read`, and revision-guarded `orbat_edit`, remove only this session's confirmed prefixes, preserve human changes, add sourced/clearly qualified game quantities and inspect rendered PNG; if running Host still old, do not claim live update, report dependency and use no unsupported direct storage edits. (3 atomic transactions rev 5→8; names/remarks cleaned; 8490 personnel / 2183 equipment; original 15-node doc untouched; PNGs read.)
- [x] Export native and compatibility versions, read them, verify totals and loss report, present final deliverables; explicitly list any unimplemented feature or unverified external-editor/browser step. (Native/loss report verified in Node tests but not via the old live Host; mil-org and mil-bundle exported and inspected; browser/original-editor import unverified.)
