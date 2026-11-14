import { type LocalePreferences } from '../countries';
import { WHATSAPP_AUTOMATION_SETTING_KEY, WHATSAPP_PLACEHOLDER_KEYS, WHATSAPP_PLACEHOLDER_GROUPS, WHATSAPP_PLACEHOLDERS, DEFAULT_WHATSAPP_AUTOMATION_CONFIG, DEFAULT_WHATSAPP_TEMPLATES, DEFAULT_WHATSAPP_RULES, DEFAULT_WHATSAPP_SAFETY, SAMPLE_WHATSAPP_TEMPLATE_CONTEXT, renderWhatsAppTemplate, buildSampleWhatsAppContext, normalizeWhatsAppAutomationConfig, resolveWhatsAppRuleTrigger, isAutoOptOutText, isTimeWithinQuietHours, extractTriggerRule, type WhatsAppPlaceholderKey, type WhatsAppPlaceholderDefinition, type WhatsAppTemplateContext, type WhatsAppTriggerType, type WhatsAppRuleAttribution, type WhatsAppTemplate, type WhatsAppAutomationRule, type WhatsAppSafetyConfig, type WhatsAppAutomationConfig } from '../../shared/whatsapp-automation';
export { WHATSAPP_AUTOMATION_SETTING_KEY, WHATSAPP_PLACEHOLDER_KEYS, WHATSAPP_PLACEHOLDER_GROUPS, WHATSAPP_PLACEHOLDERS, DEFAULT_WHATSAPP_AUTOMATION_CONFIG, DEFAULT_WHATSAPP_TEMPLATES, DEFAULT_WHATSAPP_RULES, DEFAULT_WHATSAPP_SAFETY, SAMPLE_WHATSAPP_TEMPLATE_CONTEXT, renderWhatsAppTemplate, buildSampleWhatsAppContext, normalizeWhatsAppAutomationConfig, resolveWhatsAppRuleTrigger, isAutoOptOutText, isTimeWithinQuietHours, extractTriggerRule, type WhatsAppPlaceholderKey, type WhatsAppPlaceholderDefinition, type WhatsAppTemplateContext, type WhatsAppTriggerType, type WhatsAppRuleAttribution, type WhatsAppTemplate, type WhatsAppAutomationRule, type WhatsAppSafetyConfig, type WhatsAppAutomationConfig, };
export declare function sanitizeLogText(value: unknown): string | null;
export declare const MAX_BODY_CHARS = 4096;
export type WhatsAppConnectionState = 'disconnected' | 'connecting' | 'waiting_qr' | 'waiting_pairing' | 'connected' | 'cooldown';
export interface WhatsAppStatus {
    enabled: boolean;
    state: WhatsAppConnectionState;
    connectedPhone: string | null;
    lastError: string | null;
    cooldownUntil: string | null;
    /** Stable reason code for frontend i18n translation of connection errors. */
    lastErrorReason?: string | null;
    offlineMode?: boolean;
    qr?: string;
    pairingCode?: string;
}
export declare const REPORT_MESSAGE_KINDS: readonly ["z_report", "daily_sales_report"];
export type ReportMessageKind = (typeof REPORT_MESSAGE_KINDS)[number];
export type MessageKind = 'bill_receipt' | 'manual_reply' | 'auto_followup' | 'z_report' | 'daily_sales_report';
export declare function isReportMessageKind(kind: unknown): kind is ReportMessageKind;
interface QueuedSend {
    phoneE164: string;
    body: string;
    billId: number | null;
    customerId: string | number | null;
    kind: MessageKind;
    userId: string | null;
    signal?: AbortSignal;
    retryMessageId?: number | null;
    preclaimedMessageId?: number | null;
}
export declare const ACK_TIMEOUT_MS: number;
export declare const ACK_SWEEP_INTERVAL_MS: number;
export declare function getStatus(): WhatsAppStatus;
export declare function getAutomationConfig(): WhatsAppAutomationConfig;
export declare function saveAutomationConfig(raw: unknown): WhatsAppAutomationConfig;
export declare function isCurrentlyQuietHours(safety?: WhatsAppSafetyConfig, nowDate?: Date): boolean;
export declare function isOverWeeklyAutomatedCap(phoneE164: string, maxPerCustomerPerWeek?: number, excludeMessageId?: number | null): boolean;
export declare function isOverRateLimit(phoneE164: string, maxPerHour?: number, skipMinGap?: boolean, excludeMessageId?: number | null): {
    limited: boolean;
    retryAfterMs?: number;
};
export declare function waitForMessageAck(messageId: number, timeoutMs?: number, signal?: AbortSignal): Promise<'sent' | 'submitted'>;
export declare function recordMessageAttemptExternalId(messageId: number, externalId: string | null | undefined): void;
/**
 * Sweeps outbound rows still in 'queued', 'seen', or 'typing' past ACK_TIMEOUT_MS
 * (or unfinished outbound rows from before startup / interrupted before socket submission
 * when includeAllUnfinished is true) and marks them 'failed' with error = 'ack_timeout'.
 */
export declare function sweepAckTimeouts(nowMs?: number, opts?: {
    includeAllUnfinished?: boolean;
}): number;
export declare function processInboundOptOut(phoneE164: string, body: string): boolean;
export declare function enable(userId: string): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function disable(): void;
export declare function connectWithQr(requestSignal?: AbortSignal): Promise<{
    ok: boolean;
    qr?: string;
    error?: string;
}>;
export declare function connectWithPairingCode(phone: string, requestSignal?: AbortSignal): Promise<{
    ok: boolean;
    code?: string;
    error?: string;
}>;
/** Aborts in-flight WhatsApp work and closes the live socket without unpairing so Offline mode can be switched off again. */
export declare function suspendForOfflineMode(): void;
/** Cancels an in-progress QR or pairing-code attempt without logging out or wiping existing registered credentials. */
export declare function cancelPairing(): void;
export declare function disconnect(): void;
export interface SendResult {
    ok: boolean;
    messageId?: number;
    error?: string;
    reason?: 'feature_off' | 'offline_mode' | 'no_phone' | 'blocked' | 'quiet_hours' | 'weekly_cap' | 'rate_limited' | 'cooldown' | 'not_connected' | 'not_on_whatsapp' | 'content_blocked' | 'not_found' | 'not_failed' | 'send_failed';
}
export declare function sendMessage(req: QueuedSend): Promise<SendResult>;
export declare function retryMessage(messageId: number, opts?: {
    userId?: string | null;
    signal?: AbortSignal;
}): Promise<SendResult>;
export interface InboxMessage {
    id: number;
    phone_e164: string;
    body: string;
    status: string;
    queued_at: string;
}
export declare function listInbox(limit: number, offset: number): InboxMessage[];
export interface SentMessageRow {
    id: number;
    phone_e164: string;
    bill_id: number | null;
    customer_id: string | number | null;
    cash_closure_id?: number | null;
    direction: 'inbound' | 'outbound';
    kind: MessageKind;
    status: string;
    body: string;
    error: string | null;
    queued_at: string;
    seen_at: string | null;
    typing_at: string | null;
    sent_at: string | null;
    delivered_at: string | null;
    read_at: string | null;
    failed_at: string | null;
    created_by_user_id: string | null;
    trigger_rule: WhatsAppRuleAttribution | null;
}
export declare function listMessages(opts: {
    direction?: 'inbound' | 'outbound';
    status?: string;
    phone?: string;
    billId?: number;
    limit: number;
    offset?: number;
    canViewReports?: boolean;
    canExportDailySales?: boolean;
}): SentMessageRow[];
export interface BlocklistRow {
    phone_e164: string;
    reason: string | null;
    blocked_at: string;
    blocked_by_user_id: string | null;
}
export declare function listBlocklist(): BlocklistRow[];
export declare function addToBlocklist(phoneE164: string, reason: string, userId: string): void;
export declare function removeFromBlocklist(phoneE164: string): boolean;
export declare function roundLoyaltyAmount(value: unknown, fractionDigits?: number): number;
export declare function buildWhatsAppTemplateContext(opts: {
    billId?: number | null;
    customerId?: string | number | null;
    pointsEarned?: number;
}): WhatsAppTemplateContext;
export declare function triggerBillPaidAutomation(billId: number, opts?: {
    pointsEarned?: number;
}): Promise<{
    triggered: WhatsAppTriggerType[];
    results: Record<string, SendResult>;
}>;
export declare function runScheduledAutomationSweep(nowMs?: number): Promise<{
    feedbackSent: number;
    winbackSent: number;
}>;
export interface BroadcastSegmentOptions {
    templateId?: string;
    minVisits?: number;
    inactiveDays?: number;
    minPoints?: number;
    limit?: number;
    signal?: AbortSignal;
}
export declare function runBroadcast(opts: BroadcastSegmentOptions): Promise<{
    ok: boolean;
    matched: number;
    attempted: number;
    sent: number;
    skipped: number;
    error?: string;
    reason?: string;
    errors: Array<{
        phone: string;
        reason?: string;
    }>;
}>;
export declare function initFromDb(): void;
export declare function handleSystemResume(): void;
export interface StoredZReportClosureRow {
    id: number;
    scope?: string;
    business_date: string;
    period_start: string;
    period_end: string;
    z_number: number;
    closed_by: string;
    notes: string | null;
    gross_collected_cents: number;
    refunded_cents: number;
    net_collected_cents: number;
    bill_count: number;
    opening_float_cents: number;
    expected_cash_cents: number;
    counted_cash_cents: number;
    variance_cents: number;
    payment_methods_json: string | null;
}
export declare function formatStoredZReportWhatsAppMessage(closure: StoredZReportClosureRow, options?: {
    language?: string;
    locale?: string;
    preferences?: LocalePreferences;
    currency?: string;
    timezone?: string;
    businessName?: string;
    closedByName?: string;
    maxChars?: number;
}): string;
export interface TriggerDayCloseZReportResult {
    ok: boolean;
    skipped?: boolean;
    messageId?: number;
    reason?: string;
    error?: string;
}
export interface ClaimedDayCloseZReportAttempt {
    messageId: number;
    phoneE164: string;
    body: string;
}
export declare function releaseClaimedDayCloseZReportAttempt(messageId: number | null | undefined): void;
export declare function claimDayCloseZReportAttempt(closureId: number): ClaimedDayCloseZReportAttempt | null;
export declare function _setTriggerDayCloseZReportInterceptor(fn: ((closureId: number, preclaimedMessageId?: number | null) => Promise<TriggerDayCloseZReportResult>) | null): void;
/**
 * Fires at most one automatic Z-report WhatsApp attempt for a completed
 * store-level day close (`scope = 'day'`). Suppresses cleanly with no queued
 * send when Offline mode or disabled WhatsApp is active, and persists failures
 * in `whatsapp_messages` for manual retry without ever auto-retrying on reconnect.
 */
export declare function triggerDayCloseZReport(closureId: number, preclaimedMessageId?: number | null): Promise<TriggerDayCloseZReportResult>;
export declare function shutdown(): Promise<void>;
export declare function requestShutdown(): void;
//# sourceMappingURL=whatsapp.d.ts.map