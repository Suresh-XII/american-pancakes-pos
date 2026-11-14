"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerDisplayFeedRoutes = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const customer_display_tokens_1 = require("../services/customer-display-tokens");
const router = (0, express_1.Router)();
exports.customerDisplayFeedRoutes = router;
const feedRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
// Exempt from the JWT middleware by exact path; this handler is the only credential check,
// and a display token is not a JWT so it cannot authorize any other route.
router.get('/feed', feedRateLimit, (req, res) => {
    try {
        const header = req.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
        const tokenId = token ? (0, customer_display_tokens_1.verifyDisplayToken)(token) : null;
        if (!tokenId) {
            return res.status(401).json({ error: 'Display not paired' });
        }
        let cursor;
        if (req.query.cursor !== undefined) {
            if (typeof req.query.cursor !== 'string' || req.query.cursor.length === 0) {
                return res.status(400).json({ error: 'Invalid cursor' });
            }
            cursor = req.query.cursor;
        }
        const feed = (0, customer_display_tokens_1.buildDisplayFeed)({ cursor });
        (0, customer_display_tokens_1.touchDisplayToken)(tokenId);
        res.setHeader('Cache-Control', 'no-store');
        res.json(feed);
    }
    catch (error) {
        if (error instanceof customer_display_tokens_1.DisplayFeedPaginationError) {
            return res.status(400).json({ error: error.message });
        }
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
//# sourceMappingURL=customer-display-feed.js.map