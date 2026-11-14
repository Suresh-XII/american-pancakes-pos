/**
 * Shared WhatsApp automation contract, pure template renderer, defaults,
 * and safety helpers used by both the Electron/Express main process and
 * the Next.js frontend.
 */
export declare const WHATSAPP_AUTOMATION_SETTING_KEY = "whatsapp_automation_config";
export declare const WHATSAPP_PLACEHOLDER_GROUPS: {
    readonly customer: readonly ["customer_name", "customer_phone", "visit_count", "last_visit_date", "total_spent"];
    readonly order: readonly ["bill_no", "order_date", "order_items", "total", "payment_method"];
    readonly loyalty: readonly ["points_earned", "points_balance", "points_value"];
    readonly store: readonly ["store_name", "store_phone", "feedback_link", "instagram"];
};
export type WhatsAppPlaceholderCategory = keyof typeof WHATSAPP_PLACEHOLDER_GROUPS;
export type WhatsAppPlaceholderKey = (typeof WHATSAPP_PLACEHOLDER_GROUPS)[WhatsAppPlaceholderCategory][number];
export declare const WHATSAPP_PLACEHOLDER_KEYS: readonly WhatsAppPlaceholderKey[];
export type WhatsAppTemplateContext = Record<WhatsAppPlaceholderKey, string | number | null | undefined>;
export type WhatsAppTriggerType = 'after_payment' | 'feedback_delay' | 'winback' | 'points_threshold' | 'nth_visit' | 'z_report_day_close';
export type WhatsAppRuleAttribution = WhatsAppTriggerType | 'broadcast';
export interface WhatsAppTemplate {
    id: string;
    name: string;
    body: string;
}
export interface WhatsAppAutomationRule {
    id: WhatsAppTriggerType;
    trigger: WhatsAppTriggerType;
    enabled: boolean;
    templateId: string;
    /** Hours after bill settlement (`feedback_delay`). */
    delayHours?: number;
    /** Days since last customer visit (`winback`). */
    inactiveDays?: number;
    /** Minimum loyalty points balance (`points_threshold`). */
    pointsThreshold?: number;
    /** Paid visit milestone count (`nth_visit`). */
    nthVisit?: number;
    /** Explicit owner-configured E.164 recipient phone (`z_report_day_close`). */
    recipientPhone?: string;
}
export interface WhatsAppSafetyConfig {
    autoOptOutEnabled: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    maxPerCustomerPerWeek: number;
    feedbackLink: string;
}
export interface WhatsAppAutomationConfig {
    templates: WhatsAppTemplate[];
    rules: WhatsAppAutomationRule[];
    safety: WhatsAppSafetyConfig;
}
export declare const DEFAULT_WHATSAPP_TEMPLATES: readonly WhatsAppTemplate[];
export declare const DEFAULT_WHATSAPP_RULES: readonly WhatsAppAutomationRule[];
export declare const DEFAULT_WHATSAPP_SAFETY: WhatsAppSafetyConfig;
export declare const DEFAULT_WHATSAPP_AUTOMATION_CONFIG: WhatsAppAutomationConfig;
export declare const SAMPLE_WHATSAPP_TEMPLATE_CONTEXT: Record<WhatsAppPlaceholderKey, string>;
export interface WhatsAppPlaceholderDefinition {
    key: WhatsAppPlaceholderKey;
    token: string;
    category: WhatsAppPlaceholderCategory;
    label: string;
    sample: string;
}
export declare const WHATSAPP_PLACEHOLDERS: readonly WhatsAppPlaceholderDefinition[];
/**
 * Pure single-pass placeholder renderer. Values substituted from customer/order
 * records are never re-parsed for `{...}` tokens, preventing template injection.
 */
export declare function renderWhatsAppTemplate(templateBody: string, context: Partial<WhatsAppTemplateContext>): string;
export declare function buildSampleWhatsAppContext(overrides?: Partial<WhatsAppTemplateContext>): Record<WhatsAppPlaceholderKey, string>;
export declare function resolveWhatsAppRuleTrigger(raw: unknown): WhatsAppTriggerType | null;
export declare function normalizeWhatsAppAutomationConfig(raw: unknown): WhatsAppAutomationConfig;
/**
 * Checks whether an inbound DM body is an opt-out keyword (STOP, UNSUBSCRIBE, OPT OUT, OPTOUT).
 */
export declare function isAutoOptOutText(body: string): boolean;
/**
 * Evaluates whether `currentHhMm` ('HH:MM') falls inside `[startHhMm, endHhMm)`.
 * Supports overnight windows (e.g. '22:00' to '09:00') and same-day windows.
 * When `endHhMm` is '23:59', the window includes the final minute of the day.
 */
export declare function isTimeWithinQuietHours(currentHhMm: string, startHhMm: string, endHhMm: string): boolean;
export declare function extractTriggerRule(createdByUserId: string | null | undefined): WhatsAppRuleAttribution | null;
//# sourceMappingURL=whatsapp-automation.d.ts.map