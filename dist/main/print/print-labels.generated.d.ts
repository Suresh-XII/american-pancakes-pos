import type { PrintConceptId } from '../../shared/print/concepts';
export type { PrintConceptId } from '../../shared/print/concepts';
export declare const PRINT_LABEL_LANGUAGES: readonly ["en", "es", "de", "tr", "th", "fil", "fr", "it", "pt", "ru", "fa", "ar", "ur", "ja", "zh", "zh-tw", "ko", "id", "nl", "hi", "bn", "sq", "vi", "ne"];
export type PrintLabelLanguage = (typeof PRINT_LABEL_LANGUAGES)[number];
/**
 * Resolve a receipt/KOT label concept in the requested language.
 * Unknown languages and unknown languages missing individual entries fall
 * back to English so a receipt always renders real labels, never raw keys.
 */
export declare function printLabel(lang: string, conceptId: PrintConceptId): string;
/** True when the generated view carries a dedicated table for `lang`. */
export declare function isGeneratedPrintLanguage(lang: string): lang is PrintLabelLanguage;
//# sourceMappingURL=print-labels.generated.d.ts.map