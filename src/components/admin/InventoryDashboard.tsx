import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, AlertTriangle, Download, Package, BarChart3, Calendar, ArrowRightLeft, Zap, ChevronRight, UtensilsCrossed, Camera, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format, subDays, differenceInDays, addDays } from 'date-fns';
import { Label } from '@/components/ui/label';

const UNITS = ['grams', 'ml', 'pcs', 'kg', 'liters', 'bottles', 'cans', 'slices'];
const DEPARTMENTS = ['kitchen', 'bar', 'gardens', 'housekeeping'] as const;
type Department = typeof DEPARTMENTS[number];

const DEPT_LABELS: Record<string, string> = {
  kitchen: 'Kitchen',
  bar: 'Bar',
  gardens: 'Gardens',
  housekeeping: 'Housekeeping',
};

const DEPT_ICONS: Record<string, string> = {
  kitchen: '🍳',
  bar: '🍸',
  gardens: '🌿',
  housekeeping: '🏨',
};

const DEPT_GRADIENT: Record<string, string> = {
  kitchen: 'from-orange-500 to-orange-700',
  bar: 'from-purple-500 to-purple-700',
  gardens: 'from-emerald-500 to-emerald-700',
  housekeeping: 'from-blue-500 to-blue-700',
};

const BUFFER_DAYS_DEFAULT = 3;

interface BurnInfo {
  dailyRate: number;
  daysRemaining: number | null;
  suggestedThreshold: number;
  reorderQty: number;
}

const computeStockPct = (ing: any, burn: any): number => {
  if (ing.current_stock <= 0) return 0;
  if (burn?.daysRemaining !== null && burn?.daysRemaining !== undefined && burn.dailyRate > 0) {
    return Math.min(100, Math.max(5, Math.round((burn.daysRemaining / 14) * 100)));
  }
  if (ing.low_stock_threshold > 0) {
    const ratio = ing.current_stock / ing.low_stock_threshold;
    if (ratio < 1) return Math.round(ratio * 25);
    if (ratio < 2) return Math.round(25 + (ratio - 1) * 25);
    return Math.min(100, Math.round(50 + (ratio - 2) * 10));
  }
  return 75;
};

const getInitials = (name: string) =>
  name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

const InventoryDashboard = ({ readOnly = false }: { readOnly?: boolean }) => {
  const qc = useQueryClient();
  const [selectedDept, setSelectedDept] = useState<Department | 'all'>('all');

  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => {
      const { data } = await supabase.from('ingredients').select('*').order('name');
      return data || [];
    },
  });

  const { data: recipeLinks = [] } = useQuery({
    queryKey: ['recipe_ingredients_with_menu'],
    queryFn: async () => {
      const { data } = await supabase
        .from('recipe_ingredients')
        .select('ingredient_id, menu_item_id, quantity, menu_items(name)');
      return data || [];
    },
  });

  const { data: burnLogs = [] } = useQuery({
    queryKey: ['burn-rate-logs'],
    queryFn: async () => {
      const since = subDays(new Date(), 14).toISOString();
      const { data } = await supabase
        .from('inventory_logs')
        .select('ingredient_id, change_qty, created_at')
        .eq('reason', 'order_deduction')
        .gte('created_at', since);
      return data || [];
    },
  });

  const [logDays, setLogDays] = useState(7);
  const { data: consumptionLogs = [] } = useQuery({
    queryKey: ['consumption-logs', logDays],
    queryFn: async () => {
      const since = subDays(new Date(), logDays).toISOString();
      const { data } = await supabase
        .from('inventory_logs')
        .select('*, ingredients(name, unit, department)')
        .eq('reason', 'order_deduction')
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      return data || [];
    },
  });

  const burnMap = useMemo(() => {
    const map: Record<string, BurnInfo> = {};
    if (burnLogs.length === 0) return map;

    const dates = burnLogs.map((l: any) => new Date(l.created_at));
    const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
    const now = new Date();
    const daySpan = Math.max(1, differenceInDays(now, earliest));

    const totals: Record<string, number> = {};
    burnLogs.forEach((l: any) => {
      const id = l.ingredient_id;
      totals[id] = (totals[id] || 0) + Math.abs(l.change_qty);
    });

    for (const [id, totalUsed] of Object.entries(totals)) {
      const dailyRate = totalUsed / daySpan;
      const ing = ingredients.find((i: any) => i.id === id);
      const currentStock = ing ? (ing as any).current_stock : 0;
      const daysRemaining = dailyRate > 0 ? currentStock / dailyRate : null;
      const suggestedThreshold = Math.ceil(dailyRate * BUFFER_DAYS_DEFAULT);
      const reorderQty = Math.max(0, Math.ceil((BUFFER_DAYS_DEFAULT * dailyRate) - currentStock));
      map[id] = { dailyRate, daysRemaining, suggestedThreshold, reorderQty };
    }

    return map;
  }, [burnLogs, ingredients]);

  const usageMap: Record<string, { dishName: string; quantity: number }[]> = {};
  recipeLinks.forEach((rl: any) => {
    const dishName = rl.menu_items?.name || 'Unknown';
    if (!usageMap[rl.ingredient_id]) usageMap[rl.ingredient_id] = [];
    usageMap[rl.ingredient_id].push({ dishName, quantity: rl.quantity });
  });

  const deptIngredients = selectedDept === 'all'
    ? ingredients
    : ingredients.filter((i: any) => i.department === selectedDept);

  const totalValue = deptIngredients.reduce((sum: number, i: any) => sum + (i.current_stock * i.cost_per_unit), 0);
  const missingCostCount = deptIngredients.filter((i: any) => i.cost_per_unit === 0).length;
  const outOfStockCount = deptIngredients.filter((i: any) => i.current_stock <= 0).length;

  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [editIng, setEditIng] = useState<any>(null);
  const [form, setForm] = useState({
    name: '', unit: 'grams', cost_per_unit: '', current_stock: '', low_stock_threshold: '',
    department: 'kitchen' as Department,
  });

  const [showTransfer, setShowTransfer] = useState(false);
  const [transfer, setTransfer] = useState({
    fromDept: '' as string, toDept: '' as string, ingredientId: '', quantity: '', reason: '',
  });

  const [bufferDays, setBufferDays] = useState(BUFFER_DAYS_DEFAULT);

  const openNew = () => {
    setEditIng('new');
    setForm({
      name: '', unit: 'grams', cost_per_unit: '', current_stock: '', low_stock_threshold: '',
      department: (selectedDept === 'all' ? 'kitchen' : selectedDept) as Department,
    });
  };

  const openEdit = (ing: any) => {
    setEditIng(ing);
    setForm({
      name: ing.name,
      unit: ing.unit,
      cost_per_unit: String(ing.cost_per_unit),
      current_stock: String(ing.current_stock),
      low_stock_threshold: String(ing.low_stock_threshold),
      department: ing.department || 'kitchen',
    });
  };

  const save = async () => {
    const payload = {
      name: form.name.trim(),
      unit: form.unit,
      cost_per_unit: parseFloat(form.cost_per_unit) || 0,
      current_stock: parseFloat(form.current_stock) || 0,
      low_stock_threshold: parseFloat(form.low_stock_threshold) || 0,
      department: form.department,
    };
    if (!payload.name) return;

    if (editIng === 'new') {
      await supabase.from('ingredients').insert(payload);
    } else {
      const oldStock = editIng.current_stock;
      if (payload.current_stock !== oldStock) {
        await supabase.from('inventory_logs').insert({
          ingredient_id: editIng.id,
          change_qty: payload.current_stock - oldStock,
          reason: 'manual_adjustment',
          department: payload.department,
        });
      }
      await supabase.from('ingredients').update(payload).eq('id', editIng.id);
    }
    setEditIng(null);
    qc.invalidateQueries({ queryKey: ['ingredients'] });
    toast.success('Ingredient saved');
  };

  const deleteIng = async (id: string) => {
    await supabase.from('ingredients').delete().eq('id', id);
    setEditIng(null);
    qc.invalidateQueries({ queryKey: ['ingredients'] });
    toast.success('Ingredient deleted');
  };

  const getUrgency = (ing: any): { level: 'critical' | 'warning' | 'ok'; daysLeft: number | null; dailyRate: number } => {
    const burn = burnMap[ing.id];
    if (burn && burn.daysRemaining !== null) {
      if (ing.current_stock <= 0) return { level: 'critical', daysLeft: 0, dailyRate: burn.dailyRate };
      if (burn.daysRemaining < 2) return { level: 'critical', daysLeft: burn.daysRemaining, dailyRate: burn.dailyRate };
      if (burn.daysRemaining < 5) return { level: 'warning', daysLeft: burn.daysRemaining, dailyRate: burn.dailyRate };
      return { level: 'ok', daysLeft: burn.daysRemaining, dailyRate: burn.dailyRate };
    }
    if (ing.current_stock <= 0) return { level: 'critical', daysLeft: null, dailyRate: 0 };
    if (ing.low_stock_threshold > 0 && ing.current_stock < ing.low_stock_threshold) {
      return { level: 'warning', daysLeft: null, dailyRate: 0 };
    }
    return { level: 'ok', daysLeft: null, dailyRate: 0 };
  };

  const urgentItems = useMemo(() => {
    return deptIngredients
      .map((ing: any) => ({ ing, urgency: getUrgency(ing) }))
      .filter(({ urgency }) => urgency.level !== 'ok')
      .sort((a, b) => {
        if (a.urgency.level !== b.urgency.level) return a.urgency.level === 'critical' ? -1 : 1;
        const aDays = a.urgency.daysLeft ?? 999;
        const bDays = b.urgency.daysLeft ?? 999;
        return aDays - bDays;
      });
  }, [deptIngredients, burnMap]);

  const filtered = deptIngredients.filter((i: any) => {
    if (search.trim() && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (unitFilter !== 'all' && i.unit !== unitFilter) return false;
    if (stockFilter === 'low') { if (getUrgency(i).level === 'ok') return false; }
    if (stockFilter === 'out' && i.current_stock > 0) return false;
    return true;
  });

  const downloadCSV = () => {
    let csv = 'Name,Department,Unit,Cost Per Unit,Current Stock,Low Stock Threshold,Daily Burn Rate,Days Remaining,Status\n';
    deptIngredients.forEach((i: any) => {
      const u = getUrgency(i);
      const status = u.level === 'critical' ? 'CRITICAL' : u.level === 'warning' ? 'LOW' : 'OK';
      const daysLeft = u.daysLeft !== null ? u.daysLeft.toFixed(1) : 'N/A';
      csv += `"${i.name}","${i.department || 'kitchen'}","${i.unit}",${i.cost_per_unit},${i.current_stock},${i.low_stock_threshold},${u.dailyRate.toFixed(2)},${daysLeft},${status}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-${selectedDept}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const editIngUsage = editIng && editIng !== 'new' ? (usageMap[editIng.id] || []) : [];

  const autoSetThresholds = async () => {
    const updates: { id: string; threshold: number }[] = [];
    for (const ing of deptIngredients as any[]) {
      const burn = burnMap[ing.id];
      if (burn && burn.dailyRate > 0) {
        const newThreshold = Math.ceil(burn.dailyRate * bufferDays);
        if (newThreshold !== ing.low_stock_threshold) updates.push({ id: ing.id, threshold: newThreshold });
      }
    }
    if (updates.length === 0) {
      toast.info('No threshold changes needed — no consumption data for these ingredients');
      return;
    }
    for (const u of updates) {
      await supabase.from('ingredients').update({ low_stock_threshold: u.threshold }).eq('id', u.id);
    }
    qc.invalidateQueries({ queryKey: ['ingredients'] });
    toast.success(`Updated thresholds for ${updates.length} ingredients (${bufferDays}-day buffer)`);
  };

  const filteredLogs = selectedDept === 'all'
    ? consumptionLogs
    : consumptionLogs.filter((log: any) => log.department === selectedDept || log.ingredients?.department === selectedDept);

  const logsByDate: Record<string, Record<string, { name: string; total: number; unit: string }>> = {};
  filteredLogs.forEach((log: any) => {
    const date = format(new Date(log.created_at), 'yyyy-MM-dd');
    const ingName = log.ingredients?.name || 'Unknown';
    const ingUnit = log.ingredients?.unit || '';
    if (!logsByDate[date]) logsByDate[date] = {};
    if (!logsByDate[date][ingName]) logsByDate[date][ingName] = { name: ingName, total: 0, unit: ingUnit };
    logsByDate[date][ingName].total += Math.abs(log.change_qty);
  });

  const transferIngredients = transfer.fromDept
    ? ingredients.filter((i: any) => i.department === transfer.fromDept)
    : [];

  const executeTransfer = async () => {
    const qty = parseFloat(transfer.quantity);
    if (!transfer.fromDept || !transfer.toDept || !transfer.ingredientId || !qty || qty <= 0) {
      toast.error('Please fill all transfer fields');
      return;
    }
    if (transfer.fromDept === transfer.toDept) {
      toast.error('Source and destination must be different');
      return;
    }
    const sourceIng = ingredients.find((i: any) => i.id === transfer.ingredientId);
    if (!sourceIng) return;
    if (qty > (sourceIng as any).current_stock) {
      toast.error('Insufficient stock to transfer');
      return;
    }

    await supabase.from('ingredients').update({
      current_stock: (sourceIng as any).current_stock - qty,
    }).eq('id', sourceIng.id);

    const { data: existing } = await supabase
      .from('ingredients')
      .select('*')
      .eq('name', (sourceIng as any).name)
      .eq('department', transfer.toDept)
      .maybeSingle();

    if (existing) {
      await supabase.from('ingredients').update({
        current_stock: existing.current_stock + qty,
      }).eq('id', existing.id);
    } else {
      await supabase.from('ingredients').insert({
        name: (sourceIng as any).name,
        unit: (sourceIng as any).unit,
        cost_per_unit: (sourceIng as any).cost_per_unit,
        current_stock: qty,
        low_stock_threshold: 0,
        department: transfer.toDept,
      });
    }

    const reason = transfer.reason ? `transfer: ${transfer.reason}` : 'transfer';
    await supabase.from('inventory_logs').insert([
      { ingredient_id: sourceIng.id, change_qty: -qty, reason, department: transfer.fromDept },
      { ingredient_id: existing?.id || sourceIng.id, change_qty: qty, reason, department: transfer.toDept },
    ]);

    setShowTransfer(false);
    setTransfer({ fromDept: '', toDept: '', ingredientId: '', quantity: '', reason: '' });
    qc.invalidateQueries({ queryKey: ['ingredients'] });
    toast.success(`Transferred ${qty} ${(sourceIng as any).unit} of ${(sourceIng as any).name}`);
  };

  const formatDays = (days: number | null) => {
    if (days === null) return null;
    if (days <= 0) return '0d';
    if (days < 1) return `${Math.round(days * 24)}h`;
    return `~${Math.round(days)}d`;
  };

  return (
    <div className="space-y-4">
      {/* Department chip selector */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedDept('all')}
          className={`px-3 py-1.5 rounded-full font-body text-xs border transition-all min-h-[32px] ${
            selectedDept === 'all'
              ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_12px_-3px_hsl(var(--gold)/0.5)]'
              : 'bg-secondary/50 text-foreground border-border/50 hover:border-gold/30'
          }`}
        >
          All Departments
        </button>
        {DEPARTMENTS.map(dept => (
          <button
            key={dept}
            onClick={() => setSelectedDept(dept)}
            className={`px-3 py-1.5 rounded-full font-body text-xs border transition-all min-h-[32px] flex items-center gap-1.5 ${
              selectedDept === dept
                ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_12px_-3px_hsl(var(--gold)/0.5)]'
                : 'bg-secondary/50 text-foreground border-border/50 hover:border-gold/30'
            }`}
          >
            <span>{DEPT_ICONS[dept]}</span>
            {DEPT_LABELS[dept]}
          </button>
        ))}
      </div>

      <Tabs defaultValue="stock" className="w-full">
        <TabsList className="w-full bg-secondary/50 border border-border/40 rounded-xl p-1 h-auto mb-4">
          <TabsTrigger value="stock"
            className="flex-1 font-body text-xs tracking-wider rounded-lg py-2 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:border data-[state=active]:border-border/60 data-[state=active]:shadow-sm">
            <Package className="w-3.5 h-3.5 mr-1.5" /> Stock
          </TabsTrigger>
          <TabsTrigger value="consumption"
            className="flex-1 font-body text-xs tracking-wider rounded-lg py-2 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:border data-[state=active]:border-border/60 data-[state=active]:shadow-sm">
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Usage Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-3">
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-border/60 bg-card/50 p-3 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-1">
                <p className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Value</p>
                <svg width="40" height="18" viewBox="0 0 80 36" className="opacity-40">
                  <polyline
                    points="0,30 10,24 20,28 30,16 40,20 50,11 60,15 70,8 80,4"
                    fill="none" stroke="hsl(var(--gold))" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="font-display text-lg text-foreground leading-none">₱{totalValue.toLocaleString()}</p>
              <p className="font-body text-[9px] text-muted-foreground mt-1">inventory value</p>
            </div>

            <button
              onClick={() => setStockFilter(stockFilter === 'out' ? 'all' : 'out')}
              className={`rounded-2xl border p-3 text-left transition-all backdrop-blur-sm ${
                outOfStockCount > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-border/60 bg-card/50'
              }`}
            >
              <p className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">Out of Stock</p>
              <p className={`font-display text-lg leading-none ${outOfStockCount > 0 ? 'text-red-400' : 'text-foreground'}`}>
                {outOfStockCount}
              </p>
              <p className="font-body text-[9px] text-muted-foreground mt-1">
                {outOfStockCount === 0 ? 'No items' : 'items'}
              </p>
            </button>

            <button
              onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
              className={`rounded-2xl border p-3 text-left transition-all backdrop-blur-sm ${
                urgentItems.length > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-border/60 bg-card/50'
              }`}
            >
              <p className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">Needs Attention</p>
              <p className={`font-display text-lg leading-none ${urgentItems.length > 0 ? 'text-amber-400' : 'text-foreground'}`}>
                {urgentItems.length}
              </p>
              <p className="font-body text-[9px] text-muted-foreground mt-1">
                {urgentItems.length === 0 ? 'No items' : 'need reorder'}
              </p>
            </button>
          </div>

          {/* Missing cost alert */}
          {missingCostCount > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <p className="font-body text-xs text-foreground/80">
                {missingCostCount} ingredient{missingCostCount !== 1 ? 's' : ''} missing cost — food costing inaccurate
              </p>
            </div>
          )}

          {/* Reorder alerts */}
          {urgentItems.length > 0 && stockFilter === 'all' && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <span className="font-body text-[10px] tracking-[0.25em] uppercase text-red-400">
                  Reorder Alerts{selectedDept !== 'all' ? ` · ${DEPT_LABELS[selectedDept]}` : ''}
                </span>
              </div>
              {urgentItems.slice(0, 8).map(({ ing, urgency }) => {
                const burn = burnMap[ing.id];
                return (
                  <div key={ing.id} className={`flex items-center justify-between gap-2 p-2.5 rounded-xl ${
                    urgency.level === 'critical' ? 'bg-red-500/10' : 'bg-amber-500/10'
                  }`}>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${urgency.level === 'critical' ? 'bg-red-400' : 'bg-amber-400'}`} />
                      <div className="min-w-0">
                        <p className="font-body text-xs text-foreground truncate">{ing.name}</p>
                        <p className="font-body text-[10px] text-muted-foreground">
                          {ing.current_stock} {ing.unit}
                          {urgency.dailyRate > 0 && ` · ${urgency.dailyRate.toFixed(1)}/day`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`font-body text-[10px] px-2 py-0.5 rounded-full border ${
                        urgency.level === 'critical'
                          ? 'border-red-500/40 text-red-400 bg-red-500/10'
                          : 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                      }`}>
                        {urgency.daysLeft !== null
                          ? `${formatDays(urgency.daysLeft)} left`
                          : ing.current_stock <= 0 ? 'OUT' : 'LOW'}
                      </span>
                      {burn && burn.reorderQty > 0 && (
                        <p className="font-body text-[10px] text-muted-foreground mt-0.5">
                          Order: {burn.reorderQty} {ing.unit}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {urgentItems.length > 8 && (
                <p className="font-body text-[10px] text-muted-foreground text-center pt-1">
                  +{urgentItems.length - 8} more · tap "Attention" to see all
                </p>
              )}
            </div>
          )}

          {/* Smart thresholds */}
          {!readOnly && (
            <div className="rounded-2xl border border-border/60 bg-card/50 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-lg bg-gold/15 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-gold" />
                </div>
                <span className="font-body text-xs tracking-[0.2em] uppercase text-foreground">Smart Thresholds</span>
              </div>
              <p className="font-body text-[10px] text-muted-foreground mb-3">
                Auto-set low-stock alerts from actual consumption. Buffer = days of stock to keep.
              </p>
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  {[2, 3, 5, 7].map(d => (
                    <button key={d} onClick={() => setBufferDays(d)}
                      className={`px-2.5 py-1 rounded-lg font-body text-xs border transition-all ${
                        bufferDays === d
                          ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_8px_-2px_hsl(var(--gold)/0.4)]'
                          : 'bg-secondary/50 text-foreground border-border/50 hover:border-gold/30'
                      }`}>
                      {d}d
                    </button>
                  ))}
                </div>
                <button onClick={autoSetThresholds}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gold/30 bg-gold/10 text-gold font-body text-xs hover:bg-gold/15 transition-colors">
                  <Zap className="w-3 h-3" /> Apply
                </button>
              </div>
            </div>
          )}

          {/* Search + filter */}
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search ingredients..."
              className="bg-card/50 border-border/60 text-foreground font-body rounded-xl flex-1 backdrop-blur-sm"
            />
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="bg-card/50 border-border/60 text-foreground font-body w-24 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all" className="font-body text-foreground">All units</SelectItem>
                {UNITS.map(u => (
                  <SelectItem key={u} value={u} className="font-body text-foreground">{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button onClick={downloadCSV}
              className="w-10 h-10 rounded-xl border border-border/60 bg-card/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-gold/30 transition-colors shrink-0">
              <Download className="w-4 h-4" />
            </button>
          </div>

          {/* Add + Transfer */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={openNew}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gold/30 bg-gold/10 text-gold font-body text-xs tracking-wider hover:bg-gold/15 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Ingredient
            </button>
            <button onClick={() => setShowTransfer(true)}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/60 bg-card/50 text-foreground font-body text-xs tracking-wider hover:border-gold/30 transition-colors">
              <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer Stock
            </button>
          </div>

          {/* Ingredient list */}
          <div className="space-y-2">
            {filtered.map((ing: any) => {
              const urgency = getUrgency(ing);
              const isOut = ing.current_stock <= 0;
              const burn = burnMap[ing.id];
              const stockPct = computeStockPct(ing, burn);
              const daysLabel = formatDays(urgency.daysLeft);
              const dishCount = (usageMap[ing.id] || []).length;
              const dept = ing.department || 'kitchen';
              const gradient = DEPT_GRADIENT[dept] || DEPT_GRADIENT.kitchen;

              const healthLabel = isOut ? 'Out of Stock'
                : urgency.level === 'critical' ? 'Critical'
                : urgency.level === 'warning' ? 'Low Stock'
                : 'Healthy';
              const healthColor = isOut || urgency.level === 'critical' ? 'text-red-400'
                : urgency.level === 'warning' ? 'text-amber-400'
                : 'text-emerald-400';
              const healthDot = isOut || urgency.level === 'critical' ? 'bg-red-400'
                : urgency.level === 'warning' ? 'bg-amber-400'
                : 'bg-emerald-400';
              const barColor = isOut || urgency.level === 'critical' ? 'bg-red-500'
                : urgency.level === 'warning' ? 'bg-amber-500'
                : 'bg-emerald-500';

              return (
                <button key={ing.id} onClick={() => openEdit(ing)}
                  className="w-full text-left rounded-2xl border border-border/50 bg-card/40 p-3 hover:border-gold/40 hover:bg-card/60 transition-all backdrop-blur-sm">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-sm`}>
                      <span className="font-body text-xs text-white font-bold">{getInitials(ing.name)}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="font-body text-sm text-foreground truncate">{ing.name}</p>
                        <span className={`flex items-center gap-1 text-[10px] font-body shrink-0 ${healthColor}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${healthDot}`} />
                          {healthLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="font-body text-[10px] text-muted-foreground">
                          {DEPT_ICONS[dept]} {DEPT_LABELS[dept]}
                        </span>
                        {dishCount > 0 && (
                          <span className="font-body text-[10px] text-muted-foreground">
                            · {dishCount} {dishCount === 1 ? 'dish' : 'dishes'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 rounded-full bg-secondary/70 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${stockPct}%` }} />
                        </div>
                        <span className="font-body text-[10px] text-muted-foreground shrink-0">{stockPct}%</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0 flex items-center gap-1.5">
                      <div>
                        <p className="font-body text-sm text-foreground">
                          {ing.current_stock.toLocaleString()} <span className="text-[10px] text-muted-foreground">{ing.unit}</span>
                        </p>
                        <p className="font-body text-[10px] text-muted-foreground">
                          {ing.cost_per_unit > 0 ? `₱${ing.cost_per_unit}/${ing.unit}` : '₱—'}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <Package className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="font-body text-sm text-muted-foreground">No ingredients found</p>
            </div>
          )}
        </TabsContent>

        {/* CONSUMPTION LOG TAB */}
        <TabsContent value="consumption" className="space-y-3">
          <div className="flex gap-2">
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => setLogDays(d)}
                className={`flex-1 py-2 rounded-xl border font-body text-xs tracking-wider transition-all ${
                  logDays === d
                    ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_8px_-2px_hsl(var(--gold)/0.4)]'
                    : 'bg-card/50 border-border/50 text-foreground hover:border-gold/30'
                }`}>
                {d}d
              </button>
            ))}
          </div>

          {Object.keys(logsByDate).length === 0 ? (
            <div className="py-12 text-center">
              <BarChart3 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="font-body text-sm text-muted-foreground">No consumption data yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(logsByDate)
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([date, ings]) => (
                  <div key={date} className="rounded-2xl border border-border/50 bg-card/40 p-3 backdrop-blur-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="w-3.5 h-3.5 text-gold/60" />
                      <span className="font-body text-xs tracking-wider text-foreground">
                        {format(new Date(date), 'MMM d, yyyy')}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {Object.values(ings)
                        .sort((a, b) => b.total - a.total)
                        .map((ing, idx) => (
                          <div key={idx} className="flex justify-between items-center">
                            <span className="font-body text-xs text-foreground/80">{ing.name}</span>
                            <span className="font-body text-xs text-muted-foreground">-{ing.total} {ing.unit}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit / New Ingredient Dialog */}
      <Dialog open={!!editIng} onOpenChange={() => setEditIng(null)}>
        <DialogContent className="bg-card border-border/60 max-w-sm max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-body text-sm tracking-[0.2em] uppercase text-foreground text-center">
              {editIng === 'new' ? 'Add Ingredient' : 'Edit Ingredient'}
            </DialogTitle>
          </DialogHeader>

          {/* Circular avatar with camera */}
          <div className="flex justify-center pb-2">
            <div className="relative">
              <div className={`w-24 h-24 rounded-full bg-gradient-to-br ${
                DEPT_GRADIENT[form.department] || DEPT_GRADIENT.kitchen
              } flex items-center justify-center border-4 border-card shadow-lg`}>
                <span className="font-body text-xl text-white font-bold">
                  {form.name ? getInitials(form.name) : '?'}
                </span>
              </div>
              <div className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-card border border-border/60 flex items-center justify-center shadow-sm">
                <Camera className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {/* Basic Information section */}
            <div>
              <p className="font-body text-[10px] tracking-[0.25em] uppercase text-muted-foreground mb-3">Basic Information</p>
              <div className="space-y-3">
                <div>
                  <label className="font-body text-[10px] text-muted-foreground">Ingredient Name</label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ingredient name"
                    className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl mt-1"
                  />
                </div>

                {/* Department */}
                <div>
                  <label className="font-body text-[10px] text-muted-foreground mb-2 block">Department</label>
                  <div className="flex flex-wrap gap-1.5">
                    {DEPARTMENTS.map(dept => (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, department: dept }))}
                        className={`px-2.5 py-1.5 rounded-lg font-body text-xs border transition-all flex items-center gap-1 ${
                          form.department === dept
                            ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_8px_-2px_hsl(var(--gold)/0.4)]'
                            : 'bg-secondary/50 text-foreground border-border/50 hover:border-gold/30'
                        }`}
                      >
                        {DEPT_ICONS[dept]} {DEPT_LABELS[dept]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Unit + Cost side-by-side */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-body text-[10px] text-muted-foreground mb-1 block">Unit</label>
                    <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                      <SelectTrigger className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {UNITS.map(u => (
                          <SelectItem key={u} value={u} className="font-body text-foreground">{u}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="font-body text-[10px] text-muted-foreground">Cost per unit (₱)</label>
                    <Input
                      value={form.cost_per_unit}
                      onChange={e => setForm(f => ({ ...f, cost_per_unit: e.target.value }))}
                      type="number"
                      className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl mt-1"
                    />
                  </div>
                </div>

                {/* Stock + Threshold */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-body text-[10px] text-muted-foreground">Current Stock</label>
                    <Input
                      value={form.current_stock}
                      onChange={e => setForm(f => ({ ...f, current_stock: e.target.value }))}
                      type="number"
                      className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl mt-1"
                    />
                  </div>
                  <div>
                    <label className="font-body text-[10px] text-muted-foreground">Low Stock Threshold</label>
                    <Input
                      value={form.low_stock_threshold}
                      onChange={e => setForm(f => ({ ...f, low_stock_threshold: e.target.value }))}
                      type="number"
                      className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl mt-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Usage & Performance section */}
            {editIngUsage.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="font-body text-[10px] tracking-[0.25em] uppercase text-muted-foreground">Usage &amp; Performance</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-secondary/30 p-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <UtensilsCrossed className="w-3.5 h-3.5 text-gold/70" />
                      <span className="font-body text-xs text-foreground">
                        Used in {editIngUsage.length} {editIngUsage.length === 1 ? 'dish' : 'dishes'}
                      </span>
                    </div>
                    <button className="font-body text-[10px] text-gold hover:text-gold/80 transition-colors">View All</button>
                  </div>
                  <div className="space-y-2">
                    {editIngUsage
                      .sort((a, b) => a.dishName.localeCompare(b.dishName))
                      .map((u, idx) => (
                        <div key={idx} className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shrink-0">
                            <span className="font-body text-[9px] text-white font-bold">
                              {u.dishName.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()}
                            </span>
                          </div>
                          <span className="font-body text-xs text-foreground flex-1 truncate">{u.dishName}</span>
                          <span className="font-body text-[10px] text-muted-foreground shrink-0">
                            {u.quantity} {editIng?.unit || ''} per order
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* Inventory Insights */}
            {editIng && editIng !== 'new' && burnMap[editIng.id] && (() => {
              const burn = burnMap[editIng.id];
              const depletionDate = burn.daysRemaining !== null
                ? addDays(new Date(), Math.round(burn.daysRemaining))
                : null;
              const reorderDate = burn.reorderQty > 0
                ? addDays(new Date(), Math.max(0, Math.round((burn.daysRemaining ?? 0) - 3)))
                : null;
              const avgDailyDisplay = burn.dailyRate >= 1000
                ? `${(burn.dailyRate / 1000).toFixed(1)} k${editIng.unit}`
                : `${Math.round(burn.dailyRate)} ${editIng.unit}`;
              const reorderDisplay = burn.reorderQty >= 1000
                ? `${(burn.reorderQty / 1000).toFixed(1)} k${editIng.unit}`
                : `${burn.reorderQty} ${editIng.unit}`;
              return (
                <div>
                  <p className="font-body text-[10px] tracking-[0.25em] uppercase text-muted-foreground mb-3">Inventory Insights</p>
                  <div className="rounded-2xl border border-border/60 bg-secondary/30 p-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded-xl bg-card/50">
                        <p className="font-body text-[9px] text-muted-foreground mb-1">Est. Depletion</p>
                        <p className="font-display text-sm text-foreground leading-tight">
                          {burn.daysRemaining !== null ? formatDays(burn.daysRemaining) : '—'}
                        </p>
                        {depletionDate && (
                          <p className="font-body text-[9px] text-muted-foreground mt-0.5">
                            {format(depletionDate, 'MMM d, yyyy')}
                          </p>
                        )}
                      </div>
                      <div className="p-2 rounded-xl bg-card/50">
                        <p className="font-body text-[9px] text-muted-foreground mb-1">Avg. Daily Use</p>
                        <p className="font-display text-sm text-foreground leading-tight">{avgDailyDisplay}</p>
                      </div>
                      <div className="p-2 rounded-xl bg-card/50">
                        <p className="font-body text-[9px] text-muted-foreground mb-1">Suggested Reorder</p>
                        <p className="font-display text-sm text-foreground leading-tight">
                          {burn.reorderQty > 0 ? reorderDisplay : '—'}
                        </p>
                        {reorderDate && burn.reorderQty > 0 && (
                          <p className="font-body text-[9px] text-muted-foreground mt-0.5">
                            By {format(reorderDate, 'MMM d')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Actions */}
            <div className="space-y-2 pt-1">
              <button
                onClick={save}
                className="w-full py-3 rounded-xl bg-gradient-gold text-background font-body text-sm tracking-wider shadow-[0_0_18px_-4px_hsl(var(--gold)/0.5)] hover:shadow-[0_0_24px_-4px_hsl(var(--gold)/0.6)] transition-all">
                {editIng === 'new' ? 'Add Ingredient' : 'Save Changes'}
              </button>
              {editIng && editIng !== 'new' && (
                <button
                  onClick={() => deleteIng(editIng.id)}
                  className="w-full py-2.5 rounded-xl border border-red-500/40 bg-red-500/10 text-red-400 font-body text-sm tracking-wider hover:bg-red-500/15 transition-colors flex items-center justify-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" /> Delete Ingredient
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer dialog */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="bg-card border-border/60 max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-body text-sm tracking-[0.2em] uppercase text-foreground">Transfer Stock</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">From Department</Label>
              <Select value={transfer.fromDept} onValueChange={v => setTransfer(t => ({ ...t, fromDept: v, ingredientId: '' }))}>
                <SelectTrigger className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl mt-1">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {DEPARTMENTS.map(d => (
                    <SelectItem key={d} value={d} className="font-body text-foreground">
                      {DEPT_ICONS[d]} {DEPT_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">To Department</Label>
              <Select value={transfer.toDept} onValueChange={v => setTransfer(t => ({ ...t, toDept: v }))}>
                <SelectTrigger className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl mt-1">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {DEPARTMENTS.filter(d => d !== transfer.fromDept).map(d => (
                    <SelectItem key={d} value={d} className="font-body text-foreground">
                      {DEPT_ICONS[d]} {DEPT_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Ingredient</Label>
              <Select value={transfer.ingredientId} onValueChange={v => setTransfer(t => ({ ...t, ingredientId: v }))}>
                <SelectTrigger className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl mt-1">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border max-h-48">
                  {transferIngredients.map((i: any) => (
                    <SelectItem key={i.id} value={i.id} className="font-body text-xs text-foreground">
                      {i.name} ({i.current_stock} {i.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Quantity</Label>
              <Input
                value={transfer.quantity}
                onChange={e => setTransfer(t => ({ ...t, quantity: e.target.value }))}
                type="number"
                placeholder="Amount to transfer"
                className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl mt-1"
              />
            </div>
            <div>
              <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Reason (optional)</Label>
              <Input
                value={transfer.reason}
                onChange={e => setTransfer(t => ({ ...t, reason: e.target.value }))}
                placeholder="e.g. Bar ran out"
                className="bg-secondary/50 border-border/60 text-foreground font-body rounded-xl mt-1"
              />
            </div>
            <button
              onClick={executeTransfer}
              className="w-full py-3 rounded-xl bg-gradient-gold text-background font-body text-sm tracking-wider shadow-[0_0_18px_-4px_hsl(var(--gold)/0.5)] hover:shadow-[0_0_24px_-4px_hsl(var(--gold)/0.6)] transition-all flex items-center justify-center gap-2">
              <ArrowRightLeft className="w-4 h-4" /> Transfer Stock
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InventoryDashboard;
