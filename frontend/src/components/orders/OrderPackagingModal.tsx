'use client';

import { useEffect, useState } from 'react';
import { X, Package, Plus, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

interface Props {
  orderId: number;
  onClose: () => void;
  onSaved?: () => void;
}

interface PackagingAllocation {
  id: number;
  order_item_id: number;
  item_name?: string;
  serving_allocation_id?: number | null;
  packaging_profile_id?: string | null;
  profile_name?: string | null;
  supply_id_snapshot: string;
  material_name: string;
  sku?: string | null;
  category?: string | null;
  quantity: number;
  unit_snapshot: string;
  customer_charge: number;
  notes?: string | null;
}

interface PackagingSummaryItem {
  supply_id: string;
  material_name: string;
  unit: string;
  total_quantity: number;
  total_charge: number;
}

interface OrderPackagingData {
  order_id: number;
  order_status: string;
  payment_status: string;
  can_adjust: boolean;
  allocations: PackagingAllocation[];
  summary: PackagingSummaryItem[];
  total_packaging_charge: number;
}

interface MaterialOption {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
}

export function OrderPackagingModal({ orderId, onClose, onSaved }: Props) {
  const fmt = useFormatCurrency();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OrderPackagingData | null>(null);
  const [availableMaterials, setAvailableMaterials] = useState<MaterialOption[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Adjustment form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedSupplyId, setSelectedSupplyId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [customerCharge, setCustomerCharge] = useState('0');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);
      try {
        const [pkgRes, matRes] = await Promise.all([
          api.get(`/orders/${orderId}/packaging`),
          api.get('/packaging/materials?active_only=true'),
        ]);

        if (!active) return;
        setData(pkgRes.data);
        const mats = (matRes.data.materials || []).map((m: { id: string; name: string; unit: string; current_stock: number }) => ({
          id: m.id,
          name: m.name,
          unit: m.unit,
          current_stock: m.current_stock,
        }));
        setAvailableMaterials(mats);
        if (mats.length > 0 && !selectedSupplyId) {
          setSelectedSupplyId(mats[0].id);
        }
      } catch (err: unknown) {
        if (!active) return;
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error(msg || 'Failed to load packaging details');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [orderId, refreshKey, selectedSupplyId]);

  const handleAddAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplyId) {
      toast.error('Please select a packaging material');
      return;
    }
    const numQty = parseFloat(quantity);
    if (isNaN(numQty) || numQty <= 0) {
      toast.error('Quantity must be greater than zero');
      return;
    }
    const numCharge = parseFloat(customerCharge);
    if (isNaN(numCharge) || numCharge < 0) {
      toast.error('Customer charge cannot be negative');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/orders/${orderId}/packaging/adjust`, {
        adjustments: [
          {
            supply_id: selectedSupplyId,
            quantity: numQty,
            customer_charge: numCharge,
            notes: notes.trim() || undefined,
          },
        ],
        reason: reason.trim() || undefined,
      });

      toast.success('Packaging adjusted successfully');
      setShowAddForm(false);
      setQuantity('1');
      setCustomerCharge('0');
      setNotes('');
      setReason('');
      setRefreshKey((k) => k + 1);
      onSaved?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Failed to adjust packaging');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2">
            <Package size={20} className="text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Order Packaging Allocation</h2>
            <Badge variant="outline" className="text-xs">Order #{orderId}</Badge>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Loader2 size={28} className="animate-spin text-primary" />
              <p className="text-sm">Loading packaging allocations...</p>
            </div>
          ) : !data ? (
            <div className="py-8 text-center text-muted-foreground">
              <AlertCircle size={32} className="mx-auto mb-2 text-destructive" />
              <p>Could not retrieve packaging data for this order.</p>
            </div>
          ) : (
            <>
              {/* Summary KPIs */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg border border-border bg-card">
                  <div className="text-xs text-muted-foreground">Total Materials</div>
                  <div className="text-xl font-bold text-foreground mt-0.5">
                    {data.summary.reduce((acc, s) => acc + s.total_quantity, 0)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {data.summary.length} unique items
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-border bg-card">
                  <div className="text-xs text-muted-foreground">Packaging Charge</div>
                  <div className="text-xl font-bold text-foreground mt-0.5">
                    {fmt(data.total_packaging_charge)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Customer charge</div>
                </div>
                <div className="p-3 rounded-lg border border-border bg-card">
                  <div className="text-xs text-muted-foreground">Settlement Status</div>
                  <div className="mt-1">
                    {data.can_adjust ? (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-300">
                        Adjustable
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-muted text-muted-foreground">
                        Locked / Settled
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Material Requirements Summary */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Materials Required for this Order
                </h3>
                {data.summary.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-border text-center text-xs text-muted-foreground">
                    No packaging materials allocated for this order.
                  </div>
                ) : (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 border-b border-border text-muted-foreground">
                        <tr>
                          <th className="py-2 px-3 text-left">Material</th>
                          <th className="py-2 px-3 text-right">Required Qty</th>
                          <th className="py-2 px-3 text-left">Unit</th>
                          <th className="py-2 px-3 text-right">Charge</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data.summary.map((item) => (
                          <tr key={item.supply_id} className="hover:bg-muted/20">
                            <td className="py-2 px-3 font-medium text-foreground">{item.material_name}</td>
                            <td className="py-2 px-3 text-right font-mono font-semibold">{item.total_quantity}</td>
                            <td className="py-2 px-3 text-muted-foreground">{item.unit}</td>
                            <td className="py-2 px-3 text-right font-medium">
                              {item.total_charge > 0 ? fmt(item.total_charge) : 'Free'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Detailed Allocations Breakdown */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Allocation Breakdown by Item
                </h3>
                <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b border-border text-muted-foreground sticky top-0">
                      <tr>
                        <th className="py-2 px-3 text-left">Item / Source</th>
                        <th className="py-2 px-3 text-left">Material</th>
                        <th className="py-2 px-3 text-right">Qty</th>
                        <th className="py-2 px-3 text-right">Charge</th>
                        <th className="py-2 px-3 text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.allocations.map((alloc) => (
                        <tr key={alloc.id} className="hover:bg-muted/20">
                          <td className="py-2 px-3 font-medium text-foreground">
                            {alloc.item_name || 'Manual Adjustment'}
                            {alloc.profile_name && (
                              <span className="block text-[10px] text-muted-foreground">
                                Profile: {alloc.profile_name}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3">{alloc.material_name}</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {alloc.quantity} {alloc.unit_snapshot}
                          </td>
                          <td className="py-2 px-3 text-right font-medium">
                            {alloc.customer_charge > 0 ? fmt(alloc.customer_charge) : '-'}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground truncate max-w-[120px]">
                            {alloc.notes || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Manual Adjustment Form (if order not settled) */}
              {data.can_adjust && (
                <div className="pt-2 border-t border-border">
                  {!showAddForm ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAddForm(true)}
                      className="w-full border-dashed flex items-center justify-center gap-1.5"
                    >
                      <Plus size={14} /> Add Manual Packaging Material
                    </Button>
                  ) : (
                    <form onSubmit={handleAddAdjustment} className="p-3 border border-border rounded-lg bg-muted/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
                          Add Packaging Material Adjustment
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowAddForm(false)}
                          className="h-6 w-6 p-0 text-muted-foreground"
                        >
                          <X size={14} />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <label className="block text-muted-foreground mb-1">Material</label>
                          <select
                            value={selectedSupplyId}
                            onChange={(e) => setSelectedSupplyId(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            {availableMaterials.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.unit}) - Stock: {m.current_stock}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-muted-foreground mb-1">Quantity</label>
                          <input
                            type="number"
                            step="any"
                            min="0.001"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            required
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                        <div>
                          <label className="block text-muted-foreground mb-1">Charge to Customer (₹)</label>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={customerCharge}
                            onChange={(e) => setCustomerCharge(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                        <div>
                          <label className="block text-muted-foreground mb-1">Reason for Adjustment</label>
                          <input
                            type="text"
                            placeholder="e.g. Extra bag requested by customer"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowAddForm(false)}
                          disabled={saving}
                          className="h-8 text-xs"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={saving}
                          className="h-8 text-xs flex items-center gap-1.5"
                        >
                          {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                          Save Adjustment
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end p-3 border-t border-border bg-muted/40">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
