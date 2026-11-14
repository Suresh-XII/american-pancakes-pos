import { type Role } from './role-permissions';
export type PermissionArea = 'orders' | 'tables' | 'payments' | 'cash' | 'customers' | 'menu' | 'inventory' | 'kitchen' | 'reports' | 'staff' | 'authorization' | 'settings' | 'tax' | 'printing' | 'integrations' | 'system' | 'apps' | 'support';
export type PermissionRisk = 'standard' | 'sensitive' | 'destructive';
/**
 * Stable authorization capabilities and their shipped role defaults.
 *
 * Runtime permission IDs are persistence keys. Never reuse an ID for a
 * different meaning. Store-local changes live in sparse override tables, so
 * changing a default here is a product migration and must be reviewed as one.
 */
export declare const PERMISSION_DEFINITIONS: readonly [{
    readonly id: "pos.use";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "orders.read";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "orders.create";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "orders.status.update";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "orders.customer.update";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "orders.discount.apply";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "orders.item.cancel";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "orders.item.void";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "orders.item.edit";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "orders.item.price_override";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: false;
    readonly risk: "sensitive";
}, {
    readonly id: "orders.item.restore";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "held-orders.manage";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "tables.view";
    readonly area: "tables";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "tables.manage";
    readonly area: "tables";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "tables.orders.move";
    readonly area: "tables";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "bills.read";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "bills.generate";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "payments.take";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "bills.discount.apply";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "bills.print";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "refunds.view";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "refunds.initiate";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "payment-methods.view";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "payment-methods.manage";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "expenses.view";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "expenses.manage";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "expenses.pay";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "expenses.reverse";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "cash.shifts.view";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "cash.shifts.open";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "cash.shifts.close";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "cash.movements.manage";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "cash.movements.void";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "cash.day-close";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "customers.view";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "customers.create";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "customers.edit";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "customers.maintenance";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "customers.cleanup";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "destructive";
}, {
    readonly id: "catalog.view";
    readonly area: "menu";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "catalog.manage";
    readonly area: "menu";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "catalog.import-export";
    readonly area: "menu";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "inventory.view";
    readonly area: "inventory";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "inventory.manage";
    readonly area: "inventory";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "supplies.manage";
    readonly area: "inventory";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "kitchen.use";
    readonly area: "kitchen";
    readonly defaultRoles: readonly ["owner", "manager", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "kitchen.status.update";
    readonly area: "kitchen";
    readonly defaultRoles: readonly ["owner", "manager", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "kitchen.pair";
    readonly area: "kitchen";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "kitchen.stations.manage";
    readonly area: "kitchen";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "dashboard.view";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "reports.view";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "reports.financial.view";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "reports.daily-sales.export";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "reports.customer-sales.export";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "staff.view";
    readonly area: "staff";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "staff.operational.manage";
    readonly area: "staff";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "staff.privileged.manage";
    readonly area: "staff";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: false;
    readonly risk: "sensitive";
}, {
    readonly id: "authorization.manage";
    readonly area: "authorization";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: false;
    readonly risk: "sensitive";
}, {
    readonly id: "settings.view";
    readonly area: "settings";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "settings.manage";
    readonly area: "settings";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "tax-packs.view-test";
    readonly area: "tax";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "tax-configuration.manage";
    readonly area: "tax";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "tax-packs.manage";
    readonly area: "tax";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "printing.execute";
    readonly area: "printing";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "printers.manage";
    readonly area: "printing";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "print-templates.view";
    readonly area: "printing";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "print-templates.manage";
    readonly area: "printing";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "whatsapp.use";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "whatsapp.manage";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "cloud.manage";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "cloud.account.manage";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "destructive";
}, {
    readonly id: "google-drive.manage";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "destructive";
}, {
    readonly id: "offline-mode.manage";
    readonly area: "system";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: false;
    readonly risk: "sensitive";
}, {
    readonly id: "database.manage";
    readonly area: "system";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "destructive";
}, {
    readonly id: "mobile-access.manage";
    readonly area: "system";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
}, {
    readonly id: "server-app.use";
    readonly area: "apps";
    readonly defaultRoles: readonly ["server", "manager", "owner"];
    readonly configurable: true;
    readonly risk: "standard";
}, {
    readonly id: "support.use";
    readonly area: "support";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
}];
export type PermissionDefinition = (typeof PERMISSION_DEFINITIONS)[number];
export type PermissionId = PermissionDefinition['id'];
export type PermissionEffect = 'allow' | 'deny';
export declare const PERMISSION_IDS: PermissionId[];
export declare const PERMISSION_BY_ID: Map<"authorization.manage" | "inventory.manage" | "supplies.manage" | "orders.item.price_override" | "pos.use" | "orders.read" | "orders.create" | "orders.status.update" | "orders.customer.update" | "orders.discount.apply" | "orders.item.cancel" | "orders.item.void" | "orders.item.edit" | "orders.item.restore" | "held-orders.manage" | "tables.view" | "tables.manage" | "tables.orders.move" | "bills.read" | "bills.generate" | "payments.take" | "bills.discount.apply" | "bills.print" | "refunds.view" | "refunds.initiate" | "payment-methods.view" | "payment-methods.manage" | "expenses.view" | "expenses.manage" | "expenses.pay" | "expenses.reverse" | "cash.shifts.view" | "cash.shifts.open" | "cash.shifts.close" | "cash.movements.manage" | "cash.movements.void" | "cash.day-close" | "customers.view" | "customers.create" | "customers.edit" | "customers.maintenance" | "customers.cleanup" | "catalog.view" | "catalog.manage" | "catalog.import-export" | "inventory.view" | "kitchen.use" | "kitchen.status.update" | "kitchen.pair" | "kitchen.stations.manage" | "dashboard.view" | "reports.view" | "reports.financial.view" | "reports.daily-sales.export" | "reports.customer-sales.export" | "staff.view" | "staff.operational.manage" | "staff.privileged.manage" | "settings.view" | "settings.manage" | "tax-packs.view-test" | "tax-configuration.manage" | "tax-packs.manage" | "printing.execute" | "printers.manage" | "print-templates.view" | "print-templates.manage" | "whatsapp.use" | "whatsapp.manage" | "cloud.manage" | "cloud.account.manage" | "google-drive.manage" | "offline-mode.manage" | "database.manage" | "mobile-access.manage" | "server-app.use" | "support.use", {
    readonly id: "pos.use";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "orders.read";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "orders.create";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "orders.status.update";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "orders.customer.update";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "orders.discount.apply";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "orders.item.cancel";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "orders.item.void";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "orders.item.edit";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "orders.item.price_override";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: false;
    readonly risk: "sensitive";
} | {
    readonly id: "orders.item.restore";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "held-orders.manage";
    readonly area: "orders";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "tables.view";
    readonly area: "tables";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "tables.manage";
    readonly area: "tables";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "tables.orders.move";
    readonly area: "tables";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "bills.read";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "bills.generate";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "payments.take";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "bills.discount.apply";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "bills.print";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "refunds.view";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "refunds.initiate";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "payment-methods.view";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "payment-methods.manage";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "expenses.view";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "expenses.manage";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "expenses.pay";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "expenses.reverse";
    readonly area: "payments";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "cash.shifts.view";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "cash.shifts.open";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "cash.shifts.close";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "cash.movements.manage";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "cash.movements.void";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "cash.day-close";
    readonly area: "cash";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "customers.view";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "customers.create";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "customers.edit";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "customers.maintenance";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "customers.cleanup";
    readonly area: "customers";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "destructive";
} | {
    readonly id: "catalog.view";
    readonly area: "menu";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "catalog.manage";
    readonly area: "menu";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "catalog.import-export";
    readonly area: "menu";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "inventory.view";
    readonly area: "inventory";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "inventory.manage";
    readonly area: "inventory";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "supplies.manage";
    readonly area: "inventory";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "kitchen.use";
    readonly area: "kitchen";
    readonly defaultRoles: readonly ["owner", "manager", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "kitchen.status.update";
    readonly area: "kitchen";
    readonly defaultRoles: readonly ["owner", "manager", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "kitchen.pair";
    readonly area: "kitchen";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "kitchen.stations.manage";
    readonly area: "kitchen";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "dashboard.view";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "reports.view";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "reports.financial.view";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "reports.daily-sales.export";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "reports.customer-sales.export";
    readonly area: "reports";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "staff.view";
    readonly area: "staff";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "staff.operational.manage";
    readonly area: "staff";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "staff.privileged.manage";
    readonly area: "staff";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: false;
    readonly risk: "sensitive";
} | {
    readonly id: "authorization.manage";
    readonly area: "authorization";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: false;
    readonly risk: "sensitive";
} | {
    readonly id: "settings.view";
    readonly area: "settings";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "settings.manage";
    readonly area: "settings";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "tax-packs.view-test";
    readonly area: "tax";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "tax-configuration.manage";
    readonly area: "tax";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "tax-packs.manage";
    readonly area: "tax";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "printing.execute";
    readonly area: "printing";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "printers.manage";
    readonly area: "printing";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "print-templates.view";
    readonly area: "printing";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "print-templates.manage";
    readonly area: "printing";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "whatsapp.use";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner", "manager", "cashier"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "whatsapp.manage";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "cloud.manage";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner", "manager"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "cloud.account.manage";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "destructive";
} | {
    readonly id: "google-drive.manage";
    readonly area: "integrations";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "destructive";
} | {
    readonly id: "offline-mode.manage";
    readonly area: "system";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: false;
    readonly risk: "sensitive";
} | {
    readonly id: "database.manage";
    readonly area: "system";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "destructive";
} | {
    readonly id: "mobile-access.manage";
    readonly area: "system";
    readonly defaultRoles: readonly ["owner"];
    readonly configurable: true;
    readonly risk: "sensitive";
} | {
    readonly id: "server-app.use";
    readonly area: "apps";
    readonly defaultRoles: readonly ["server", "manager", "owner"];
    readonly configurable: true;
    readonly risk: "standard";
} | {
    readonly id: "support.use";
    readonly area: "support";
    readonly defaultRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly configurable: true;
    readonly risk: "standard";
}>;
export declare const PROTECTED_PERMISSION_IDS: PermissionId[];
export declare function isPermissionId(value: unknown): value is PermissionId;
export declare function defaultPermissionIdsForRole(role: Role): PermissionId[];
export declare function permissionDefaultAllows(permissionId: PermissionId, role: Role): boolean;
//# sourceMappingURL=permissions.d.ts.map