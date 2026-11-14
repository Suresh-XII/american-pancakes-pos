"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supplyRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const supplies_1 = require("../services/supplies");
const cloud_sync_1 = require("../services/cloud-sync");
const operation_failure_1 = require("../lib/operation-failure");
const units_1 = require("../services/units");
const router = (0, express_1.Router)();
const MANUAL_MOVEMENT_TYPES = [
    'receive',
    'count',
    'adjustment',
    'waste',
];
const ALL_MOVEMENT_TYPES = [
    'receive',
    'count',
    'adjustment',
    'waste',
    'recipe_depletion',
    'recipe_restore',
];
function sendError(res, error) {
    const details = error;
    const statusCode = Number.isInteger(details.statusCode) ? details.statusCode : 500;
    if (statusCode >= 500)
        console.error('[API] Internal error:', error);
    if (error instanceof supplies_1.SupplyServiceError &&
        error.diagnosticCode &&
        error.diagnosticCode !== 'recipe_linked') {
        captureSupplyValidation(error.diagnosticCode);
    }
    else if (error instanceof units_1.UnitConversionError) {
        captureSupplyValidation(error.diagnosticCode);
    }
    res
        .status(statusCode)
        .json({ error: statusCode >= 500 ? 'Internal server error' : details.message });
}
function captureSupplyValidation(validationCode) {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.supply.validation',
        outcome: 'not_applied',
        facts: { validation_code: validationCode },
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change supply validation responses.
    }
}
function captureSupplyMovementQueryRejection() {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.supply.movement_query.invalid',
        outcome: 'not_applied',
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change supply query validation.
    }
}
class SupplyQueryValidationError extends Error {
    statusCode = 400;
}
function queryString(value, field) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
        throw new SupplyQueryValidationError(`${field} must be a non-empty string of at most 128 characters`);
    }
    return value.trim();
}
function captureSupplyDeleteBlocked() {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.supply.delete.recipe_linked',
        outcome: 'not_applied',
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change supply deletion behavior.
    }
}
router.get('/', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const includeInactive = req.query.include_inactive === 'true' || req.query.include_inactive === '1';
        const lowStockOnly = req.query.low_stock === 'true' || req.query.low_stock === '1';
        const search = queryString(req.query.search, 'search');
        const supplies = (0, supplies_1.listSupplies)(db, { includeInactive, lowStockOnly, search });
        res.json({ supplies });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.post('/', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        const body = req.body || {};
        const actorId = String(req.user?.userId || '');
        if (!actorId)
            return res.status(403).json({ error: 'Authentication required' });
        const supply = (0, supplies_1.createSupply)((0, db_1.getDatabase)(), {
            name: body.name,
            baseUnit: body.base_unit,
            stockQuantity: body.stock_quantity,
            lowStockThreshold: body.low_stock_threshold,
            unitCost: body.unit_cost,
            unitCostUnit: body.unit_cost_unit,
            isActive: body.is_active,
            actorUserId: actorId,
        });
        res.status(201).json({ supply });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.get('/movements', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        const supplyId = queryString(req.query.supply_id, 'supply_id');
        const movementType = queryString(req.query.movement_type, 'movement_type');
        if (movementType && !ALL_MOVEMENT_TYPES.includes(movementType)) {
            captureSupplyMovementQueryRejection();
            return res.status(400).json({ error: 'movement_type is invalid' });
        }
        const search = queryString(req.query.search, 'search');
        const rawBeforeId = req.query.before_id;
        const beforeId = rawBeforeId === undefined
            ? undefined
            : typeof rawBeforeId === 'string' && /^\d+$/.test(rawBeforeId)
                ? Number(rawBeforeId)
                : NaN;
        if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
            captureSupplyMovementQueryRejection();
            return res.status(400).json({ error: 'before_id must be a positive integer' });
        }
        const rawPerPage = req.query.per_page;
        const requestedPerPage = rawPerPage === undefined ? NaN : Number(rawPerPage);
        const perPage = Number.isInteger(requestedPerPage) && requestedPerPage > 0
            ? Math.min(requestedPerPage, 500)
            : 50;
        const page = (0, supplies_1.listSupplyMovements)((0, db_1.getDatabase)(), {
            supplyId,
            movementType,
            search,
            beforeId,
            perPage,
        });
        res.json({
            movements: page.movements,
            ...(page.nextCursor !== null && { nextCursor: page.nextCursor }),
        });
    }
    catch (error) {
        if (error instanceof SupplyQueryValidationError)
            captureSupplyMovementQueryRejection();
        sendError(res, error);
    }
});
router.get('/:id', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        const supply = (0, supplies_1.getSupply)((0, db_1.getDatabase)(), String(req.params.id));
        res.json({ supply });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.put('/:id', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        const body = req.body || {};
        const supply = (0, supplies_1.updateSupply)((0, db_1.getDatabase)(), String(req.params.id), {
            name: body.name,
            isActive: body.is_active,
            lowStockThreshold: body.low_stock_threshold,
            unitCost: body.unit_cost,
            unitCostUnit: body.unit_cost_unit,
        });
        res.json({ supply });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.delete('/:id', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        (0, supplies_1.softDeleteSupply)((0, db_1.getDatabase)(), String(req.params.id));
        res.json({ success: true });
    }
    catch (error) {
        if (error instanceof supplies_1.SupplyServiceError && error.diagnosticCode === 'recipe_linked') {
            captureSupplyDeleteBlocked();
        }
        sendError(res, error);
    }
});
router.post('/:id/movements', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        const actorId = String(req.user?.userId || '');
        if (!actorId)
            return res.status(403).json({ error: 'Authentication required' });
        const body = req.body || {};
        const movementType = body.movement_type;
        if (!MANUAL_MOVEMENT_TYPES.includes(movementType)) {
            captureSupplyValidation('movement_type_invalid');
            return res
                .status(400)
                .json({ error: 'movement_type must be one of: receive, count, adjustment, waste' });
        }
        const movement = (0, supplies_1.recordSupplyMovement)((0, db_1.getDatabase)(), {
            supplyId: String(req.params.id),
            movementType,
            quantity: body.quantity,
            unit: body.unit,
            unitCost: body.unit_cost,
            totalCost: body.total_cost,
            reason: body.reason,
            actorUserId: actorId,
        });
        res.status(201).json({ movement });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.supplyRoutes = router;
//# sourceMappingURL=supplies.js.map