'use client';

import { useState, useEffect } from 'react';
import {
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  RotateCw,
  Info,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export interface DeliveryPlatformConfig {
  provider: 'swiggy' | 'zomato' | 'sandbox';
  display_name: string;
  is_enabled: boolean;
  mode: 'sandbox' | 'live' | 'disconnected';
  api_key_configured: boolean;
  api_secret_configured: boolean;
  merchant_id: string | null;
  store_id: string | null;
  auto_accept_orders: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  notes: string | null;
}

export interface DeliveryMenuMapping {
  id: number;
  provider: 'swiggy' | 'zomato' | 'sandbox';
  external_item_id: string;
  external_variant_id: string | null;
  internal_product_id: string;
  internal_variant_id: string | null;
  external_name: string;
  product_name?: string;
  variant_name?: string | null;
  is_active: boolean;
  sync_status: string;
  last_synced_at: string | null;
}

export interface DeliveryWebhookEvent {
  id: number;
  event_id: string;
  provider: 'swiggy' | 'zomato' | 'sandbox';
  event_type: string;
  idempotency_key: string;
  status: 'received' | 'processed' | 'failed' | 'ignored';
  internal_order_id: number | null;
  external_order_id: string | null;
  retry_count: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

interface ProductOption {
  id: string;
  name: string;
  variants?: Array<{ id: string; name: string }>;
}

export function DeliveryIntegrationsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [configs, setConfigs] = useState<DeliveryPlatformConfig[]>([]);
  const [mappings, setMappings] = useState<DeliveryMenuMapping[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<DeliveryWebhookEvent[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Mapping Dialog State
  const [isMappingDialogOpen, setIsMappingDialogOpen] = useState<boolean>(false);
  const [mappingProvider, setMappingProvider] = useState<'swiggy' | 'zomato' | 'sandbox'>('swiggy');
  const [extItemId, setExtItemId] = useState<string>('');
  const [extVarId, setExtVarId] = useState<string>('');
  const [extName, setExtName] = useState<string>('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');

  // Simulator Dialog State
  const [isSimulatorOpen, setIsSimulatorOpen] = useState<boolean>(false);
  const [simProvider, setSimProvider] = useState<'swiggy' | 'zomato' | 'sandbox'>('sandbox');
  const [simExtOrderId, setSimExtOrderId] = useState<string>('SIM-10001');
  const [simAddress, setSimAddress] = useState<string>('Flat 402, Greenfield Apts, Indiranagar');
  const [simDeliveryCharge, setSimDeliveryCharge] = useState<string>('30');
  const [simMappingId, setSimMappingId] = useState<string>('');
  const [simQuantity, setSimQuantity] = useState<number>(1);
  const [simulating, setSimulating] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const [configsRes, mappingsRes, eventsRes, productsRes] = await Promise.all([
          api.get('/delivery/configs'),
          api.get('/delivery/mappings'),
          api.get('/delivery/webhooks/events?limit=20'),
          api.get('/products'),
        ]);
        if (!cancelled) {
          const rawProducts = productsRes.data;
          const productList: ProductOption[] = Array.isArray(rawProducts)
            ? rawProducts
            : Array.isArray(rawProducts?.products)
            ? rawProducts.products
            : [];
          setProducts(productList);

          const rawConfigs = configsRes.data;
          const configList: DeliveryPlatformConfig[] = Array.isArray(rawConfigs)
            ? rawConfigs
            : Array.isArray(rawConfigs?.configs)
            ? rawConfigs.configs
            : [];
          setConfigs(configList);

          const rawMappings = mappingsRes.data;
          const mappingList: DeliveryMenuMapping[] = Array.isArray(rawMappings)
            ? rawMappings
            : Array.isArray(rawMappings?.mappings)
            ? rawMappings.mappings
            : [];
          setMappings(mappingList);

          const rawEvents = eventsRes.data;
          const eventList: DeliveryWebhookEvent[] = Array.isArray(rawEvents)
            ? rawEvents
            : Array.isArray(rawEvents?.events)
            ? rawEvents.events
            : [];
          setWebhookEvents(eventList);

          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          toast.error('Failed to load delivery integration data');
          setLoading(false);
        }
      }
    }
    void fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const [configsRes, mappingsRes, eventsRes, productsRes] = await Promise.all([
        api.get('/delivery/configs'),
        api.get('/delivery/mappings'),
        api.get('/delivery/webhooks/events?limit=20'),
        api.get('/products'),
      ]);
      const rawProducts = productsRes.data;
      const productList: ProductOption[] = Array.isArray(rawProducts)
        ? rawProducts
        : Array.isArray(rawProducts?.products)
        ? rawProducts.products
        : [];
      setProducts(productList);

      const rawConfigs = configsRes.data;
      const configList: DeliveryPlatformConfig[] = Array.isArray(rawConfigs)
        ? rawConfigs
        : Array.isArray(rawConfigs?.configs)
        ? rawConfigs.configs
        : [];
      setConfigs(configList);

      const rawMappings = mappingsRes.data;
      const mappingList: DeliveryMenuMapping[] = Array.isArray(rawMappings)
        ? rawMappings
        : Array.isArray(rawMappings?.mappings)
        ? rawMappings.mappings
        : [];
      setMappings(mappingList);

      const rawEvents = eventsRes.data;
      const eventList: DeliveryWebhookEvent[] = Array.isArray(rawEvents)
        ? rawEvents
        : Array.isArray(rawEvents?.events)
        ? rawEvents.events
        : [];
      setWebhookEvents(eventList);
    } catch {
      toast.error('Failed to load delivery integration data');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEnable = async (config: DeliveryPlatformConfig) => {
    if (!isAdmin) return;
    try {
      const newEnabled = !config.is_enabled;
      await api.put(`/delivery/configs/${config.provider}`, {
        is_enabled: newEnabled,
      });
      toast.success(`${config.display_name} ${newEnabled ? 'enabled' : 'disabled'}`);
      void refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      toast.error(msg);
    }
  };

  const handleToggleAutoAccept = async (config: DeliveryPlatformConfig) => {
    if (!isAdmin) return;
    try {
      const newAuto = !config.auto_accept_orders;
      await api.put(`/delivery/configs/${config.provider}`, {
        auto_accept_orders: newAuto,
      });
      toast.success(`Auto-accept ${newAuto ? 'turned ON' : 'turned OFF'} for ${config.display_name}`);
      void refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      toast.error(msg);
    }
  };

  const handleCreateMapping = async () => {
    if (!extItemId.trim() || !extName.trim() || !selectedProductId) {
      toast.error('Please fill in external item ID, name, and choose an internal product');
      return;
    }
    try {
      await api.post('/delivery/mappings', {
        provider: mappingProvider,
        external_item_id: extItemId.trim(),
        external_variant_id: extVarId.trim() || null,
        external_name: extName.trim(),
        internal_product_id: selectedProductId,
        internal_variant_id: selectedVariantId || null,
        is_active: true,
      });
      toast.success('Menu mapping saved');
      setIsMappingDialogOpen(false);
      setExtItemId('');
      setExtVarId('');
      setExtName('');
      setSelectedProductId('');
      setSelectedVariantId('');
      void refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save menu mapping';
      toast.error(msg);
    }
  };

  const handleDeleteMapping = async (id: number) => {
    if (!isAdmin) return;
    try {
      await api.delete(`/delivery/mappings/${id}`);
      toast.success('Mapping removed');
      void refresh();
    } catch {
      toast.error('Failed to remove mapping');
    }
  };

  const handleSimulateOrder = async () => {
    if (!simExtOrderId.trim()) {
      toast.error('External order ID is required');
      return;
    }
    const safeMappings = Array.isArray(mappings) ? mappings : [];
    const mapping = safeMappings.find((m) => String(m.id) === simMappingId);
    if (!mapping) {
      toast.error('Please select an item from existing menu mappings');
      return;
    }

    setSimulating(true);
    try {
      const payload = {
        provider: simProvider,
        external_order_id: simExtOrderId.trim(),
        delivery_address: simAddress.trim(),
        delivery_charge: Number(simDeliveryCharge) || 0,
        items: [
          {
            external_item_id: mapping.external_item_id,
            external_variant_id: mapping.external_variant_id,
            external_name: mapping.external_name,
            quantity: Number(simQuantity) || 1,
          },
        ],
      };

      const res = await api.post('/delivery/sandbox/simulate-order', payload);
      const order = res.data?.order;
      toast.success(`Simulated order #${order?.order_number || ''} ingested successfully!`);
      setIsSimulatorOpen(false);
      setSimExtOrderId(`SIM-${Math.floor(10000 + Math.random() * 90000)}`);
      void refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Simulation failed';
      toast.error(msg);
    } finally {
      setSimulating(false);
    }
  };

  const handleRetryWebhook = async (eventId: number) => {
    try {
      await api.post(`/delivery/webhooks/events/${eventId}/retry`);
      toast.success('Webhook event reprocessed successfully');
      void refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retry failed';
      toast.error(msg);
    }
  };

  const safeProducts = Array.isArray(products) ? products : [];
  const safeMappings = Array.isArray(mappings) ? mappings : [];
  const safeConfigs = Array.isArray(configs) ? configs : [];
  const safeWebhookEvents = Array.isArray(webhookEvents) ? webhookEvents : [];

  const selectedProduct = safeProducts.find((p) => p.id === selectedProductId);

  return (
    <div className="space-y-6">
      {/* Top Banner: Stage 6A Status */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm space-y-1">
          <p className="font-semibold text-amber-600 dark:text-amber-400">
            Delivery Platform Integration – API-Ready Foundation (Stage 6A)
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Official partner API onboarding for Swiggy &amp; Zomato is pending. Live mode is strictly protected
            and cannot be activated without approved partner credentials. Use Sandbox mode to verify menu mappings,
            order ingestion, Stage 5 parcel packaging allocations, and kitchen display (KDS) flows.
          </p>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Delivery Platforms</h2>
          <p className="text-sm text-muted-foreground">
            Manage provider connections, external menu mappings, and simulated orders.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RotateCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setIsSimulatorOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Play className="h-4 w-4 mr-1.5" />
            Simulate Order
          </Button>
        </div>
      </div>

      {/* Platform Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {safeConfigs.map((config) => {
          const isSwiggy = config.provider === 'swiggy';
          const isZomato = config.provider === 'zomato';
          const isSandbox = config.provider === 'sandbox';

          return (
            <Card key={config.provider} className="relative overflow-hidden flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center font-bold text-white text-xs ${
                        isSwiggy ? 'bg-orange-500' : isZomato ? 'bg-red-600' : 'bg-slate-700'
                      }`}
                    >
                      {isSwiggy ? 'SW' : isZomato ? 'ZM' : 'SB'}
                    </div>
                    <div>
                      <CardTitle className="text-base">{config.display_name}</CardTitle>
                      <CardDescription className="text-xs">
                        {isSandbox ? 'Local Mock Simulator' : 'External Food Delivery'}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant={config.is_enabled ? 'default' : 'secondary'} className="text-[10px]">
                    {config.is_enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 text-xs">
                <div className="bg-muted/50 rounded-lg p-2.5 space-y-1.5 border border-border/50">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Mode:</span>
                    <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                      {config.mode}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">API Status:</span>
                    <span className="font-medium text-amber-500">
                      {isSandbox ? 'Sandbox Mock' : 'Official Access Pending'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Auto-Accept:</span>
                    <span className="font-medium">
                      {config.auto_accept_orders ? 'Yes (KDS Auto)' : 'No (Manual Accept)'}
                    </span>
                  </div>
                  {config.last_sync_at && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Last Sync:</span>
                      <span className="text-[11px]">
                        {(() => {
                          try {
                            const d = new Date(config.last_sync_at);
                            return isNaN(d.getTime()) ? String(config.last_sync_at) : d.toLocaleTimeString();
                          } catch {
                            return String(config.last_sync_at);
                          }
                        })()}
                      </span>
                    </div>
                  )}
                </div>

                {isAdmin && (
                  <div className="flex items-center justify-between pt-1 border-t border-border/40">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleEnable(config)}
                      className="text-xs h-7 px-2"
                    >
                      {config.is_enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleAutoAccept(config)}
                      className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                    >
                      {config.auto_accept_orders ? 'Disable Auto-Accept' : 'Enable Auto-Accept'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Menu Mappings Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              External Menu Mappings
            </CardTitle>
            <CardDescription className="text-xs">
              Link external platform item IDs to internal POS products and variants.
            </CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setIsMappingDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Mapping
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {safeMappings.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm space-y-2">
              <Info className="h-6 w-6 mx-auto opacity-50" />
              <p>No menu mappings configured yet.</p>
              <p className="text-xs">Map external delivery items so incoming orders match your POS recipes and inventory.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="pb-2 font-medium">Provider</th>
                    <th className="pb-2 font-medium">External Item ID</th>
                    <th className="pb-2 font-medium">External Name</th>
                    <th className="pb-2 font-medium">Internal POS Product</th>
                    <th className="pb-2 font-medium">Status</th>
                    {isAdmin && <th className="pb-2 font-medium text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {safeMappings.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30">
                      <td className="py-2.5 font-medium uppercase text-[11px]">{m.provider}</td>
                      <td className="py-2.5 font-mono text-[11px] text-muted-foreground">
                        {m.external_item_id}
                        {m.external_variant_id ? ` (var: ${m.external_variant_id})` : ''}
                      </td>
                      <td className="py-2.5 font-medium">{m.external_name}</td>
                      <td className="py-2.5">
                        <span className="font-semibold">{m.product_name || m.internal_product_id}</span>
                        {m.variant_name && (
                          <span className="ml-1 text-muted-foreground font-normal">
                            ({m.variant_name})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                          Mapped
                        </Badge>
                      </td>
                      {isAdmin && (
                        <td className="py-2.5 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteMapping(m.id)}
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Webhook Event Audit Log */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Webhook Event Audit Log
            </CardTitle>
            <CardDescription className="text-xs">
              Idempotent webhook requests received from delivery platforms.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} className="text-xs">
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh Log
          </Button>
        </CardHeader>
        <CardContent>
          {safeWebhookEvents.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-xs">
              No webhook events recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="pb-2 font-medium">Time</th>
                    <th className="pb-2 font-medium">Provider</th>
                    <th className="pb-2 font-medium">Event Type</th>
                    <th className="pb-2 font-medium">External Order ID</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Error / Details</th>
                    {isAdmin && <th className="pb-2 font-medium text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {safeWebhookEvents.map((evt) => (
                    <tr key={evt.id} className="hover:bg-muted/30">
                      <td className="py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                        {(() => {
                          try {
                            const d = new Date(evt.created_at);
                            return isNaN(d.getTime()) ? String(evt.created_at) : d.toLocaleTimeString();
                          } catch {
                            return String(evt.created_at);
                          }
                        })()}
                      </td>
                      <td className="py-2 uppercase font-medium text-[11px]">{evt.provider}</td>
                      <td className="py-2 font-mono text-[11px]">{evt.event_type}</td>
                      <td className="py-2 font-mono text-[11px]">{evt.external_order_id || '–'}</td>
                      <td className="py-2">
                        <Badge
                          variant={
                            evt.status === 'processed'
                              ? 'default'
                              : evt.status === 'failed'
                              ? 'destructive'
                              : 'secondary'
                          }
                          className="text-[10px]"
                        >
                          {evt.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-muted-foreground max-w-[200px] truncate text-[11px]">
                        {evt.last_error || 'Successfully processed'}
                      </td>
                      {isAdmin && (
                        <td className="py-2 text-right">
                          {evt.status === 'failed' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRetryWebhook(evt.id)}
                              className="h-6 text-[11px] px-2"
                            >
                              Retry
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Menu Mapping Modal */}
      <Dialog open={isMappingDialogOpen} onOpenChange={setIsMappingDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Add External Menu Mapping</DialogTitle>
            <DialogDescription className="text-xs">
              Link an external platform menu item to your internal FloCafe product.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery Provider</Label>
              <select
                value={mappingProvider}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'swiggy' || val === 'zomato' || val === 'sandbox') {
                    setMappingProvider(val);
                  }
                }}
                className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs"
              >
                <option value="swiggy">Swiggy</option>
                <option value="zomato">Zomato</option>
                <option value="sandbox">Sandbox Simulator</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">External Item ID</Label>
              <Input
                placeholder="e.g. SWIGGY-ITM-101"
                value={extItemId}
                onChange={(e) => setExtItemId(e.target.value)}
                className="text-xs h-8"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">External Item Name</Label>
              <Input
                placeholder="e.g. Classic Blueberry Pancakes"
                value={extName}
                onChange={(e) => setExtName(e.target.value)}
                className="text-xs h-8"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">External Variant ID (Optional)</Label>
              <Input
                placeholder="e.g. VAR-LRG"
                value={extVarId}
                onChange={(e) => setExtVarId(e.target.value)}
                className="text-xs h-8"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Internal POS Product</Label>
              <select
                value={selectedProductId}
                onChange={(e) => {
                  setSelectedProductId(e.target.value);
                  setSelectedVariantId('');
                }}
                className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs"
              >
                <option value="">Select a product...</option>
                {safeProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedProduct?.variants && selectedProduct.variants.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Internal Variant (Optional)</Label>
                <select
                  value={selectedVariantId}
                  onChange={(e) => setSelectedVariantId(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs"
                >
                  <option value="">Default (No specific variant)</option>
                  {selectedProduct.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsMappingDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateMapping}>
              Save Mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sandbox Simulator Modal */}
      <Dialog open={isSimulatorOpen} onOpenChange={setIsSimulatorOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Play className="h-4 w-4 text-emerald-500" />
              Simulate Delivery Order
            </DialogTitle>
            <DialogDescription className="text-xs">
              Simulate an incoming delivery order to verify POS ingestion, parcel packaging, and KDS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Platform</Label>
                <select
                  value={simProvider}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'swiggy' || val === 'zomato' || val === 'sandbox') {
                      setSimProvider(val);
                    }
                  }}
                  className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs"
                >
                  <option value="sandbox">Sandbox Mock</option>
                  <option value="swiggy">Swiggy Mock</option>
                  <option value="zomato">Zomato Mock</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">External Order ID</Label>
                <Input
                  value={simExtOrderId}
                  onChange={(e) => setSimExtOrderId(e.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Select Mapped Item</Label>
              <select
                value={simMappingId}
                onChange={(e) => setSimMappingId(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs"
              >
                <option value="">Select an item...</option>
                {safeMappings.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    [{m.provider.toUpperCase()}] {m.external_name} → {m.product_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min="1"
                  value={simQuantity}
                  onChange={(e) => setSimQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="text-xs h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Delivery Fee (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={simDeliveryCharge}
                  onChange={(e) => setSimDeliveryCharge(e.target.value)}
                  className="text-xs h-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Delivery Address</Label>
              <Input
                value={simAddress}
                onChange={(e) => setSimAddress(e.target.value)}
                className="text-xs h-8"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsSimulatorOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSimulateOrder}
              disabled={simulating}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {simulating ? 'Ingesting...' : 'Ingest Simulated Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
