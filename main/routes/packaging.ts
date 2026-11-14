import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { requireAnyPermission } from '../services/authorization';
import {
  listPackagingMaterials,
  getPackagingMaterial,
  createPackagingMaterial,
  updatePackagingMaterial,
  deletePackagingMaterial,
  getPackagingMaterialMovements,
  listPackagingProfiles,
  getPackagingProfile,
  createPackagingProfile,
  updatePackagingProfile,
  duplicatePackagingProfile,
  deletePackagingProfile,
  getProductPackagingAssignments,
  setProductPackagingAssignment,
  setVariantPackagingAssignment,
  getPackagingDashboard,
} from '../services/packaging';

interface AuthenticatedRequest extends Request {
  user?: {
    userId?: string;
    role?: string;
  };
}

interface HttpError extends Error {
  statusCode?: number;
}

const router = Router();

const actor = (req: Request) => String((req as AuthenticatedRequest).user?.userId || '');

function bad(res: Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

function handleRouteError(res: Response, err: unknown, fallbackMessage: string, defaultStatus = 400) {
  const error = err as HttpError;
  return bad(res, error?.message || fallbackMessage, error?.statusCode || defaultStatus);
}

// --- Dashboard ---

router.get(
  '/dashboard',
  requireAnyPermission('inventory.view', 'settings.manage', 'dashboard.view'),
  (_req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const data = getPackagingDashboard(db);
      res.json(data);
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to get packaging dashboard', 500);
    }
  },
);

// --- Packaging Materials ---

router.get(
  '/materials',
  requireAnyPermission('inventory.view', 'supplies.manage', 'settings.manage', 'pos.use'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const filters = {
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        lowStockOnly: req.query.low_stock_only === 'true',
        includeInactive: req.query.include_inactive === 'true',
      };
      const materials = listPackagingMaterials(db, filters);
      res.json({ materials });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to list packaging materials', 500);
    }
  },
);

router.get(
  '/materials/:id',
  requireAnyPermission('inventory.view', 'supplies.manage', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const material = getPackagingMaterial(db, String(req.params.id));
      if (!material) return bad(res, 'Packaging material not found', 404);
      res.json({ material });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to get packaging material', 500);
    }
  },
);

router.post(
  '/materials',
  requireAnyPermission('supplies.manage', 'inventory.manage', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const material = createPackagingMaterial(db, req.body || {}, actor(req));
      res.status(201).json({ material });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to create packaging material', 400);
    }
  },
);

router.put(
  '/materials/:id',
  requireAnyPermission('supplies.manage', 'inventory.manage', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const material = updatePackagingMaterial(db, String(req.params.id), req.body || {}, actor(req));
      res.json({ material });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to update packaging material', 400);
    }
  },
);

router.delete(
  '/materials/:id',
  requireAnyPermission('supplies.manage', 'inventory.manage', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      deletePackagingMaterial(db, String(req.params.id), actor(req));
      res.json({ success: true });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to delete packaging material', 400);
    }
  },
);

router.get(
  '/materials/:id/movements',
  requireAnyPermission('inventory.view', 'supplies.manage', 'settings.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
      const result = getPackagingMaterialMovements(db, String(req.params.id), limit);
      res.json(result);
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to get material movements', 500);
    }
  },
);

// --- Packaging Profiles ---

router.get(
  '/profiles',
  requireAnyPermission('pos.use', 'orders.create', 'settings.manage', 'inventory.view'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const activeOnly = req.query.active_only === 'true';
      const profiles = listPackagingProfiles(db, { activeOnly });
      res.json({ profiles });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to list packaging profiles', 500);
    }
  },
);

router.get(
  '/profiles/:id',
  requireAnyPermission('pos.use', 'orders.create', 'settings.manage', 'inventory.view'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const profile = getPackagingProfile(db, String(req.params.id));
      if (!profile) return bad(res, 'Packaging profile not found', 404);
      res.json({ profile });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to get packaging profile', 500);
    }
  },
);

router.post(
  '/profiles',
  requireAnyPermission('settings.manage', 'supplies.manage', 'inventory.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const profile = createPackagingProfile(db, req.body || {}, actor(req));
      res.status(201).json({ profile });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to create packaging profile', 400);
    }
  },
);

router.put(
  '/profiles/:id',
  requireAnyPermission('settings.manage', 'supplies.manage', 'inventory.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const profile = updatePackagingProfile(db, String(req.params.id), req.body || {}, actor(req));
      res.json({ profile });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to update packaging profile', 400);
    }
  },
);

router.post(
  '/profiles/:id/duplicate',
  requireAnyPermission('settings.manage', 'supplies.manage', 'inventory.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const profile = duplicatePackagingProfile(db, String(req.params.id), actor(req));
      res.status(201).json({ profile });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to duplicate packaging profile', 400);
    }
  },
);

router.delete(
  '/profiles/:id',
  requireAnyPermission('settings.manage', 'supplies.manage', 'inventory.manage'),
  (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      deletePackagingProfile(db, String(req.params.id), actor(req));
      res.json({ success: true });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to delete packaging profile', 400);
    }
  },
);

// --- Product and Variant Assignments ---

router.get(
  '/assignments',
  requireAnyPermission('catalog.manage', 'settings.manage', 'inventory.view', 'pos.use'),
  (_req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const products = getProductPackagingAssignments(db);
      res.json({ products });
    } catch (err: unknown) {
      handleRouteError(res, err, 'Failed to get packaging assignments', 500);
    }
  },
);

const handleProductAssignment = (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const product = setProductPackagingAssignment(db, String(req.params.id), req.body || {});
    res.json({ success: true, product });
  } catch (err: unknown) {
    handleRouteError(res, err, 'Failed to set product packaging assignment', 400);
  }
};

const handleVariantAssignment = (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const variant = setVariantPackagingAssignment(db, String(req.params.id), req.body || {});
    res.json({ success: true, variant });
  } catch (err: unknown) {
    handleRouteError(res, err, 'Failed to set variant packaging assignment', 400);
  }
};

router.put(
  ['/assignments/products/:id', '/assignments/product/:id'],
  requireAnyPermission('catalog.manage', 'settings.manage'),
  handleProductAssignment,
);
router.post(
  ['/assignments/products/:id', '/assignments/product/:id'],
  requireAnyPermission('catalog.manage', 'settings.manage'),
  handleProductAssignment,
);

router.put(
  ['/assignments/variants/:id', '/assignments/variant/:id'],
  requireAnyPermission('catalog.manage', 'settings.manage'),
  handleVariantAssignment,
);
router.post(
  ['/assignments/variants/:id', '/assignments/variant/:id'],
  requireAnyPermission('catalog.manage', 'settings.manage'),
  handleVariantAssignment,
);

export const packagingRoutes = router;
