import { Router, type Request, type Response } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import {
  createPurchase,
  createSupplier,
  deleteSupplier,
  getPurchase,
  getStockCount,
  listPurchases,
  listStockCounts,
  listSuppliers,
  postStockCount,
  receivePurchase,
  recordWastage,
  reviewPurchase,
  reviewStockCount,
  saveStockCount,
  startStockCount,
  stockDashboard,
  StockManagementError,
  updatePurchase,
  updateSupplier,
} from '../services/stock-management';

export const stockManagementRoutes = Router();

function actorId(req: Request): string {
  return String((req as Request & { user?: { userId?: string } }).user?.userId || '');
}

function sendError(res: Response, error: unknown): void {
  const status = error instanceof StockManagementError ? error.statusCode : 500;
  if (status >= 500) console.error('[stock-management]', error);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : (error as Error).message });
}

stockManagementRoutes.use(requirePermission('supplies.manage'));

stockManagementRoutes.get('/dashboard', (_req, res) => {
  try { res.json(stockDashboard(getDatabase())); } catch (error) { sendError(res, error); }
});

stockManagementRoutes.get('/suppliers', (req, res) => {
  try { res.json({ suppliers: listSuppliers(getDatabase(), req.query.include_inactive === 'true') }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.post('/suppliers', (req, res) => {
  try { res.status(201).json({ supplier: createSupplier(getDatabase(), req.body || {}) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.put('/suppliers/:id', (req, res) => {
  try { res.json({ supplier: updateSupplier(getDatabase(), String(req.params.id), req.body || {}) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.post('/suppliers/:id/deactivate', (req, res) => {
  try { res.json({ supplier: updateSupplier(getDatabase(), String(req.params.id), { ...(req.body || {}), isActive: false }) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.delete('/suppliers/:id', (req, res) => {
  try { deleteSupplier(getDatabase(), String(req.params.id)); res.json({ success: true }); } catch (error) { sendError(res, error); }
});

stockManagementRoutes.get('/purchases', (_req, res) => {
  try { res.json({ purchases: listPurchases(getDatabase()) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.get('/purchases/:id', (req, res) => {
  try { res.json({ purchase: getPurchase(getDatabase(), String(req.params.id)) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.post('/purchases', (req, res) => {
  try {
    res.status(201).json({ purchase: createPurchase(getDatabase(), { ...(req.body || {}), actorUserId: actorId(req) }) });
  } catch (error) { sendError(res, error); }
});
stockManagementRoutes.post('/purchases/:id/review', (req, res) => {
  try { res.json({ purchase: reviewPurchase(getDatabase(), String(req.params.id), actorId(req)) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.post('/purchases/:id/receive', (req, res) => {
  try { res.json({ purchase: receivePurchase(getDatabase(), String(req.params.id), actorId(req)) }); } catch (error) { sendError(res, error); }
});

stockManagementRoutes.put('/purchases/:id', (req, res) => {
  try {
    res.json({
      purchase: updatePurchase(getDatabase(), String(req.params.id), {
        ...(req.body || {}),
        actorUserId: actorId(req),
      }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

stockManagementRoutes.get('/stock-counts', (_req, res) => {
  try { res.json({ counts: listStockCounts(getDatabase()) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.post('/stock-counts', (req, res) => {
  try { res.status(201).json({ count: startStockCount(getDatabase(), actorId(req), req.body?.notes) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.get('/stock-counts/:id', (req, res) => {
  try { res.json({ count: getStockCount(getDatabase(), String(req.params.id)) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.put('/stock-counts/:id', (req, res) => {
  try { res.json({ count: saveStockCount(getDatabase(), String(req.params.id), req.body?.items || []) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.post('/stock-counts/:id/review', (req, res) => {
  try { res.json({ count: reviewStockCount(getDatabase(), String(req.params.id), actorId(req)) }); } catch (error) { sendError(res, error); }
});
stockManagementRoutes.post('/stock-counts/:id/post', (req, res) => {
  try { res.json({ count: postStockCount(getDatabase(), String(req.params.id), actorId(req)) }); } catch (error) { sendError(res, error); }
});

stockManagementRoutes.post('/wastage', (req, res) => {
  try { res.status(201).json({ wastage: recordWastage(getDatabase(), { ...(req.body || {}), actorUserId: actorId(req) }) }); } catch (error) { sendError(res, error); }
});
