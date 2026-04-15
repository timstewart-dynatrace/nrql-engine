/**
 * `toMonacoYaml` — pure-data helper that converts a Dynatrace Settings
 * 2.0 envelope into the Monaco configuration-as-code YAML shape.
 *
 * Back-ported from the Python `Dynatrace-NewRelic` `exporters/monaco.py`
 * renderer, minus the filesystem half. This helper returns a YAML
 * string only — consumers (CLIs, Dynatrace apps) handle file writes.
 *
 * The envelope shape accepted here matches what the transformers emit:
 * `{ schemaId, displayName?, ...fields }`. One envelope → one Monaco
 * config block. Multiple envelopes (the common case) concatenate into
 * a single YAML document.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface DtSettingsEnvelope {
  readonly schemaId: string;
  readonly displayName?: string;
  readonly objectId?: string;
  readonly scope?: string;
  readonly value: Record<string, unknown>;
}

export interface MonacoYamlOptions {
  /** Two-space indent by default; Monaco accepts either. */
  readonly indentSpaces?: number;
  /** When true, emits `---` document separator between envelopes. */
  readonly documentSeparators?: boolean;
}

// ---------------------------------------------------------------------------
// Minimal YAML serializer (dependency-free; sufficient for DT envelopes)
// ---------------------------------------------------------------------------

function needsQuoting(s: string): boolean {
  if (!s) return true;
  if (/^\s|\s$/.test(s)) return true;
  if (/[:#&*!|>'"%@`,\[\]\{\}]/.test(s)) return true;
  if (/^(?:true|false|null|yes|no|on|off|~|-?\d+(?:\.\d+)?)$/i.test(s))
    return true;
  return false;
}

function escapeDouble(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function emitScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  const s = String(v);
  return needsQuoting(s) ? `"${escapeDouble(s)}"` : s;
}

function emitValue(v: unknown, indent: string, step: string): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return v
      .map(
        (item) =>
          `\n${indent}- ${emitValue(item, indent + step, step).replace(/^\n/, '')}`,
      )
      .join('');
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, val]) => {
        const key = needsQuoting(k) ? `"${escapeDouble(k)}"` : k;
        const nested = emitValue(val, indent + step, step);
        if (nested.startsWith('\n')) {
          return `\n${indent}${key}:${nested}`;
        }
        return `\n${indent}${key}: ${nested}`;
      })
      .join('');
  }
  return emitScalar(v);
}

// ---------------------------------------------------------------------------
// Public helper
// ---------------------------------------------------------------------------

/**
 * Convert one or more DT Settings 2.0 envelopes to a Monaco YAML string.
 */
export function toMonacoYaml(
  envelopes: DtSettingsEnvelope[] | DtSettingsEnvelope,
  options?: MonacoYamlOptions,
): string {
  const list = Array.isArray(envelopes) ? envelopes : [envelopes];
  if (list.length === 0) return '';

  const indentSpaces = options?.indentSpaces ?? 2;
  const step = ' '.repeat(indentSpaces);
  const separate = options?.documentSeparators === true;

  const blocks = list.map((env) => {
    const slug =
      (env.displayName ?? env.objectId ?? env.schemaId)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'entry';

    const monacoBlock: Record<string, unknown> = {
      configs: [
        {
          id: slug,
          config: {
            name: env.displayName ?? slug,
            parameters: {
              scope: env.scope ?? 'environment',
            },
            template: `${slug}.json`,
          },
          type: {
            settings: {
              schema: env.schemaId,
              schemaVersion: '1.0.0',
            },
          },
        },
      ],
    };

    // Emit the top-level mapping without a leading document marker, then
    // append the payload as a separate `# value:` comment so operators can
    // paste the JSON into the generated template file.
    const yaml = emitValue(monacoBlock, '', step).replace(/^\n/, '');
    const jsonPayload = JSON.stringify(env.value, null, 2);
    return `${yaml}\n# template payload (save as ${slug}.json):\n# ${jsonPayload.split('\n').join('\n# ')}`;
  });

  if (!separate) return blocks.join('\n---\n');
  return '---\n' + blocks.join('\n---\n') + '\n';
}
