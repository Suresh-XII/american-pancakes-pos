import { Request, Response, NextFunction } from 'express';
export { getServerPort, getLocalIP, getAllLocalIPs } from './server-state';
/** JWT verification middleware protecting API routes from unauthenticated LAN access. Exported so tests can assert its path exemptions. */
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
export declare function isServerRunning(): boolean;
/** Resolve a clean application route to its own Next.js static-export page. */
export declare function resolveStaticPage(frontendDir: string, reqPath: string): string;
export declare function startServer(): Promise<void>;
export declare function stopServer(): Promise<void>;
//# sourceMappingURL=server.d.ts.map