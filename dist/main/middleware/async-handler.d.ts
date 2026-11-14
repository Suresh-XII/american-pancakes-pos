import { Request, Response, NextFunction, RequestHandler } from 'express';
/** Wrap async Express handler so rejected promises flow to the global error handler. */
export declare function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler;
//# sourceMappingURL=async-handler.d.ts.map