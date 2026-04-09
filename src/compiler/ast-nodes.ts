/**
 * NRQL-to-DQL Compiler — AST node definitions.
 * Uses discriminated unions instead of Python class hierarchy.
 */

// -- Expressions --

export interface StarExpr {
  readonly type: 'star';
}

export interface LiteralExpr {
  readonly type: 'literal';
  readonly value: string | number | boolean | null;
}

export interface FieldRef {
  readonly type: 'field';
  readonly name: string;
}

export interface FunctionCall {
  readonly type: 'function';
  readonly name: string;
  readonly args: ASTNode[];
  readonly where?: Condition;
}

export interface BinaryOp {
  readonly type: 'binary';
  readonly op: string;
  readonly left: ASTNode;
  readonly right: ASTNode;
}

export interface UnaryMinus {
  readonly type: 'unaryMinus';
  readonly expr: ASTNode;
}

export interface TimeInterval {
  readonly type: 'timeInterval';
  readonly value: number;
  readonly unit: string;
}

export type ASTNode =
  | StarExpr
  | LiteralExpr
  | FieldRef
  | FunctionCall
  | BinaryOp
  | UnaryMinus
  | TimeInterval
  | Condition;

// -- Conditions --

export interface ComparisonCond {
  readonly type: 'comparison';
  readonly op: string;
  readonly left: ASTNode;
  readonly right: ASTNode;
}

export interface LogicalCond {
  readonly type: 'logical';
  readonly op: 'and' | 'or';
  readonly left: Condition;
  readonly right: Condition;
}

export interface NotCond {
  readonly type: 'not';
  readonly inner: Condition;
}

export interface IsNullCond {
  readonly type: 'isNull';
  readonly expr: ASTNode;
  readonly negated: boolean;
}

export interface InListCond {
  readonly type: 'inList';
  readonly expr: ASTNode;
  readonly values: ASTNode[];
  readonly negated: boolean;
}

export interface InSubqueryCond {
  readonly type: 'inSubquery';
  readonly expr: ASTNode;
  readonly subquery: Query;
  readonly negated: boolean;
}

export interface LikeCond {
  readonly type: 'like';
  readonly expr: ASTNode;
  readonly pattern: string;
  readonly negated: boolean;
}

export interface RLikeCond {
  readonly type: 'rlike';
  readonly expr: ASTNode;
  readonly pattern: string;
  readonly negated: boolean;
}

export type Condition =
  | ComparisonCond
  | LogicalCond
  | NotCond
  | IsNullCond
  | InListCond
  | InSubqueryCond
  | LikeCond
  | RLikeCond;

// -- Clauses --

export interface SelectItem {
  readonly expression: ASTNode;
  readonly alias?: string;
}

export interface FacetItem {
  readonly expression: ASTNode;
  readonly alias?: string;
}

export interface TimeseriesClause {
  readonly interval?: string;
  readonly slideBy?: string;
}

export interface LimitClause {
  readonly value: number | 'MAX';
}

export interface OrderByClause {
  readonly expression: ASTNode;
  readonly direction: 'ASC' | 'DESC';
}

export interface JoinClause {
  readonly joinType: 'INNER' | 'LEFT';
  readonly subquery: Query;
  readonly onLeft?: string;
  readonly onRight?: string;
}

export interface Query {
  readonly selectItems: SelectItem[];
  readonly fromClause: string;
  readonly where?: Condition;
  readonly facetItems?: FacetItem[];
  readonly timeseries?: TimeseriesClause;
  readonly sinceRaw?: string;
  readonly untilRaw?: string;
  readonly limit?: LimitClause;
  readonly orderBy?: OrderByClause;
  readonly compareWithRaw?: string;
  readonly extrapolate: boolean;
  readonly joinClause?: JoinClause;
  readonly facetOrderBy?: ASTNode;
  readonly withTimezone?: string;
  readonly predict: boolean;
}
