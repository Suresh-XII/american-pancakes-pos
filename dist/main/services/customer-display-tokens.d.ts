import { getDatabase } from '../db';
import { CUSTOMER_DISPLAY_STATUSES, type CustomerDisplayConfig } from './customer-display-config';
export interface CustomerDisplayTokenSummary {
    id: string;
    label: string;
    created_at: string;
    last_seen_at: string | null;
}
export interface CustomerDisplayFeed {
    business_name: string;
    config: CustomerDisplayConfig;
    orders: Array<{
        id: number;
        number: string;
        status: string;
    }>;
    next_cursor: string | null;
    has_more: boolean;
}
export interface CustomerDisplayFeedOptions {
    cursor?: string;
}
export interface DisplayFeedCursor {
    created_at: string;
    id: number;
}
export interface BoardEligibleOrderRow {
    id: number;
    order_number: string;
    status: string;
    created_at: string;
}
export type CustomerDisplayBoardStatus = (typeof CUSTOMER_DISPLAY_STATUSES)[number];
export declare function parseBoardStatuses(raw: unknown): CustomerDisplayBoardStatus[] | null;
export declare class DisplayFeedPaginationError extends Error {
    constructor(message: string);
}
export declare function normalizeTokenLabel(value: unknown): string | null;
export declare function activeTokenCount(): number;
export declare function hasReachedTokenLimit(): boolean;
/** Creates a token and returns the plaintext once; only its hash is stored. */
export declare function createDisplayToken(label: string, createdBy: string | null): {
    id: `${string}-${string}-${string}-${string}-${string}`;
    label: string;
    created_at: string;
    last_seen_at: null;
    token: string;
};
export declare function listDisplayTokens(): CustomerDisplayTokenSummary[];
/** Returns true when an active token was revoked. */
export declare function revokeDisplayToken(id: string): boolean;
/** Resolves a presented token to its id, or null when unknown or revoked. */
export declare function verifyDisplayToken(token: string): string | null;
export declare function touchDisplayToken(id: string): void;
export declare function collectProjectedCompletedOrderIds(db: ReturnType<typeof getDatabase>, statuses: ReadonlyArray<CustomerDisplayBoardStatus>, cursor?: DisplayFeedCursor | null): number[];
export declare function selectBoardEligibleOrderPage(db: ReturnType<typeof getDatabase>, options: {
    statuses: ReadonlyArray<CustomerDisplayBoardStatus>;
    cursor?: DisplayFeedCursor | null;
    limit: number;
}): {
    pageRows: BoardEligibleOrderRow[];
    hasMore: boolean;
    nextCursor: DisplayFeedCursor | null;
};
/** Sanitized board data: order numbers and statuses only, never customer or staff fields. */
export declare function buildDisplayFeed(options?: CustomerDisplayFeedOptions): CustomerDisplayFeed;
//# sourceMappingURL=customer-display-tokens.d.ts.map