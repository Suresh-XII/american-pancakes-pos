"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.moreAppsRoutes = void 0;
/** Returns catalog of companion apps and download QR codes for settings display. */
const express_1 = require("express");
const qrcode_1 = __importDefault(require("qrcode"));
const async_handler_1 = require("../middleware/async-handler");
const router = (0, express_1.Router)();
const MORE_APPS = [];
const REVFLO_APP = {
    id: 'revflo',
    name: 'RevFlo',
    tagline: 'See live sales, daily summaries, and reports for your store from your phone.',
    iosUrl: null,
    androidUrl: null,
    landingUrl: 'https://flopos.com/revflo',
};
async function toAppResponse(app) {
    const primaryUrl = app.iosUrl || app.androidUrl || app.landingUrl || null;
    let qrDataUrl = null;
    if (primaryUrl) {
        try {
            qrDataUrl = await qrcode_1.default.toDataURL(primaryUrl, { errorCorrectionLevel: 'M', width: 256 });
        }
        catch (err) {
            console.warn(`[MoreApps] QR generation failed for ${app.id}:`, err);
        }
    }
    return {
        id: app.id,
        name: app.name,
        tagline: app.tagline,
        ios_url: app.iosUrl,
        android_url: app.androidUrl,
        landing_url: app.landingUrl || null,
        qr_data_url: qrDataUrl,
        available: Boolean(primaryUrl),
    };
}
router.get('/', (0, async_handler_1.asyncHandler)(async (_req, res) => {
    try {
        const apps = await Promise.all(MORE_APPS.map(toAppResponse));
        res.json({ apps });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// GET /api/more-apps/revflo — backs the consolidated RevFlo card in
// Settings → Integrations (see AppEntry note above).
router.get('/revflo', (0, async_handler_1.asyncHandler)(async (_req, res) => {
    try {
        res.json({ app: await toAppResponse(REVFLO_APP) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
exports.moreAppsRoutes = router;
//# sourceMappingURL=more-apps.js.map