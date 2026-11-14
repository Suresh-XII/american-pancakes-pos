"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tableRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const crypto_1 = require("crypto");
const authorization_1 = require("../services/authorization");
const kds_1 = require("../services/kds");
const cloud_sync_1 = require("../services/cloud-sync");
const router = (0, express_1.Router)();
const ACTIVE_ORDER_STATUS_SQL = "status NOT IN ('completed', 'cancelled')";
function activeOrderForTable(db, tableId, orderId) {
    const whereOrder = orderId ? ' AND id = ?' : '';
    const params = orderId ? [tableId, orderId] : [tableId];
    const order = (0, db_1.parseRowJson)(db
        .prepare(`
    SELECT * FROM orders
    WHERE table_id = ? AND ${ACTIVE_ORDER_STATUS_SQL}${whereOrder}
    ORDER BY created_at DESC LIMIT 1
  `)
        .get(...params));
    if (!order?.customer_id)
        return order;
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
    return { ...order, customer: customer || null };
}
function reservationCustomerShape(db, table) {
    const reservationCustomer = table.status === 'reserved' && table.reservation_customer_id
        ? db
            .prepare('SELECT name, phone FROM customers WHERE id = ?')
            .get(table.reservation_customer_id)
        : undefined;
    return {
        reservation_customer_id: table.status === 'reserved' ? (table.reservation_customer_id ?? null) : null,
        reservation_customer_name: reservationCustomer?.name ?? null,
        reservation_customer_phone: reservationCustomer?.phone ?? null,
    };
}
function tableShape(db, table, activeOrder, includeReservationCustomer = true) {
    const currentOrder = activeOrder || null;
    const visibleCurrentOrder = currentOrder && !includeReservationCustomer
        ? { ...currentOrder, customer_id: null, customer: null }
        : currentOrder;
    return {
        ...table,
        name: table.number,
        ...(includeReservationCustomer
            ? reservationCustomerShape(db, table)
            : {
                reservation_customer_id: null,
                reservation_customer_name: null,
                reservation_customer_phone: null,
            }),
        activeOrder: visibleCurrentOrder,
        current_order: visibleCurrentOrder,
        seated_at: visibleCurrentOrder?.created_at ?? null,
    };
}
/** Normalize a customer-facing table name without coercing objects or nullish values. */
function normalizeTableNumber(value) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    if (typeof value === 'number' && !Number.isFinite(value))
        return null;
    const normalized = String(value).trim();
    return normalized || null;
}
/** Normalize optional floor/section labels and flag non-string payloads as invalid. */
function normalizeOptionalTableLabel(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== 'string')
        return undefined;
    return value.trim() || null;
}
/** Accept only positive integer number primitives or their non-empty string representation. */
function normalizeTableCapacity(value) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    if (typeof value === 'string' && !value.trim())
        return null;
    const normalized = Number(value);
    return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}
router.get('/', (0, authorization_1.requirePermission)('tables.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let query = 'SELECT * FROM tables WHERE 1=1';
        const params = [];
        if (req.query.status) {
            query += ' AND status = ?';
            params.push(req.query.status);
        }
        if (req.query.floor) {
            query += ' AND floor = ?';
            params.push(req.query.floor);
        }
        if (req.query.section) {
            query += ' AND section = ?';
            params.push(req.query.section);
        }
        if (req.query.kitchen_station_id) {
            query += ' AND kitchen_station_id = ?';
            params.push(req.query.kitchen_station_id);
        }
        if (req.query.active === 'true' || req.query.active === '1') {
            query += ' AND is_active = 1';
        }
        query += ' ORDER BY number';
        const rows = db.prepare(query).all(...params);
        const includeReservationCustomer = (0, authorization_1.hasPermission)(req.user?.userId || '', 'customers.view');
        // Normalize: frontend expects `name`, schema column is `number`
        const tables = rows.map((t) => tableShape(db, t, activeOrderForTable(db, t.id), includeReservationCustomer));
        res.json({ tables });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/:id', (0, authorization_1.requirePermission)('tables.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        const activeOrder = activeOrderForTable(db, req.params.id);
        const includeReservationCustomer = (0, authorization_1.hasPermission)(req.user?.userId || '', 'customers.view');
        // Normalize: frontend expects `name`, schema column is `number`
        res.json({ table: tableShape(db, table, activeOrder, includeReservationCustomer) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Rename a floor across every table. Renaming to an existing floor name merges
// every row from `:name` into the target in one UPDATE. Issue #646.
router.patch('/floors/:name', (0, authorization_1.requirePermission)('tables.manage'), (req, res) => {
    try {
        const oldName = String(req.params.name || '');
        if (!oldName) {
            return res.status(400).json({ code: 'FLOOR_NAME_REQUIRED', error: 'Floor name is required' });
        }
        const newName = normalizeOptionalTableLabel(req.body?.newName);
        if (newName === undefined || newName === null || !newName) {
            return res.status(400).json({ code: 'FLOOR_NAME_REQUIRED', error: 'Floor name is required' });
        }
        if (newName === oldName) {
            return res.json({ floor: newName, affected: 0 });
        }
        const db = (0, db_1.getDatabase)();
        const result = db
            .prepare(`
      UPDATE tables SET floor = ?, updated_at = ?
      WHERE floor = ?
    `)
            .run(newName, (0, db_1.now)(), oldName);
        res.json({ floor: newName, previousFloor: oldName, affected: result.changes });
    }
    catch (error) {
        console.error('[API] Floor rename failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Remove a floor label from every table that uses it; tables stay and fall
// back into the Unassigned bucket. Issue #646.
router.delete('/floors/:name', (0, authorization_1.requirePermission)('tables.manage'), (req, res) => {
    try {
        const name = String(req.params.name || '');
        if (!name) {
            return res
                .status(400)
                .json({ code: 'FLOOR_NAME_REQUIRED', error: 'Floor name is required' });
        }
        const db = (0, db_1.getDatabase)();
        const result = db
            .prepare(`
      UPDATE tables SET floor = NULL, position_x = NULL, position_y = NULL, updated_at = ?
      WHERE floor = ?
    `)
            .run((0, db_1.now)(), name);
        res.json({ floor: null, removedFloor: name, affected: result.changes });
    }
    catch (error) {
        console.error('[API] Floor delete failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/', (0, authorization_1.requirePermission)('tables.manage'), (req, res) => {
    try {
        // Accept `number` (schema column) or `name` (legacy frontend field)
        const { number, name, capacity, floor, section, position_x, position_y, kitchen_station_id } = req.body;
        const tableNumber = normalizeTableNumber(number ?? name);
        if (!tableNumber) {
            return res
                .status(400)
                .json({ code: 'TABLE_NAME_REQUIRED', error: 'Table number is required' });
        }
        const normalizedCapacity = capacity === undefined ? 4 : normalizeTableCapacity(capacity);
        if (normalizedCapacity === null) {
            return res.status(400).json({
                code: 'TABLE_CAPACITY_INVALID',
                error: 'Capacity must be a positive whole number',
            });
        }
        const normalizedFloor = normalizeOptionalTableLabel(floor);
        const normalizedSection = normalizeOptionalTableLabel(section);
        if (normalizedFloor === undefined || normalizedSection === undefined) {
            return res
                .status(400)
                .json({ code: 'TABLE_LOCATION_INVALID', error: 'Floor and section must be text values' });
        }
        const normalizedX = normalizePositionCoord(position_x);
        const normalizedY = normalizePositionCoord(position_y);
        if (normalizedX === undefined || normalizedY === undefined) {
            return res
                .status(400)
                .json({ error: 'Coordinates must be numbers between 0 and 100, or null' });
        }
        const db = (0, db_1.getDatabase)();
        const existing = db.prepare('SELECT * FROM tables WHERE number = ?').get(tableNumber);
        if (existing) {
            if (existing.is_active === 0) {
                return res.status(400).json({
                    code: 'TABLE_INACTIVE_DUPLICATE',
                    error: `Table ${tableNumber} already exists but is deactivated. Please reactivate it from the list.`,
                });
            }
            else {
                return res
                    .status(400)
                    .json({ code: 'TABLE_NAME_DUPLICATE', error: 'Table number already exists' });
            }
        }
        const tableId = `tbl-${(0, crypto_1.randomUUID)().slice(0, 8)}`;
        const result = db
            .prepare(`
      INSERT INTO tables (id, number, capacity, floor, section, position_x, position_y, kitchen_station_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
            .run(tableId, tableNumber, normalizedCapacity, normalizedFloor, normalizedSection, normalizedX, normalizedY, kitchen_station_id || null, (0, db_1.now)(), (0, db_1.now)());
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId);
        res.status(201).json({ table });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Canvas-percentage coordinate: null/undefined clears, otherwise a finite
// 0–100 number. Returns undefined for anything else so callers can reject it.
function normalizePositionCoord(value) {
    if (value === null || value === undefined)
        return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
}
router.patch('/positions', (0, authorization_1.requirePermission)('tables.manage'), (req, res) => {
    try {
        const raw = req.body?.positions;
        if (!Array.isArray(raw)) {
            return res.status(400).json({ error: 'Positions array is required' });
        }
        const updates = [];
        for (const item of raw) {
            if (!item || typeof item.id !== 'string' || !item.id.trim()) {
                return res.status(400).json({ error: 'Invalid table ID in positions payload' });
            }
            const x = normalizePositionCoord(item.position_x);
            const y = normalizePositionCoord(item.position_y);
            if (x === undefined || y === undefined) {
                return res
                    .status(400)
                    .json({ error: 'Coordinates must be numbers between 0 and 100, or null' });
            }
            updates.push({ id: item.id.trim(), position_x: x, position_y: y });
        }
        const db = (0, db_1.getDatabase)();
        if (updates.length > 0) {
            const rows = db
                .prepare(`SELECT id FROM tables WHERE id IN (${updates.map(() => '?').join(',')})`)
                .all(...updates.map((u) => u.id));
            const found = new Set(rows.map((r) => r.id));
            const missing = updates.find((u) => !found.has(u.id));
            if (missing) {
                return res.status(404).json({ error: `Table not found: ${missing.id}` });
            }
        }
        (0, db_1.withTxn)(() => {
            const stmt = db.prepare(`
        UPDATE tables SET
          position_x = ?,
          position_y = ?,
          updated_at = ?
        WHERE id = ?
      `);
            const currentTime = (0, db_1.now)();
            for (const u of updates) {
                stmt.run(u.position_x, u.position_y, currentTime, u.id);
            }
        });
        res.json({ success: true, count: updates.length });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/:id', (0, authorization_1.requirePermission)('tables.manage'), (req, res) => {
    try {
        const { number, name, capacity, floor, section, position_x, position_y, kitchen_station_id } = req.body;
        const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);
        const hasTableNumber = has('number') || has('name');
        const tableNumber = hasTableNumber
            ? normalizeTableNumber(has('number') ? number : name)
            : undefined;
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        if (hasTableNumber && !tableNumber) {
            return res
                .status(400)
                .json({ code: 'TABLE_NAME_REQUIRED', error: 'Table number is required' });
        }
        const normalizedCapacity = has('capacity') ? normalizeTableCapacity(capacity) : table.capacity;
        if (normalizedCapacity === null) {
            return res.status(400).json({
                code: 'TABLE_CAPACITY_INVALID',
                error: 'Capacity must be a positive whole number',
            });
        }
        const normalizedFloor = has('floor') ? normalizeOptionalTableLabel(floor) : table.floor;
        const normalizedSection = has('section') ? normalizeOptionalTableLabel(section) : table.section;
        const normalizedX = has('position_x') ? normalizePositionCoord(position_x) : table.position_x;
        const normalizedY = has('position_y') ? normalizePositionCoord(position_y) : table.position_y;
        if (normalizedX === undefined || normalizedY === undefined) {
            return res
                .status(400)
                .json({ error: 'Coordinates must be numbers between 0 and 100, or null' });
        }
        if (normalizedFloor === undefined || normalizedSection === undefined) {
            return res
                .status(400)
                .json({ code: 'TABLE_LOCATION_INVALID', error: 'Floor and section must be text values' });
        }
        if (hasTableNumber) {
            const existing = db
                .prepare('SELECT * FROM tables WHERE number = ? AND id != ?')
                .get(tableNumber, req.params.id);
            if (existing) {
                return res
                    .status(400)
                    .json({ code: 'TABLE_NAME_DUPLICATE', error: 'Table number already exists' });
            }
        }
        db.prepare(`
      UPDATE tables SET
        number = ?,
        capacity = ?,
        floor = ?,
        section = ?,
        position_x = ?,
        position_y = ?,
        kitchen_station_id = ?,
        updated_at = ?
      WHERE id = ?
    `).run(hasTableNumber ? tableNumber : table.number, normalizedCapacity, normalizedFloor, normalizedSection, normalizedX, normalizedY, has('kitchen_station_id') ? kitchen_station_id : table.kitchen_station_id, (0, db_1.now)(), req.params.id);
        const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        res.json({
            table: tableShape(db, updated, activeOrderForTable(db, req.params.id)),
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/:id/deactivate', (0, authorization_1.requirePermission)('tables.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        if (table.is_active === 0) {
            return res.status(400).json({ error: 'Already deactivated' });
        }
        const activeOrder = db
            .prepare(`
      SELECT * FROM orders WHERE table_id = ? AND ${ACTIVE_ORDER_STATUS_SQL}
    `)
            .get(req.params.id);
        if (activeOrder) {
            return res.status(400).json({ error: 'Cannot deactivate table with active orders' });
        }
        db.prepare('UPDATE tables SET is_active = 0, updated_at = ? WHERE id = ?').run((0, db_1.now)(), req.params.id);
        const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        res.json({ table: tableShape(db, updated) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/:id/reactivate', (0, authorization_1.requirePermission)('tables.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        if (table.is_active === 1) {
            return res.status(400).json({ error: 'Already active' });
        }
        db.prepare('UPDATE tables SET is_active = 1, updated_at = ? WHERE id = ?').run((0, db_1.now)(), req.params.id);
        const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        res.json({ table: tableShape(db, updated) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/:id/move-order', (0, authorization_1.requirePermission)('tables.orders.move'), (req, res) => {
    try {
        const sourceTableId = req.params.id;
        const { target_table_id, order_id } = req.body;
        if (!target_table_id) {
            return res.status(400).json({ error: 'target_table_id is required' });
        }
        if (target_table_id === sourceTableId) {
            return res.status(400).json({ error: 'Order is already on this table' });
        }
        const db = (0, db_1.getDatabase)();
        const moved = (0, db_1.withTxn)(() => {
            const sourceTable = db
                .prepare('SELECT * FROM tables WHERE id = ?')
                .get(sourceTableId);
            if (!sourceTable) {
                const error = new Error('Source table not found');
                error.status = 404;
                throw error;
            }
            const targetTable = db
                .prepare('SELECT * FROM tables WHERE id = ?')
                .get(target_table_id);
            if (!targetTable) {
                const error = new Error('Target table not found');
                error.status = 404;
                throw error;
            }
            if (!targetTable.is_active) {
                throw Object.assign(new Error('Target table is not active'), { status: 400 });
            }
            const order = activeOrderForTable(db, sourceTableId, order_id);
            if (!order) {
                const error = new Error(order_id
                    ? 'Active order not found on source table'
                    : 'Source table has no active order');
                error.status = 404;
                throw error;
            }
            const targetActiveOrder = activeOrderForTable(db, target_table_id);
            if (targetActiveOrder) {
                const error = new Error('Target table already has an active order');
                error.status = 409;
                throw error;
            }
            const targetHeldOrder = db
                .prepare('SELECT id FROM held_orders WHERE table_id = ?')
                .get(target_table_id);
            const currentTargetTable = db
                .prepare('SELECT * FROM tables WHERE id = ?')
                .get(target_table_id);
            if (!currentTargetTable) {
                throw Object.assign(new Error('Target table not found'), { status: 404 });
            }
            if (!currentTargetTable.is_active) {
                throw Object.assign(new Error('Target table is not active'), { status: 400 });
            }
            if (targetHeldOrder ||
                targetTable.status === 'held' ||
                currentTargetTable.status === 'held') {
                const error = new Error('Target table has a held order');
                error.status = 409;
                throw error;
            }
            if (targetTable.status === 'reserved' || currentTargetTable.status === 'reserved') {
                throw Object.assign(new Error('Target table is reserved'), { status: 409 });
            }
            const nowStr = (0, db_1.now)();
            db.prepare('UPDATE orders SET table_id = ?, type = ?, updated_at = ? WHERE id = ?').run(target_table_id, order.type, nowStr, order.id);
            db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?").run(nowStr, sourceTableId);
            db.prepare("UPDATE tables SET status = 'occupied', updated_at = ? WHERE id = ?").run(nowStr, target_table_id);
            const updatedOrder = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id));
            const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
            const updatedSource = db
                .prepare('SELECT * FROM tables WHERE id = ?')
                .get(sourceTableId);
            const updatedTarget = db
                .prepare('SELECT * FROM tables WHERE id = ?')
                .get(target_table_id);
            return {
                order: {
                    ...updatedOrder,
                    items,
                    table: { ...updatedTarget, name: updatedTarget.number },
                },
                sourceTable: tableShape(db, updatedSource, activeOrderForTable(db, sourceTableId)),
                targetTable: tableShape(db, updatedTarget, activeOrderForTable(db, target_table_id)),
            };
        });
        cloud_sync_1.cloudSync.recordOrderChanged(moved.order.id, 'order.table_moved');
        (0, kds_1.notifyKdsUpdate)();
        res.json({
            order: moved.order,
            sourceTable: moved.sourceTable,
            targetTable: moved.targetTable,
        });
    }
    catch (error) {
        const statusCode = error.status || 500;
        console.error('[API] Table move failed:', error);
        res
            .status(statusCode)
            .json({ error: statusCode >= 500 ? 'Table move failed' : error.message });
    }
});
router.patch('/:id/status', (0, authorization_1.requirePermission)('tables.manage'), (req, res) => {
    try {
        const { status } = req.body;
        const reservationCustomerId = req.body.reservation_customer_id;
        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }
        const validStatuses = ['available', 'occupied', 'reserved', 'cleaning', 'held'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
        }
        if (status !== 'reserved' && reservationCustomerId != null) {
            return res
                .status(400)
                .json({ error: 'A reservation customer can only be set for a reserved table' });
        }
        let normalizedReservationCustomerId = null;
        if (status === 'reserved' && reservationCustomerId != null) {
            if (typeof reservationCustomerId !== 'string' || !reservationCustomerId.trim()) {
                return res
                    .status(400)
                    .json({ error: 'Reservation customer ID must be a non-empty string' });
            }
            normalizedReservationCustomerId = reservationCustomerId.trim();
        }
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        if (normalizedReservationCustomerId) {
            const customer = db
                .prepare('SELECT id FROM customers WHERE id = ? AND is_active = 1')
                .get(normalizedReservationCustomerId);
            if (!customer) {
                return res.status(400).json({ error: 'Reservation customer was not found or is inactive' });
            }
        }
        if (status === 'reserved') {
            db.prepare('UPDATE tables SET status = ?, reservation_customer_id = ?, updated_at = ? WHERE id = ?').run(status, normalizedReservationCustomerId, (0, db_1.now)(), req.params.id);
        }
        else {
            db.prepare('UPDATE tables SET status = ?, updated_at = ? WHERE id = ?').run(status, (0, db_1.now)(), req.params.id);
        }
        const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        res.json({ table: { ...updated, ...reservationCustomerShape(db, updated) } });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.tableRoutes = router;
//# sourceMappingURL=tables.js.map