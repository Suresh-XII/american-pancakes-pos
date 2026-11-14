import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDatabase, now } from '../db';
import { requireAnyPermission, requirePermission } from '../services/authorization';
import { duplicatePackagingProfile } from '../services/packaging';

interface AuthenticatedUserRequest extends Request {
  user?: {
    userId?: string;
    role?: string;
  };
}

interface ProfileRow {
  id: string;
  name: string;
  serving_type: string;
  packaging_type: string;
  supply_id: string;
  supply_name?: string;
  units_per_serving: number;
  customer_charge_per_unit: number;
  unit_cost?: number | null;
  is_active: number;
  is_default: number;
  supply_is_active?: number;
}

interface ComponentRow {
  profile_id: string;
  material_id: string;
  quantity: number;
  material_name: string;
  base_unit: string;
  unit_cost: number | null;
  stock_quantity: number;
  sku: string | null;
  category: string | null;
  is_active: number;
}

interface HttpError extends Error {
  statusCode?: number;
}

const router = Router();

const validServing = new Set(['dine_in', 'parcel']);
const validType = new Set(['paper_plate', 'parcel_box']);

const expected: Record<string, string> = {
  dine_in: 'paper_plate',
  parcel: 'parcel_box',
};

const actor = (req: Request) => String((req as AuthenticatedUserRequest).user?.userId || '');
const isOwner = (req: Request) => (req as AuthenticatedUserRequest).user?.role === 'owner';

function bad(res: Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

router.get(
  '/',
  requireAnyPermission('pos.use', 'orders.create', 'settings.manage'),
  (req, res) => {
    const activeOnly = req.query.active_only === 'true';
    const db = getDatabase();

    const rows = db
      .prepare(`
        SELECT
          p.*,
          s.name AS supply_name,
          s.unit_cost,
          s.is_active AS supply_is_active
        FROM packaging_profiles p
        JOIN supplies s ON s.id = p.supply_id
        WHERE s.deleted_at IS NULL
        ${activeOnly ? 'AND p.is_active=1 AND s.is_active=1' : ''}
        ORDER BY p.serving_type, p.is_default DESC, p.name COLLATE NOCASE
      `)
      .all() as ProfileRow[];

    const profileIds = rows.map((r) => r.id);
    const materialsByProfile = new Map<string, Array<{
      material_id: string;
      material_name: string;
      quantity: number;
      base_unit: string;
      unit_cost: number | null;
      sku: string | null;
      category: string | null;
      is_active: number;
      stock_quantity: number;
    }>>();

    if (profileIds.length > 0) {
      const placeholders = profileIds.map(() => '?').join(',');
      const components = db
        .prepare(`
          SELECT
            pm.profile_id,
            pm.material_id,
            pm.quantity,
            s.name AS material_name,
            s.base_unit,
            s.unit_cost,
            s.stock_quantity,
            s.sku,
            s.category,
            s.is_active
          FROM packaging_profile_materials pm
          JOIN supplies s ON s.id = pm.material_id
          WHERE pm.profile_id IN (${placeholders})
            AND s.deleted_at IS NULL
          ORDER BY pm.id
        `)
        .all(...profileIds) as ComponentRow[];

      for (const c of components) {
        const list = materialsByProfile.get(c.profile_id) || [];
        list.push({
          material_id: c.material_id,
          material_name: c.material_name,
          quantity: Number(c.quantity),
          base_unit: c.base_unit,
          unit_cost: c.unit_cost !== null && c.unit_cost !== undefined ? Number(c.unit_cost) : null,
          sku: c.sku,
          category: c.category,
          is_active: Number(c.is_active),
          stock_quantity: Number(c.stock_quantity || 0),
        });
        materialsByProfile.set(c.profile_id, list);
      }
    }

    const enriched = rows.map((r) => {
      let comps = materialsByProfile.get(r.id);
      if (!comps || comps.length === 0) {
        comps = [
          {
            material_id: r.supply_id,
            material_name: r.supply_name || '',
            quantity: Number(r.units_per_serving || 1),
            base_unit: 'each',
            unit_cost: r.unit_cost !== null && r.unit_cost !== undefined ? Number(r.unit_cost) : null,
            sku: null,
            category: null,
            is_active: Number(r.supply_is_active ?? 1),
            stock_quantity: 0,
          },
        ];
      }
      return {
        ...r,
        components: comps,
      };
    });

    res.json({ profiles: enriched });
  },
);

function write(req: Request, res: Response, id?: string) {
  if (!isOwner(req)) {
    return bad(res, 'Only the owner can manage packaging profiles', 403);
  }

  const body = req.body || {};

  const name =
    typeof body.name === 'string'
      ? body.name.trim().slice(0, 100)
      : '';

  const servingType = body.serving_type;
  const packagingType = body.packaging_type;

  let supplyId =
    typeof body.supply_id === 'string'
      ? body.supply_id.trim()
      : '';

  let units =
    body.units_per_serving === undefined
      ? 1
      : Number(body.units_per_serving);

  const charge =
    body.customer_charge_per_unit === undefined
      ? 0
      : Number(body.customer_charge_per_unit);

  const active = body.is_active === false ? 0 : 1;
  const defaultProfile = body.is_default === true ? 1 : 0;
  const description = body.description ? String(body.description).trim() : null;
  const notes = body.notes ? String(body.notes).trim() : null;

  // Handle multi-material components if provided
  let componentsInput = Array.isArray(body.components) ? body.components : null;
  if (!componentsInput && Array.isArray(body.materials)) {
    componentsInput = body.materials;
  }

  if (componentsInput && componentsInput.length > 0) {
    if (!supplyId) {
      supplyId = String(componentsInput[0].material_id || '').trim();
      units = Number(componentsInput[0].quantity || 1);
    }
  }

  if (
    !name ||
    !validServing.has(servingType) ||
    !validType.has(packagingType) ||
    expected[servingType] !== packagingType ||
    !supplyId ||
    !Number.isSafeInteger(units) ||
    units <= 0 ||
    !Number.isFinite(charge) ||
    charge < 0 ||
    (defaultProfile === 1 && active === 0)
  ) {
    return bad(res, 'Invalid packaging profile');
  }

  const db = getDatabase();

  const supply = db
    .prepare(`
      SELECT id, base_unit
      FROM supplies
      WHERE id = ?
        AND is_active = 1
        AND deleted_at IS NULL
    `)
    .get(supplyId) as { id: string; base_unit: string } | undefined;

  if (!supply) {
    return bad(res, 'Linked packaging supply is inactive or unavailable');
  }

  if (supply.base_unit !== 'each') {
    return bad(
      res,
      'Packaging supplies must use the each base unit',
    );
  }

  const validatedComponents: Array<{ material_id: string; quantity: number }> = [];
  if (componentsInput && componentsInput.length > 0) {
    const seen = new Set<string>();
    for (const comp of componentsInput) {
      const matId = String(comp.material_id || '').trim();
      if (!matId) return bad(res, 'Material ID is required for component');
      if (seen.has(matId)) return bad(res, 'Duplicate component in profile');
      seen.add(matId);

      const qty = Number(comp.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        return bad(res, 'Component quantity must be a positive number');
      }

      const mat = db.prepare('SELECT id, is_active, deleted_at FROM supplies WHERE id = ?').get(matId) as {
        id: string;
        is_active: number;
        deleted_at: string | null;
      } | undefined;
      if (!mat || mat.deleted_at !== null || mat.is_active !== 1) {
        return bad(res, 'Linked packaging supply is inactive or unavailable');
      }
      validatedComponents.push({ material_id: matId, quantity: qty });
    }
  } else {
    validatedComponents.push({ material_id: supplyId, quantity: units });
  }

  const userId = actor(req);
  const timestamp = now();
  const profileId = id || randomUUID();

  if (id) {
    const existing = db
      .prepare('SELECT id FROM packaging_profiles WHERE id = ?')
      .get(id);

    if (!existing) {
      return bad(res, 'Packaging profile not found', 404);
    }
  }

  try {
    db.transaction(() => {
      if (defaultProfile) {
        db.prepare(`
          UPDATE packaging_profiles
          SET
            is_default = 0,
            updated_at = ?,
            updated_by_user_id = ?
          WHERE serving_type = ?
            AND id != ?
        `).run(timestamp, userId, servingType, profileId);
      }

      if (id) {
        const result = db.prepare(`
          UPDATE packaging_profiles
          SET
            name = ?,
            description = ?,
            notes = ?,
            serving_type = ?,
            packaging_type = ?,
            supply_id = ?,
            units_per_serving = ?,
            customer_charge_per_unit = ?,
            is_active = ?,
            is_default = ?,
            updated_by_user_id = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          name,
          description,
          notes,
          servingType,
          packagingType,
          supplyId,
          units,
          charge,
          active,
          defaultProfile,
          userId,
          timestamp,
          id,
        );

        if (result.changes !== 1) {
          throw new Error('Packaging profile update failed');
        }
      } else {
        db.prepare(`
          INSERT INTO packaging_profiles (
            id,
            name,
            description,
            notes,
            serving_type,
            packaging_type,
            supply_id,
            units_per_serving,
            customer_charge_per_unit,
            is_active,
            is_default,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          profileId,
          name,
          description,
          notes,
          servingType,
          packagingType,
          supplyId,
          units,
          charge,
          active,
          defaultProfile,
          userId,
          userId,
          timestamp,
          timestamp,
        );
      }

      db.prepare('DELETE FROM packaging_profile_materials WHERE profile_id = ?').run(profileId);
      for (const comp of validatedComponents) {
        db.prepare(`
          INSERT INTO packaging_profile_materials (
            profile_id, material_id, quantity, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(profileId, comp.material_id, comp.quantity, timestamp, timestamp);
        db.prepare('UPDATE supplies SET is_packaging = 1 WHERE id = ?').run(comp.material_id);
      }
    })();
  } catch {
    return bad(res, 'Could not save packaging profile');
  }

  const profile = db
    .prepare(`
      SELECT
        p.*,
        s.name AS supply_name,
        s.unit_cost
      FROM packaging_profiles p
      JOIN supplies s ON s.id = p.supply_id
      WHERE p.id = ?
    `)
    .get(profileId) as ProfileRow | undefined;

  const comps = db.prepare(`
    SELECT
      pm.material_id,
      pm.quantity,
      s.name AS material_name,
      s.base_unit,
      s.unit_cost
    FROM packaging_profile_materials pm
    JOIN supplies s ON s.id = pm.material_id
    WHERE pm.profile_id = ?
  `).all(profileId);

  return res.status(id ? 200 : 201).json({
    profile: {
      ...profile,
      components: comps,
    },
  });
}

router.post('/', requirePermission('settings.manage'), (req, res) =>
  write(req, res),
);

router.put('/:id', requirePermission('settings.manage'), (req, res) =>
  write(req, res, String(req.params.id)),
);

router.post('/:id/duplicate', requirePermission('settings.manage'), (req, res) => {
  if (!isOwner(req)) {
    return bad(res, 'Only the owner can manage packaging profiles', 403);
  }
  try {
    const db = getDatabase();
    const profile = duplicatePackagingProfile(db, String(req.params.id), actor(req));
    res.status(201).json({ profile });
  } catch (err: unknown) {
    const error = err as HttpError;
    bad(res, error?.message || 'Failed to duplicate profile', error?.statusCode || 400);
  }
});

export const packagingProfileRoutes = router;
