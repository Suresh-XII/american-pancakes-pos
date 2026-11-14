'use client';

import { useState, useEffect } from 'react';
import { Tag, Plus, Pencil, Calendar, CheckCircle2, XCircle, Gift } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

export interface PromotionItem {
  id: string;
  name: string;
  description: string | null;
  discount_type: 'bogo' | 'percentage' | 'fixed_amount';
  target_type: 'all_pancakes' | 'category' | 'products' | 'all';
  target_category_id: string | null;
  discount_value: number;
  bogo_buy_qty: number;
  bogo_get_qty: number;
  bogo_pricing_rule: string;
  is_loyalty_reward: boolean;
  loyalty_qualifying_visits_required: number;
  start_at: string | null;
  end_at: string | null;
  is_active: boolean;
  is_automatic: boolean;
  max_redemptions: number | null;
  current_redemptions_count: number;
  created_at: string;
}

export interface PromotionReportSummary {
  totalRedemptionsCount: number;
  totalDiscountAmount: number;
  bogoRedemptionsCount: number;
  bogoDiscountAmount: number;
  launchBogoRedemptionsCount: number;
  launchBogoDiscountAmount: number;
  loyaltyRewardRedemptionsCount: number;
  loyaltyRewardDiscountAmount: number;
  redemptionsByCashier: Array<{
    cashierUserId: string | null;
    cashierName: string;
    redemptionCount: number;
    totalDiscount: number;
  }>;
  redemptionsByDate: Array<{
    date: string;
    redemptionCount: number;
    totalDiscount: number;
  }>;
}

interface PromotionFormState {
  id: string;
  name: string;
  description: string;
  discount_type: 'bogo' | 'percentage' | 'fixed_amount';
  target_type: 'all_pancakes' | 'category' | 'products' | 'all';
  discount_value: string;
  start_at: string;
  end_at: string;
  is_active: boolean;
  max_redemptions: string;
}

const DEFAULT_FORM: PromotionFormState = {
  id: '',
  name: '',
  description: '',
  discount_type: 'bogo',
  target_type: 'all_pancakes',
  discount_value: '0',
  start_at: '',
  end_at: '',
  is_active: true,
  max_redemptions: '',
};

export function PromotionsManagerCard({ isAdmin = true }: { isAdmin?: boolean }) {
  const [promotions, setPromotions] = useState<PromotionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<PromotionReportSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<PromotionItem | null>(null);
  const [form, setForm] = useState<PromotionFormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const currencyFmt = useFormatCurrency();

  const refreshPromotions = async () => {
    try {
      const [promosRes, reportRes] = await Promise.all([
        api.get('/promotions?active_only=false'),
        api.get('/promotions/reports/summary'),
      ]);
      setPromotions(promosRes.data.promotions || []);
      setReport(reportRes.data || null);
    } catch {
      toast.error('Failed to load promotions');
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const [promosRes, reportRes] = await Promise.all([
          api.get('/promotions?active_only=false'),
          api.get('/promotions/reports/summary'),
        ]);
        if (!cancelled) {
          setPromotions(promosRes.data.promotions || []);
          setReport(reportRes.data || null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          toast.error('Failed to load promotions');
          setLoading(false);
        }
      }
    }
    void fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenCreate = () => {
    setEditingPromotion(null);
    setForm({
      ...DEFAULT_FORM,
      start_at: new Date().toISOString().slice(0, 16),
      end_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (promo: PromotionItem) => {
    setEditingPromotion(promo);
    setForm({
      id: promo.id,
      name: promo.name,
      description: promo.description || '',
      discount_type: promo.discount_type,
      target_type: promo.target_type,
      discount_value: String(promo.discount_value || 0),
      start_at: promo.start_at ? new Date(promo.start_at).toISOString().slice(0, 16) : '',
      end_at: promo.end_at ? new Date(promo.end_at).toISOString().slice(0, 16) : '',
      is_active: promo.is_active,
      max_redemptions: promo.max_redemptions !== null ? String(promo.max_redemptions) : '',
    });
    setDialogOpen(true);
  };

  const handleToggleActive = async (promo: PromotionItem) => {
    try {
      const nextActive = !promo.is_active;
      await api.put(`/promotions/${promo.id}`, { is_active: nextActive });
      setPromotions((prev) =>
        prev.map((p) => (p.id === promo.id ? { ...p, is_active: nextActive } : p)),
      );
      toast.success(`${promo.name} ${nextActive ? 'activated' : 'deactivated'}`);
    } catch {
      toast.error('Failed to update promotion status');
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Promotion name is required');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        discount_type: form.discount_type,
        target_type: form.target_type,
        discount_value: parseFloat(form.discount_value) || 0,
        start_at: form.start_at ? new Date(form.start_at).toISOString() : undefined,
        end_at: form.end_at ? new Date(form.end_at).toISOString() : undefined,
        is_active: form.is_active,
        max_redemptions: form.max_redemptions ? parseInt(form.max_redemptions, 10) : null,
      };

      if (editingPromotion) {
        await api.put(`/promotions/${editingPromotion.id}`, payload);
        toast.success('Promotion updated successfully');
      } else {
        await api.post('/promotions', payload);
        toast.success('Promotion created successfully');
      }

      setDialogOpen(false);
      void refreshPromotions();
    } catch {
      toast.error('Failed to save promotion');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview & Redemptions Summary */}
      {report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">Total Redemptions</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {report.totalRedemptionsCount}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Saved {currencyFmt(report.totalDiscountAmount)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">Launch BOGO</p>
            <p className="mt-1 text-2xl font-bold text-brand">
              {report.launchBogoRedemptionsCount}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {currencyFmt(report.launchBogoDiscountAmount)} in free items
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">Loyalty 6th Visit</p>
            <p className="mt-1 text-2xl font-bold text-purple-600 dark:text-purple-400">
              {report.loyaltyRewardRedemptionsCount}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {currencyFmt(report.loyaltyRewardDiscountAmount)} rewards given
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">Total BOGO Pairs</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {report.bogoRedemptionsCount}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {currencyFmt(report.bogoDiscountAmount)}
            </p>
          </div>
        </div>
      )}

      {/* Promotions List Card */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Tag size={20} className="text-brand" />
              <h2 className="text-lg font-semibold text-foreground">Promotions & Offers</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configure BOGO rules, Launch promotions, and Loyalty 6th-visit rewards.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={handleOpenCreate} size="sm" className="gap-1.5 shrink-0">
              <Plus size={16} />
              Create Promotion
            </Button>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading promotions...
          </div>
        ) : promotions.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No promotions configured yet.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {promotions.map((promo) => (
              <div
                key={promo.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/30 transition-colors"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground text-sm">{promo.name}</span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        promo.discount_type === 'bogo'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          : promo.discount_type === 'percentage'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300'
                      }`}
                    >
                      {promo.discount_type === 'bogo'
                        ? 'BOGO'
                        : promo.discount_type === 'percentage'
                          ? `${promo.discount_value}% OFF`
                          : `${currencyFmt(promo.discount_value)} FLAT`}
                    </span>
                    {promo.is_loyalty_reward && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 flex items-center gap-1">
                        <Gift size={11} />
                        Loyalty 6th Visit
                      </span>
                    )}
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        promo.is_active
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {promo.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground">{promo.description}</p>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span>
                      Target:{' '}
                      <strong className="text-foreground">
                        {promo.target_type === 'all_pancakes'
                          ? 'All Pancakes'
                          : promo.target_type === 'category'
                            ? 'Category'
                            : 'Selected Products'}
                      </strong>
                    </span>
                    {promo.end_at && (
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        Ends: {new Date(promo.end_at).toLocaleDateString()}
                      </span>
                    )}
                    <span>
                      Redemptions: <strong className="text-foreground">{promo.current_redemptions_count}</strong>
                      {promo.max_redemptions ? ` / ${promo.max_redemptions}` : ''}
                    </span>
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleActive(promo)}
                      className="text-xs h-8"
                    >
                      {promo.is_active ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={13} /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <XCircle size={13} /> Inactive
                        </span>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(promo)}
                      className="h-8 w-8 p-0"
                    >
                      <Pencil size={14} />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit / Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingPromotion ? `Edit: ${editingPromotion.name}` : 'Create New Promotion'}
            </DialogTitle>
            <DialogDescription>
              Set up eligibility rules, discount type, and active period.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label htmlFor="promoName" className="text-xs font-semibold text-foreground">Promotion Name *</label>
              <input
                id="promoName"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Launch BOGO - Pancakes"
                className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-lg outline-none focus:ring-1 focus:ring-brand bg-card"
              />
            </div>

            <div>
              <label htmlFor="promoDesc" className="text-xs font-semibold text-foreground">Description</label>
              <input
                id="promoDesc"
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Buy 1 pancake get 1 free"
                className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-lg outline-none focus:ring-1 focus:ring-brand bg-card"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="promoType" className="text-xs font-semibold text-foreground">Discount Type</label>
                <select
                  id="promoType"
                  value={form.discount_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      discount_type: e.target.value as 'bogo' | 'percentage' | 'fixed_amount',
                    })
                  }
                  className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-lg outline-none focus:ring-1 focus:ring-brand bg-card"
                >
                  <option value="bogo">BOGO (Buy 1 Get 1)</option>
                  <option value="percentage">Percentage</option>
                  <option value="fixed_amount">Fixed Amount</option>
                </select>
              </div>

              <div>
                <label htmlFor="promoTarget" className="text-xs font-semibold text-foreground">Eligible Products</label>
                <select
                  id="promoTarget"
                  value={form.target_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      target_type: e.target.value as 'all_pancakes' | 'category' | 'products' | 'all',
                    })
                  }
                  className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-lg outline-none focus:ring-1 focus:ring-brand bg-card"
                >
                  <option value="all_pancakes">All Pancakes</option>
                  <option value="all">All Products</option>
                  <option value="category">Category</option>
                </select>
              </div>
            </div>

            {form.discount_type !== 'bogo' && (
              <div>
                <label htmlFor="promoVal" className="text-xs font-semibold text-foreground">
                  {form.discount_type === 'percentage' ? 'Percentage (0 - 100%)' : 'Amount'}
                </label>
                <input
                  id="promoVal"
                  type="number"
                  min="0"
                  max={form.discount_type === 'percentage' ? 100 : undefined}
                  value={form.discount_value}
                  onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-lg outline-none focus:ring-1 focus:ring-brand bg-card"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="promoStart" className="text-xs font-semibold text-foreground">Start Date & Time</label>
                <input
                  id="promoStart"
                  type="datetime-local"
                  value={form.start_at}
                  onChange={(e) => setForm({ ...form, start_at: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-lg outline-none focus:ring-1 focus:ring-brand bg-card"
                />
              </div>

              <div>
                <label htmlFor="promoEnd" className="text-xs font-semibold text-foreground">End Date & Time</label>
                <input
                  id="promoEnd"
                  type="datetime-local"
                  value={form.end_at}
                  onChange={(e) => setForm({ ...form, end_at: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-lg outline-none focus:ring-1 focus:ring-brand bg-card"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="is_active_check"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
              />
              <label htmlFor="is_active_check" className="text-sm font-medium text-foreground">
                Active and available for checkout
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Promotion'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
