export interface BackendPorts {
    server: number;
    kds: number;
    serverApp: number;
}
/** Confirms all three owned HTTP services answer on /api/health for real liveness. */
export declare function probeBackendHealth(ports: BackendPorts, timeoutMs?: number): Promise<boolean>;
//# sourceMappingURL=backend-health.d.ts.map