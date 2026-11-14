# FloCafe POS – Stage 6A: Delivery Platform Integration Foundation

**Business:** American Pancakes  
**System:** FloCafe POS  
**Architecture:** Local-First Restaurant POS (SQLite + Next.js + Electron)  
**Status:** Completed & Regression Verified (Stage 6A)

---

## 1. Executive Summary & Business Context

FloCafe POS Stage 6A establishes an **API-ready delivery platform integration foundation** with native adapters for **Swiggy**, **Zomato**, and a full **Sandbox Simulator**.

### Crucial Integration Boundary
- Official approved partner API access has **not yet been granted** by Swiggy or Zomato for American Pancakes.
- **Strict safety rule:** FloCafe POS **does not** scrape partner dashboards, automate customer websites, or connect to unauthorized/unofficial endpoints.
- **Live Mode Protection:** The integration system enforces an automated safety guard preventing activation of `mode = 'live'` for platforms pending official partner onboarding.
- **Sandbox Mode:** Provides a complete end-to-end sandbox simulator allowing restaurant managers and cashiers to simulate external orders, verify menu mappings, validate Stage 5 parcel packaging allocations, observe Kitchen Display System (KDS) live updates, and verify `checkout_v1` inventory consumption without risk.

---

## 2. Architecture & Adapter Pattern

The delivery system is designed using a provider-independent adapter pattern (`DeliveryProviderAdapter`). All external interactions are mediated through provider adapters, keeping core POS order lifecycles and business rules cleanly isolated.

```
┌────────────────────────────────────────────────────────┐
│                   External Platforms                   │
│   [Swiggy Partner API]   [Zomato Partner API]   [Sandbox]
└───────────────────────────┬────────────────────────────┘
                            │ (Webhooks / HTTP)
┌───────────────────────────▼────────────────────────────┐
│              Delivery Provider Adapters                │
│   SwiggyAdapter     ZomatoAdapter     SandboxAdapter   │
└───────────────────────────┬────────────────────────────┘
                            │ (Normalized Delivery Order)
┌───────────────────────────▼────────────────────────────┐
│            Delivery Integration Service                │
│   - Provider-scoped idempotency check                  │
│   - External menu mapping resolution                   │
│   - Item & variant validation                          │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│            Core FloCafe POS Subsystems                 │
│   - Orders Engine (type = 'online', checkout_v1)       │
│   - Stage 5 Packaging Engine (parcel allocations)      │
│   - Kitchen Display System (KDS auto-broadcast)        │
│   - Inventory Consumption (deferred checkout_v1)       │
└────────────────────────────────────────────────────────┘
```

### Component Breakdown
1. **`main/services/delivery/types.ts`**: Unified domain types for normalized delivery orders, menu mappings, platform configurations, order tracking, and webhook event logs.
2. **`main/services/delivery/adapters/provider-adapter.ts`**: The standard interface defining `isLiveSupported()`, `validateWebhookSignature()`, `parseIncomingOrder()`, `mapExternalStatus()`, `mapInternalStatus()`, and `updateOrderStatus()`.
3. **`main/services/delivery/adapters/swiggy-adapter.ts`**: Swiggy-specific payload parser and status mapper. Returns `isLiveSupported() === false` pending official partnership.
4. **`main/services/delivery/adapters/zomato-adapter.ts`**: Zomato-specific payload parser and status mapper. Returns `isLiveSupported() === false` pending official partnership.
5. **`main/services/delivery/adapters/sandbox-adapter.ts`**: Fully functional simulator adapter generating valid simulated orders with customer, address, item, and fee payloads.
6. **`main/services/delivery/delivery-service.ts`**: Core domain logic coordinating config management, menu resolution, transactional order creation, status synchronization, and webhook audit/retry.
7. **`main/routes/delivery.ts`**: Express REST API mounted under `/api/delivery`.
8. **`frontend/src/components/settings/DeliveryIntegrationsPanel.tsx`**: Next.js UI management panel for configs, mappings, simulator, and webhook logs.

---

## 3. Database Schema (Migration v130)

Migration 130 introduces four dedicated tables designed for auditability, idempotency, and high-performance querying:

### 1. `delivery_platform_configs`
Stores platform settings, operational modes, and credentials:
- `provider`: Primary Key (`'swiggy' | 'zomato' | 'sandbox'`).
- `display_name`: Formatted provider title (`'Swiggy'`, `'Zomato'`, `'Sandbox Simulator'`).
- `is_enabled`: Boolean flag indicating whether orders will be accepted.
- `mode`: Integration mode (`'disconnected' | 'sandbox' | 'live'`).
- `api_key_configured` / `api_secret_configured`: Credential status indicators.
- `merchant_id` / `store_id`: External store identifiers.
- `auto_accept_orders`: Automatically moves accepted orders to `'preparing'` state.
- `last_sync_at` / `last_error` / `last_error_at`: Health monitoring fields.

### 2. `delivery_menu_mappings`
Maps external platform catalog identifiers to internal FloCafe products and variants:
- `id`: Auto-incrementing primary key.
- `provider`: Target platform.
- `external_item_id`: Item identifier assigned by external platform (e.g. `'SW-BLUEBERRY-1'`).
- `external_variant_id`: Optional external variant code.
- `internal_product_id`: Foreign key reference to POS `products.id`.
- `internal_variant_id`: Foreign key reference to POS `product_variants.id`.
- `external_name`: Display name on external platform.
- `sync_status`: Current sync status (`'mapped' | 'unmapped' | 'error'`).
- **Constraint:** `UNIQUE(provider, external_item_id, external_variant_id)`.

### 3. `delivery_order_tracking`
Provides lifecycle tracking and audit records for incoming delivery orders:
- `id`: Auto-incrementing primary key.
- `internal_order_id`: Unique reference to `orders.id`.
- `provider`: Originating provider.
- `external_order_id`: External order identifier (e.g. `'SIM-ORD-101'`).
- `is_simulated`: Boolean flag indicating sandbox test orders.
- `external_status`: Status on external platform (`'received' | 'accepted' | 'preparing' | 'ready' | 'dispatched' | 'delivered' | 'cancelled' | 'rejected'`).
- `internal_status`: POS status (`'pending' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled'`).
- `pickup_code`, `rider_name`, `rider_phone`, `estimated_delivery_time`, `delivery_address`.
- `raw_details_json`: Full incoming payload preserved for diagnostics.
- **Constraint:** `UNIQUE(provider, external_order_id)`.

### 4. `delivery_webhook_events`
Stores immutable incoming webhook events for idempotency and manual retry:
- `id`: Auto-incrementing primary key.
- `event_id`: External event identifier.
- `provider`: Originating provider.
- `event_type`: Event kind (`'order.created'`, `'order.status_updated'`, etc.).
- `idempotency_key`: Combined provider + event ID string.
- `payload_json`: Verbatim webhook payload.
- `status`: Event processing state (`'received' | 'processed' | 'failed' | 'ignored'`).
- `retry_count`: Number of manual retry attempts.
- `last_error`: Diagnostic message if processing encountered an error.
- **Constraint:** `UNIQUE(idempotency_key)`.

---

## 4. Order Ingestion & POS Lifecycle Integration

When an order arrives (via webhook or sandbox simulator), `ingestDeliveryOrder()` executes within an atomic transaction:

1. **Provider-Scoped Idempotency:**
   - Checks `delivery_order_tracking` for an existing `(provider, external_order_id)`.
   - If present, returns the existing POS order with `isDuplicate: true` without duplicating records or double-charging.
2. **External Menu Resolution:**
   - Every order line is resolved against `delivery_menu_mappings`.
   - If an unmapped item is encountered, ingestion is safely aborted with HTTP 400 and an actionable message indicating which external item requires mapping.
3. **Stage 5 Packaging Integration:**
   - External delivery orders default to the `'parcel'` serving type.
   - For every line, `persistItemServingAndPackaging()` is called with `serving_type: 'parcel'`.
   - Automatically resolves multi-material parcel packaging profiles (e.g., pancake kraft box + birchwood cutlery), generates immutable packaging allocation snapshots, and adds the packaging fee to the order.
4. **Checkout_v1 Inventory Lifecycle:**
   - Orders are assigned `inventory_lifecycle = 'checkout_v1'`.
   - Inventory is NOT deducted at order ingestion. Stock deduction is safely deferred until checkout settlement via `consumeCheckoutInventory()`.
5. **Kitchen Display System (KDS):**
   - Calls `notifyKdsUpdate()` immediately after order creation, alerting kitchen stations of new incoming delivery orders in real time.

---

## 5. Order Status Synchronization

Status transitions between POS and delivery platforms follow strict bidirectional mapping:

| External Platform Status | Internal POS Status | Meaning |
| :--- | :--- | :--- |
| `received` | `pending` | Order placed by customer, awaiting kitchen acceptance |
| `accepted` / `preparing` | `preparing` | Order accepted, kitchen is cooking |
| `ready` | `ready` | Food packed, ready for delivery rider pickup |
| `dispatched` | `served` | Handed over to rider |
| `delivered` | `completed` | Rider marked delivery complete |
| `cancelled` / `rejected` | `cancelled` | Order cancelled or rejected |

### Transition Safety Invariant
Once an order reaches terminal status (`'completed'` or `'cancelled'`), subsequent status modification attempts are strictly rejected with HTTP 400, preventing invalid regression transitions.

---

## 6. Settings UI & Sandbox Simulator

Located in POS Settings under **Integrations > Delivery Platforms**:
- **Platform Cards:** Live display of Swiggy, Zomato, and Sandbox status, mode badges, auto-accept toggles, and pending onboarding alerts.
- **Menu Mappings Table:** Filterable by platform, supporting creation and deletion of product/variant mappings.
- **Sandbox Order Simulator Modal:** Test order generator allowing customization of external order IDs, mapped items, quantities, delivery fees, customer details, and special instructions.
- **Webhook Audit Log:** Chronological table of incoming webhooks with status badges, error details, and an instant **Retry** button for failed events.

---

## 7. Security, Roles & Permissions

Endpoint access is gated using the FloCafe POS authorization system:
- `settings.view` / `settings.manage`: View and update platform configs (Owner only for config writes).
- `catalog.view` / `catalog.manage`: View, create, update, and delete menu mappings.
- `orders.create`: Run sandbox order simulations and trigger webhook retries.
- `orders.read`: View order tracking details.
- `orders.status.update` / `orders.item.edit`: Synchronize order statuses.
- **Webhook Receiver:** Publicly exposed to accept platform callbacks; requests are verified via `validateWebhookSignature()` on the adapter.

---

## 8. Checklist for Future Official Onboarding

When official partner API approval is received from Swiggy or Zomato:

1. **Obtain Official Partner Credentials:**
   - Merchant ID & Store ID.
   - Production API Key & Secret.
   - Webhook signing secret.
2. **Update Adapter Implementation:**
   - In `main/services/delivery/adapters/swiggy-adapter.ts` (or `zomato-adapter.ts`):
     - Implement HMAC-SHA256 signature verification in `validateWebhookSignature()`.
     - Implement live HTTP client calls in `updateOrderStatus()`.
     - Return `true` from `isLiveSupported()`.
3. **Configure Settings:**
   - Enter credentials in the Delivery Platforms panel.
   - Switch mode from `sandbox` to `live`.
4. **Verify Live Webhooks:**
   - Point platform webhook URL to `https://<pos-host>/api/delivery/webhooks/swiggy`.
   - Monitor `delivery_webhook_events` audit table for initial live test ping.
