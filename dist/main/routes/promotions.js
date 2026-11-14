"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const promotions_1 = require("../services/promotions");
const bills_1 = require("./bills");
const router = (0, express_1.Router)();
// ── GET /api/promotions ──────────────────────────────────────────────────
// Returns list of promotions with optional eligibility calculation for an order
router.get('/', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const activeOnly = req.query.active_only === 'true';
        const orderId = req.query.order_id;
        const customerId = req.query.customer_id;
        let query = 'SELECT * FROM promotions';
        if (activeOnly) {
            query += ' WHERE is_active = 1 AND is_loyalty_reward = 0';
        }
        query += ' ORDER BY is_loyalty_reward DESC, is_active DESC, created_at DESC';
        const rows = db.prepare(query).all();
        const promotions = rows.map(promotions_1.parsePromotionRow);
        if (orderId) {
            const order = db.prepare('SELECT id, customer_id, promotion_id FROM orders WHERE id = ?').get(orderId);
            if (order) {
                const orderItems = db
                    .prepare(`SELECT oi.id, oi.product_id, p.name as product_name, p.category_id, c.name as category_name,
                    oi.variant_id, oi.quantity, oi.unit_price
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE oi.order_id = ? AND oi.status NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded')`)
                    .all(orderId);
                const currency = (0, bills_1.getTenantCurrency)();
                const effectiveCustomerId = customerId || order.customer_id;
                const enriched = promotions.map((promo) => {
                    const calc = (0, promotions_1.calculatePromotionDiscount)(db, promo, orderItems.map((i) => ({
                        id: i.id,
                        product_id: i.product_id,
                        product_name: i.product_name,
                        variant_id: i.variant_id,
                        quantity: i.quantity,
                        unit_price: i.unit_price,
                        category_id: i.category_id,
                        category_name: i.category_name,
                    })), effectiveCustomerId, currency);
                    return {
                        ...promo,
                        is_currently_applied: order.promotion_id === promo.id,
                        eligibility: {
                            eligible: calc.eligible,
                            reason: calc.ineligibleReason,
                            estimated_discount: calc.totalDiscountAmount,
                            pairs: calc.pairs,
                            free_units_count: calc.freeUnits.length,
                        },
                    };
                });
                return res.json({ promotions: enriched });
            }
        }
        res.json({ promotions });
    }
    catch (err) {
        const error = err;
        res.status(500).json({ error: error.message || 'Failed to list promotions' });
    }
});
// ── GET /api/promotions/loyalty-eligibility/:customerId ───────────────────
router.get('/loyalty-eligibility/:customerId', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const customerId = String(req.params.customerId);
        const orderId = req.query.order_id;
        const loyaltyStatus = (0, promotions_1.checkCustomerLoyaltyRewardEligibility)(db, customerId, orderId);
        res.json(loyaltyStatus);
    }
    catch (err) {
        const error = err;
        res.status(500).json({ error: error.message || 'Failed to check loyalty eligibility' });
    }
});
// ── GET /api/promotions/reports/summary ───────────────────────────────────
router.get('/reports/summary', (0, authorization_1.requirePermission)('reports.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const rawStart = req.query.start_date || null;
        const rawEnd = req.query.end_date || null;
        const startDate = rawStart && rawStart.length === 10 ? `${rawStart} 00:00:00` : rawStart;
        const endDate = rawEnd && rawEnd.length === 10 ? `${rawEnd} 23:59:59` : rawEnd;
        const summary = (0, promotions_1.getPromotionReportsSummary)(db, startDate, endDate);
        res.json(summary);
    }
    catch (err) {
        const error = err;
        res.status(500).json({ error: error.message || 'Failed to generate promotions report' });
    }
});
// ── GET /api/promotions/:id ──────────────────────────────────────────────
router.get('/:id', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const row = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
        if (!row) {
            return res.status(404).json({ error: 'Promotion not found' });
        }
        const promo = (0, promotions_1.parsePromotionRow)(row);
        let assignedProducts = [];
        if (promo.target_type === 'products') {
            assignedProducts = db
                .prepare(`SELECT pp.product_id, pp.variant_id, p.name as product_name
           FROM promotion_products pp
           JOIN products p ON p.id = pp.product_id
           WHERE pp.promotion_id = ?`)
                .all(promo.id);
        }
        res.json({ promotion: promo, assigned_products: assignedProducts });
    }
    catch (err) {
        const error = err;
        res.status(500).json({ error: error.message || 'Failed to get promotion' });
    }
});
// ── POST /api/promotions/preview ─────────────────────────────────────────
router.post('/preview', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const { promotion_id, items, customer_id } = req.body || {};
        if (!promotion_id) {
            return res.status(400).json({ error: 'promotion_id is required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items array is required' });
        }
        const row = db.prepare('SELECT * FROM promotions WHERE id = ?').get(promotion_id);
        if (!row) {
            return res.status(404).json({ error: 'Promotion not found' });
        }
        const promo = (0, promotions_1.parsePromotionRow)(row);
        const currency = (0, bills_1.getTenantCurrency)();
        const calculation = (0, promotions_1.calculatePromotionDiscount)(db, promo, items, customer_id, currency);
        res.json(calculation);
    }
    catch (err) {
        const error = err;
        res.status(500).json({ error: error.message || 'Failed to preview promotion' });
    }
});
// ── POST /api/promotions/apply ───────────────────────────────────────────
router.post('/apply', (0, authorization_1.requirePermission)('orders.discount.apply'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const { order_id, promotion_id } = req.body || {};
        if (!order_id || !promotion_id) {
            return res.status(400).json({ error: 'order_id and promotion_id are required' });
        }
        const authReq = req;
        const actorUserId = authReq.user?.userId || 'system';
        const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
        const result = (0, db_1.withTxn)(() => {
            return (0, promotions_1.applyPromotionToOrder)(db, order_id, promotion_id, actorUserId, clientIp);
        });
        res.json({
            success: true,
            order: result.order,
            bill: result.bill,
            calculation: result.calculation,
        });
    }
    catch (err) {
        const error = err;
        res.status(error.statusCode || 500).json({ error: error.message || 'Failed to apply promotion' });
    }
});
// ── POST /api/promotions/remove ──────────────────────────────────────────
router.post('/remove', (0, authorization_1.requirePermission)('orders.discount.apply'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const { order_id } = req.body || {};
        if (!order_id) {
            return res.status(400).json({ error: 'order_id is required' });
        }
        const authReq = req;
        const actorUserId = authReq.user?.userId || 'system';
        const result = (0, db_1.withTxn)(() => {
            return (0, promotions_1.removePromotionFromOrder)(db, order_id, actorUserId);
        });
        res.json({
            success: true,
            order: result.order,
            bill: result.bill,
        });
    }
    catch (err) {
        const error = err;
        res.status(error.statusCode || 500).json({ error: error.message || 'Failed to remove promotion' });
    }
});
// ── POST /api/promotions ─────────────────────────────────────────────────
router.post('/', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const { id: customId, name, description, discount_type, target_type, target_category_id, discount_value, bogo_buy_qty, bogo_get_qty, bogo_pricing_rule, is_loyalty_reward, loyalty_qualifying_visits_required, start_at, end_at, is_active, is_automatic, max_redemptions, product_ids, } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Promotion name is required' });
        }
        if (!['bogo', 'percentage', 'fixed_amount'].includes(discount_type)) {
            return res.status(400).json({ error: 'discount_type must be bogo, percentage, or fixed_amount' });
        }
        const promoId = customId ? String(customId).trim() : `promo-${(0, crypto_1.randomUUID)()}`;
        const authReq = req;
        const actorUserId = authReq.user?.userId || null;
        const timestamp = (0, db_1.now)();
        (0, db_1.withTxn)(() => {
            db.prepare(`
          INSERT INTO promotions (
            id, name, description, discount_type, target_type, target_category_id,
            discount_value, bogo_buy_qty, bogo_get_qty, bogo_pricing_rule,
            is_loyalty_reward, loyalty_qualifying_visits_required,
            start_at, end_at, is_active, is_automatic, max_redemptions,
            created_by, updated_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(promoId, name.trim(), description || null, discount_type, target_type || 'all_pancakes', target_category_id || null, Number(discount_value || 0), Math.max(1, Number(bogo_buy_qty || 1)), Math.max(1, Number(bogo_get_qty || 1)), bogo_pricing_rule || 'same_item', is_loyalty_reward ? 1 : 0, Math.max(1, Number(loyalty_qualifying_visits_required || 5)), start_at || timestamp, end_at || null, is_active !== undefined ? (is_active ? 1 : 0) : 1, is_automatic ? 1 : 0, max_redemptions !== undefined && max_redemptions !== null ? Number(max_redemptions) : null, actorUserId, actorUserId, timestamp, timestamp);
            if (Array.isArray(product_ids)) {
                const insertProd = db.prepare(`
            INSERT OR IGNORE INTO promotion_products (promotion_id, product_id, variant_id, created_at)
            VALUES (?, ?, ?, ?)
          `);
                for (const item of product_ids) {
                    const pId = typeof item === 'object' ? item.product_id : item;
                    const vId = typeof item === 'object' ? item.variant_id : null;
                    if (pId)
                        insertProd.run(promoId, pId, vId || null, timestamp);
                }
            }
        });
        const created = db.prepare('SELECT * FROM promotions WHERE id = ?').get(promoId);
        res.status(201).json({ promotion: (0, promotions_1.parsePromotionRow)(created) });
    }
    catch (err) {
        const error = err;
        res.status(500).json({ error: error.message || 'Failed to create promotion' });
    }
});
// ── PUT /api/promotions/:id ──────────────────────────────────────────────
router.put('/:id', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const promoId = req.params.id;
        const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(promoId);
        if (!existing) {
            return res.status(404).json({ error: 'Promotion not found' });
        }
        const { name, description, discount_type, target_type, target_category_id, discount_value, bogo_buy_qty, bogo_get_qty, bogo_pricing_rule, is_loyalty_reward, loyalty_qualifying_visits_required, start_at, end_at, is_active, is_automatic, max_redemptions, product_ids, } = req.body || {};
        const authReq = req;
        const actorUserId = authReq.user?.userId || null;
        const timestamp = (0, db_1.now)();
        (0, db_1.withTxn)(() => {
            db.prepare(`
          UPDATE promotions
          SET name = COALESCE(?, name),
              description = COALESCE(?, description),
              discount_type = COALESCE(?, discount_type),
              target_type = COALESCE(?, target_type),
              target_category_id = ?,
              discount_value = COALESCE(?, discount_value),
              bogo_buy_qty = COALESCE(?, bogo_buy_qty),
              bogo_get_qty = COALESCE(?, bogo_get_qty),
              bogo_pricing_rule = COALESCE(?, bogo_pricing_rule),
              is_loyalty_reward = COALESCE(?, is_loyalty_reward),
              loyalty_qualifying_visits_required = COALESCE(?, loyalty_qualifying_visits_required),
              start_at = COALESCE(?, start_at),
              end_at = ?,
              is_active = COALESCE(?, is_active),
              is_automatic = COALESCE(?, is_automatic),
              max_redemptions = ?,
              updated_by = ?,
              updated_at = ?
          WHERE id = ?
        `).run(name !== undefined ? name.trim() : null, description !== undefined ? description : null, discount_type !== undefined ? discount_type : null, target_type !== undefined ? target_type : null, target_category_id !== undefined ? target_category_id : existing.target_category_id, discount_value !== undefined ? Number(discount_value) : null, bogo_buy_qty !== undefined ? Math.max(1, Number(bogo_buy_qty)) : null, bogo_get_qty !== undefined ? Math.max(1, Number(bogo_get_qty)) : null, bogo_pricing_rule !== undefined ? bogo_pricing_rule : null, is_loyalty_reward !== undefined ? (is_loyalty_reward ? 1 : 0) : null, loyalty_qualifying_visits_required !== undefined
                ? Math.max(1, Number(loyalty_qualifying_visits_required))
                : null, start_at !== undefined ? start_at : null, end_at !== undefined ? end_at : existing.end_at, is_active !== undefined ? (is_active ? 1 : 0) : null, is_automatic !== undefined ? (is_automatic ? 1 : 0) : null, max_redemptions !== undefined ? (max_redemptions !== null ? Number(max_redemptions) : null) : existing.max_redemptions, actorUserId, timestamp, promoId);
            if (Array.isArray(product_ids)) {
                db.prepare('DELETE FROM promotion_products WHERE promotion_id = ?').run(promoId);
                const insertProd = db.prepare(`
            INSERT OR IGNORE INTO promotion_products (promotion_id, product_id, variant_id, created_at)
            VALUES (?, ?, ?, ?)
          `);
                for (const item of product_ids) {
                    const pId = typeof item === 'object' ? item.product_id : item;
                    const vId = typeof item === 'object' ? item.variant_id : null;
                    if (pId)
                        insertProd.run(promoId, pId, vId || null, timestamp);
                }
            }
        });
        const updated = db.prepare('SELECT * FROM promotions WHERE id = ?').get(promoId);
        res.json({ promotion: (0, promotions_1.parsePromotionRow)(updated) });
    }
    catch (err) {
        const error = err;
        res.status(500).json({ error: error.message || 'Failed to update promotion' });
    }
});
// ── DELETE /api/promotions/:id ───────────────────────────────────────────
router.delete('/:id', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const promoId = req.params.id;
        const existing = db.prepare('SELECT 1 FROM promotions WHERE id = ?').get(promoId);
        if (!existing) {
            return res.status(404).json({ error: 'Promotion not found' });
        }
        db.prepare('UPDATE promotions SET is_active = 0, updated_at = ? WHERE id = ?').run((0, db_1.now)(), promoId);
        res.json({ success: true, message: 'Promotion deactivated' });
    }
    catch (err) {
        const error = err;
        res.status(500).json({ error: error.message || 'Failed to deactivate promotion' });
    }
});
exports.default = router;
//# sourceMappingURL=promotions.js.map