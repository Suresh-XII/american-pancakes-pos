export type OperationOutcome = 'not_applied' | 'applied' | 'partial' | 'unknown' | 'not_applicable';
export type OperationFailureClass = 'expected_rejection' | 'unexpected_failure';
type IntegerFactRule = {
    type: 'integer';
    min: number;
    max: number;
    required?: boolean;
};
type EnumFactRule = {
    type: 'enum';
    values: readonly string[];
    required?: boolean;
};
type FactRule = IntegerFactRule | EnumFactRule;
type OperationFailureDefinition = {
    capture_point: string;
    reason_code: string;
    operation: string;
    stage: string;
    classification: OperationFailureClass;
    outcomes: readonly OperationOutcome[];
    facts: Readonly<Record<string, FactRule>>;
};
export type OperationFailure = {
    capture_point: string;
    reason_code: string;
    operation: string;
    stage: string;
    classification: OperationFailureClass;
    outcome: OperationOutcome;
    correlation_id?: string;
    facts: Record<string, number | string>;
};
/** Closed capture registry; new event tuples must be added here and to the cloud receiver. */
export declare const OPERATION_FAILURE_REGISTRY: readonly OperationFailureDefinition[];
export declare function isOperationReference(value: unknown): value is string;
/** Produces only the registered tuple and approved bounded facts, or null for any mismatch. */
export declare function serializeOperationFailure(input: {
    capture_point: unknown;
    outcome: unknown;
    correlation_id?: unknown;
    facts?: unknown;
}): OperationFailure | null;
export {};
//# sourceMappingURL=operation-failure.d.ts.map