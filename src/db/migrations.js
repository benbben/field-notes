// Schema migration helpers.
//
// Keep this module pure (no DB or React imports) so the Dexie upgrade,
// JSON import, encrypted restore and the Node test-suite can all share it.
//
// Schema history
//   1  original: sessions carried four free-text fields
//      (context_text, reflection_in_moment, reflection_day_after, reflection_post)
//   2  single `notes` field replaces the four; legacy text is merged into it.

export const SCHEMA_VERSION = 2;
export const EXPORT_SCHEMA_V1 = 'field-notes/1';
export const EXPORT_SCHEMA_V2 = 'field-notes/2';
export const EXPORT_SCHEMA = EXPORT_SCHEMA_V2;
export const SUPPORTED_EXPORT_SCHEMAS = [EXPORT_SCHEMA_V1, EXPORT_SCHEMA_V2];

export const LEGACY_TEXT_FIELDS = [
  'context_text',
  'reflection_in_moment',
  'reflection_day_after',
  'reflection_post',
];

const REFLECTION_HEADERS = [
  ['reflection_in_moment', 'In the moment:'],
  ['reflection_day_after', 'Day after:'],
  ['reflection_post', 'Post-integration:'],
];

function text(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// The legacy fields of a session merged into one block of text.
// Order: context (no header), then each reflection under its header.
// Blocks are separated by a blank line. Empty fields are skipped.
export function mergeLegacyFields(s) {
  const blocks = [];
  const ctx = text(s.context_text);
  if (ctx) blocks.push(ctx);
  for (const [key, header] of REFLECTION_HEADERS) {
    const v = text(s[key]);
    if (v) blocks.push(`${header}\n${v}`);
  }
  return blocks.join('\n\n');
}

// Notes for a session of any schema version.
// - A record that already carries `notes` keeps them (idempotent on v2 rows).
// - Legacy text is merged in; if both exist (a record touched by mixed versions),
//   the legacy text is appended after the existing notes so nothing is lost.
// - All empty -> ''.
export function mergeLegacy(s) {
  if (!s) return '';
  const existing = typeof s.notes === 'string' ? s.notes : '';
  const legacy = mergeLegacyFields(s);
  if (!legacy) return existing;
  if (!existing.trim()) return legacy;
  if (existing.includes(legacy)) return existing;
  return `${existing}\n\n${legacy}`;
}

// Mutates a session record in place from the v1 shape to the v2 shape.
// Safe to call on an already-migrated record (no-op apart from ensuring `notes` is a string).
export function migrateSessionRecord(s) {
  if (!s) return s;
  s.notes = mergeLegacy(s);
  for (const k of LEGACY_TEXT_FIELDS) delete s[k];
  // Older edit flows snapshotted the doses array onto the session row; doses live
  // in their own table and the snapshot only ever went stale, so drop it.
  if (Array.isArray(s.doses)) delete s.doses;
  return s;
}

// Returns a new v2-shaped session from any v1/v2 session (non-mutating).
export function toV2Session(s) {
  return migrateSessionRecord({ ...s });
}

export function isSupportedExportSchema(schema) {
  return SUPPORTED_EXPORT_SCHEMAS.includes(schema);
}

function checkRows(rows, name, requiredKeys) {
  if (rows === undefined || rows === null) return [];
  if (!Array.isArray(rows)) {
    throw new Error(`Malformed Field Notes export: "${name}" must be a list.`);
  }
  rows.forEach((row, i) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Malformed Field Notes export: ${name}[${i}] is not a record.`);
    }
    for (const k of requiredKeys) {
      if (typeof row[k] !== 'string' || !row[k]) {
        throw new Error(`Malformed Field Notes export: ${name}[${i}] is missing "${k}".`);
      }
    }
  });
  return rows;
}

// Normalises an export payload of any supported schema to the v2 shape.
// Throws a clear error for anything else (wrong schema, malformed rows).
export function normalizeExportPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Not a Field Notes export file');
  }
  if (!isSupportedExportSchema(payload.schema)) {
    throw new Error(
      `Unsupported export schema "${payload.schema ?? 'unknown'}". ` +
      `This app can import ${SUPPORTED_EXPORT_SCHEMAS.join(' and ')}.`
    );
  }
  const sessions = checkRows(payload.sessions, 'sessions', ['id']).map(toV2Session);
  const doses = checkRows(payload.doses, 'doses', ['id', 'session_id']);
  const strains = checkRows(payload.strains, 'strains', ['id']);
  const batches = checkRows(payload.batches, 'batches', ['id']);
  return {
    ...payload,
    schema: EXPORT_SCHEMA_V2,
    sessions,
    doses,
    strains,
    batches,
  };
}
