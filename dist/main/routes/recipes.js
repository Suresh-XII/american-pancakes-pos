"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recipeRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const recipes_1 = require("../services/recipes");
const cloud_sync_1 = require("../services/cloud-sync");
const operation_failure_1 = require("../lib/operation-failure");
const router = (0, express_1.Router)();
function sendError(res, error) {
    const details = error;
    const statusCode = Number.isInteger(details.statusCode) ? details.statusCode : 500;
    if (error instanceof recipes_1.RecipeServiceError && error.diagnosticCode) {
        const failure = (0, operation_failure_1.serializeOperationFailure)({
            capture_point: 'fc.backend.recipe.save.invalid_component',
            outcome: 'not_applied',
            facts: { validation_code: error.diagnosticCode },
        });
        try {
            if (failure)
                cloud_sync_1.cloudSync.captureOperationFailure(failure);
        }
        catch {
            // Diagnostics cannot change the recipe validation response.
        }
    }
    if (statusCode >= 500)
        console.error('[API] Internal error:', error);
    res
        .status(statusCode)
        .json({ error: statusCode >= 500 ? 'Internal server error' : details.message });
}
router.get('/', (0, authorization_1.requirePermission)('supplies.manage'), (_req, res) => {
    try {
        res.json({ recipes: (0, recipes_1.listRecipes)((0, db_1.getDatabase)()) });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.get('/product/:productId', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        const recipe = (0, recipes_1.getRecipeByProduct)((0, db_1.getDatabase)(), String(req.params.productId));
        res.json({ recipe });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.put('/product/:productId', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        const body = req.body || {};
        const recipe = (0, recipes_1.saveRecipe)((0, db_1.getDatabase)(), {
            productId: String(req.params.productId),
            yieldQuantity: body.yield_quantity,
            isActive: body.is_active,
            items: body.items,
        });
        res.json({ recipe });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.delete('/product/:productId', (0, authorization_1.requirePermission)('supplies.manage'), (req, res) => {
    try {
        (0, recipes_1.deleteRecipe)((0, db_1.getDatabase)(), String(req.params.productId));
        res.json({ success: true });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.recipeRoutes = router;
//# sourceMappingURL=recipes.js.map