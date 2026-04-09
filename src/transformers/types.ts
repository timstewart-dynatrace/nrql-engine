/**
 * Shared types used across all transformers.
 *
 * Provides the core result interface and transformer contract
 * that every entity transformer implements.
 */

/**
 * Result of a transformation operation.
 * Every transformer method returns this shape.
 */
export interface TransformResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly warnings: string[];
  readonly errors: string[];
}

/**
 * Contract for entity transformers.
 * Each transformer converts a New Relic entity to a Dynatrace entity.
 */
export interface Transformer<TInput, TOutput> {
  transform(input: TInput): TransformResult<TOutput>;
  transformAll(inputs: TInput[]): TransformResult<TOutput>[];
}

/**
 * Factory to create a successful TransformResult.
 */
export function success<T>(data: T, warnings: string[] = []): TransformResult<T> {
  return { success: true, data, warnings, errors: [] };
}

/**
 * Factory to create a failed TransformResult.
 */
export function failure<T>(errors: string[], warnings: string[] = []): TransformResult<T> {
  return { success: false, warnings, errors };
}
