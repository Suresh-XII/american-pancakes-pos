import { getDatabase } from '../db';
/** Filipino intentionally uses the English sample data as its reviewed exception. */
export declare const ENGLISH_IDENTICAL_SEED_LANGUAGES: readonly ["fil"];
export declare function seedSetupProfile(db: ReturnType<typeof getDatabase>, profile: string, serviceModel: string, language?: string, country?: string): void;
//# sourceMappingURL=seed-data.d.ts.map