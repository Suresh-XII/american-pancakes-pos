/** Outbound-only cloud bridge for pushing local events and polling signed commands. */
export declare const DEFAULT_CLOUD_SERVER_URL = "https://blue.flopos.com/";
export declare class CloudRequestError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export type SupportTicketInput = {
    client_ticket_id: string;
    subject: string;
    severity?: 'low' | 'normal' | 'high' | 'urgent';
    event_code?: string;
    correlation_id?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    message: string;
    diagnostics?: Record<string, unknown> | null;
    /** Tail of the app's log file at submission time, when the user opted to attach it. */
    log_tail?: string;
};
/** Tier 2 store-attributed diagnostic event payload without customer PII or order data. */
export type DiagnosticEventInput = {
    event_id: string;
    event_code: string;
    severity: 'debug' | 'info' | 'warn' | 'error' | 'critical';
    correlation_id?: string;
    message?: string;
    metadata?: Record<string, unknown>;
    occurred_at: string;
};
/** A locally captured failure, as the diagnostics screen and the copy-for-support bundle see it. */
export type LocalDiagnostic = {
    id: number;
    event_code: string;
    severity: string;
    error_class: string;
    signature: string;
    summary: string;
    metadata?: Record<string, unknown>;
    occurred_at: string;
    created_at: string;
};
/** Allowlist of event codes; built from this list, never filtered from a wider set afterwards. */
declare const DIAGNOSTIC_EVENT_CODES: readonly ["order.place.failed", "order.place.rejected", "order.place.unreachable", "order.place.storage_unavailable", "order.create.failed", "payment.batch.failed", "server.internal_error", "print.receipt.failed", "print.kot.failed"];
type DiagnosticEventCode = (typeof DIAGNOSTIC_EVENT_CODES)[number];
export declare const ALLOWED_DIAGNOSTIC_EVENT_CODES: Set<"server.internal_error" | "order.place.failed" | "order.place.rejected" | "order.place.unreachable" | "order.place.storage_unavailable" | "order.create.failed" | "payment.batch.failed" | "print.receipt.failed" | "print.kot.failed">;
/** Upper bound on both the local failure log and the undelivered outbox. Oldest rows are evicted first. */
export declare const DIAGNOSTIC_LOG_MAX_ROWS = 200;
export declare function isAllowedDiagnosticEventCode(value: unknown): value is DiagnosticEventCode;
declare const DIAGNOSTICS_GAP_REASONS: readonly ["queue_eviction", "permanent_rejection", "invalid_ack", "report_id_mismatch", "local_retention"];
type DiagnosticsGapReason = (typeof DIAGNOSTICS_GAP_REASONS)[number];
export declare function normalizeCloudServerUrl(raw?: string | null): string;
export declare class CloudSyncService {
    private heartbeatTimer;
    private outboxTimer;
    private supportOutboxTimer;
    private diagnosticsOutboxTimer;
    private commandTimer;
    private settings;
    private flushing;
    private outboxFlushPromise;
    private pollingCommands;
    private relaySocket;
    private relayPingTimer;
    private relayAwaitingPong;
    private relayHeartbeatFrameTimer;
    private relayReconnectTimer;
    private relayReconnectAttempts;
    private httpFallbackActive;
    private relayMode;
    private supportFlushing;
    private supportFlushPromise;
    private diagnosticsFlushing;
    private diagnosticsFlushPromise;
    private cloudDeletionInProgress;
    private cloudNetworkOperations;
    private cloudNetworkIdleWaiters;
    private backgroundPromises;
    private relayCommandPromises;
    private commandPollPromises;
    private commandPollAbortController;
    private shutdownPromise;
    private shutdownRequested;
    private shutdownController;
    private autoRegisterTimer;
    private offlineAbort;
    private autoRegisterAttempts;
    private autoRegisterInFlight;
    private runtimeStarted;
    start(): void;
    reload(): void;
    resumeAfterMaintenance(): void;
    private refreshDiagnosticsOutbox;
    stop(): void;
    shutdown(): Promise<void>;
    private waitForBackgroundWork;
    private withDatabaseRequest;
    private teardownRelay;
    /** Returns whether cloud account features are available and enabled by the user. */
    isCloudAccountAvailable(): boolean;
    getStatus(): {
        cloud_server_url: string;
        cloud_pos_hash: string | null;
        cloud_pos_id: string | null;
        cloud_sync_enabled: boolean;
        cloud_orders_enabled: boolean;
        cloud_reports_enabled: boolean;
        cloud_command_polling_enabled: boolean;
        cloud_registration_status: string;
        cloud_services_disabled_by_user: boolean;
        cloud_connected: boolean;
        cloud_last_sync: string | null;
        cloud_last_heartbeat: string | null;
        cloud_last_error: string | null;
        cloud_deletion_status: string;
        cloud_deletion_outcome: string;
        cloud_deletion_blocked: boolean;
        cloud_relay_mode: "websocket" | "http_fallback" | "disconnected";
        outbox_pending: number;
        outbox_failed: number;
        loaded: boolean;
    };
    register(signal?: AbortSignal): Promise<Record<string, unknown>>;
    testConnection(signal?: AbortSignal): Promise<Record<string, unknown>>;
    getEmailPreferences(signal?: AbortSignal, serverUrlOverride?: string): Promise<Record<string, unknown>>;
    updateEmailPreferences(preferences: {
        product_updates?: boolean;
        marketing?: boolean;
    }, signal?: AbortSignal): Promise<Record<string, unknown>>;
    requestEmailVerification(preferences?: {
        product_updates?: boolean;
        marketing?: boolean;
        source?: string;
    }, signal?: AbortSignal, serverUrlOverride?: string): Promise<Record<string, unknown>>;
    private isDevCloudRecoveryAllowed;
    isTrustedRecoveryServerUrl(rawUrl?: string): boolean;
    private resolveTrustedRecoveryServerUrl;
    private hasMatchingActiveOwnerEmail;
    /** True when cloud services are on and the store has an active owner matching the registered email. */
    isEmailRecoveryAvailable(): boolean;
    isOwnerEmailVerified(signal?: AbortSignal): Promise<boolean>;
    /** Sends the verification email when the owner email is unverified; returns whether it already is. */
    ensureOwnerEmailVerification(signal?: AbortSignal): Promise<boolean>;
    /** The owner email the store registered with, which FloAdmin mails the reset link to. */
    getRegisteredOwnerEmail(): string;
    private passwordResetCall;
    requestPasswordReset(signal?: AbortSignal): Promise<Record<string, unknown>>;
    getPasswordResetStatus(resetId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
    redeemPasswordReset(resetId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
    stopAllCloudServices(signal?: AbortSignal): Promise<Record<string, unknown>>;
    deleteCloudData(signal?: AbortSignal): Promise<Record<string, unknown>>;
    getDeletionRequestStatus(options?: {
        allowRemote?: boolean;
        signal?: AbortSignal;
    }): Promise<Record<string, unknown> | null>;
    cancelDeletionRequest(signal?: AbortSignal): Promise<Record<string, unknown>>;
    /** Persists and synchronizes an explicit local diagnostics choice. */
    setDiagnosticsConsent(enabled: boolean, signal?: AbortSignal): Promise<void>;
    private postDiagnosticsConsent;
    private reconcileDiagnosticsConsent;
    /** Queue a support request durably; the caller can be offline. */
    queueSupportTicket(input: SupportTicketInput, signal?: AbortSignal): Promise<{
        queued: boolean;
        client_ticket_id: string;
    }>;
    private flushSupportTicketOutbox;
    reportDiagnostic(input: DiagnosticEventInput, error?: unknown): void;
    /** Capture a registry-approved occurrence into the bounded local hourly aggregate. */
    captureOperationFailure(input: {
        capture_point: unknown;
        outcome: unknown;
        correlation_id?: unknown;
        facts?: unknown;
        occurred_at?: unknown;
    }): void;
    /** Safe counts for the diagnostics screen; never includes report bytes or raw errors. */
    listDiagnosticDeliveryHealth(): {
        effective_consent: boolean;
        transmission_enabled: boolean;
        consent_sync_pending: boolean;
        delayed: boolean;
        transport: 'signed' | 'anonymous' | 'local' | 'disabled';
        pending_reports: number;
        pending_occurrences: number;
        pending_aggregates: number;
        pending_aggregate_occurrences: number;
        permanently_rejected_reports: number;
        gaps: Array<{
            reason_code: DiagnosticsGapReason;
            count: number;
        }>;
    };
    /** Recent locally captured failures, newest first, for the diagnostics screen. */
    listLocalDiagnostics(limit?: number): LocalDiagnostic[];
    /** Remove every locally captured failure. Nothing has been transmitted, so nothing is withdrawn. */
    clearLocalDiagnostics(): number;
    private flushDiagnosticsOutbox;
    private markDiagnosticReportDelivered;
    private markDiagnosticReportRejected;
    private retryDiagnosticReport;
    /** Generate or rotate the RevFlo pairing code for this store. */
    generatePairingCode(revoke: boolean): Promise<{
        code: string;
        expires_at: string;
    }>;
    /** Devices (RevFlo installs) currently paired to this store. */
    listPairedDevices(): Promise<Record<string, unknown>[]>;
    recordOrderChanged(orderId: number | string, eventType?: string): void;
    sendOrderStatus(orderflowOrderId: string, status: string, note?: string): void;
    private buildHeartbeatPayload;
    /** HTTP fallback path — used only while the WSS relay is unavailable. */
    private sendHeartbeat;
    /** Primary path — heartbeat carried as a frame on the open relay connection. */
    private sendRelayHeartbeat;
    private enqueueEvent;
    private flushOutbox;
    private failSendingRows;
    private pollCommands;
    private executeCommand;
    /** Same as executeCommand, but for a command pushed over the relay socket — result goes back as a frame, not a POST. */
    private executeRelayCommand;
    private trackRelayCommand;
    private trackCommandPoll;
    /** Register on startup to sync updated store metadata with FloAdmin. */
    private maybeAutoRegister;
    /** Aborts in-flight FloAdmin requests when Offline mode is switched on. */
    suspendForOfflineMode(): void;
    /** Refresh FloAdmin after setup or store-profile settings change. */
    refreshRegistrationProfile(): void;
    private attemptAutoRegister;
    private maybeStartRelay;
    private connectRelay;
    private onRelayOpen;
    private onRelayMessage;
    private onRelayClosed;
    private scheduleRelayReconnect;
    /** Degraded mode — same HTTP command-poll/heartbeat behavior the POS shipped with before the relay existed. */
    private startHttpFallback;
    private stopHttpFallback;
    /** Apply feature flags only when values changed to avoid relay reconnect storms. */
    private applyFeatures;
    private runCommand;
    private healthPayload;
    private liveOrders;
    private getOrder;
    private salesReport;
    private dashboardReport;
    private hourlyReport;
    private itemsReport;
    private paymentsReport;
    private paymentBreakdown;
    private buildOrderSnapshot;
    private decorateOrder;
    private decorateOrders;
    /** Shared HMAC signing used by every signed HTTP call and the relay WS handshake — see floadmin.md § Identity & request signing. */
    private buildSignedHeaders;
    private signedFetch;
    private runBackground;
    private trackedFetch;
    private drainResponse;
    private waitForCloudNetworkIdle;
    private loadSettings;
    private readSettings;
    private upsertSettings;
    private countOutbox;
    private markError;
}
export declare const cloudSync: CloudSyncService;
export {};
//# sourceMappingURL=cloud-sync.d.ts.map