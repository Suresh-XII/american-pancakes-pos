export declare const FLO_CSV_ENCODING_COLUMN = "flo_csv_encoding";
export declare const FLO_CSV_ENCODING_QUOTE_V1 = "quote-v1";
/** CSV field serializer with spreadsheet formula neutralization (CWE-1236). */
export declare function toCsvRow(fields: (string | number | null | undefined)[]): string;
/** Doubles an original leading apostrophe before `toCsvRow` formula neutralization. */
export declare function encodeQuoteV1Field(field: string | number | null | undefined): string | number | null | undefined;
/** Serializes a CSV row using reversible `quote-v1` escaping plus spreadsheet formula neutralization. */
export declare function toQuoteV1CsvRow(fields: (string | number | null | undefined)[]): string;
/** Removes the single apostrophe added by `quote-v1` encoding. */
export declare function decodeQuoteV1Field(value: string): string;
/**
 * Decodes an unmarked legacy CSV field only when comparison with an existing
 * record's stored value proves the leading apostrophe was added by formula neutralization.
 */
export declare function decodeLegacyProvenField(csvValue: string, storedValue: string | null | undefined): string;
//# sourceMappingURL=csv.d.ts.map