// Compiler
export { NRQLCompiler, type CompileResult, type TranslationNotes } from './compiler/index.js';
export { NRQLLexer, LexError } from './compiler/index.js';
export { NRQLParser, ParseError } from './compiler/index.js';
export { DQLEmitter } from './compiler/index.js';
export { TokenType, type Token } from './compiler/index.js';
export type { ASTNode, Condition, Query, SelectItem, FacetItem } from './compiler/index.js';

// Validators
export { DQLSyntaxValidator, type DQLValidationError, type DQLValidationResult } from './validators/index.js';
export { DQLFixer } from './validators/index.js';

// Transformers
export { type TransformResult } from './transformers/types.js';
export {
  DashboardTransformer,
  AlertTransformer,
  NotificationTransformer,
  SyntheticTransformer,
  SLOTransformer,
  WorkloadTransformer,
  InfrastructureTransformer,
  LogParsingTransformer,
  TagTransformer,
  DropRuleTransformer,
} from './transformers/index.js';
export { RegexToDPLConverter } from './transformers/converters.js';
export { EntityMapper, VISUALIZATION_TYPE_MAP, ALERT_PRIORITY_MAP } from './transformers/mapping-rules.js';

// Clients
export { NewRelicClient, type NerdGraphResponse } from './clients/index.js';
export { DynatraceClient, type DynatraceResponse, type ImportResult } from './clients/index.js';

// Config
export { getSettings, resetSettings, type NewRelicConfig, type DynatraceConfig, type MigrationConfig } from './config/index.js';
export { AVAILABLE_COMPONENTS, COMPONENT_DEPENDENCIES } from './config/index.js';

// Registry
export { DTEnvironmentRegistry } from './registry/index.js';
export { SLOAuditor } from './registry/index.js';

// Migration
export {
  RollbackManifest,
  EntityIdMap,
  MigrationCheckpoint,
  IncrementalState,
} from './migration/index.js';
export { FailedEntities } from './migration/index.js';
export { DiffReport, type DiffEntry } from './migration/index.js';
