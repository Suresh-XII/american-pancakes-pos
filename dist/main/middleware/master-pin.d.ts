import { Request, Response, NextFunction } from 'express';
/** Requires master_pin in request body; rate limit is scoped per-route. */
export declare function requireMasterPin(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=master-pin.d.ts.map