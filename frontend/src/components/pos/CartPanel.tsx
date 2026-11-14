'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import {
  ShoppingCart,
  UtensilsCrossed,
  Package,
  Truck,
  Globe,
  Plus,
  Minus,
  Trash2,
  Pause,
  MapPin,
  SquarePen,
  Tag,
  Users,
  Wallet,
  StickyNote,
  CalendarClock,
  CreditCard,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import type { CustomPaymentMethod } from '@/lib/payment-methods';
import { useCartStore, type CartOrderType } from '@/store/cart';
import { useHeldOrdersStore } from '@/store/held-orders';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore } from '@/store/pos-settings';
import { useTranslations } from 'use-intl';
import toast from 'react-hot-toast';
import type { Table, Order, OrderItem, CartItem, ServingAllocationInput } from '@/lib/types';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { fractionalQuantityStep, roundToQuantityPrecision } from '@/lib/utils';
import { cartLineUnitPrice, cartVariantUnitPrice } from '@/lib/cart-price';
import { tenantCan } from '@/lib/permissions';
import { CartPriceOverrideModal } from '@/components/pos/CartPriceOverrideModal';
import { calculateAppliedCharges } from '@/lib/charges';
import { chargesForOrderType, useChargesStore } from '@/store/charges';
import { getCurrencyFractionDigits } from '@countries';
import { isTerminalItemStatus } from '../../../../shared/order-item-status';
import {
  formatScheduledInstantForDisplay,
  parseScheduledForInput,
  suggestFutureScheduleWallClock,
} from '@/lib/scheduled-time';

interface Props {
  tables: Table[];
  currency: string;
  submitting: boolean;
  onPlaceOrder: () => void;
  onSendToPayment?: () => void;
  onOpenPaymentQueue?: () => void;
  counterRole?: 'ordering' | 'payment' | 'combined' | null;
  multiCounterEnabled?: boolean;
  onEditItem?: (item: CartItem) => void;
  onModalOpenChange?: (open: boolean) => void;
  variant?: 'sidebar' | 'drawer';
  existingOrder?: Order | null;
  storeTimezone?: string;
  onCancelExistingOrderMode?: () => void;
}

const orderTypeIcons = {
  dine_in: UtensilsCrossed,
  takeaway: Package,
  delivery: Truck,
  online: Globe,
};

type PackagingProfile = {
  id: string;
  name: string;
  serving_type: 'dine_in' | 'parcel';
  packaging_type: 'paper_plate' | 'parcel_box';
  units_per_serving: number;
  customer_charge_per_unit: number;
  is_default: number | boolean;
};

function allocationFor(item: CartItem, servingType: 'dine_in' | 'parcel') {
  return (item.serving_allocations || []).find((entry) => entry.serving_type === servingType);
}

function ServingSelector({
  item,
  profiles,
  orderType,
  onChange,
}: {
  item: CartItem;
  profiles: PackagingProfile[];
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'online';
  onChange: (allocations: ServingAllocationInput[]) => void;
}) {
  const isTakeawayOrOnline =
    orderType === 'takeaway' || orderType === 'delivery' || orderType === 'online';
  const parcelProfiles = profiles.filter((profile) => profile.serving_type === 'parcel');
  const defaultParcel =
    parcelProfiles.find((profile) => Boolean(profile.is_default)) || parcelProfiles[0];
  const parcel = allocationFor(item, 'parcel');
  const dine = allocationFor(item, 'dine_in');
  const parcelQuantity = Number(parcel?.quantity || 0);
  const dineQuantity = Number(dine?.quantity || 0);

  const selectedParcelProfile =
    parcelProfiles.find(
      (profile) => profile.id === (parcel?.packaging_profile_id || defaultParcel?.id),
    ) || defaultParcel;

  const parcelBoxesRequired =
    item.quantity * Number(selectedParcelProfile?.units_per_serving || 0);

  useEffect(() => {
    if (isTakeawayOrOnline) {
      if (parcelQuantity !== item.quantity || dineQuantity > 0) {
        onChange([
          {
            serving_type: 'parcel',
            quantity: item.quantity,
            packaging_profile_id: parcel?.packaging_profile_id || defaultParcel?.id || null,
          },
        ]);
      }
    } else {
      if (dineQuantity !== item.quantity || parcelQuantity > 0) {
        onChange([{ serving_type: 'dine_in', quantity: item.quantity }]);
      }
    }
  }, [
    isTakeawayOrOnline,
    item.quantity,
    parcelQuantity,
    dineQuantity,
    parcel?.packaging_profile_id,
    defaultParcel?.id,
    onChange,
  ]);

  if (isTakeawayOrOnline) {
    return (
      <div
        className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs space-y-1.5"
        data-testid="serving-selector"
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold text-foreground">
            {orderType === 'takeaway' ? 'Parcel / Takeaway' : 'Delivery / Online'}
          </span>
          <span className="rounded bg-background px-2 py-0.5 text-muted-foreground border border-border">
            Qty: {item.quantity}
          </span>
        </div>
        <div className="space-y-1.5">
          <label className="block text-muted-foreground">
            Parcel box profile
            <select
              aria-label="Parcel box profile"
              value={parcel?.packaging_profile_id || defaultParcel?.id || ''}
              onChange={(event) =>
                onChange([
                  {
                    serving_type: 'parcel',
                    quantity: item.quantity,
                    packaging_profile_id: event.target.value || defaultParcel?.id || null,
                  },
                ])
              }
              className="mt-0.5 w-full rounded border border-border bg-card px-1 py-1"
            >
              {parcelProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <p className="text-muted-foreground">
            Boxes required: {parcelBoxesRequired}
            ({Number(selectedParcelProfile?.units_per_serving || 0)} per pancake)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs space-y-1.5"
      data-testid="serving-selector"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground">Dine-in / Regular</span>
        <span className="rounded bg-background px-2 py-0.5 text-muted-foreground border border-border">
          Paper plates: {item.quantity}
        </span>
      </div>
    </div>
  );
}

function ItemQuantityControl({
  item,
  updateQuantity,
}: {
  item: CartItem;
  updateQuantity: (cartItemId: string, quantity: number) => void;
}) {
  const t = useTranslations('pos');
  const step = fractionalQuantityStep(item.product);
  const [draft, setDraft] = useState(() => String(item.quantity));
  const [lastQuantity, setLastQuantity] = useState(item.quantity);
  if (lastQuantity !== item.quantity) {
    setLastQuantity(item.quantity);
    setDraft(String(item.quantity));
  }

  const commitDraft = () => {
    if (step == null) return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(item.quantity));
      return;
    }
    const rounded = Math.max(step, roundToQuantityPrecision(parsed, step));
    updateQuantity(item.id, rounded);
    setDraft(String(rounded));
  };

  const stepBy = (sign: 1 | -1) => {
    if (step == null) {
      updateQuantity(item.id, item.quantity + sign);
      return;
    }
    const next = roundToQuantityPrecision(item.quantity + sign * step, step);
    updateQuantity(item.id, next);
    setDraft(String(next));
  };

  if (step == null) {
    return (
      <>
        <button
          onClick={() => stepBy(-1)}
          className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
          aria-label={t('remove')}
        >
          <Minus size={16} />
        </button>
        <span
          data-testid="cart-item-qty"
          className="w-6 text-center text-base font-semibold tabular-nums"
        >
          {item.quantity}
        </span>
        <button
          onClick={() => stepBy(1)}
          className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
          aria-label={t('addItems')}
        >
          <Plus size={16} />
        </button>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => stepBy(-1)}
        className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
        aria-label={t('remove')}
      >
        <Minus size={16} />
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={step}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitDraft();
        }}
        aria-label={t('quantity')}
        className="w-14 text-center text-base font-semibold tabular-nums border border-border bg-card rounded-md px-1 py-0.5 outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
      <button
        onClick={() => stepBy(1)}
        className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
        aria-label={t('addItems')}
      >
        <Plus size={16} />
      </button>
    </>
  );
}

export default function CartPanel({
  tables,
  submitting,
  onPlaceOrder,
  onSendToPayment,
  onOpenPaymentQueue,
  counterRole,
  multiCounterEnabled = false,
  onEditItem,
  onModalOpenChange,
  variant = 'sidebar',
  existingOrder,
  storeTimezone,
  onCancelExistingOrderMode,
}: Props) {
  const cart = useCartStore();
  const [packagingProfiles, setPackagingProfiles] = useState<PackagingProfile[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.get('/packaging-profiles?active_only=true')
      .then((response) => {
        if (!cancelled) setPackagingProfiles(response.data.profiles || []);
      })
      .catch(() => { if (!cancelled) setPackagingProfiles([]); });
    return () => { cancelled = true; };
  }, []);
  const heldOrders = useHeldOrdersStore();
  const { user, currentTenant } = useAuthStore();
  const canOverridePrice = tenantCan(currentTenant, 'orders.item.price_override');
  const [priceOverrideState, setPriceOverrideState] = useState<{
    userId: string | number | undefined;
    itemId: string;
  } | null>(null);
  const priceOverrideItemId =
    canOverridePrice && priceOverrideState && priceOverrideState.userId === user?.id
      ? priceOverrideState.itemId
      : null;
  const setPriceOverrideItemId = (itemId: string | null) =>
    setPriceOverrideState(itemId ? { userId: user?.id, itemId } : null);
  const priceOverrideTarget =
    canOverridePrice && priceOverrideItemId
      ? cart.items.find((i) => i.id === priceOverrideItemId)
      : undefined;
  const priceOverrideOpen = Boolean(priceOverrideTarget);
  useEffect(() => {
    onModalOpenChange?.(priceOverrideOpen);
    return () => onModalOpenChange?.(false);
  }, [priceOverrideOpen, onModalOpenChange]);
  const billingType = usePosSettingsStore((s) => s.billingType);
  const t = useTranslations('pos');
  const tCommon = useTranslations('common');
  const tOrders = useTranslations('orders');
  const tSettings = useTranslations('settings');
  const isRestaurant = (currentTenant?.business_type ?? 'restaurant') === 'restaurant';
  const fmt = useFormatCurrency();
  const effectiveTimezone = storeTimezone || currentTenant?.timezone || 'UTC';
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);
  const canScheduleCart =
    !existingOrder && (cart.orderType === 'takeaway' || cart.orderType === 'delivery');
  const scheduleValidation =
    canScheduleCart && cart.scheduledFor.trim().length > 0
      ? parseScheduledForInput({
          input: cart.scheduledFor,
          timezone: effectiveTimezone,
          nowMs,
        })
      : null;
  const scheduleErrorMessage =
    scheduleValidation && !scheduleValidation.ok
      ? scheduleValidation.code === 'PAST_SCHEDULED_TIME'
        ? t('scheduledPastTimeError', { timezone: effectiveTimezone })
        : scheduleValidation.code === 'DST_NONEXISTENT_TIME'
          ? t('scheduledDstSkippedError', { timezone: effectiveTimezone })
          : scheduleValidation.code === 'DST_AMBIGUOUS_TIME'
            ? t('scheduledDstAmbiguousError', { timezone: effectiveTimezone })
            : t('scheduledInvalidTimeError', { timezone: effectiveTimezone })
      : null;
  const canHold =
    isRestaurant &&
    cart.orderType === 'dine_in' &&
    cart.tableId &&
    cart.items.length > 0 &&
    billingType === 'postpaid';
  const selectableOrderTypes: CartOrderType[] = existingOrder?.type === 'delivery'
    ? ['dine_in', 'takeaway', 'online', 'delivery']
    : ['dine_in', 'takeaway', 'online'];

  const isDeliveryOrder = cart.orderType === 'delivery';
  const [customPaymentMethods, setCustomPaymentMethods] = useState<CustomPaymentMethod[]>([]);
  useEffect(() => {
    if (!isDeliveryOrder || existingOrder) return;
    api
      .get('/payment-methods')
      .then((res) => setCustomPaymentMethods(res.data.payment_methods || []))
      .catch(() => setCustomPaymentMethods([]));
  }, [isDeliveryOrder, existingOrder]);

  const charges = useChargesStore((s) => s.charges);
  const loadCharges = useChargesStore((s) => s.load);
  useEffect(() => {
    void loadCharges();
  }, [loadCharges]);

  // Preview only: the backend recomputes and persists the authoritative amounts.
  // Serving snapshots own packaging charges. Keep the configurable generic
  // packaging fee out of this preview so the customer sees it exactly once.
  const applicableCharges = chargesForOrderType(charges, cart.orderType)
    .filter((charge) => charge.id !== 'packaging_charge');
  const appliedCharges = calculateAppliedCharges({
    definitions: applicableCharges,
    orderType: cart.orderType,
    subtotal: cart.subtotal(),
    discountAmount: 0,
    waivedIds: cart.waivedChargeIds,
    optedInIds: cart.optedInChargeIds,
    currencyDecimals: getCurrencyFractionDigits(currentTenant?.currency || ''),
  });
  const chargeTotal = appliedCharges.reduce(
    (sum, charge) => sum + (charge.waived ? 0 : charge.amount),
    0,
  );
  const packagingSummary = cart.items.reduce(
    (summary, item) => {
      const allocations = item.serving_allocations || [{ serving_type: 'dine_in' as const, quantity: item.quantity }];
      for (const allocation of allocations) {
        const profile = packagingProfiles.find((candidate) =>
          candidate.id === allocation.packaging_profile_id ||
          (!allocation.packaging_profile_id && candidate.serving_type === allocation.serving_type && Boolean(candidate.is_default)),
        );
        if (!profile) continue;
        const packageQuantity =Number(allocation.quantity) * Number(profile.units_per_serving);
        if (allocation.serving_type === 'dine_in') summary.plates += packageQuantity;
        else summary.boxes += packageQuantity;
        summary.charge += packageQuantity * Number(profile.customer_charge_per_unit || 0);
      }
      return summary;
    },
    { plates: 0, boxes: 0, charge: 0 },
  );
  const servingInvalid = cart.items.some((item) => {
    const allocations = item.serving_allocations || [];
    const total = allocations.reduce(
      (sum, allocation) => sum + Number(allocation.quantity || 0),
      0,
    );

    return Math.abs(total - Number(item.quantity)) > 0.000001;
  });
  // A charge the merchant left off by default is never applied until the cashier
  // adds it, so it has to be listed here or there is no way to add it.
  const addableCharges = applicableCharges.filter(
    (charge) => !charge.is_default_active && !cart.optedInChargeIds.has(charge.id),
  );

  const handleHold = async () => {
    if (!cart.tableId) {
      toast.error(t('selectTableFirst'));
      return;
    }
    if (cart.items.length === 0) {
      toast.error(t('cartEmpty'));
      return;
    }
    const tableName = tables.find((t) => t.id === cart.tableId)?.name || cart.tableId;
    try {
      await heldOrders.holdOrder(
        cart.tableId,
        cart.items,
        cart.customerId,
        cart.guestCount,
        cart.orderNotes,
        [...cart.waivedChargeIds],
        [...cart.optedInChargeIds],
      );
      cart.clearCart();
      toast.success(t('orderHeldFor', { table: tableName }));
    } catch {
      toast.error(t('holdOrderFailed'));
    }
  };

  const isDrawer = variant === 'drawer';

  return (
    <div
      data-testid="cart-shell"
      className={
        isDrawer
          ? 'flex flex-col w-full'
          : 'pos-cart-shell w-full h-full bg-card rounded-xl border border-border dark:border-border flex flex-col shadow-sm'
      }
    >
      {/* Order Type */}
      <div className="p-4 border-b border-border dark:border-border space-y-2">
        {existingOrder &&
          existingOrder.release_status &&
          existingOrder.release_status !== 'released' && (
            <div
              data-testid="cart-scheduled-existing-banner"
              className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-2.5 py-2 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <CalendarClock size={14} className="shrink-0" />
                <span className="truncate font-medium">
                  {t('scheduledAddingToBanner', {
                    number: existingOrder.order_number,
                    time: existingOrder.scheduled_for
                      ? formatScheduledInstantForDisplay(
                          existingOrder.scheduled_for,
                          effectiveTimezone,
                        )
                      : '',
                  })}
                </span>
              </span>
              {onCancelExistingOrderMode && (
                <button
                  type="button"
                  onClick={onCancelExistingOrderMode}
                  aria-label={t('close')}
                  className="rounded p-0.5 hover:bg-blue-100 dark:hover:bg-blue-900/50 shrink-0"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {selectableOrderTypes
            .filter((type) => isRestaurant || type !== 'dine_in')
            .map((type) => {
              const Icon = orderTypeIcons[type];
              const showIcon = type !== 'dine_in' && type !== 'online';
              const label =
                type === 'dine_in'
                  ? t('orderTypeDineIn')
                  : type === 'takeaway'
                    ? t('orderTypeTakeaway')
                    : type === 'delivery'
                      ? t('orderTypeDelivery')
                      : t('orderTypeOnline');
              return (
                <button
                  key={type}
                  type="button"
                  disabled={Boolean(existingOrder && existingOrder.type !== type)}
                  onClick={() => cart.setOrderType(type)}
                  className={`touch-target flex-1 gap-1 px-2 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showIcon ? '' : 'whitespace-nowrap'} ${
                    cart.orderType === type
                      ? 'bg-card text-brand shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {showIcon && <Icon size={14} />}
                  {label}
                </button>
              );
            })}
        </div>

        {cart.orderType === 'dine_in' && (
          <div className="flex flex-wrap items-stretch gap-2">
            <div className="flex flex-1 min-w-[160px] items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users size={15} />
                <span>{t('pax')}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t('decreasePax')}
                  onClick={() => cart.setGuestCount(Math.max(1, cart.guestCount - 1))}
                  className="touch-target rounded-full bg-muted"
                >
                  <Minus size={15} />
                </button>
                <input
                  aria-label={t('pax')}
                  inputMode="numeric"
                  type="number"
                  min="1"
                  max="99"
                  value={cart.guestCount}
                  onChange={(e) =>
                    cart.setGuestCount(Math.min(99, Math.max(1, Number(e.target.value) || 1)))
                  }
                  className="w-12 text-center text-base font-semibold border-0 outline-none bg-transparent"
                />
                <button
                  type="button"
                  aria-label={t('increasePax')}
                  onClick={() => cart.setGuestCount(Math.min(99, cart.guestCount + 1))}
                  className="touch-target rounded-full bg-muted"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delivery address — shown inline when delivery is selected */}
        {!existingOrder && cart.orderType === 'delivery' && (
          <div className="flex items-center gap-2">
            <MapPin size={14} className="text-muted-foreground shrink-0" />
            <input
              type="text"
              value={cart.deliveryAddress}
              onChange={(e) => cart.setDeliveryAddress(e.target.value)}
              placeholder={t('deliveryAddress')}
              className="flex-1 min-h-11 px-3 py-2 text-sm border border-border bg-card rounded-lg focus:ring-2 focus:ring-brand focus:border-brand outline-none"
            />
          </div>
        )}

        {/* Expected collection and courier note: recorded with the order, never a payment */}
        {!existingOrder && isDeliveryOrder && (
          <>
            <label className="flex items-center gap-2">
              <Wallet size={14} className="text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground">{t('expectedPayment')}</span>
              <select
                value={
                  cart.expectedPaymentMethodId !== null
                    ? `custom:${cart.expectedPaymentMethodId}`
                    : cart.expectedPaymentMethod
                }
                onChange={(e) => {
                  const selected = e.target.value;
                  // A configured method travels by identity, so a method named
                  // "Pending" or "Unknown" cannot be read back as a sentinel.
                  const customId = selected.startsWith('custom:')
                    ? Number(selected.slice('custom:'.length))
                    : null;
                  if (customId !== null) {
                    const method = customPaymentMethods.find(
                      (candidate) => candidate.id === customId,
                    );
                    if (method) {
                      cart.setExpectedPaymentMethod(method.name, method.id);
                      return;
                    }
                    if (customId === cart.expectedPaymentMethodId) return;
                  }
                  cart.setExpectedPaymentMethod(selected, null);
                }}
                className="flex-1 min-w-0 min-h-11 px-3 py-2 text-sm border border-border bg-card rounded-lg focus:ring-2 focus:ring-brand focus:border-brand outline-none"
              >
                <option value="">{tCommon('unknown')}</option>
                <option value="pending">{tOrders('pending')}</option>
                <option value="cash">{t('methodCash')}</option>
                <option value="upi">{t('methodUpi')}</option>
                {cart.expectedPaymentMethod === 'card' && (
                  <option value="card">{t('methodCard')}</option>
                )}
                {customPaymentMethods.length > 0 && (
                  <optgroup label={tSettings('paymentMethods')}>
                    {customPaymentMethods.map((method) => (
                      <option key={method.id} value={`custom:${method.id}`}>
                        {method.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {cart.expectedPaymentMethodId !== null &&
                  !customPaymentMethods.some(
                    (method) => method.id === cart.expectedPaymentMethodId,
                  ) && (
                    <option value={`custom:${cart.expectedPaymentMethodId}`}>
                      {cart.expectedPaymentMethod || tCommon('unknown')}
                    </option>
                  )}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <StickyNote size={14} className="text-muted-foreground shrink-0" />
              <input
                type="text"
                value={cart.deliveryNote}
                onChange={(e) => cart.setDeliveryNote(e.target.value.slice(0, 200))}
                placeholder={t('deliveryNotePlaceholder')}
                maxLength={200}
                className="flex-1 min-h-11 px-3 py-2 text-sm border border-border bg-card rounded-lg focus:ring-2 focus:ring-brand focus:border-brand outline-none"
              />
            </div>
          </>
        )}

        {/* Online platform + external order id — shown inline when online is selected */}
        {!existingOrder && cart.orderType === 'online' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-muted-foreground shrink-0" />
              <input
                type="text"
                value={cart.onlinePlatform}
                onChange={(e) => cart.setOnlinePlatform(e.target.value)}
                placeholder={t('onlinePlatformPlaceholder')}
                className="flex-1 min-h-11 px-3 py-2 text-sm border border-border bg-card rounded-lg focus:ring-2 focus:ring-brand focus:border-brand outline-none"
              />
            </div>
            <input
              type="text"
              value={cart.externalOrderId}
              onChange={(e) => cart.setExternalOrderId(e.target.value)}
              placeholder={t('externalOrderIdPlaceholder')}
              className="flex-1 min-h-11 px-3 py-2 text-sm border border-border bg-card rounded-lg focus:ring-2 focus:ring-brand focus:border-brand outline-none"
            />
          </div>
        )}


        {canScheduleCart && (
          <div
            data-testid="pos-schedule-section"
            className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-2"
          >
            <div className="text-xs font-medium text-foreground">
              When should we prepare this order?
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="pos-prepare-now-btn"
                aria-pressed={!cart.scheduledFor}
                onClick={() => cart.setScheduledFor('')}
                className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                  !cart.scheduledFor
                    ? 'bg-card text-brand shadow-sm border border-brand'
                    : 'border border-border text-muted-foreground'
                }`}
              >
                Prepare now
              </button>

              <button
                type="button"
                data-testid="pos-schedule-later-btn"
                aria-pressed={Boolean(cart.scheduledFor)}
                onClick={() => {
                  if (!cart.scheduledFor) {
                    cart.setScheduledFor(
                      suggestFutureScheduleWallClock(effectiveTimezone),
                    );
                  }
                }}
                className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                  cart.scheduledFor
                    ? 'bg-card text-brand shadow-sm border border-brand'
                    : 'border border-border text-muted-foreground'
                }`}
              >
                <CalendarClock size={13} className="inline me-1" />
                Schedule for later
              </button>
            </div>

            {cart.scheduledFor && (
              <div className="space-y-1.5">
                <label
                  htmlFor={`pos-send-to-kitchen-at-${variant}`}
                  className="text-xs font-medium text-foreground"
                >
                  Send to kitchen at
                </label>

                <input
                  id={`pos-send-to-kitchen-at-${variant}`}
                  data-testid="pos-send-to-kitchen-input"
                  type="datetime-local"
                  value={cart.scheduledFor}
                  onChange={(e) => cart.setScheduledFor(e.target.value)}
                  className={`w-full min-h-10 px-2.5 py-1.5 text-sm border bg-card rounded-lg outline-none focus:ring-2 focus:ring-brand focus:border-brand ${
                    scheduleErrorMessage ? 'border-red-500' : 'border-border'
                  }`}
                />

                <p className="text-[11px] text-muted-foreground leading-snug">
                  Store time ({effectiveTimezone}) — releases to kitchen at this time.
                </p>

                {scheduleErrorMessage && (
                  <p
                    role="alert"
                    data-testid="pos-schedule-error"
                    className="text-xs text-red-600 dark:text-red-400 font-medium leading-snug"
                  >
                    {scheduleErrorMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Cart Items */}
      {/* min-h-0 overrides the content-based automatic minimum size, so a long
          cart scrolls its rows instead of pushing the totals and checkout out. */}
      <div
        data-testid="cart-items-scroll"
        className={
          isDrawer
            ? 'overflow-y-auto p-4 max-h-[40vh]'
            : 'pos-cart-items flex-1 min-h-0 overflow-y-auto p-4'
        }
      >
        {/* Previously ordered items (add-items mode) */}
        {existingOrder &&
          existingOrder.items &&
          existingOrder.items.filter((i: OrderItem) => !isTerminalItemStatus(i.status)).length >
            0 && (
            <div className="mb-3 pb-3 border-b border-dashed border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t('alreadyOrdered')}
              </p>
              <div className="space-y-1.5">
                {existingOrder.items
                  .filter((i: OrderItem) => !isTerminalItemStatus(i.status))
                  .map((item: OrderItem) => (
                    <div key={item.id} className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">
                        {item.quantity}× {item.product_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmt(Number(item.total))}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

        {cart.items.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center text-muted-foreground ${existingOrder ? 'py-4' : isDrawer ? 'py-8' : 'h-full'}`}
          >
            <ShoppingCart size={existingOrder ? 24 : 40} />
            <p className="mt-2 text-sm">{existingOrder ? t('addNewItemsAbove') : t('cartEmpty')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.items.map((item) => (
              <div
                key={item.id}
                data-testid="cart-item"
                className="border-b border-border/60 pb-3 last:border-b-0 last:pb-0"
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 break-words text-sm font-medium leading-snug text-foreground">
                    {item.variant
                      ? `${item.product.name} (${item.variant.name})`
                      : item.product.name}
                  </p>
                  <button
                    onClick={() => cart.removeItem(item.id)}
                    className="touch-target -me-2 -mt-2 shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 active:bg-red-50 dark:active:bg-red-950/40"
                    aria-label={t('remove')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="min-w-0">
                  {item.addons.length > 0 && (
                    <div className="mt-0.5">
                      {item.addons.map((a) => (
                        <p key={a.id} className="break-words text-xs text-muted-foreground">
                          + {a.name}
                          {(a.quantity || 1) > 1 ? ` ×${a.quantity}` : ''}{' '}
                          {Number(a.price) > 0 && `(${fmt(Number(a.price) * (a.quantity || 1))})`}
                        </p>
                      ))}
                    </div>
                  )}
                  {item.special_instructions && (
                    <p className="text-xs text-muted-foreground italic mt-0.5 break-words">
                      {item.special_instructions}
                    </p>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {fmt(
                      cartLineUnitPrice(
                        item,
                        cart.orderType === 'online' && cart.onlinePlatform.trim().length > 0,
                      ),
                    )}
                    {item.price_override && (
                      <span className="ms-1.5 text-xs text-amber-600 dark:text-amber-400">
                        {tOrders('priceOverriddenMenu', {
                          price: fmt(
                            cartVariantUnitPrice(
                              item,
                              cart.orderType === 'online' && cart.onlinePlatform.trim().length > 0,
                            ),
                          ),
                        })}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {canOverridePrice && (
                      <button
                        onClick={() => setPriceOverrideItemId(item.id)}
                        className="touch-target shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
                        aria-label={tOrders('overridePrice')}
                        title={tOrders('overridePrice')}
                      >
                        <Tag size={14} />
                      </button>
                    )}
                    {onEditItem && (
                      <button
                        onClick={() => onEditItem(item)}
                        className="touch-target shrink-0 gap-1 rounded-full bg-amber-100 px-3 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60 dark:active:bg-amber-950/60 transition-colors hover:bg-amber-200 active:bg-amber-200"
                      >
                        <SquarePen size={12} />
                        {tCommon('edit')}
                      </button>
                    )}
                    <ItemQuantityControl item={item} updateQuantity={cart.updateQuantity} />
                  </div>
                </div>
                <ServingSelector
                  item={item}
                  profiles={packagingProfiles}
                  orderType={cart.orderType}
                  onChange={(allocations) => cart.setServingAllocations(item.id, allocations)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cart Footer */}
      <div data-testid="cart-footer" className="p-4 border-t border-border dark:border-border">
        <div className="flex justify-between mb-1 text-sm">
          <span className="text-muted-foreground">{t('items')}</span>
          <span className="font-medium">{cart.itemCount()}</span>
        </div>
        <div className="flex justify-between mb-4 text-lg">
          <span className="font-semibold text-foreground">{t('subtotal')}</span>
          <span className="font-bold text-brand">{fmt(cart.subtotal())}</span>
        </div>
        <div className="mb-4 rounded-md bg-muted/40 px-2 py-1.5 text-xs space-y-0.5" data-testid="packaging-summary">
          <div className="flex justify-between"><span className="text-muted-foreground">Paper plates</span><span>{packagingSummary.plates}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Parcel boxes</span><span>{packagingSummary.boxes}</span></div>
          <div className="flex justify-between font-medium"><span>Packaging</span><span>{fmt(packagingSummary.charge)}</span></div>
        </div>
        {servingInvalid && (
          <p className="mb-3 text-xs font-medium text-red-600" role="alert">
            Each item&apos;s Dine-in and Parcel quantities must equal its item quantity.
          </p>
        )}        
        {(appliedCharges.length > 0 || addableCharges.length > 0) && (
          <div className="mb-4 space-y-1" data-testid="cart-charges">
            {appliedCharges.map((charge) => {
              const definition = applicableCharges.find((c) => c.id === charge.id);
              const isOptional = definition?.is_optional ?? false;
              return (
                <div key={charge.id} className="flex items-center justify-between gap-2 text-sm">
                  <span
                    className={
                      charge.waived ? 'text-muted-foreground line-through' : 'text-muted-foreground'
                    }
                  >
                    {charge.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={
                        charge.waived ? 'text-muted-foreground line-through' : 'font-medium'
                      }
                    >
                      {fmt(charge.amount)}
                    </span>
                    {isOptional && (
                      <button
                        type="button"
                        onClick={() => cart.toggleWaiveCharge(charge.id)}
                        aria-pressed={charge.waived}
                        className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        {charge.waived ? t('applyCharge') : t('waiveCharge')}
                      </button>
                    )}
                    {!definition?.is_default_active && (
                      <button
                        type="button"
                        onClick={() => cart.toggleOptedInCharge(charge.id)}
                        aria-pressed={!cart.optedInChargeIds.has(charge.id)}
                        className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        {cart.optedInChargeIds.has(charge.id) ? t('removeCharge') : t('addCharge')}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            {addableCharges.map((charge) => (
              <div key={charge.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{charge.name}</span>
                <button
                  type="button"
                  onClick={() => cart.toggleOptedInCharge(charge.id)}
                  className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  {t('addCharge')}
                </button>
              </div>
            ))}
            {appliedCharges.length > 0 && (
              <div className="flex justify-between text-sm font-medium">
                <span>{t('chargesTotal')}</span>
                <span>{fmt(chargeTotal)}</span>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2">
          {canHold && (
            <Button variant="outline" onClick={handleHold} className="flex-1">
              <Pause size={14} className="me-1" /> {t('holdButton')}
              <span
                aria-hidden="true"
                className="hidden sm:inline-flex ms-1 px-1 py-0.2 rounded border border-border text-[10px] font-mono text-muted-foreground"
              >
                F8
              </span>
            </Button>
          )}
          {existingOrder ? (
            <Button
              onClick={onPlaceOrder}
              disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage) || servingInvalid}
              className="flex-1"
              size="lg"
              data-testid="pos-append-existing-order-btn"
            >
              {submitting ? t('placing') : t('placeOrderButton')}
              {!submitting && (
                <span
                  aria-hidden="true"
                  className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                >
                  Space
                </span>
              )}
            </Button>
          ) : multiCounterEnabled && counterRole === 'payment' ? (
            cart.items.length === 0 ? (
              <Button
                type="button"
                onClick={onOpenPaymentQueue}
                className="flex-1"
                size="lg"
                data-testid="pos-open-payment-queue-btn"
              >
                <CreditCard className="me-2 h-4 w-4" />
                {t('paymentQueue')}
              </Button>
            ) : (
              <>
                {onOpenPaymentQueue && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onOpenPaymentQueue}
                    className="flex-1"
                    size="lg"
                    data-testid="pos-open-payment-queue-btn"
                  >
                    <CreditCard className="me-2 h-4 w-4" />
                    {t('paymentQueue')}
                  </Button>
                )}
                <Button
                  onClick={onPlaceOrder}
                  disabled={submitting || Boolean(scheduleErrorMessage) || servingInvalid}
                  className="flex-1"
                  size="lg"
                >
                  {submitting ? t('placing') : t('placeOrderButton')}
                  {!submitting && (
                    <span
                      aria-hidden="true"
                      className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                    >
                      Space
                    </span>
                  )}
                </Button>
              </>
            )
          ) : multiCounterEnabled &&
            onSendToPayment &&
            counterRole === 'ordering' &&
            (cart.orderType === 'takeaway' || cart.orderType === 'dine_in') ? (
            <Button
              onClick={onSendToPayment}
              disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage) || servingInvalid}
              className="flex-1"
              size="lg"
              data-testid="pos-send-to-payment-btn"
            >
              {submitting ? t('placing') : t('sendToPayment')}
              {!submitting && (
                <span
                  aria-hidden="true"
                  className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                >
                  Space
                </span>
              )}
            </Button>
          ) : multiCounterEnabled &&
            onSendToPayment &&
            counterRole === 'combined' &&
            (cart.orderType === 'takeaway' || cart.orderType === 'dine_in') ? (
            <>
              <Button
                variant="outline"
                onClick={onSendToPayment}
                disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage) || servingInvalid}
                className="flex-1"
                size="lg"
                data-testid="pos-send-to-payment-btn"
              >
                {t('sendToPayment')}
              </Button>
              <Button
                onClick={onPlaceOrder}
                disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage) || servingInvalid}
                className="flex-1"
                size="lg"
              >
                {submitting ? t('placing') : t('placeOrderButton')}
                {!submitting && (
                  <span
                    aria-hidden="true"
                    className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                  >
                    Space
                  </span>
                )}
              </Button>
            </>
          ) : (
            <Button
              onClick={onPlaceOrder}
              disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage) || servingInvalid}
              className="flex-1"
              size="lg"
            >
              {submitting ? t('placing') : t('placeOrderButton')}
              {!submitting && (
                <span
                  aria-hidden="true"
                  className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                >
                  Space
                </span>
              )}
            </Button>
          )}
        </div>
      </div>
      {priceOverrideTarget && (
        <CartPriceOverrideModal
          item={priceOverrideTarget}
          onlinePlatformSelected={
            cart.orderType === 'online' && cart.onlinePlatform.trim().length > 0
          }
          onApply={(override) => cart.setItemPriceOverride(priceOverrideTarget.id, override)}
          onClose={() => setPriceOverrideItemId(null)}
        />
      )}
    </div>
  );
}
