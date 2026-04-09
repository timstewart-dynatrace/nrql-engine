/**
 * NRQL-to-DQL Compiler — Token definitions and keyword mappings.
 */

export enum TokenType {
  // Keywords
  SELECT = 'SELECT',
  FROM = 'FROM',
  WHERE = 'WHERE',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  AS = 'AS',
  FACET = 'FACET',
  TIMESERIES = 'TIMESERIES',
  SINCE = 'SINCE',
  UNTIL = 'UNTIL',
  LIMIT = 'LIMIT',
  IN = 'IN',
  LIKE = 'LIKE',
  RLIKE = 'RLIKE',
  IS = 'IS',
  NULL = 'NULL',
  TRUE = 'TRUE',
  FALSE = 'FALSE',
  COMPARE = 'COMPARE',
  WITH = 'WITH',
  ORDER = 'ORDER',
  BY = 'BY',
  ASC = 'ASC',
  DESC = 'DESC',
  EXTRAPOLATE = 'EXTRAPOLATE',
  AUTO = 'AUTO',
  RAW = 'RAW',
  AGO = 'AGO',
  CASES = 'CASES',
  OFFSET = 'OFFSET',
  MAX_KW = 'MAX_KW',

  // Literals & identifiers
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  IDENTIFIER = 'IDENTIFIER',

  // Operators
  EQ = 'EQ',
  NEQ = 'NEQ',
  LT = 'LT',
  GT = 'GT',
  LTE = 'LTE',
  GTE = 'GTE',
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  STAR = 'STAR',
  SLASH = 'SLASH',
  PERCENT = 'PERCENT',

  // Punctuation
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  COMMA = 'COMMA',

  // End
  EOF = 'EOF',
}

export interface Token {
  readonly type: TokenType;
  readonly value: string | number | null;
  readonly pos: number;
}

export const KEYWORDS: ReadonlyMap<string, TokenType> = new Map([
  ['select', TokenType.SELECT],
  ['from', TokenType.FROM],
  ['where', TokenType.WHERE],
  ['and', TokenType.AND],
  ['or', TokenType.OR],
  ['not', TokenType.NOT],
  ['as', TokenType.AS],
  ['facet', TokenType.FACET],
  ['timeseries', TokenType.TIMESERIES],
  ['since', TokenType.SINCE],
  ['until', TokenType.UNTIL],
  ['limit', TokenType.LIMIT],
  ['in', TokenType.IN],
  ['like', TokenType.LIKE],
  ['rlike', TokenType.RLIKE],
  ['is', TokenType.IS],
  ['null', TokenType.NULL],
  ['true', TokenType.TRUE],
  ['false', TokenType.FALSE],
  ['compare', TokenType.COMPARE],
  ['with', TokenType.WITH],
  ['order', TokenType.ORDER],
  ['by', TokenType.BY],
  ['asc', TokenType.ASC],
  ['desc', TokenType.DESC],
  ['extrapolate', TokenType.EXTRAPOLATE],
  ['auto', TokenType.AUTO],
  ['raw', TokenType.RAW],
  ['ago', TokenType.AGO],
  ['cases', TokenType.CASES],
  ['offset', TokenType.OFFSET],
]);

export const NON_KEYWORD_IDENTS: ReadonlySet<string> = new Set([
  'count', 'average', 'sum', 'max', 'min', 'rate', 'filter',
  'percentage', 'percentile', 'uniquecount', 'latest', 'earliest',
  'uniques', 'median', 'stddev', 'apdex', 'funnel', 'histogram',
  'substring', 'indexof', 'length', 'concat', 'lower', 'upper',
  'abs', 'ceil', 'floor', 'round', 'if', 'capture', 'aparse',
  'bytecountestimate', 'allcolumnsearch', 'cardinality',
  'cdfpercentage', 'derivative', 'eventtype', 'getfield',
  'keyset', 'mapkeys', 'mapvalues',
  // Phase 2+3 additions
  'jparse', 'blob', 'clamp_max', 'clamp_min', 'ln',
  'buckets', 'bucketpercentile', 'predictlinear',
  'aggregationendtime', 'inner', 'left', 'join', 'on',
  'slide', 'predict', 'show', 'event', 'types', 'timezone',
]);
