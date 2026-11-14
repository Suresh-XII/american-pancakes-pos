'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';

type Unit = 'each' | 'g' | 'kg' | 'ml' | 'l';
type Supply = {
  id: string;
  name: string;
  base_unit: Unit;
  stock_quantity: number;
  low_stock_threshold: number | null;
};
type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: number;
  purchase_count?: number;
};
type Purchase = {
  id: string;
  supplier_name?: string | null;
  invoice_number: string | null;
  purchase_date: string;
  status: 'draft' | 'review' | 'received';
  grand_total: number;
};
type CountItem = {
  supply_id: string;
  supply_name_snapshot: string;
  base_unit_snapshot: Unit;
  expected_quantity: number;
  observed_stock_quantity: number | null;
  observed_at: string | null;
  actual_quantity: number | null;
  variance_quantity: number | null;
  variance_cost: number | null;
  reason: string | null;
};
type Count = { id: string; status: 'draft' | 'review' | 'posted'; items?: CountItem[] };
type Dashboard = {
  low_stock: Supply[];
  out_of_stock: Supply[];
  recent_purchases: Purchase[];
  recent_wastage: Array<{
    id: string;
    supply_name: string;
    quantity: number;
    unit: Unit;
    reason: string;
  }>;
  latest_count: { id: string; posted_at: string; variance_cost: number } | null;
};
const INITIAL_DATE = new Date().toISOString().slice(0, 10);

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    return String(
      (error as { response?: { data?: { error?: string } } }).response?.data?.error ||
        'Could not save changes',
    );
  }
  return 'Could not save changes';
}

export function StockManagementPanel({
  supplies,
  onChanged,
}: {
  supplies: Supply[];
  onChanged: () => void;
}) {
  const [view, setView] = useState<'dashboard' | 'suppliers' | 'purchases' | 'counts' | 'wastage'>(
    'dashboard',
  );
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Count[]>([]);
  const [activeCount, setActiveCount] = useState<Count | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
  });
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [purchaseForm, setPurchaseForm] = useState({
    supplierId: '',
    purchaseDate: INITIAL_DATE,
    invoiceNumber: '',
    additionalExpenses: '',
    paymentStatus: 'unpaid',
    notes: '',
    items: [
      {
        supplyId: supplies[0]?.id || '',
        quantity: '1',
        purchaseUnit: 'each',
        packSizeInBase: '',
        unitPrice: '',
      },
    ],
  });
  const [wasteForm, setWasteForm] = useState({
    supplyId: supplies[0]?.id || '',
    quantity: '',
    unit: (supplies[0]?.base_unit || 'each') as Unit,
    wastageDate: INITIAL_DATE,
    reason: '',
    notes: '',
  });

  const refresh = async () => {
    try {
      const [dash, supplierResult, purchaseResult, countResult] = await Promise.all([
        api.get('/stock-management/dashboard'),
        api.get('/stock-management/suppliers?include_inactive=true'),
        api.get('/stock-management/purchases'),
        api.get('/stock-management/stock-counts'),
      ]);
      setDashboard(dash.data);
      setSuppliers(supplierResult.data.suppliers || []);
      setPurchases(purchaseResult.data.purchases || []);
      setCounts(countResult.data.counts || []);
    } catch {
      toast.error('Could not load stock operations');
    }
  };
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/stock-management/dashboard'),
      api.get('/stock-management/suppliers?include_inactive=true'),
      api.get('/stock-management/purchases'),
      api.get('/stock-management/stock-counts'),
    ])
      .then(([dash, supplierResult, purchaseResult, countResult]) => {
        if (cancelled) return;
        setDashboard(dash.data);
        setSuppliers(supplierResult.data.suppliers || []);
        setPurchases(purchaseResult.data.purchases || []);
        setCounts(countResult.data.counts || []);
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load stock operations');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveSupplier = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (editingSupplier)
        await api.put(`/stock-management/suppliers/${editingSupplier.id}`, supplierForm);
      else await api.post('/stock-management/suppliers', supplierForm);
      setSupplierForm({ name: '', contact_name: '', phone: '', email: '', address: '', notes: '' });
      setEditingSupplier(null);
      await refresh();
      toast.success('Supplier saved');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const resetPurchaseForm = () => {
    setEditingPurchaseId(null);
    setPurchaseForm({
      supplierId: '',
      purchaseDate: INITIAL_DATE,
      invoiceNumber: '',
      additionalExpenses: '',
      paymentStatus: 'unpaid',
      notes: '',
      items: [
        {
          supplyId: supplies[0]?.id || '',
          quantity: '1',
          purchaseUnit: 'each',
          packSizeInBase: '',
          unitPrice: '',
        },
      ],
    });
  };

  const createPurchase = async (event: React.FormEvent) => {
    event.preventDefault();

    const payload = {
      supplierId: purchaseForm.supplierId || null,
      purchaseDate: purchaseForm.purchaseDate,
      invoiceNumber: purchaseForm.invoiceNumber || null,
      additionalExpenses: Number(purchaseForm.additionalExpenses || 0),
      paymentStatus: purchaseForm.paymentStatus,
      notes: purchaseForm.notes || null,
      items: purchaseForm.items.map((item) => ({
        supplyId: item.supplyId,
        quantity: Number(item.quantity),
        purchaseUnit: item.purchaseUnit,
        packSizeInBase:
          item.purchaseUnit === 'pack'
            ? Number(item.packSizeInBase)
            : undefined,
        unitPrice: Number(item.unitPrice),
      })),
    };

    try {
      if (editingPurchaseId) {
        await api.put(
          `/stock-management/purchases/${editingPurchaseId}`,
          payload,
        );
        toast.success('Purchase draft updated');
      } else {
        await api.post('/stock-management/purchases', payload);
        toast.success('Purchase saved as draft');
      }

      resetPurchaseForm();
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const editPurchase = async (purchase: Purchase) => {
    if (purchase.status !== 'draft') {
      toast.error('Only draft purchases can be edited');
      return;
    }

    try {
      const result = await api.get(
        `/stock-management/purchases/${purchase.id}`,
      );

      const data = result.data.purchase;

      if (!data || data.status !== 'draft') {
        toast.error('This purchase is no longer editable');
        await refresh();
        return;
      }

      setPurchaseForm({
        supplierId: data.supplier_id || '',
        purchaseDate: data.purchase_date,
        invoiceNumber: data.invoice_number || '',
        additionalExpenses: String(data.additional_expenses ?? ''),
        paymentStatus: data.payment_status || 'unpaid',
        notes: data.notes || '',
        items: (data.items || []).map((item: {
          supply_id: string;
          quantity: number;
          purchase_unit: string;
          pack_size_in_base: number | null;
          unit_price: number;
        }) => ({
          supplyId: item.supply_id,
          quantity: String(item.quantity),
          purchaseUnit: item.purchase_unit,
          packSizeInBase:
            item.pack_size_in_base == null
              ? ''
              : String(item.pack_size_in_base),
          unitPrice: String(item.unit_price),
        })),
      });

      setEditingPurchaseId(purchase.id);
      setView('purchases');

      toast.success('Draft loaded for editing');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const transitionPurchase = async (purchase: Purchase, action: 'review' | 'receive') => {
    try {
      await api.post(`/stock-management/purchases/${purchase.id}/${action}`);
      await refresh();
      if (action === 'receive') onChanged();
      toast.success(
        action === 'receive' ? 'Purchase received and stock updated' : 'Purchase ready to receive',
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const startCount = async () => {
    try {
      const result = await api.post('/stock-management/stock-counts', { notes: 'Physical count' });
      setActiveCount(result.data.count);
      await refresh();
      toast.success('Count started from current expected stock');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const loadCount = async (id: string) => {
    try {
      const result = await api.get(`/stock-management/stock-counts/${id}`);
      setActiveCount(result.data.count);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const saveCount = async () => {
    if (!activeCount?.items) return;
    try {
      const result = await api.put(`/stock-management/stock-counts/${activeCount.id}`, {
        items: activeCount.items.map((item) => ({
          supplyId: item.supply_id,
          actualQuantity: Number(item.actual_quantity),
          reason: item.reason || null,
        })),
      });
      setActiveCount(result.data.count);
      await refresh();
      toast.success('Count saved');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const transitionCount = async (action: 'review' | 'post') => {
    if (!activeCount) return;
    try {
      const result = await api.post(`/stock-management/stock-counts/${activeCount.id}/${action}`);
      setActiveCount(result.data.count);
      await refresh();
      if (action === 'post') onChanged();
      toast.success(
        action === 'post' ? 'Count posted as audited stock adjustments' : 'Count is ready to post',
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const saveWastage = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/stock-management/wastage', {
        ...wasteForm,
        quantity: Number(wasteForm.quantity),
      });
      await refresh();
      onChanged();
      setWasteForm({ ...wasteForm, quantity: '', reason: '', notes: '' });
      toast.success('Wastage recorded');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {(['dashboard', 'suppliers', 'purchases', 'counts', 'wastage'] as const).map((entry) => (
          <Button
            key={entry}
            size="sm"
            variant={view === entry ? 'default' : 'outline'}
            onClick={() => setView(entry)}
          >
            {entry === 'dashboard' ? 'Stock dashboard' : entry[0].toUpperCase() + entry.slice(1)}
          </Button>
        ))}
      </div>

      {view === 'dashboard' && (
        <div className="grid gap-4 md:grid-cols-3">
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-semibold">Low stock</h3>
            <p className="mt-1 text-2xl font-bold">{dashboard?.low_stock.length ?? 0}</p>
            <ul className="mt-2 text-sm text-muted-foreground">
              {dashboard?.low_stock.slice(0, 5).map((s) => (
                <li key={s.id}>
                  {s.name}: {s.stock_quantity} {s.base_unit}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-semibold">Out of stock</h3>
            <p className="mt-1 text-2xl font-bold">{dashboard?.out_of_stock.length ?? 0}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Thresholds are set per supply in the Supplies tab.
            </p>
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-semibold">Latest physical count</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {dashboard?.latest_count
                ? `${dashboard.latest_count.posted_at} · variance ${dashboard.latest_count.variance_cost}`
                : 'No posted count yet'}
            </p>
          </section>
          <section className="rounded-xl border border-border bg-card p-4 md:col-span-2">
            <h3 className="font-semibold">Recent purchases</h3>
            <ul className="mt-2 text-sm text-muted-foreground">
              {dashboard?.recent_purchases.slice(0, 5).map((p) => (
                <li key={p.id}>
                  {p.purchase_date} · {p.supplier_name || 'No supplier'} · {p.status} ·{' '}
                  {p.grand_total}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-semibold">Recent wastage</h3>
            <ul className="mt-2 text-sm text-muted-foreground">
              {dashboard?.recent_wastage.slice(0, 4).map((w) => (
                <li key={w.id}>
                  {w.supply_name}: {w.quantity} {w.unit}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {view === 'suppliers' && (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          <form
            onSubmit={saveSupplier}
            className="space-y-2 rounded-xl border border-border bg-card p-4"
          >
            <h3 className="font-semibold">{editingSupplier ? 'Edit supplier' : 'Add supplier'}</h3>
            {(['name', 'contact_name', 'phone', 'email', 'address', 'notes'] as const).map(
              (field) => (
                <input
                  key={field}
                  required={field === 'name'}
                  value={supplierForm[field]}
                  onChange={(e) => setSupplierForm({ ...supplierForm, [field]: e.target.value })}
                  placeholder={field.replace('_', ' ')}
                  className="w-full rounded border border-border bg-background px-3 py-2"
                />
              ),
            )}
            <div className="flex gap-2">
              <Button type="submit">Save supplier</Button>
              {editingSupplier && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingSupplier(null);
                    setSupplierForm({
                      name: '',
                      contact_name: '',
                      phone: '',
                      email: '',
                      address: '',
                      notes: '',
                    });
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-3">Supplier</th>
                  <th>Contact</th>
                  <th>Purchases</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id} className="border-b border-border">
                    <td className="p-3 font-medium">{supplier.name}</td>
                    <td>{supplier.contact_name || supplier.phone || '—'}</td>
                    <td>{supplier.purchase_count || 0}</td>
                    <td>{supplier.is_active ? 'Active' : 'Inactive'}</td>
                    <td>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingSupplier(supplier);
                            setSupplierForm({
                              name: supplier.name,
                              contact_name: supplier.contact_name || '',
                              phone: supplier.phone || '',
                              email: supplier.email || '',
                              address: supplier.address || '',
                              notes: supplier.notes || '',
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!supplier.is_active}
                          onClick={async () => {
                            try {
                              await api.post(
                                `/stock-management/suppliers/${supplier.id}/deactivate`,
                              );
                              await refresh();
                            } catch (error) {
                              toast.error(errorMessage(error));
                            }
                          }}
                        >
                          Deactivate
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={(supplier.purchase_count || 0) > 0}
                          onClick={async () => {
                            try {
                              await api.delete(`/stock-management/suppliers/${supplier.id}`);
                              await refresh();
                            } catch (error) {
                              toast.error(errorMessage(error));
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'purchases' && (
        <div className="space-y-5">
          <form
            onSubmit={createPurchase}
            className="space-y-3 rounded-xl border border-border bg-card p-4"
          >
            <h3 className="font-semibold">
              {editingPurchaseId ? 'Edit purchase draft' : 'New purchase draft'}
            </h3>
            <div className="grid gap-2 md:grid-cols-4">
              <select
                value={purchaseForm.supplierId}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, supplierId: e.target.value })}
                className="rounded border border-border bg-background p-2"
              >
                <option value="">No supplier</option>
                {suppliers
                  .filter((s) => s.is_active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <input
                type="date"
                value={purchaseForm.purchaseDate}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, purchaseDate: e.target.value })}
                className="rounded border border-border bg-background p-2"
                required
              />
              <input
                value={purchaseForm.invoiceNumber}
                onChange={(e) =>
                  setPurchaseForm({ ...purchaseForm, invoiceNumber: e.target.value })
                }
                placeholder="Invoice number"
                className="rounded border border-border bg-background p-2"
              />
              <input
                type="number"
                min="0"
                step="any"
                value={purchaseForm.additionalExpenses}
                onChange={(e) =>
                  setPurchaseForm({ ...purchaseForm, additionalExpenses: e.target.value })
                }
                placeholder="Additional expenses"
                className="rounded border border-border bg-background p-2"
              />
              <select
                value={purchaseForm.paymentStatus}
                onChange={(e) =>
                  setPurchaseForm({ ...purchaseForm, paymentStatus: e.target.value })
                }
                className="rounded border border-border bg-background p-2"
              >
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partially paid</option>
                <option value="paid">Paid</option>
              </select>
              <input
                value={purchaseForm.notes}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })}
                placeholder="Notes"
                className="rounded border border-border bg-background p-2"
              />
            </div>
            {purchaseForm.items.map((item, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-5">
                <select
                  value={item.supplyId}
                  onChange={(e) => {
                    const next = [...purchaseForm.items];
                    next[index] = { ...item, supplyId: e.target.value };
                    setPurchaseForm({ ...purchaseForm, items: next });
                  }}
                  className="rounded border border-border bg-background p-2"
                  required
                >
                  <option value="">Supply</option>
                  {supplies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.base_unit})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0.00000001"
                  step="any"
                  value={item.quantity}
                  onChange={(e) => {
                    const next = [...purchaseForm.items];
                    next[index] = { ...item, quantity: e.target.value };
                    setPurchaseForm({ ...purchaseForm, items: next });
                  }}
                  placeholder="Quantity"
                  className="rounded border border-border bg-background p-2"
                  required
                />
                <select
                  value={item.purchaseUnit}
                  onChange={(e) => {
                    const next = [...purchaseForm.items];
                    next[index] = { ...item, purchaseUnit: e.target.value };
                    setPurchaseForm({ ...purchaseForm, items: next });
                  }}
                  className="rounded border border-border bg-background p-2"
                >
                  <option value="each">pieces</option>
                  <option value="pack">packs</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                  <option value="ml">ml</option>
                  <option value="l">litres</option>
                </select>
                {item.purchaseUnit === 'pack' ? (
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={item.packSizeInBase}
                    onChange={(e) => {
                      const next = [...purchaseForm.items];
                      next[index] = { ...item, packSizeInBase: e.target.value };
                      setPurchaseForm({ ...purchaseForm, items: next });
                    }}
                    placeholder="Pieces / pack"
                    className="rounded border border-border bg-background p-2"
                    required
                  />
                ) : (
                  <span />
                )}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={item.unitPrice}
                  onChange={(e) => {
                    const next = [...purchaseForm.items];
                    next[index] = { ...item, unitPrice: e.target.value };
                    setPurchaseForm({ ...purchaseForm, items: next });
                  }}
                  placeholder="Unit price"
                  className="rounded border border-border bg-background p-2"
                  required
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setPurchaseForm({
                    ...purchaseForm,
                    items: [
                      ...purchaseForm.items,
                      {
                        supplyId: supplies[0]?.id || '',
                        quantity: '1',
                        purchaseUnit: 'each',
                        packSizeInBase: '',
                        unitPrice: '',
                      },
                    ],
                  })
                }
              >
                Add item
              </Button>
              <Button type="submit">
                {editingPurchaseId ? 'Update draft' : 'Save draft'}
              </Button>

              {editingPurchaseId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetPurchaseForm}
                >
                  Cancel editing
                </Button>
              )}
            </div>
          </form>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-2 font-semibold">Purchase workflow</h3>
            {purchases.map((purchase) => (
              <div
                key={purchase.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm"
              >
                <span>
                  {purchase.purchase_date} · {purchase.supplier_name || 'No supplier'} ·{' '}
                  {purchase.invoice_number || 'No invoice'} · {purchase.status}
                </span>
                <span className="flex gap-2">
                  {purchase.status === 'draft' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => editPurchase(purchase)}
                      >
                        Edit
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => transitionPurchase(purchase, 'review')}
                      >
                        Review
                      </Button>
                    </>
                  )}
                  {purchase.status === 'review' && (
                    <Button size="sm" onClick={() => transitionPurchase(purchase, 'receive')}>
                      Receive / post stock
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'counts' && (
        <div className="space-y-4">
          <Button onClick={startCount}>Start physical count</Button>
          <div className="flex flex-wrap gap-2">
            {counts.map((count) => (
              <Button
                key={count.id}
                size="sm"
                variant="outline"
                onClick={() => loadCount(count.id)}
              >
                {count.status} · {count.id.slice(-6)}
              </Button>
            ))}
          </div>
          {activeCount && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-semibold">Count {activeCount.status}</h3>
              <div className="mt-3 space-y-2">
                {activeCount.items?.map((item, index) => (
                  <div key={item.supply_id} className="grid gap-2 md:grid-cols-[1fr_8rem_8rem_1fr]">
                    <span>
                      {item.supply_name_snapshot}{' '}
                      <span className="text-muted-foreground">
                        started at {item.expected_quantity} · system stock when saved {item.observed_stock_quantity ?? 'not saved'} {item.base_unit_snapshot}
                      </span>
                      {item.variance_quantity !== null && item.variance_quantity !== 0 && (
                        <span className="ms-2 text-muted-foreground">
                          variance {item.variance_quantity} · cost {item.variance_cost}
                        </span>
                      )}
                    </span>
                    <input
                      disabled={activeCount.status !== 'draft'}
                      type="number"
                      min="0"
                      step="any"
                      value={item.actual_quantity ?? ''}
                      onChange={(e) => {
                        const items = [...(activeCount.items || [])];
                        items[index] = {
                          ...item,
                          actual_quantity: e.target.value === '' ? null : Number(e.target.value),
                        };
                        setActiveCount({ ...activeCount, items });
                      }}
                      placeholder="Actual"
                      className="rounded border border-border bg-background p-2"
                    />
                    <span>{item.base_unit_snapshot}</span>
                    <input
                      disabled={activeCount.status !== 'draft'}
                      value={item.reason || ''}
                      onChange={(e) => {
                        const items = [...(activeCount.items || [])];
                        items[index] = { ...item, reason: e.target.value };
                        setActiveCount({ ...activeCount, items });
                      }}
                      placeholder="Variance reason (required if different)"
                      className="rounded border border-border bg-background p-2"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                {activeCount.status === 'draft' && (
                  <>
                    <Button onClick={saveCount}>Save count</Button>
                    <Button variant="outline" onClick={() => transitionCount('review')}>
                      Review differences
                    </Button>
                  </>
                )}
                {activeCount.status === 'review' && (
                  <Button onClick={() => transitionCount('post')}>Post audited adjustments</Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'wastage' && (
        <form
          onSubmit={saveWastage}
          className="grid max-w-3xl gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-2"
        >
          <h3 className="md:col-span-2 font-semibold">Record wastage</h3>
          <select
            value={wasteForm.supplyId}
            onChange={(e) => {
              const supply = supplies.find((entry) => entry.id === e.target.value);
              setWasteForm({
                ...wasteForm,
                supplyId: e.target.value,
                unit: (supply?.base_unit || 'each') as Unit,
              });
            }}
            className="rounded border border-border bg-background p-2"
            required
          >
            {supplies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0.00000001"
            step="any"
            placeholder="Quantity"
            value={wasteForm.quantity}
            onChange={(e) => setWasteForm({ ...wasteForm, quantity: e.target.value })}
            className="rounded border border-border bg-background p-2"
            required
          />
          <p className="rounded border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Unit: {wasteForm.unit}
          </p>
          <input
            type="date"
            value={wasteForm.wastageDate}
            onChange={(e) => setWasteForm({ ...wasteForm, wastageDate: e.target.value })}
            className="rounded border border-border bg-background p-2"
            required
          />
          <input
            placeholder="Reason"
            value={wasteForm.reason}
            onChange={(e) => setWasteForm({ ...wasteForm, reason: e.target.value })}
            className="rounded border border-border bg-background p-2"
            required
          />
          <input
            placeholder="Notes"
            value={wasteForm.notes}
            onChange={(e) => setWasteForm({ ...wasteForm, notes: e.target.value })}
            className="rounded border border-border bg-background p-2"
          />
          <Button type="submit">Record wastage</Button>
        </form>
      )}
    </div>
  );
}
