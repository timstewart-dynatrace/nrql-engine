/**
 * Custom Instrumentation Translator — Identifies `newrelic.*()` call
 * sites in customer source code and emits replacement suggestions
 * against the Dynatrace OneAgent SDK / OpenTelemetry SDK / bizevent
 * ingest API.
 *
 * **Never rewrites files.** Consumers (CLIs, IDE plugins, code
 * reviewers) feed source text in and get back a list of
 * `TranslationSuggestion` objects they can surface as diffs, diff
 * comments, or PR suggestions. The transformer is pure — no I/O, no
 * side effects.
 *
 * Ported from the Python `transformers/custom_instrumentation_translator.py`
 * pattern catalog; the regex dialect is kept language-aware per language
 * key because NR APIs vary slightly between clients (Node callbacks vs.
 * Python decorators vs. Java annotations).
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRInstrumentationLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'java';

export interface NRInstrumentationInput {
  readonly language: NRInstrumentationLanguage;
  readonly file: string;
  readonly sourceText: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type NRApiCategory =
  | 'custom_event'
  | 'custom_attribute'
  | 'custom_metric'
  | 'error_capture'
  | 'transaction_naming'
  | 'segment';

export type ReplacementConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TranslationSuggestion {
  readonly language: NRInstrumentationLanguage;
  readonly file: string;
  readonly line: number;
  readonly original: string;
  readonly replacement: string;
  readonly apiCategory: NRApiCategory;
  readonly confidence: ReplacementConfidence;
  readonly note?: string;
}

export interface CustomInstrumentationTransformData {
  readonly suggestions: TranslationSuggestion[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Pattern catalog
// ---------------------------------------------------------------------------

interface PatternDef {
  readonly regex: RegExp;
  readonly apiCategory: NRApiCategory;
  readonly confidence: ReplacementConfidence;
  readonly replacement: (match: RegExpMatchArray) => string;
  readonly note?: string;
}

const PATTERNS: Record<NRInstrumentationLanguage, PatternDef[]> = {
  javascript: [
    {
      regex: /newrelic\.recordCustomEvent\s*\(\s*(['"][^'"]+['"])\s*,\s*(\{[\s\S]*?\})\s*\)/g,
      apiCategory: 'custom_event',
      confidence: 'HIGH',
      replacement: (m) =>
        `fetch('/platform/ingest/v1/events.bizevents', { method: 'POST', headers: { 'Authorization': 'Api-Token <token>' }, body: JSON.stringify({ 'event.type': ${m[1]}, ...${m[2]} }) })`,
    },
    {
      regex: /newrelic\.addCustomAttribute\s*\(\s*(['"][^'"]+['"])\s*,\s*([^)]+)\)/g,
      apiCategory: 'custom_attribute',
      confidence: 'HIGH',
      replacement: (m) => `oneagent.addCustomRequestAttribute(${m[1]}, ${m[2]})`,
      note: 'Requires @dynatrace/oneagent-sdk; import { oneagent } from "@dynatrace/oneagent-sdk".',
    },
    {
      regex: /newrelic\.recordMetric\s*\(\s*(['"][^'"]+['"])\s*,\s*([^)]+)\)/g,
      apiCategory: 'custom_metric',
      confidence: 'MEDIUM',
      replacement: (m) => `meter.createCounter(${m[1]}).add(${m[2]})`,
      note: 'OTel Meter API; requires a MeterProvider configured to export to DT OTLP.',
    },
    {
      regex: /newrelic\.noticeError\s*\(\s*([^)]+)\)/g,
      apiCategory: 'error_capture',
      confidence: 'HIGH',
      replacement: (m) => `oneagent.reportError(${m[1]})`,
    },
    {
      regex: /newrelic\.setTransactionName\s*\(\s*([^,)]+)(?:\s*,\s*([^)]+))?\)/g,
      apiCategory: 'transaction_naming',
      confidence: 'MEDIUM',
      replacement: (m) =>
        `// DT request-naming rules are server-side settings (builtin:service.request-naming-rule); emit a rule that matches the caller and names it "${m[1]?.replace(/['"]/g, '')}${m[2] ? ':' + m[2]?.replace(/['"]/g, '') : ''}"`,
      note: 'DT request naming is configured in Settings, not at the call site. The emitted replacement is a comment pointing to the rule.',
    },
    {
      regex: /newrelic\.startSegment\s*\(\s*(['"][^'"]+['"])[^)]*\)/g,
      apiCategory: 'segment',
      confidence: 'MEDIUM',
      replacement: (m) => `tracer.startActiveSpan(${m[1]}, span => { /* body */ span.end(); })`,
      note: 'OTel Tracer span replaces NR segment; ensure tracer is initialized against DT OTLP.',
    },
  ],
  typescript: [], // populated post-declaration from JavaScript patterns
  python: [
    {
      regex: /newrelic\.agent\.record_custom_event\s*\(\s*(['"][^'"]+['"])\s*,\s*(\{[\s\S]*?\})\s*\)/g,
      apiCategory: 'custom_event',
      confidence: 'HIGH',
      replacement: (m) =>
        `requests.post('/platform/ingest/v1/events.bizevents', headers={'Authorization': 'Api-Token <token>'}, json={'event.type': ${m[1]}, **${m[2]}})`,
    },
    {
      regex: /newrelic\.agent\.add_custom_(?:attribute|parameter)\s*\(\s*(['"][^'"]+['"])\s*,\s*([^)]+)\)/g,
      apiCategory: 'custom_attribute',
      confidence: 'HIGH',
      replacement: (m) => `oneagent.get_sdk().add_custom_request_attribute(${m[1]}, ${m[2]})`,
      note: 'Requires the oneagent-sdk-python package.',
    },
    {
      regex: /newrelic\.agent\.record_custom_metric\s*\(\s*(['"][^'"]+['"])\s*,\s*([^)]+)\)/g,
      apiCategory: 'custom_metric',
      confidence: 'MEDIUM',
      replacement: (m) => `meter.create_counter(${m[1]}).add(${m[2]})`,
    },
    {
      regex: /newrelic\.agent\.record_exception\s*\(\s*([^)]+)\)/g,
      apiCategory: 'error_capture',
      confidence: 'HIGH',
      replacement: (m) => `oneagent.get_sdk().trace_incoming_web_request().mark_error(type(${m[1]}).__name__, str(${m[1]}))`,
    },
    {
      regex: /newrelic\.agent\.set_transaction_name\s*\(\s*([^,)]+)(?:\s*,\s*([^)]+))?\)/g,
      apiCategory: 'transaction_naming',
      confidence: 'MEDIUM',
      replacement: (m) =>
        `# DT request-naming rule needed for "${m[1]?.replace(/['"]/g, '')}"`,
      note: 'Configure at DT Settings level, not in code.',
    },
  ],
  java: [
    {
      regex: /NewRelic\.getAgent\(\)\.getInsights\(\)\.recordCustomEvent\s*\(\s*(".*?")\s*,\s*([^)]+)\)/g,
      apiCategory: 'custom_event',
      confidence: 'HIGH',
      replacement: (m) =>
        `// POST to /platform/ingest/v1/events.bizevents with { "event.type": ${m[1]}, attributes: ${m[2]} }`,
    },
    {
      regex: /NewRelic\.addCustomParameter\s*\(\s*(".*?")\s*,\s*([^)]+)\)/g,
      apiCategory: 'custom_attribute',
      confidence: 'HIGH',
      replacement: (m) =>
        `OneAgentSDK.getInstance().traceIncomingWebRequest().addCustomRequestAttribute(${m[1]}, ${m[2]})`,
    },
    {
      regex: /NewRelic\.recordMetric\s*\(\s*(".*?")\s*,\s*([^)]+)\)/g,
      apiCategory: 'custom_metric',
      confidence: 'MEDIUM',
      replacement: (m) =>
        `GlobalOpenTelemetry.getMeter("migrated").counterBuilder(${m[1]}).build().add(${m[2]})`,
    },
    {
      regex: /NewRelic\.noticeError\s*\(\s*([^)]+)\)/g,
      apiCategory: 'error_capture',
      confidence: 'HIGH',
      replacement: (m) =>
        `OneAgentSDK.getInstance().traceIncomingWebRequest().markFailedWith(${m[1]})`,
    },
    {
      regex: /NewRelic\.setTransactionName\s*\(\s*([^,)]+)\s*,\s*([^)]+)\)/g,
      apiCategory: 'transaction_naming',
      confidence: 'MEDIUM',
      replacement: (m) => `// DT request-naming rule: ${m[1]}:${m[2]}`,
    },
  ],
};

// TypeScript shares the JS call surface.
PATTERNS.typescript = PATTERNS.javascript;

const MANUAL_STEPS: string[] = [
  'Suggestions emitted here are code-review aids, not automatic rewrites. Review each before applying.',
  'HIGH-confidence suggestions have a 1:1 DT equivalent; MEDIUM means the replacement is structurally correct but requires initialization (OTel Tracer/Meter, OneAgent SDK import); LOW means manual translation is required.',
  'Before applying replacements, add the DT SDK dependency to your build file (package.json / requirements.txt / pom.xml).',
  'Transaction-naming calls become DT Settings rules — the emitted replacement is a comment pointing at the rule, not in-source code.',
];

function lineOf(sourceText: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < sourceText.length; i++) {
    if (sourceText[i] === '\n') line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// CustomInstrumentationTransformer
// ---------------------------------------------------------------------------

export class CustomInstrumentationTransformer {
  transform(
    input: NRInstrumentationInput,
  ): TransformResult<CustomInstrumentationTransformData> {
    try {
      if (!input.language) return failure(['language is required']);
      const patterns = PATTERNS[input.language];
      if (!patterns) {
        return failure([`Unsupported language '${input.language}'`]);
      }

      const suggestions: TranslationSuggestion[] = [];

      for (const p of patterns) {
        // Each PatternDef carries a stateful /g regex; reset between inputs
        // so prior invocations don't skip matches.
        p.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = p.regex.exec(input.sourceText)) !== null) {
          const s: TranslationSuggestion = {
            language: input.language,
            file: input.file,
            line: lineOf(input.sourceText, match.index),
            original: match[0],
            replacement: p.replacement(match),
            apiCategory: p.apiCategory,
            confidence: p.confidence,
            ...(p.note ? { note: p.note } : {}),
          };
          suggestions.push(s);
        }
      }

      return success(
        { suggestions, manualSteps: MANUAL_STEPS },
        suggestions.length === 0
          ? [`No NR instrumentation calls detected in ${input.file}.`]
          : [...MANUAL_STEPS],
      );
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    inputs: NRInstrumentationInput[],
  ): TransformResult<CustomInstrumentationTransformData>[] {
    return inputs.map((i) => this.transform(i));
  }
}
