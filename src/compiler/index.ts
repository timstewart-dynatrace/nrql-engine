export {
  NRQLCompiler,
  applyPhase19Uplift,
  type CompileResult,
  type TranslationNotes,
} from './compiler.js';
export { DEFAULT_METRIC_MAP } from './default-metric-map.js';
export { NRQLLexer, LexError } from './lexer.js';
export { NRQLParser, ParseError } from './parser.js';
export { DQLEmitter } from './emitter.js';
export { TokenType, type Token } from './tokens.js';
export type {
  ASTNode,
  Condition,
  Query,
  SelectItem,
  FacetItem,
  TimeseriesClause,
  LimitClause,
  OrderByClause,
  JoinClause,
} from './ast-nodes.js';
