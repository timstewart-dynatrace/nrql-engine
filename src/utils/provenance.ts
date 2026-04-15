/**
 * `migrated.from=newrelic` provenance stamping helpers (P15-12).
 *
 * Stamps every Gen3 transformer output with a stable marker so that
 * the Phase 15 `runAudit()` drift detector (P15-02) can distinguish
 * migrated entities from manually-created ones. The pattern is
 * back-ported from the Python project's `_looks_migrated()` heuristic
 * in `migration/audit.py`.
 *
 * Three complementary stamps; consumers apply one or more depending
 * on the output shape:
 *
 *   1. **Name-prefix marker** — `[Migrated]` / `[Migrated Legacy]` /
 *      `[Migrated AIOps]` etc. Already used throughout the codebase.
 *   2. **Properties marker** — `{ migrated.from: 'newrelic' }` folded
 *      into a settings payload or `eventTemplate.properties`.
 *   3. **Description tag** — `migrated from NR` phrase in the
 *      description string.
 */

export const PROVENANCE_MARKER = { 'migrated.from': 'newrelic' } as const;

export const PROVENANCE_NAME_PREFIXES: ReadonlyArray<string> = [
  '[Migrated]',
  '[Migrated Legacy]',
  '[Migrated SLv3]',
  '[Migrated AIOps]',
  '[Migrated AIOps v2]',
  '[Migrated Export]',
  '[Migrated CertCheck]',
  '[Migrated BrokenLinks]',
  '[Migrated KeyTx]',
  '[Migrated MultiLocation]',
  '[Migrated mute',
  '[Migrated Security]',
  '[Migrated enrichment]',
  '[Migrated v2 enrichment]',
  '[Migrated Davis]',
  '[Migrated Apdex]',
  '[Migrated naming',
];

/** Regex for quick identification of migrated name prefixes. */
export const PROVENANCE_PREFIX_REGEX = /^\[Migrated\b/;

/**
 * Merge the provenance marker into an existing properties-like
 * object. Returns a new object so callers that hold a readonly input
 * get a safe copy.
 */
export function withProvenance<T extends Record<string, unknown>>(
  properties: T | undefined,
): T & typeof PROVENANCE_MARKER {
  return { ...(properties ?? ({} as T)), ...PROVENANCE_MARKER } as T &
    typeof PROVENANCE_MARKER;
}

/**
 * Return a description string with the migration source appended when
 * it isn't already present.
 */
export function stampDescription(description: string | undefined): string {
  const base = description?.trim() ?? '';
  if (/migrated\s+(?:from|via)\s+new\s*relic/i.test(base)) return base;
  return base ? `${base} · migrated from NR` : 'migrated from NR';
}

/**
 * `_looks_migrated()` heuristic (TS port of Python audit.py logic).
 *
 * Accepts any DT object shape — we only inspect a handful of well-known
 * property paths (`displayName`, `name`, `properties`, `description`,
 * `dashboardMetadata.name`, `tags`).
 */
export function looksMigrated(entity: unknown): boolean {
  if (!entity || typeof entity !== 'object') return false;
  const e = entity as Record<string, unknown>;

  // Name / displayName prefix
  const nameCandidates: Array<unknown> = [
    e['displayName'],
    e['name'],
    (e['metadata'] as Record<string, unknown> | undefined)?.['name'],
    (e['dashboardMetadata'] as Record<string, unknown> | undefined)?.['name'],
    (e['summary'] as unknown),
    (e['title'] as unknown),
  ];
  for (const n of nameCandidates) {
    if (typeof n === 'string' && PROVENANCE_PREFIX_REGEX.test(n)) return true;
  }

  // Properties stamp
  const props = e['properties'];
  if (
    props &&
    typeof props === 'object' &&
    (props as Record<string, unknown>)['migrated.from'] === 'newrelic'
  ) {
    return true;
  }

  // eventTemplate.properties (metric-event shape)
  const evTemplate = e['eventTemplate'];
  if (evTemplate && typeof evTemplate === 'object') {
    const evProps = (evTemplate as Record<string, unknown>)['properties'];
    if (
      evProps &&
      typeof evProps === 'object' &&
      (evProps as Record<string, unknown>)['migrated.from'] === 'newrelic'
    ) {
      return true;
    }
  }

  // Tags containing `nr-migrated`
  const tags = e['tags'];
  if (Array.isArray(tags)) {
    for (const t of tags as unknown[]) {
      if (typeof t === 'string' && t.toLowerCase().includes('nr-migrated'))
        return true;
      if (t && typeof t === 'object') {
        const tag = t as Record<string, unknown>;
        if (
          tag['key'] === 'nr-migrated' ||
          (typeof tag['key'] === 'string' &&
            (tag['key'] as string).toLowerCase().includes('nr-migrated'))
        ) {
          return true;
        }
      }
    }
  } else if (tags && typeof tags === 'object') {
    const tagMap = tags as Record<string, unknown>;
    if ('nr-migrated' in tagMap || 'migrated.from' in tagMap) return true;
  }

  // entityTags map (workflow shape)
  const entityTags = e['entityTags'];
  if (entityTags && typeof entityTags === 'object') {
    const et = entityTags as Record<string, unknown>;
    if ('nr-migrated' in et) return true;
  }

  // Description phrase
  const desc = e['description'];
  if (typeof desc === 'string' && /migrated\s+(?:from|via)\s+new\s*relic/i.test(desc)) {
    return true;
  }

  return false;
}
