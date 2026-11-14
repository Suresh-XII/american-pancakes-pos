import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { requireAnyPermission, requirePermission } from '../services/authorization';
import {
  getDeliveryPlatformConfigs,
  getDeliveryPlatformConfig,
  updateDeliveryPlatformConfig,
  listDeliveryMenuMappings,
  createDeliveryMenuMapping,
  updateDeliveryMenuMapping,
  deleteDeliveryMenuMapping,
  getDeliveryAdapter,
  ingestDeliveryOrder,
  syncDeliveryOrderStatus,
  processDeliveryWebhook,
  retryDeliveryWebhookEvent,
  listDeliveryWebhookEvents,
  getDeliveryOrderTracking,
} from '../services/delivery/delivery-service';
import { DeliveryProvider, NormalizedDeliveryOrder } from '../services/delivery/types';

interface AuthenticatedUserRequest extends Request {
  user?: {
    userId?: string;
    id?: string;
    role?: string;
  };
}

const router = Router();

const actor = (req: Request): string => {
  const authReq = req as AuthenticatedUserRequest;
  return String(authReq.user?.userId || authReq.user?.id || 'system');
};

interface CustomHttpError {
  statusCode?: number;
  status?: number;
  message?: string;
}

function handleError(res: Response, err: unknown) {
  const httpErr = err as CustomHttpError;
  const status = Number(httpErr?.statusCode || httpErr?.status || 500);
  const message = httpErr?.message || 'Internal server error';
  return res.status(status).json({ error: message });
}

// ─── Platform Configurations ──────────────────────────────────────────────────

router.get(
  '/configs',
  requireAnyPermission('settings.view', 'settings.manage'),
  (_req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const configs = getDeliveryPlatformConfigs(db);
      res.json(configs);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

router.get(
  '/configs/:provider',
  requireAnyPermission('settings.view', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const provider = String(req.params.provider).toLowerCase() as DeliveryProvider;
      const config = getDeliveryPlatformConfig(db, provider);
      if (!config) {
        return res.status(404).json({ error: `Platform config for ${provider} not found` });
      }
      res.json(config);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

router.put(
  '/configs/:provider',
  requirePermission('settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const provider = String(req.params.provider).toLowerCase() as DeliveryProvider;
      const updated = updateDeliveryPlatformConfig(db, provider, req.body, actor(req));
      res.json(updated);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

// ─── External Menu Mappings ──────────────────────────────────────────────────

router.get(
  '/mappings',
  requireAnyPermission('catalog.view', 'settings.manage', 'orders.read'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const provider = req.query.provider ? (String(req.query.provider).toLowerCase() as DeliveryProvider) : undefined;
      const mappings = listDeliveryMenuMappings(db, provider);
      res.json(mappings);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

router.post(
  '/mappings',
  requireAnyPermission('catalog.manage', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const mapping = createDeliveryMenuMapping(db, req.body, actor(req));
      res.status(201).json(mapping);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

router.put(
  '/mappings/:id',
  requireAnyPermission('catalog.manage', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Valid mapping id is required' });
      }
      const updated = updateDeliveryMenuMapping(db, id, req.body, actor(req));
      res.json(updated);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

router.delete(
  '/mappings/:id',
  requireAnyPermission('catalog.manage', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Valid mapping id is required' });
      }
      deleteDeliveryMenuMapping(db, id, actor(req));
      res.json({ success: true, id });
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

// ─── Sandbox Order Simulation ────────────────────────────────────────────────

router.post(
  '/sandbox/simulate-order',
  requireAnyPermission('orders.create', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const sandboxAdapter = getDeliveryAdapter('sandbox');

      let normalized: NormalizedDeliveryOrder;
      // If client supplied already normalized format
      if (req.body.externalOrderId && Array.isArray(req.body.items)) {
        normalized = {
          ...req.body,
          customerName: null,
          customerPhone: null,
          provider: 'sandbox',
          isSimulated: true,
        };
      } else {
        // Parse raw sandbox payload
        normalized = sandboxAdapter.parseIncomingOrder(req.body);
        normalized.customerName = null;
        normalized.customerPhone = null;
      }

      const result = ingestDeliveryOrder(db, normalized, actor(req));
      res.status(201).json(result);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

// ─── Webhook Receiver & Management ───────────────────────────────────────────

router.post(
  '/webhooks/:provider',
  async (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const provider = String(req.params.provider).toLowerCase() as DeliveryProvider;
      const result = await processDeliveryWebhook(db, provider, req.headers, req.body);
      res.status(200).json(result);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

router.get(
  '/webhooks/events',
  requireAnyPermission('settings.view', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const provider = req.query.provider ? (String(req.query.provider).toLowerCase() as DeliveryProvider) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const events = listDeliveryWebhookEvents(db, { provider, status, limit });
      res.json(events);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

router.post(
  '/webhooks/events/:id/retry',
  requireAnyPermission('settings.manage', 'orders.create'),
  async (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Valid webhook event id is required' });
      }
      const result = await retryDeliveryWebhookEvent(db, id, actor(req));
      res.json(result);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

// ─── Delivery Order Tracking & Status Sync ───────────────────────────────────

router.get(
  '/orders/:orderId/tracking',
  requirePermission('orders.read'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const orderId = Number(req.params.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ error: 'Valid order id is required' });
      }
      const tracking = getDeliveryOrderTracking(db, orderId);
      if (!tracking) {
        return res.status(404).json({ error: `Tracking for order #${orderId} not found` });
      }
      res.json(tracking);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

router.post(
  '/orders/:orderId/status',
  requireAnyPermission('orders.status.update', 'orders.item.edit'),
  async (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const orderId = Number(req.params.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ error: 'Valid order id is required' });
      }
      const status = req.body?.status;
      if (!status) {
        return res.status(400).json({ error: 'Status is required' });
      }
      const result = await syncDeliveryOrderStatus(db, orderId, status, actor(req));
      res.json(result);
    } catch (err: unknown) {
      handleError(res, err);
    }
  },
);

export const deliveryRoutes = router;
