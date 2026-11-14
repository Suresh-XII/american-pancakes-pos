"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireMasterPin = requireMasterPin;
const master_pin_1 = require("../services/master-pin");
/** Requires master_pin in request body; rate limit is scoped per-route. */
function requireMasterPin(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const routeKey = req.baseUrl + req.path;
    const result = (0, master_pin_1.authorizeMasterPin)(req.body?.master_pin, `http:${ip}:${routeKey}`);
    if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
    }
    next();
}
//# sourceMappingURL=master-pin.js.map