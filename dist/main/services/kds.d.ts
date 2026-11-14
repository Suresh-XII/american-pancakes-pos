import { WebSocketServer, WebSocket } from 'ws';
export declare const KDS_AUTH_TIMEOUT_MS = 5000;
export declare const MAX_KDS_CLIENTS = 100;
export declare const MAX_UNAUTHENTICATED_KDS_CLIENTS = 25;
export declare function getKdsClientCount(): number;
export declare function closeKdsClientForTest(ws: WebSocket, message?: string): void;
export declare function setupKdsWebSocket(wss: WebSocketServer): void;
/** Queries and serializes the snapshot for one filter signature; identical for every client sharing it. */
export declare function buildActiveOrdersSnapshot(categoryIds: string[], stationIds?: string[], restrictedPayload?: boolean): string;
export declare function notifyKdsUpdate(): void;
export declare function notifyOrderUpdated(): void;
//# sourceMappingURL=kds.d.ts.map