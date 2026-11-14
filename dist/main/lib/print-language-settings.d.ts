import { type KotLanguagePolicy, type ReceiptLanguagePolicy } from '../../shared/print';
export declare const BILL_LANGUAGE_POLICY_KEY = "bill_language_policy";
export declare const KOT_LANGUAGE_POLICY_KEY = "kot_language_policy";
export declare const Z_REPORT_LANGUAGE_POLICY_KEY = "z_report_language_policy";
export declare const LANGUAGE_POLICY_SETTING_KEYS: ReadonlySet<string>;
/** Canonical JSON stored when a tenant has not customized the policy. */
export declare function defaultLanguagePolicySettingJson(): string;
export type LanguagePolicyValidation = {
    ok: true;
    stored: string;
} | {
    ok: false;
    error: string;
};
/** Validate an untrusted policy value for a language-policy settings key. */
export declare function validateLanguagePolicySetting(key: string, value: unknown): LanguagePolicyValidation;
export type StoredPrintLanguagePolicy = ReceiptLanguagePolicy | KotLanguagePolicy;
/** Lenient read-side parse of a stored policy, falling back to default. */
export declare function parseStoredLanguagePolicy(key: string, stored: string | undefined): StoredPrintLanguagePolicy;
//# sourceMappingURL=print-language-settings.d.ts.map