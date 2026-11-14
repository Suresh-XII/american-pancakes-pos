'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Search,
  X,
  Edit,
  Trash2,
  Copy,
  AlertTriangle,
  History,
  CheckCircle2,
  Package,
  Layers,
  ShoppingBag,
  Sliders,
} from 'lucide-react';

type ServingType = 'dine_in' | 'parcel';

interface PackagingMaterial {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  base_unit: string;
  stock_quantity: number;
  low_stock_threshold: number | null;
  unit_cost: number | null;
  is_active: number;
  is_low_stock?: number;
  created_at: string;
  updated_at: string;
}

interface ProfileComponent {
  material_id: string;
  material_name?: string;
  quantity: number;
  base_unit?: string;
  unit_cost?: number | null;
  sku?: string | null;
  category?: string | null;
  is_active?: number;
}

interface Profile {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  serving_type: ServingType;
  packaging_type: 'paper_plate' | 'parcel_box';
  supply_id: string;
  units_per_serving: number;
  customer_charge_per_unit: number;
  is_active: number;
  is_default: number;
  components: ProfileComponent[];
}

interface ProductAssignment {
  product_id: string | number;
  product_name: string;
  packaging_profile_id: string | null;
  profile_name: string | null;
  no_packaging: boolean;
  variants: Array<{
    variant_id: string | number;
    variant_name: string;
    packaging_profile_id: string | null;
    profile_name: string | null;
    no_packaging: boolean;
  }>;
}

interface PackagingDashboardData {
  total_materials: number;
  low_stock_materials: number;
  active_profiles: number;
  assigned_products_count: number;
  low_stock_items: PackagingMaterial[];
  recent_movements: Array<{
    id: number;
    supply_id: string;
    material_name: string;
    quantity_delta: number;
    movement_type: string;
    unit: string;
    stock_after: number;
    reason: string | null;
    created_at: string;
  }>;
}

interface MaterialMovement {
  id: number;
  supply_id: string;
  quantity_delta: number;
  movement_type: string;
  unit: string;
  stock_after: number;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
}

export function PackagingProfilesPanel() {
  const [subTab, setSubTab] = useState<'dashboard' | 'materials' | 'profiles' | 'assignments' | 'defaults'>('dashboard');
  const [loading, setLoading] = useState(true);

  // Dashboard state
  const [dashboard, setDashboard] = useState<PackagingDashboardData | null>(null);

  // Materials state
  const [materials, setMaterials] = useState<PackagingMaterial[]>([]);
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialCategory, setMaterialCategory] = useState('');
  const [lowStockFilter, setLowStockFilter] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<PackagingMaterial | null>(null);
  const [materialForm, setMaterialForm] = useState({
    name: '',
    sku: '',
    category: '',
    unit: 'each',
    stock_quantity: '0',
    low_stock_threshold: '',
    purchase_cost: '',
    is_active: true,
  });

  // Movement history modal
  const [viewingMovementsMaterial, setViewingMovementsMaterial] = useState<PackagingMaterial | null>(null);
  const [materialMovements, setMaterialMovements] = useState<MaterialMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  // Profiles state
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: '',
    description: '',
    notes: '',
    serving_type: 'parcel' as ServingType,
    packaging_type: 'parcel_box' as 'paper_plate' | 'parcel_box',
    customer_charge_per_unit: '0',
    is_active: true,
    is_default: false,
    components: [{ material_id: '', quantity: '1' }],
  });

  // Product assignments state
  const [assignments, setAssignments] = useState<ProductAssignment[]>([]);

  // Serving defaults form
  const [defaultDineIn, setDefaultDineIn] = useState({ name: '', supply_id: '', units: '1', charge: '0', is_active: true });
  const [defaultParcel, setDefaultParcel] = useState({ name: '', supply_id: '', units: '1', charge: '0', is_active: true });
  const [savingDefaults, setSavingDefaults] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const fetchPackagingData = async () => {
      try {
        const [dashRes, matRes, profRes, assignRes] = await Promise.all([
          api.get('/packaging/dashboard'),
          api.get('/packaging/materials?include_inactive=true'),
          api.get('/packaging/profiles'),
          api.get('/packaging/assignments'),
        ]);

        if (!active) return;

        const dashData = dashRes.data as PackagingDashboardData;
        const loadedMaterials = (matRes.data.materials || []) as PackagingMaterial[];
        const loadedProfiles = (profRes.data.profiles || []) as Profile[];
        const loadedAssignments = (assignRes.data.products || []) as ProductAssignment[];

        setDashboard(dashData);
        setMaterials(loadedMaterials);
        setProfiles(loadedProfiles);
        setAssignments(loadedAssignments);

        // Populate default forms
        const dineInProf = loadedProfiles.find((p) => p.serving_type === 'dine_in' && p.is_default) ||
          loadedProfiles.find((p) => p.serving_type === 'dine_in');
        const parcelProf = loadedProfiles.find((p) => p.serving_type === 'parcel' && p.is_default) ||
          loadedProfiles.find((p) => p.serving_type === 'parcel');

        if (dineInProf) {
          setDefaultDineIn({
            name: dineInProf.name,
            supply_id: dineInProf.supply_id || (dineInProf.components[0]?.material_id ?? ''),
            units: String(dineInProf.units_per_serving || 1),
            charge: String(dineInProf.customer_charge_per_unit || 0),
            is_active: Boolean(dineInProf.is_active),
          });
        }
        if (parcelProf) {
          setDefaultParcel({
            name: parcelProf.name,
            supply_id: parcelProf.supply_id || (parcelProf.components[0]?.material_id ?? ''),
            units: String(parcelProf.units_per_serving || 1),
            charge: String(parcelProf.customer_charge_per_unit || 0),
            is_active: Boolean(parcelProf.is_active),
          });
        }
      } catch (err: unknown) {
        if (active) {
          const apiError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          toast.error(
            apiError
              ? `Could not load packaging configuration: ${apiError}`
              : 'Could not load packaging configuration',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchPackagingData();

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const loadAll = () => setRefreshKey((k) => k + 1);

  // --- Material Handlers ---

  const openAddMaterial = () => {
    setEditingMaterial(null);
    setMaterialForm({
      name: '',
      sku: '',
      category: '',
      unit: 'each',
      stock_quantity: '0',
      low_stock_threshold: '',
      purchase_cost: '',
      is_active: true,
    });
    setShowMaterialModal(true);
  };

  const openEditMaterial = (m: PackagingMaterial) => {
    setEditingMaterial(m);
    setMaterialForm({
      name: m.name,
      sku: m.sku || '',
      category: m.category || '',
      unit: m.base_unit || 'each',
      stock_quantity: String(m.stock_quantity),
      low_stock_threshold: m.low_stock_threshold !== null ? String(m.low_stock_threshold) : '',
      purchase_cost: m.unit_cost !== null ? String(m.unit_cost) : '',
      is_active: Boolean(m.is_active),
    });
    setShowMaterialModal(true);
  };

  const saveMaterial = async () => {
    if (!materialForm.name.trim()) {
      toast.error('Material name is required');
      return;
    }
    const costVal = materialForm.purchase_cost.trim() !== '' ? Number(materialForm.purchase_cost) : null;
    if (costVal !== null && (!Number.isFinite(costVal) || costVal < 0)) {
      toast.error('Purchase cost cannot be negative');
      return;
    }
    const threshVal = materialForm.low_stock_threshold.trim() !== '' ? Number(materialForm.low_stock_threshold) : null;
    if (threshVal !== null && (!Number.isFinite(threshVal) || threshVal < 0)) {
      toast.error('Threshold cannot be negative');
      return;
    }

    try {
      if (editingMaterial) {
        await api.put(`/packaging/materials/${editingMaterial.id}`, {
          name: materialForm.name.trim(),
          sku: materialForm.sku.trim() || null,
          category: materialForm.category.trim() || null,
          unit: materialForm.unit,
          low_stock_threshold: threshVal,
          purchase_cost: costVal,
          is_active: materialForm.is_active,
        });
        toast.success('Packaging material updated');
      } else {
        const stockVal = Number(materialForm.stock_quantity || 0);
        await api.post('/packaging/materials', {
          name: materialForm.name.trim(),
          sku: materialForm.sku.trim() || null,
          category: materialForm.category.trim() || null,
          unit: materialForm.unit,
          initial_stock: Number.isFinite(stockVal) && stockVal >= 0 ? stockVal : 0,
          low_stock_threshold: threshVal,
          purchase_cost: costVal,
          is_active: materialForm.is_active,
        });
        toast.success('Packaging material created');
      }
      setShowMaterialModal(false);
      await loadAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save material';
      toast.error(msg);
    }
  };

  const deleteMaterial = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this packaging material?')) return;
    try {
      await api.delete(`/packaging/materials/${id}`);
      toast.success('Packaging material deleted');
      await loadAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to delete material';
      toast.error(msg);
    }
  };

  const openMovements = async (m: PackagingMaterial) => {
    setViewingMovementsMaterial(m);
    setMovementsLoading(true);
    try {
      const res = await api.get(`/packaging/materials/${m.id}/movements`);
      setMaterialMovements(res.data.movements || []);
    } catch {
      toast.error('Failed to load movements');
    } finally {
      setMovementsLoading(false);
    }
  };

  // --- Profile Handlers ---

  const openAddProfile = () => {
    setEditingProfile(null);
    setProfileForm({
      name: '',
      description: '',
      notes: '',
      serving_type: 'parcel',
      packaging_type: 'parcel_box',
      customer_charge_per_unit: '0',
      is_active: true,
      is_default: false,
      components: [{ material_id: materials[0]?.id || '', quantity: '1' }],
    });
    setShowProfileModal(true);
  };

  const openEditProfile = (p: Profile) => {
    setEditingProfile(p);
    setProfileForm({
      name: p.name,
      description: p.description || '',
      notes: p.notes || '',
      serving_type: p.serving_type,
      packaging_type: p.packaging_type,
      customer_charge_per_unit: String(p.customer_charge_per_unit || 0),
      is_active: Boolean(p.is_active),
      is_default: Boolean(p.is_default),
      components: p.components.length > 0
        ? p.components.map((c) => ({ material_id: c.material_id, quantity: String(c.quantity) }))
        : [{ material_id: p.supply_id || materials[0]?.id || '', quantity: String(p.units_per_serving || 1) }],
    });
    setShowProfileModal(true);
  };

  const duplicateProfile = async (id: string) => {
    try {
      await api.post(`/packaging/profiles/${id}/duplicate`);
      toast.success('Packaging profile duplicated');
      await loadAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to duplicate profile';
      toast.error(msg);
    }
  };

  const deleteProfile = async (id: string) => {
    if (!window.confirm('Are you sure you want to deactivate this packaging profile?')) return;
    try {
      await api.delete(`/packaging/profiles/${id}`);
      toast.success('Packaging profile deactivated');
      await loadAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to deactivate profile';
      toast.error(msg);
    }
  };

  const saveProfile = async () => {
    if (!profileForm.name.trim()) {
      toast.error('Profile name is required');
      return;
    }
    const chargeVal = Number(profileForm.customer_charge_per_unit);
    if (!Number.isFinite(chargeVal) || chargeVal < 0) {
      toast.error('Customer charge must be a valid non-negative amount');
      return;
    }

    const comps = profileForm.components
      .filter((c) => c.material_id.trim() !== '')
      .map((c) => ({ material_id: c.material_id, quantity: Number(c.quantity) }));

    if (comps.length === 0) {
      toast.error('At least one packaging material component is required');
      return;
    }
    for (const c of comps) {
      if (!Number.isFinite(c.quantity) || c.quantity <= 0) {
        toast.error('Component quantity must be a positive number');
        return;
      }
    }

    const payload = {
      name: profileForm.name.trim(),
      description: profileForm.description.trim() || null,
      notes: profileForm.notes.trim() || null,
      serving_type: profileForm.serving_type,
      packaging_type: profileForm.serving_type === 'dine_in' ? 'paper_plate' : 'parcel_box',
      customer_charge_per_unit: chargeVal,
      is_active: profileForm.is_active,
      is_default: profileForm.is_default,
      components: comps,
    };

    try {
      if (editingProfile) {
        await api.put(`/packaging/profiles/${editingProfile.id}`, payload);
        toast.success('Packaging profile updated');
      } else {
        await api.post('/packaging/profiles', payload);
        toast.success('Packaging profile created');
      }
      setShowProfileModal(false);
      await loadAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save profile';
      toast.error(msg);
    }
  };

  // --- Assignment Handlers ---

  const updateProductAssignment = async (productId: number | string, profileId: string | null, noPackaging: boolean) => {
    try {
      await api.put(`/packaging/assignments/products/${productId}`, {
        packaging_profile_id: noPackaging ? null : profileId,
        no_packaging: noPackaging,
      });
      toast.success('Product assignment updated');
      await loadAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update assignment';
      toast.error(msg);
    }
  };

  const updateVariantAssignment = async (variantId: number | string, profileId: string | null, noPackaging: boolean) => {
    try {
      await api.put(`/packaging/assignments/variants/${variantId}`, {
        packaging_profile_id: noPackaging ? null : profileId,
        no_packaging: noPackaging,
      });
      toast.success('Variant assignment updated');
      await loadAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update assignment';
      toast.error(msg);
    }
  };

  // --- Defaults Handlers ---

  const saveServingDefault = async (type: ServingType) => {
    const form = type === 'dine_in' ? defaultDineIn : defaultParcel;
    if (!form.name.trim() || !form.supply_id) {
      toast.error('Enter a profile name and select a supply');
      return;
    }
    const units = Number(form.units);
    const charge = Number(form.charge);
    if (!Number.isSafeInteger(units) || units <= 0 || !Number.isFinite(charge) || charge < 0) {
      toast.error('Units must be a positive integer and charge must be non-negative');
      return;
    }

    setSavingDefaults(type);
    const existing = profiles.find((p) => p.serving_type === type && p.is_default) || profiles.find((p) => p.serving_type === type);
    const payload = {
      name: form.name.trim(),
      serving_type: type,
      packaging_type: type === 'dine_in' ? 'paper_plate' : 'parcel_box',
      supply_id: form.supply_id,
      units_per_serving: units,
      customer_charge_per_unit: charge,
      is_active: form.is_active,
      is_default: form.is_active,
    };

    try {
      if (existing) {
        await api.put(`/packaging-profiles/${existing.id}`, payload);
      } else {
        await api.post('/packaging-profiles', payload);
      }
      toast.success(`${type === 'dine_in' ? 'Dine-in' : 'Takeaway'} packaging saved`);
      await loadAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not save default';
      toast.error(msg);
    } finally {
      setSavingDefaults(null);
    }
  };

  if (loading) {
    return <p className="p-4 text-muted-foreground">Loading packaging management system...</p>;
  }

  const filteredMaterials = materials.filter((m) => {
    if (materialSearch && !m.name.toLowerCase().includes(materialSearch.toLowerCase()) && !(m.sku && m.sku.toLowerCase().includes(materialSearch.toLowerCase()))) {
      return false;
    }
    if (materialCategory && m.category !== materialCategory) {
      return false;
    }
    if (lowStockFilter && !m.is_low_stock) {
      return false;
    }
    return true;
  });

  const categories = Array.from(new Set(materials.map((m) => m.category).filter(Boolean))) as string[];

  return (
    <div className="space-y-6">
      {/* Header and Sub-Navigation */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Packaging Management</h2>
          <p className="text-sm text-muted-foreground">
            Configure packaging materials, multi-component profiles, product assignments, and automated checkout consumption.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={subTab === 'dashboard' ? 'default' : 'outline'}
            onClick={() => setSubTab('dashboard')}
          >
            <Sliders size={15} className="mr-1.5" />
            Dashboard
          </Button>
          <Button
            size="sm"
            variant={subTab === 'materials' ? 'default' : 'outline'}
            onClick={() => setSubTab('materials')}
          >
            <Package size={15} className="mr-1.5" />
            Materials
          </Button>
          <Button
            size="sm"
            variant={subTab === 'profiles' ? 'default' : 'outline'}
            onClick={() => setSubTab('profiles')}
          >
            <Layers size={15} className="mr-1.5" />
            Profiles
          </Button>
          <Button
            size="sm"
            variant={subTab === 'assignments' ? 'default' : 'outline'}
            onClick={() => setSubTab('assignments')}
          >
            <ShoppingBag size={15} className="mr-1.5" />
            Assignments
          </Button>
          <Button
            size="sm"
            variant={subTab === 'defaults' ? 'default' : 'outline'}
            onClick={() => setSubTab('defaults')}
          >
            Defaults
          </Button>
        </div>
      </div>

      {/* --- DASHBOARD TAB --- */}
      {subTab === 'dashboard' && dashboard && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs font-medium text-muted-foreground uppercase">Packaging Materials</span>
              <div className="mt-2 text-2xl font-bold">{dashboard.total_materials}</div>
              <span className="text-xs text-muted-foreground">Active materials</span>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs font-medium text-muted-foreground uppercase">Low Stock Alerts</span>
              <div className={`mt-2 text-2xl font-bold ${dashboard.low_stock_materials > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {dashboard.low_stock_materials}
              </div>
              <span className="text-xs text-muted-foreground">Materials below threshold</span>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs font-medium text-muted-foreground uppercase">Active Profiles</span>
              <div className="mt-2 text-2xl font-bold">{dashboard.active_profiles}</div>
              <span className="text-xs text-muted-foreground">Configured packaging rules</span>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs font-medium text-muted-foreground uppercase">Assigned Products</span>
              <div className="mt-2 text-2xl font-bold">{dashboard.assigned_products_count}</div>
              <span className="text-xs text-muted-foreground">Products with custom rules</span>
            </div>
          </div>

          {/* Low Stock Warning */}
          {dashboard.low_stock_items && dashboard.low_stock_items.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="text-amber-500" size={18} />
                <h4 className="font-semibold text-amber-600 dark:text-amber-400">Low Stock Packaging Materials</h4>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {dashboard.low_stock_items.map((item) => (
                  <div key={item.id} className="flex justify-between items-center rounded-lg bg-card p-2 text-sm border border-border">
                    <span className="font-medium truncate max-w-[150px]">{item.name}</span>
                    <span className="text-amber-600 font-semibold">
                      {item.stock_quantity} / {item.low_stock_threshold} {item.base_unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Movements */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="font-semibold mb-3">Recent Packaging Movements</h4>
            {dashboard.recent_movements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No recent movements recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-left text-xs uppercase">
                      <th className="p-2">Material</th>
                      <th className="p-2">Movement</th>
                      <th className="p-2 text-right">Delta</th>
                      <th className="p-2 text-right">Stock After</th>
                      <th className="p-2">Reason</th>
                      <th className="p-2 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dashboard.recent_movements.map((move) => (
                      <tr key={move.id}>
                        <td className="p-2 font-medium">{move.material_name}</td>
                        <td className="p-2">
                          <Badge variant="outline">{move.movement_type}</Badge>
                        </td>
                        <td className={`p-2 text-right font-medium ${move.quantity_delta < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                          {move.quantity_delta > 0 ? `+${move.quantity_delta}` : move.quantity_delta} {move.unit}
                        </td>
                        <td className="p-2 text-right font-medium">{move.stock_after} {move.unit}</td>
                        <td className="p-2 text-muted-foreground">{move.reason || '—'}</td>
                        <td className="p-2 text-right text-xs text-muted-foreground">
                          {new Date(move.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- MATERIALS TAB --- */}
      {subTab === 'materials' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search materials or SKU..."
                  value={materialSearch}
                  onChange={(e) => setMaterialSearch(e.target.value)}
                  className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              {categories.length > 0 && (
                <select
                  value={materialCategory}
                  onChange={(e) => setMaterialCategory(e.target.value)}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                >
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={lowStockFilter}
                  onChange={(e) => setLowStockFilter(e.target.checked)}
                />
                Low stock only
              </label>
            </div>
            <Button size="sm" onClick={openAddMaterial}>
              <Plus size={16} className="mr-1" />
              Add Material
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-left text-xs uppercase bg-muted/40">
                  <th className="p-3">Material Name</th>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Category</th>
                  <th className="p-3 text-right">Available Stock</th>
                  <th className="p-3 text-right">Threshold</th>
                  <th className="p-3 text-right">Unit Cost</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredMaterials.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-muted-foreground">
                      No packaging materials found.
                    </td>
                  </tr>
                ) : (
                  filteredMaterials.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30">
                      <td className="p-3 font-medium">
                        {m.name}
                        {m.is_low_stock === 1 && (
                          <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">Low Stock</Badge>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{m.sku || '—'}</td>
                      <td className="p-3 text-xs text-muted-foreground">{m.category || '—'}</td>
                      <td className={`p-3 text-right font-medium ${m.stock_quantity <= 0 ? 'text-red-500' : ''}`}>
                        {m.stock_quantity} {m.base_unit}
                      </td>
                      <td className="p-3 text-right text-xs text-muted-foreground">
                        {m.low_stock_threshold !== null ? `${m.low_stock_threshold} ${m.base_unit}` : '—'}
                      </td>
                      <td className="p-3 text-right text-xs">
                        {m.unit_cost !== null ? `₹${Number(m.unit_cost).toFixed(2)}` : '—'}
                      </td>
                      <td className="p-3 text-center">
                        <Badge variant={m.is_active ? 'default' : 'secondary'} className="text-[10px]">
                          {m.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Movement History" onClick={() => openMovements(m)}>
                            <History size={14} />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit Material" onClick={() => openEditMaterial(m)}>
                            <Edit size={14} />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" title="Delete Material" onClick={() => deleteMaterial(m.id)}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- PROFILES TAB --- */}
      {subTab === 'profiles' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Packaging profiles group multiple packaging materials and define item-level packaging rules.
            </p>
            <Button size="sm" onClick={openAddProfile}>
              <Plus size={16} className="mr-1" />
              Add Profile
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {profiles.length === 0 ? (
              <p className="text-muted-foreground col-span-2 text-center py-6">No packaging profiles configured.</p>
            ) : (
              profiles.map((p) => {
                const totalCost = p.components.reduce((sum, c) => {
                  return sum + (c.unit_cost !== null && c.unit_cost !== undefined ? Number(c.unit_cost) * Number(c.quantity) : 0);
                }, 0);

                return (
                  <div key={p.id} className="rounded-xl border border-border bg-card p-5 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">{p.name}</h3>
                          {p.is_default === 1 && (
                            <Badge variant="outline" className="text-emerald-500 border-emerald-500 text-[10px]">
                              Default {p.serving_type === 'dine_in' ? 'Dine-In' : 'Takeaway'}
                            </Badge>
                          )}
                          <Badge variant={p.is_active ? 'default' : 'secondary'} className="text-[10px]">
                            {p.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        {p.description && <p className="text-xs text-muted-foreground mt-1">{p.description}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Duplicate Profile" onClick={() => duplicateProfile(p.id)}>
                          <Copy size={15} />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Edit Profile" onClick={() => openEditProfile(p)}>
                          <Edit size={15} />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500" title="Deactivate Profile" onClick={() => deleteProfile(p.id)}>
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </div>

                    {/* Multi-material components breakdown */}
                    <div className="rounded-lg bg-muted/40 p-3 space-y-2">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">Components</span>
                      {p.components.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Single supply: {p.units_per_serving} unit</p>
                      ) : (
                        <div className="space-y-1">
                          {p.components.map((c) => (
                            <div key={c.material_id} className="flex justify-between text-xs">
                              <span className="font-medium text-foreground">{c.material_name || c.material_id}</span>
                              <span className="text-muted-foreground font-semibold">
                                {c.quantity} {c.base_unit || 'each'}
                                {c.unit_cost !== null && c.unit_cost !== undefined ? ` (₹${(Number(c.unit_cost) * Number(c.quantity)).toFixed(2)})` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border">
                      <div>
                        <span className="text-muted-foreground">Serving compatibility:</span>
                        <p className="font-medium capitalize">{p.serving_type.replace('_', ' ')}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-muted-foreground">Customer Charge:</span>
                        <p className="font-medium">₹{Number(p.customer_charge_per_unit || 0).toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Estimated Materials Cost:</span>
                        <p className="font-medium">₹{totalCost.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* --- PRODUCT ASSIGNMENTS TAB --- */}
      {subTab === 'assignments' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure product and variant packaging assignments. Precedence: Explicit order override → Variant profile → Product profile → Serving default.
          </p>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-left text-xs uppercase bg-muted/40">
                  <th className="p-3">Product / Variant</th>
                  <th className="p-3">Assigned Profile</th>
                  <th className="p-3 text-center">No Packaging</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {assignments.map((prod) => (
                  <ProductAssignmentRow
                    key={prod.product_id}
                    product={prod}
                    profiles={profiles}
                    onSaveProduct={updateProductAssignment}
                    onSaveVariant={updateVariantAssignment}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- DEFAULTS TAB --- */}
      {subTab === 'defaults' && (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Quick configuration for system-wide default paper plates and parcel boxes.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Dine-In Default */}
            <div className="space-y-4 rounded-xl border border-border bg-card p-5">
              <h3 className="font-semibold text-lg">Dine-in Default Packaging</h3>
              <div className="space-y-3 text-sm">
                <label className="block space-y-1">
                  <span>Profile Name</span>
                  <input
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={defaultDineIn.name}
                    onChange={(e) => setDefaultDineIn({ ...defaultDineIn, name: e.target.value })}
                  />
                </label>
                <label className="block space-y-1">
                  <span>Supply Material</span>
                  <select
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={defaultDineIn.supply_id}
                    onChange={(e) => setDefaultDineIn({ ...defaultDineIn, supply_id: e.target.value })}
                  >
                    <option value="">Select supply</option>
                    {materials.filter((m) => m.is_active).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span>Plates per pancake</span>
                    <input
                      type="number"
                      min="1"
                      className="w-full rounded-md border border-border bg-background p-2"
                      value={defaultDineIn.units}
                      onChange={(e) => setDefaultDineIn({ ...defaultDineIn, units: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span>Charge per unit (₹)</span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded-md border border-border bg-background p-2"
                      value={defaultDineIn.charge}
                      onChange={(e) => setDefaultDineIn({ ...defaultDineIn, charge: e.target.value })}
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    checked={defaultDineIn.is_active}
                    onChange={(e) => setDefaultDineIn({ ...defaultDineIn, is_active: e.target.checked })}
                  />
                  <span>Enable dine-in packaging</span>
                </label>
                <div className="flex justify-end pt-2">
                  <Button size="sm" onClick={() => saveServingDefault('dine_in')} disabled={savingDefaults !== null}>
                    {savingDefaults === 'dine_in' ? 'Saving...' : 'Save Dine-In Default'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Takeaway Default */}
            <div className="space-y-4 rounded-xl border border-border bg-card p-5">
              <h3 className="font-semibold text-lg">Takeaway Default Packaging</h3>
              <div className="space-y-3 text-sm">
                <label className="block space-y-1">
                  <span>Profile Name</span>
                  <input
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={defaultParcel.name}
                    onChange={(e) => setDefaultParcel({ ...defaultParcel, name: e.target.value })}
                  />
                </label>
                <label className="block space-y-1">
                  <span>Supply Material</span>
                  <select
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={defaultParcel.supply_id}
                    onChange={(e) => setDefaultParcel({ ...defaultParcel, supply_id: e.target.value })}
                  >
                    <option value="">Select supply</option>
                    {materials.filter((m) => m.is_active).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span>Boxes per pancake</span>
                    <input
                      type="number"
                      min="1"
                      className="w-full rounded-md border border-border bg-background p-2"
                      value={defaultParcel.units}
                      onChange={(e) => setDefaultParcel({ ...defaultParcel, units: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span>Charge per unit (₹)</span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded-md border border-border bg-background p-2"
                      value={defaultParcel.charge}
                      onChange={(e) => setDefaultParcel({ ...defaultParcel, charge: e.target.value })}
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    checked={defaultParcel.is_active}
                    onChange={(e) => setDefaultParcel({ ...defaultParcel, is_active: e.target.checked })}
                  />
                  <span>Enable takeaway packaging</span>
                </label>
                <div className="flex justify-end pt-2">
                  <Button size="sm" onClick={() => saveServingDefault('parcel')} disabled={savingDefaults !== null}>
                    {savingDefaults === 'parcel' ? 'Saving...' : 'Save Takeaway Default'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- ADD / EDIT MATERIAL MODAL --- */}
      {showMaterialModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">{editingMaterial ? 'Edit Packaging Material' : 'Add Packaging Material'}</h3>
              <button onClick={() => setShowMaterialModal(false)}><X size={20} className="text-muted-foreground" /></button>
            </div>
            <div className="space-y-3 text-sm">
              <label className="block space-y-1">
                <span>Material Name *</span>
                <input
                  className="w-full rounded-md border border-border bg-background p-2"
                  value={materialForm.name}
                  onChange={(e) => setMaterialForm({ ...materialForm, name: e.target.value })}
                  placeholder="e.g. Small Pancake Box"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span>SKU / Code</span>
                  <input
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={materialForm.sku}
                    onChange={(e) => setMaterialForm({ ...materialForm, sku: e.target.value })}
                    placeholder="e.g. BOX-SM"
                  />
                </label>
                <label className="space-y-1">
                  <span>Category</span>
                  <input
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={materialForm.category}
                    onChange={(e) => setMaterialForm({ ...materialForm, category: e.target.value })}
                    placeholder="e.g. Boxes, Cutlery"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span>Unit of Measure</span>
                  <select
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={materialForm.unit}
                    onChange={(e) => setMaterialForm({ ...materialForm, unit: e.target.value })}
                  >
                    <option value="each">Pieces / Each</option>
                    <option value="g">Grams (g)</option>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="ml">Millilitres (ml)</option>
                    <option value="l">Litres (L)</option>
                  </select>
                </label>
                {!editingMaterial && (
                  <label className="space-y-1">
                    <span>Initial Stock</span>
                    <input
                      type="number"
                      min="0"
                      className="w-full rounded-md border border-border bg-background p-2"
                      value={materialForm.stock_quantity}
                      onChange={(e) => setMaterialForm({ ...materialForm, stock_quantity: e.target.value })}
                    />
                  </label>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span>Low Stock Threshold</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="Optional"
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={materialForm.low_stock_threshold}
                    onChange={(e) => setMaterialForm({ ...materialForm, low_stock_threshold: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span>Purchase Cost (₹)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Optional"
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={materialForm.purchase_cost}
                    onChange={(e) => setMaterialForm({ ...materialForm, purchase_cost: e.target.value })}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={materialForm.is_active}
                  onChange={(e) => setMaterialForm({ ...materialForm, is_active: e.target.checked })}
                />
                <span>Active status</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setShowMaterialModal(false)}>Cancel</Button>
              <Button size="sm" onClick={saveMaterial}>Save Material</Button>
            </div>
          </div>
        </div>
      )}

      {/* --- ADD / EDIT PROFILE MODAL --- */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">{editingProfile ? 'Edit Packaging Profile' : 'Add Packaging Profile'}</h3>
              <button onClick={() => setShowProfileModal(false)}><X size={20} className="text-muted-foreground" /></button>
            </div>
            <div className="space-y-3 text-sm">
              <label className="block space-y-1">
                <span>Profile Name *</span>
                <input
                  className="w-full rounded-md border border-border bg-background p-2"
                  value={profileForm.name}
                  onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                  placeholder="e.g. Standard Pancake Takeaway Pack"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span>Serving Type</span>
                  <select
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={profileForm.serving_type}
                    onChange={(e) => setProfileForm({
                      ...profileForm,
                      serving_type: e.target.value as ServingType,
                      packaging_type: e.target.value === 'dine_in' ? 'paper_plate' : 'parcel_box',
                    })}
                  >
                    <option value="parcel">Takeaway / Parcel</option>
                    <option value="dine_in">Dine-In</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span>Customer Charge (₹)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full rounded-md border border-border bg-background p-2"
                    value={profileForm.customer_charge_per_unit}
                    onChange={(e) => setProfileForm({ ...profileForm, customer_charge_per_unit: e.target.value })}
                  />
                </label>
              </div>

              {/* Multi-material components */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-xs uppercase text-muted-foreground">Packaging Materials Components</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setProfileForm({
                      ...profileForm,
                      components: [...profileForm.components, { material_id: materials[0]?.id || '', quantity: '1' }],
                    })}
                  >
                    <Plus size={13} className="mr-1" /> Add Component
                  </Button>
                </div>
                {profileForm.components.map((comp, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      className="flex-1 rounded-md border border-border bg-background p-2 text-sm"
                      value={comp.material_id}
                      onChange={(e) => {
                        const next = [...profileForm.components];
                        next[idx].material_id = e.target.value;
                        setProfileForm({ ...profileForm, components: next });
                      }}
                    >
                      <option value="">Select material</option>
                      {materials.filter((m) => m.is_active).map((m) => (
                        <option key={m.id} value={m.id}>{m.name} ({m.base_unit})</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0.1"
                      step="any"
                      placeholder="Qty"
                      className="w-20 rounded-md border border-border bg-background p-2 text-sm text-right"
                      value={comp.quantity}
                      onChange={(e) => {
                        const next = [...profileForm.components];
                        next[idx].quantity = e.target.value;
                        setProfileForm({ ...profileForm, components: next });
                      }}
                    />
                    {profileForm.components.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = profileForm.components.filter((_, i) => i !== idx);
                          setProfileForm({ ...profileForm, components: next });
                        }}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <label className="block space-y-1">
                <span>Description</span>
                <input
                  className="w-full rounded-md border border-border bg-background p-2"
                  value={profileForm.description}
                  onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })}
                  placeholder="Optional brief description"
                />
              </label>

              <label className="block space-y-1">
                <span>Profile Notes</span>
                <input
                  className="w-full rounded-md border border-border bg-background p-2"
                  value={profileForm.notes}
                  onChange={(e) => setProfileForm({ ...profileForm, notes: e.target.value })}
                  placeholder="Optional internal packaging instructions"
                />
              </label>

              <div className="flex gap-4 pt-1">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={profileForm.is_active}
                    onChange={(e) => setProfileForm({ ...profileForm, is_active: e.target.checked })}
                  />
                  <span>Active</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={profileForm.is_default}
                    onChange={(e) => setProfileForm({ ...profileForm, is_default: e.target.checked })}
                  />
                  <span>Set as default for {profileForm.serving_type}</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setShowProfileModal(false)}>Cancel</Button>
              <Button size="sm" onClick={saveProfile}>Save Profile</Button>
            </div>
          </div>
        </div>
      )}

      {/* --- MOVEMENT HISTORY MODAL --- */}
      {viewingMovementsMaterial && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg">Movement History</h3>
                <p className="text-xs text-muted-foreground">{viewingMovementsMaterial.name}</p>
              </div>
              <button onClick={() => setViewingMovementsMaterial(null)}><X size={20} className="text-muted-foreground" /></button>
            </div>
            {movementsLoading ? (
              <p className="py-4 text-center text-muted-foreground text-sm">Loading movements...</p>
            ) : materialMovements.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-sm">No recorded stock movements.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-left text-xs uppercase bg-muted/40">
                      <th className="p-2">Type</th>
                      <th className="p-2 text-right">Delta</th>
                      <th className="p-2 text-right">Stock After</th>
                      <th className="p-2">Reason</th>
                      <th className="p-2 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {materialMovements.map((move) => (
                      <tr key={move.id}>
                        <td className="p-2">
                          <Badge variant="outline" className="text-[10px]">{move.movement_type}</Badge>
                        </td>
                        <td className={`p-2 text-right font-medium ${move.quantity_delta < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                          {move.quantity_delta > 0 ? `+${move.quantity_delta}` : move.quantity_delta} {move.unit}
                        </td>
                        <td className="p-2 text-right font-medium">{move.stock_after} {move.unit}</td>
                        <td className="p-2 text-xs text-muted-foreground">{move.reason || '—'}</td>
                        <td className="p-2 text-right text-xs text-muted-foreground">
                          {new Date(move.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setViewingMovementsMaterial(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Subcomponent for product assignment row to handle variant overrides
function ProductAssignmentRow({
  product,
  profiles,
  onSaveProduct,
  onSaveVariant,
}: {
  product: ProductAssignment;
  profiles: Profile[];
  onSaveProduct: (productId: number | string, profileId: string | null, noPackaging: boolean) => Promise<void>;
  onSaveVariant: (variantId: number | string, profileId: string | null, noPackaging: boolean) => Promise<void>;
}) {
  const [selectedProfile, setSelectedProfile] = useState<string>(product.packaging_profile_id || '');
  const [noPackaging, setNoPackaging] = useState<boolean>(product.no_packaging);
  const [dirty, setDirty] = useState(false);

  return (
    <>
      <tr className="bg-card hover:bg-muted/20 font-medium">
        <td className="p-3">
          <div className="flex items-center gap-2">
            <span>{product.product_name}</span>
            {product.variants.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{product.variants.length} variants</Badge>
            )}
          </div>
        </td>
        <td className="p-3">
          <select
            disabled={noPackaging}
            value={selectedProfile}
            onChange={(e) => {
              setSelectedProfile(e.target.value);
              setDirty(true);
            }}
            className="w-full max-w-xs rounded-md border border-border bg-background p-1.5 text-xs"
          >
            <option value="">Default Serving Profile</option>
            {profiles.filter((p) => p.is_active).map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.serving_type})</option>
            ))}
          </select>
        </td>
        <td className="p-3 text-center">
          <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={noPackaging}
              onChange={(e) => {
                setNoPackaging(e.target.checked);
                setDirty(true);
              }}
            />
            <span>None</span>
          </label>
        </td>
        <td className="p-3 text-right">
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={async () => {
                await onSaveProduct(product.product_id, selectedProfile || null, noPackaging);
                setDirty(false);
              }}
            >
              <CheckCircle2 size={13} className="mr-1 text-emerald-500" /> Save
            </Button>
          )}
        </td>
      </tr>
      {/* Variant sub-rows */}
      {product.variants.map((variant) => (
        <VariantAssignmentRow
          key={variant.variant_id}
          variant={variant}
          profiles={profiles}
          onSaveVariant={onSaveVariant}
        />
      ))}
    </>
  );
}

function VariantAssignmentRow({
  variant,
  profiles,
  onSaveVariant,
}: {
  variant: {
    variant_id: number | string;
    variant_name: string;
    packaging_profile_id: string | null;
    no_packaging: boolean;
  };
  profiles: Profile[];
  onSaveVariant: (variantId: number | string, profileId: string | null, noPackaging: boolean) => Promise<void>;
}) {
  const [selectedProfile, setSelectedProfile] = useState<string>(variant.packaging_profile_id || '');
  const [noPackaging, setNoPackaging] = useState<boolean>(variant.no_packaging);
  const [dirty, setDirty] = useState(false);

  return (
    <tr className="bg-muted/10 hover:bg-muted/30 text-xs">
      <td className="p-3 pl-8 text-muted-foreground flex items-center gap-1.5">
        <span className="text-muted-foreground">↳</span>
        <span>{variant.variant_name}</span>
      </td>
      <td className="p-3">
        <select
          disabled={noPackaging}
          value={selectedProfile}
          onChange={(e) => {
            setSelectedProfile(e.target.value);
            setDirty(true);
          }}
          className="w-full max-w-xs rounded-md border border-border bg-background p-1.5 text-xs"
        >
          <option value="">Inherit Product Profile</option>
          {profiles.filter((p) => p.is_active).map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.serving_type})</option>
          ))}
        </select>
      </td>
      <td className="p-3 text-center">
        <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={noPackaging}
            onChange={(e) => {
              setNoPackaging(e.target.checked);
              setDirty(true);
            }}
          />
          <span>None</span>
        </label>
      </td>
      <td className="p-3 text-right">
        {dirty && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={async () => {
              await onSaveVariant(variant.variant_id, selectedProfile || null, noPackaging);
              setDirty(false);
            }}
          >
            <CheckCircle2 size={13} className="mr-1 text-emerald-500" /> Save
          </Button>
        )}
      </td>
    </tr>
  );
}
