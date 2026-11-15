// Evidence-aware quantity metadata, per the Common Contract in
// docs/superpowers/plans/2026-11-15-orbat-game-workflow.md.
//
// Layout:
//   node.custom.orbat = { version: 1, personnel?: {status, source?},
//                         equipmentList?: {status, source?}, observedTotals?: {...} }
//   equipment item     = { name, count, ..., orbat: {status, source?} }
//
// Only a node `custom.orbat` carrying numeric `version: 1` is workbench
// evidence. Any other same-named object (no version, another version, a plain
// legacy value) is unrelated custom data: it is preserved verbatim and never
// interpreted. Equipment item `orbat` has no version in the contract, so an
// `orbat` key that is present there is always evidence and is validated.
//
// All malformed evidence fails closed with OrbatError; it is never coerced,
// dropped or reinterpreted.
import { OrbatError, isPlainObject } from './model.js';

export const EVIDENCE_STATUSES = Object.freeze([
  'actual',
  'standard',
  'estimate',
  'unknown',
  'legacy-ambiguous',
]);

const STATUS_SET = new Set(EVIDENCE_STATUSES);

export const WORKBENCH_ORBAT_VERSION = 1;

// Common Contract: optional string fields on a source annotation.
export const SOURCE_FIELDS = Object.freeze([
  'title',
  'url',
  'page',
  'date',
  'method',
  'note',
]);

const SOURCE_FIELD_SET = new Set(SOURCE_FIELDS);

function fail(code, message, details = {}) {
  throw new OrbatError(code, message, details);
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) {
    fail('invalid_evidence', `${label} 必须是普通对象`, { field: label });
  }
  return value;
}

function validateStatus(record, label) {
  if (!Object.hasOwn(record, 'status') || record.status === undefined) {
    fail('invalid_evidence_status', `${label}.status 缺失`, { field: `${label}.status` });
  }
  const status = record.status;
  if (typeof status !== 'string' || !STATUS_SET.has(status)) {
    fail('invalid_evidence_status', `${label}.status 非法: ${String(status)}`, {
      field: `${label}.status`,
      value: status,
      allowed: EVIDENCE_STATUSES,
    });
  }
  return status;
}

function validateSource(source, label) {
  if (!isPlainObject(source)) {
    fail('invalid_evidence_source', `${label} 必须是普通对象`, { field: label });
  }
  for (const field of Object.keys(source)) {
    if (!SOURCE_FIELD_SET.has(field)) continue;
    if (typeof source[field] !== 'string') {
      fail('invalid_evidence_source', `${label}.${field} 必须是字符串`, {
        field: `${label}.${field}`,
      });
    }
  }
  return source;
}

/**
 * Validate one `{status, source?}` evidence record. Evidence records are only
 * ever created by us, so a present record must declare a status: an empty or
 * status-less record is malformed rather than silently treated as legacy.
 */
function validateEvidenceRecord(record, label) {
  requirePlainObject(record, label);
  validateStatus(record, label);
  if (Object.hasOwn(record, 'source') && record.source !== undefined) {
    validateSource(record.source, label);
  }
  return record;
}

/** True only for the versioned workbench namespace. */
export function isWorkbenchOrbat(custom) {
  if (!isPlainObject(custom) || !Object.hasOwn(custom, 'orbat')) return false;
  const orbat = custom.orbat;
  return isPlainObject(orbat) && orbat.version === WORKBENCH_ORBAT_VERSION;
}

/**
 * Validate workbench evidence nested in a node `custom` value (already passed
 * through the generic safe-JSON normalizer). Foreign `custom` shapes, including
 * an `orbat` namespace without `version: 1`, are returned untouched.
 */
export function normalizeNodeEvidence(custom, label = 'custom') {
  if (!isPlainObject(custom) || !Object.hasOwn(custom, 'orbat')) return custom;
  const orbat = custom.orbat;
  if (!isPlainObject(orbat)) return custom;
  if (orbat.version !== WORKBENCH_ORBAT_VERSION) return custom;

  const at = `${label}.orbat`;
  if (Object.hasOwn(orbat, 'personnel')) {
    validateEvidenceRecord(orbat.personnel, `${at}.personnel`);
  }
  if (Object.hasOwn(orbat, 'equipmentList')) {
    validateEvidenceRecord(orbat.equipmentList, `${at}.equipmentList`);
  }
  if (Object.hasOwn(orbat, 'observedTotals')) {
    // Source totals are annotations only: plain safe JSON, never aggregated.
    requirePlainObject(orbat.observedTotals, `${at}.observedTotals`);
  }
  return custom;
}

/**
 * Validate and return an equipment entry's `orbat` metadata. Item metadata is
 * the versionless `{status, source?}` shape from the Common Contract.
 */
export function normalizeItemEvidence(entry, label = 'equipment') {
  if (!isPlainObject(entry)) return entry;
  if (!Object.hasOwn(entry, 'orbat')) return entry;
  validateEvidenceRecord(entry.orbat, `${label}.orbat`);
  return entry;
}

/**
 * Read the versioned evidence namespace of a normalized node, if any. Evidence
 * is only ever read from an OWN `custom.orbat`: an `orbat` reached through the
 * prototype chain is unrelated data (prototype-pollution safety).
 */
export function nodeEvidence(node) {
  const custom = node?.custom;
  if (!isPlainObject(custom) || !Object.hasOwn(custom, 'orbat')) return null;
  const orbat = custom.orbat;
  if (!isPlainObject(orbat) || orbat.version !== WORKBENCH_ORBAT_VERSION) return null;
  return orbat;
}

function itemEvidence(item) {
  // Item evidence is only an OWN, plain `orbat` object; inherited or malformed
  // same-named values are unrelated data and never aggregated.
  if (!isPlainObject(item) || !Object.hasOwn(item, 'orbat')) return null;
  const orbat = item.orbat;
  return isPlainObject(orbat) ? orbat : null;
}

function coverageTotals() {
  return {
    personnel: { known: 0, unknown: 0, estimated: 0, legacyAmbiguous: 0 },
    equipment: {
      // Plain object (not a Map/null-prototype object) so the public shape stays
      // JSON/deep-equal friendly; `__proto__`-like names are defined as own
      // enumerable data properties instead of hitting the prototype setter.
      known: {},
      knownTotal: 0,
      unknown: 0,
      estimated: 0,
      legacyAmbiguous: 0,
    },
  };
}

/** Record a known equipment subtotal, safely even for names like `__proto__`. */
function addKnown(equipmentCoverage, name, count) {
  const previous = Object.hasOwn(equipmentCoverage.known, name)
    ? equipmentCoverage.known[name]
    : 0;
  Object.defineProperty(equipmentCoverage.known, name, {
    value: previous + count,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  equipmentCoverage.knownTotal += count;
}

/**
 * Compute personnel/equipment completeness coverage for an already validated
 * tree. Legacy scalar stats stay untouched: this only annotates how much of the
 * recorded quantity is actually known.
 *
 * Personnel: explicit actual/standard/estimate values are known; estimate also
 * adds to `estimated`; unknown and legacy-ambiguous count affected nodes; an
 * unlabelled non-zero value is recorded legacy (known); an unlabelled zero is
 * ambiguous, never silently a real zero or an unknown.
 *
 * Equipment: `known` maps each equipment name to its known subtotal (`knownTotal`
 * sums those subtotals). actual/standard quantities are known; estimate
 * quantities are known and also sum into `estimated`; unknown items and
 * legacy-ambiguous items count affected records and never contribute to
 * `known`. A status-less non-zero item is recorded legacy (known); a
 * status-less zero item is ambiguous, never a confirmed zero. A list-level
 * `unknown`/`legacy-ambiguous` counts the list once (not per item), and an
 * unannotated empty list is legacy-ambiguous rather than "none"; an explicitly
 * actual/standard empty list is a known empty list.
 */
export function computeCoverage(root) {
  const coverage = coverageTotals();

  const walk = (node) => {
    const evidence = nodeEvidence(node);

    const personnelStatus = evidence?.personnel?.status;
    if (personnelStatus === 'unknown') {
      coverage.personnel.unknown += 1;
    } else if (personnelStatus === 'legacy-ambiguous') {
      coverage.personnel.legacyAmbiguous += 1;
    } else if (personnelStatus === 'estimate') {
      coverage.personnel.known += node.personnel;
      coverage.personnel.estimated += node.personnel;
    } else if (personnelStatus === 'actual' || personnelStatus === 'standard') {
      coverage.personnel.known += node.personnel;
    } else if (personnelStatus === undefined) {
      if (node.personnel > 0) coverage.personnel.known += node.personnel;
      else coverage.personnel.legacyAmbiguous += 1;
    }

    const equipmentCoverage = coverage.equipment;
    const listStatus = evidence?.equipmentList?.status;
    if (listStatus === 'unknown') {
      equipmentCoverage.unknown += 1;
    } else if (listStatus === 'legacy-ambiguous') {
      equipmentCoverage.legacyAmbiguous += 1;
    } else if (listStatus === undefined && node.equipment.length === 0) {
      // No list evidence and nothing recorded: legacy ambiguity, not "none".
      equipmentCoverage.legacyAmbiguous += 1;
    }

    for (const item of node.equipment) {
      const status = itemEvidence(item)?.status;
      if (status === 'actual' || status === 'standard') {
        addKnown(equipmentCoverage, item.name, item.count);
      } else if (status === 'estimate') {
        addKnown(equipmentCoverage, item.name, item.count);
        equipmentCoverage.estimated += item.count;
      } else if (status === 'unknown') {
        equipmentCoverage.unknown += 1;
      } else if (status === 'legacy-ambiguous') {
        equipmentCoverage.legacyAmbiguous += 1;
      } else if (status === undefined) {
        if (item.count > 0) addKnown(equipmentCoverage, item.name, item.count);
        else equipmentCoverage.legacyAmbiguous += 1;
      }
    }

    for (const child of node.children) walk(child);
  };

  walk(root);
  return coverage;
}

/** An aggregate is incomplete (label it so) when any unknown/ambiguous remains. */
export function isIncomplete(coverage) {
  if (!coverage) return false;
  return Boolean(
    coverage.personnel?.unknown > 0 ||
    coverage.personnel?.legacyAmbiguous > 0 ||
    coverage.equipment?.unknown > 0 ||
    coverage.equipment?.legacyAmbiguous > 0,
  );
}
