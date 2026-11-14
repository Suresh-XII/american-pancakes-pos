import { Request, Response, NextFunction } from 'express';
interface RateLimitOptions {
    windowMs?: number;
    max?: number;
    message?: string;
    skipSuccessfulRequests?: boolean;
    /** When false, private/LAN IPs are NOT exempt — use for auth endpoints. Default: true. */
    bypassPrivateIp?: boolean;
}
/** Canonicalizes an IP address for rate-limit bucketing so equivalent forms share budget. */
export declare function normalizeIpForRateLimit(ip: string): string;
/** In-memory rate limiter for local Express API keyed by canonicalized IP. */
export declare function rateLimit(options?: RateLimitOptions): (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
/** Shared volume rate limiter across default login endpoints (:3001, :3002, :3003). */
export declare function loginAuthRateLimit(options?: {
    max?: number;
}): import("express-rate-limit").RateLimitRequestHandler;
export declare function resetSharedLoginAuthRateLimiter(): void;
/** Stricter rate limiter for authentication endpoints; private/LAN IPs are not exempt. */
export declare function authRateLimit(options?: {
    max?: number;
    skipSuccessfulRequests?: boolean;
    onRateLimited?: (req: Request, res: Response) => void;
}): import("express-rate-limit").RateLimitRequestHandler;
export declare const FAILED_LOGIN_MAX_ATTEMPTS = 5;
export declare const FAILED_LOGIN_LOCKOUT_MINUTES = 15;
export declare function checkLoginRateLimit(ip: string): {
    allowed: boolean;
    waitMinutes?: number;
};
export declare function incrementFailedLogin(ip: string): number;
export declare function resetSuccessfulLogin(ip: string): void;
export declare function clearLoginRateLimits(): void;
export declare const PIN_MAX_ATTEMPTS = 5;
export declare const PIN_WINDOW_MS: number;
export declare function checkPinRateLimit(key: string): boolean;
export declare function isPinRateLimited(key: string): boolean;
export declare function clearPinRateLimit(key: string): void;
export declare function resetPinRateLimitForTests(): void;
/**
 * Serializes PIN verification for the given rateLimitKey to ensure that
 * simultaneous invalid requests do not execute redundant bcrypt computations
 * in parallel before the failure counter is updated.
 */
export declare function withPinVerificationLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
/** Shared rate limiter for static/SPA file serving with private IP bypass. */
export declare function staticRouteRateLimit(options?: {
    windowMs?: number;
    limit?: number;
}): import("express-rate-limit").RateLimitRequestHandler;
/** Caches user active status, current role, and tokens_valid_after timestamp. */
export declare function getUserAuthStatus(userId: string, options?: {
    fresh?: boolean;
}): {
    isActive: boolean;
    role: string;
    tokensValidAfter: string | null;
} | null;
/** Forces next requireAuth check for user to re-read DB instead of cache. */
export declare function invalidateUserAuthCache(userId: string): void;
export declare function clearUserAuthCache(): void;
/** True if token iat predates user tokens_valid_after (e.g. after password/PIN change). */
export declare function isTokenStale(iat: number | undefined, tokensValidAfter: string | null | undefined): boolean;
export declare function revokeToken(token: string, verifiedExpiresAtMs?: number): void;
export declare function isTokenRevoked(token: string): boolean;
export declare function clearInMemoryRevokedTokens(): void;
export declare function clearRevokedTokens(): void;
/** Role-based authorization middleware (must follow requireAuth). */
export declare function requireRole(...roles: readonly string[]): (req: Request, res: Response, next: () => void) => Response<any, Record<string, any>> | undefined;
/** Gates authenticated KDS REST endpoints behind the kds_enabled setting. */
export declare function requireKdsEnabled(req: Request, res: Response, next: () => void): Response<any, Record<string, any>> | undefined;
/** Gates KDS pairing endpoints behind kds_enabled, returning 404 when disabled. */
export declare function requireKdsEnabledOr404(req: Request, res: Response, next: () => void): Response<any, Record<string, any>> | undefined;
/** Checks if IP address is private, local, or Tailscale IP. */
export declare function isAllowedPrivateIp(ip: string): boolean;
/** Checks if an IP address is disallowed as an outbound fetch target for SSRF protection. */
export declare function isBlockedSsrfTarget(ip: string): boolean;
export declare const corsOptions: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void;
};
/** The single password policy shared by backend routes and frontend forms. */
export { validatePassword } from '../../shared/password-policy';
//# sourceMappingURL=security.d.ts.map