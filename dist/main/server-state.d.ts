export declare function getServerPort(): number;
export declare function setServerPort(port: number): void;
/** Scores an interface address for LAN pairing; higher is better, physical LAN adapters win over virtual or tunnel adapters. */
export declare function rankLocalIPv4(interfaceName: string, address: string): number;
/** Returns the best-ranked valid non-loopback IPv4 address on the machine. */
export declare function getLocalIP(): string;
/** Returns all valid non-loopback IPv4 addresses on the machine, best-ranked first. */
export declare function getAllLocalIPs(): string[];
//# sourceMappingURL=server-state.d.ts.map