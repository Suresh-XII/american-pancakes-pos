export { getJWTSecret, clearJWTSecretCache } from '../security/jwt-secret';
export { seedSetupProfile, ENGLISH_IDENTICAL_SEED_LANGUAGES } from '../setup/seed-data';
export declare function normalizeEmail(email: unknown): string;
export declare function parseCategoryIds(value: unknown): string[];
export declare const MAX_EMAIL_LENGTH = 254;
export declare function isValidEmail(email: string): boolean;
export declare const authRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=auth.d.ts.map