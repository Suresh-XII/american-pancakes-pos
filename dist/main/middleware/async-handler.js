"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = asyncHandler;
const shutdown_1 = require("../shutdown");
/** Wrap async Express handler so rejected promises flow to the global error handler. */
function asyncHandler(fn) {
    return (req, res, next) => {
        const operation = Promise.resolve().then(() => fn(req, res, next));
        (0, shutdown_1.trackHttpRequestWork)(req, operation).catch(next);
    };
}
//# sourceMappingURL=async-handler.js.map