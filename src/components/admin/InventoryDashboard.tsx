import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, AlertTriangle, Download, Package, BarChart3, Calendar, ArrowRightLeft, Zap, ChevronRight, UtensilsCrossed, Camera, Trash2, Wine, Palmtree, Bed } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format, subDays, differenceInDays, addDays } from 'date-fns';
import { Label } from '@/components/ui/label';

const UNITS = ['grams', 'ml', 'pcs', 'kg', 'liters', 'bottles', 'cans', 'slices'];
const DEPARTMENTS = ['kitchen', 'bar', 'gardens', 'housekeeping', 'dry_goods'] as const;
type Department = typeof DEPARTMENTS[number];

const DEPT_LABELS: Record<string, string> = {
  kitchen: 'Kitchen',
  bar: 'Bar',
  gardens: 'Gardens',
  housekeeping: 'Housekeeping',
  dry_goods: 'Dry Goods',
};

const DEPT_ICONS: Record<string, React.ReactNode> = {
  kitchen: <UtensilsCrossed className="w-4 h-4" />,
  bar: <Wine className="w-4 h-4" />,
  gardens: <Palmtree className="w-4 h-4" />,
  housekeeping: <Bed className="w-4 h-4" />,
  dry_goods: <Package className="w-4 h-4" />,
};

const DEPT_GRADIENT: Record<string, string> = {
  kitchen: 'from-orange-500 to-orange-700',
  bar: 'from-purple-500 to-purple-700',
  gardens: 'from-emerald-500 to-emerald-700',
  housekeeping: 'from-blue-500 to-blue-700',
  dry_goods: 'from-amber-700 to-amber-900',
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
      toast.info('No threshold changes needed â€” no consumption data for these ingredients');
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
    <div className="space-y-6 max-w-7xl mx-auto pb-24">
      {/* Header & Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="font-serif-display text-2xl sm:text-3xl text-foreground">Inventory Management</h2>
          <p className="font-body text-sm text-muted-foreground mt-1">Real-time stock tracking and automated thresholds</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Value */}
        <div className="lux-card rounded-2xl p-5 border border-border/50 bg-card/40 backdrop-blur-md relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-gradient-gold opacity-10 rounded-full blur-2xl group-hover:opacity-20 transition-opacity"></div>
          <div className="flex justify-between items-start relative z-10">
            <div>
              <p className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">Total Inventory Value</p>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl text-foreground tracking-tight">₱{totalValue.toLocaleString()}</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center border border-gold/20">
              <Zap className="w-5 h-5 text-gold" />
            </div>
          </div>
          {missingCostCount > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              <span className="font-body text-[10px]">{missingCostCount} items missing cost</span>
            </div>
          )}
        </div>

        {/* Out of Stock */}
        <button onClick={() => setStockFilter(stockFilter === 'out' ? 'all' : 'out')} className="text-left lux-card rounded-2xl p-5 border border-border/50 bg-card/40 backdrop-blur-md relative overflow-hidden group hover:border-red-500/30 transition-colors w-full">
          <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl transition-opacity ${outOfStockCount > 0 ? 'bg-red-500 opacity-10 group-hover:opacity-20' : 'bg-foreground/5 opacity-5'}`}></div>
          <div className="flex justify-between items-start relative z-10">
            <div>
              <p className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">Out of Stock</p>
              <div className="flex items-baseline gap-2">
                <span className={`font-display text-3xl tracking-tight ${outOfStockCount > 0 ? 'text-red-400' : 'text-foreground'}`}>{outOfStockCount}</span>
                <span className="font-body text-xs text-muted-foreground">items</span>
              </div>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${outOfStockCount > 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-secondary border-border'}`}>
              <AlertTriangle className={`w-5 h-5 ${outOfStockCount > 0 ? 'text-red-400' : 'text-muted-foreground'}`} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-muted-foreground">
            <span className="font-body text-[10px]">Zero quantity available</span>
          </div>
        </button>

        {/* Needs Attention */}
        <button onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')} className="text-left lux-card rounded-2xl p-5 border border-border/50 bg-card/40 backdrop-blur-md relative overflow-hidden group hover:border-amber-500/30 transition-colors w-full">
          <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl transition-opacity ${urgentItems.length > 0 ? 'bg-amber-500 opacity-10 group-hover:opacity-20' : 'bg-foreground/5 opacity-5'}`}></div>
          <div className="flex justify-between items-start relative z-10">
            <div>
              <p className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">Needs Attention</p>
              <div className="flex items-baseline gap-2">
                <span className={`font-display text-3xl tracking-tight ${urgentItems.length > 0 ? 'text-amber-400' : 'text-foreground'}`}>{urgentItems.length}</span>
                <span className="font-body text-xs text-muted-foreground">items</span>
              </div>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${urgentItems.length > 0 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-secondary border-border'}`}>
              <Package className={`w-5 h-5 ${urgentItems.length > 0 ? 'text-amber-400' : 'text-muted-foreground'}`} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-muted-foreground">
            <span className="font-body text-[10px]">Below threshold or burning fast</span>
          </div>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="lux-card rounded-2xl border border-border/50 bg-card/40 backdrop-blur-md overflow-hidden">
        {/* Navigation & Controls */}
        <div className="p-4 border-b border-border/50 space-y-4">
          <div className="flex flex-col lg:flex-row justify-between gap-4">
            
            {/* Department Pills */}
            <div className="flex flex-wrap gap-2 pb-2 lg:pb-0">
              <button
                onClick={() => setSelectedDept('all')}
                className={`whitespace-nowrap px-4 py-2 rounded-xl font-body text-xs border transition-all flex items-center justify-center ${
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
                  className={`whitespace-nowrap px-4 py-2 rounded-xl font-body text-xs border transition-all flex items-center gap-2 ${
                    selectedDept === dept
                      ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_12px_-3px_hsl(var(--gold)/0.5)]'
                      : 'bg-secondary/50 text-foreground border-border/50 hover:border-gold/30'
                  }`}
                >
                  <span className="text-sm">{DEPT_ICONS[dept]}</span>
                  {DEPT_LABELS[dept]}
                </button>
              ))}
            </div>

            {/* View Tabs */}
            <Tabs defaultValue="stock" className="w-full lg:w-[280px] shrink-0" onValueChange={(v) => {
              document.querySelectorAll('[id$="-tab-content"]').forEach(el => el.classList.add('hidden'));
              document.getElementById(`${v}-tab-content`)?.classList.remove('hidden');
            }}>
              <TabsList className="w-full bg-secondary/50 border border-border/40 rounded-xl p-1 h-auto">
                <TabsTrigger value="stock"
                  className="flex-1 font-body text-xs tracking-wider rounded-lg py-2 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:border data-[state=active]:border-border/60 data-[state=active]:shadow-sm">
                  <Package className="w-3.5 h-3.5 mr-1.5" /> Stock
                </TabsTrigger>
                <TabsTrigger value="consumption"
                  className="flex-1 font-body text-xs tracking-wider rounded-lg py-2 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:border data-[state=active]:border-border/60 data-[state=active]:shadow-sm">
                  <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Usage Log
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[200px] relative">
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search ingredients..."
                className="w-full pl-9 bg-secondary/30 border-border/60 text-foreground font-body rounded-xl h-10"
              />
              <svg className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            </div>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="bg-secondary/30 border-border/60 text-foreground font-body w-[120px] rounded-xl h-10">
                <SelectValue placeholder="All units" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all" className="font-body text-foreground">All units</SelectItem>
                {UNITS.map(u => (
                  <SelectItem key={u} value={u} className="font-body text-foreground">{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button onClick={downloadCSV}
              className="h-10 px-4 rounded-xl border border-border/60 bg-secondary/30 flex items-center justify-center text-foreground font-body text-xs hover:border-gold/30 hover:text-gold transition-colors shrink-0 gap-2">
              <Download className="w-4 h-4" /> <span className="hidden sm:inline">Export</span>
            </button>
            {!readOnly && (
              <>
                <button onClick={autoSetThresholds} title="Auto-set thresholds from consumption data"
                  className="h-10 px-4 rounded-xl border border-gold/30 bg-gold/10 flex items-center justify-center text-gold font-body text-xs hover:bg-gold/20 transition-colors shrink-0 gap-2">
                  <Zap className="w-4 h-4" /> <span className="hidden sm:inline">Smart Thresholds</span>
                </button>
                <button onClick={() => setShowTransfer(true)}
                  className="h-10 px-4 rounded-xl border border-border/60 bg-card/50 text-foreground font-body text-xs hover:border-gold/30 hover:bg-card transition-colors shrink-0 gap-2 flex items-center justify-center">
                  <ArrowRightLeft className="w-4 h-4" /> <span className="hidden sm:inline">Transfer</span>
                </button>
                <button onClick={openNew}
                  className="h-10 px-4 rounded-xl border border-gold/30 bg-gold/10 text-gold font-body text-xs hover:bg-gold/15 transition-colors shrink-0 gap-2 flex items-center justify-center shadow-[0_0_12px_-3px_hsl(var(--gold)/0.3)]">
                  <Plus className="w-4 h-4" /> Add Item
                </button>
              </>
            )}
          </div>
        </div>

        <div className="p-0 relative min-h-[400px]">
          <div className="block w-full" id="stock-tab-content">
            
            {/* Desktop Data Table */}
            <div className="hidden md:block w-full overflow-x-auto pb-4">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b border-border/50 bg-secondary/20">
                    <th className="py-3 px-5 font-body text-[10px] tracking-[0.15em] uppercase text-muted-foreground font-medium">Ingredient</th>
                    <th className="py-3 px-5 font-body text-[10px] tracking-[0.15em] uppercase text-muted-foreground font-medium">Department</th>
                    <th className="py-3 px-5 font-body text-[10px] tracking-[0.15em] uppercase text-muted-foreground font-medium w-48">Stock Level</th>
                    <th className="py-3 px-5 font-body text-[10px] tracking-[0.15em] uppercase text-muted-foreground font-medium">Status / Action</th>
                    <th className="py-3 px-5 font-body text-[10px] tracking-[0.15em] uppercase text-muted-foreground font-medium">Unit Cost</th>
                    <th className="py-3 px-5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filtered.map((ing: any) => {
                    const urgency = getUrgency(ing);
                    const isOut = ing.current_stock <= 0;
                    const burn = burnMap[ing.id];
                    const stockPct = computeStockPct(ing, burn);
                    const dishCount = (usageMap[ing.id] || []).length;
                    const dept = ing.department || 'kitchen';
                    const gradient = DEPT_GRADIENT[dept] || DEPT_GRADIENT.kitchen;

                    const healthLabel = isOut ? 'Out of Stock' : urgency.level === 'critical' ? 'Critical' : urgency.level === 'warning' ? 'Low Stock' : 'Healthy';
                    const healthColor = isOut || urgency.level === 'critical' ? 'text-red-400' : urgency.level === 'warning' ? 'text-amber-400' : 'text-emerald-400';
                    const healthDot = isOut || urgency.level === 'critical' ? 'bg-red-400' : urgency.level === 'warning' ? 'bg-amber-400' : 'bg-emerald-400';
                    const barColor = isOut || urgency.level === 'critical' ? 'bg-red-500' : urgency.level === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';

                    return (
                      <tr key={ing.id} className="hover:bg-white/[0.02] transition-colors group cursor-pointer" onClick={() => openEdit(ing)}>
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-sm opacity-90 group-hover:opacity-100 transition-opacity`}>
                              <span className="font-body text-[11px] text-white font-bold">{getInitials(ing.name)}</span>
                            </div>
                            <div>
                              <p className="font-body text-sm font-medium text-foreground">{ing.name}</p>
                              {dishCount > 0 && <p className="font-body text-[10px] text-muted-foreground mt-0.5">Used in {dishCount} {dishCount === 1 ? 'dish' : 'dishes'}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-5">
                          <span className="font-body text-xs text-muted-foreground flex items-center gap-1.5">
                            <span className="text-[14px]">{DEPT_ICONS[dept]}</span> {DEPT_LABELS[dept]}
                          </span>
                        </td>
                        <td className="py-3 px-5">
                          <div className="w-40">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`font-body text-xs font-medium ${healthColor}`}>{ing.current_stock.toLocaleString()} <span className="text-[10px] opacity-70">{ing.unit}</span></span>
                              <span className="font-body text-[10px] text-muted-foreground">{stockPct}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-secondary/70 overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${stockPct}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-5">
                          <div className="flex flex-col items-start gap-1">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border font-body text-[10px] ${
                              isOut || urgency.level === 'critical' ? 'border-red-500/40 text-red-400 bg-red-500/10' :
                              urgency.level === 'warning' ? 'border-amber-500/40 text-amber-400 bg-amber-500/10' :
                              'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${healthDot}`} /> {healthLabel}
                            </span>
                            {urgency.daysLeft !== null && <span className="font-body text-[10px] text-muted-foreground ml-1">{formatDays(urgency.daysLeft)} left</span>}
                          </div>
                        </td>
                        <td className="py-3 px-5">
                          <p className="font-body text-xs text-foreground">{ing.cost_per_unit > 0 ? `₱${ing.cost_per_unit.toFixed(2)}` : '₱—'}</p>
                          <p className="font-body text-[10px] text-muted-foreground">per {ing.unit}</p>
                        </td>
                        <td className="py-3 px-5 text-right">
                          <div className="w-8 h-8 rounded-full border border-border/50 flex items-center justify-center group-hover:border-gold/40 group-hover:bg-gold/10 transition-all text-muted-foreground group-hover:text-gold">
                            <ChevronRight className="w-4 h-4" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="py-16 text-center">
                  <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="font-body text-sm text-muted-foreground">No ingredients found</p>
                </div>
              )}
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden space-y-2 p-4 pb-12">
              {filtered.map((ing: any) => {
                const urgency = getUrgency(ing);
                const isOut = ing.current_stock <= 0;
                const burn = burnMap[ing.id];
                const stockPct = computeStockPct(ing, burn);
                const dishCount = (usageMap[ing.id] || []).length;
                const dept = ing.department || 'kitchen';
                const gradient = DEPT_GRADIENT[dept] || DEPT_GRADIENT.kitchen;

                const healthLabel = isOut ? 'Out of Stock' : urgency.level === 'critical' ? 'Critical' : urgency.level === 'warning' ? 'Low Stock' : 'Healthy';
                const healthColor = isOut || urgency.level === 'critical' ? 'text-red-400' : urgency.level === 'warning' ? 'text-amber-400' : 'text-emerald-400';
                const healthDot = isOut || urgency.level === 'critical' ? 'bg-red-400' : urgency.level === 'warning' ? 'bg-amber-400' : 'bg-emerald-400';
                const barColor = isOut || urgency.level === 'critical' ? 'bg-red-500' : urgency.level === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';

                return (
                  <button key={ing.id} onClick={() => openEdit(ing)}
                    className="w-full text-left rounded-2xl border border-border/50 bg-card/40 p-4 hover:border-gold/40 hover:bg-card/60 transition-all backdrop-blur-sm group lux-card">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-sm`}>
                        <span className="font-body text-[11px] text-white font-bold">{getInitials(ing.name)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="font-body text-sm font-medium text-foreground truncate">{ing.name}</p>
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-body text-[9px] shrink-0 ${
                            isOut || urgency.level === 'critical' ? 'border-red-500/40 text-red-400 bg-red-500/10' :
                            urgency.level === 'warning' ? 'border-amber-500/40 text-amber-400 bg-amber-500/10' :
                            'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                          }`}>
                            <span className={`w-1 h-1 rounded-full ${healthDot}`} /> {healthLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1"><span className="text-[12px]">{DEPT_ICONS[dept]}</span> {DEPT_LABELS[dept]}</span>
                          {dishCount > 0 && <span>· {dishCount} {dishCount === 1 ? 'dish' : 'dishes'}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="bg-secondary/30 rounded-xl p-3 space-y-2 border border-border/30">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="font-body text-xs text-foreground font-medium">{ing.current_stock.toLocaleString()} <span className="text-[10px] text-muted-foreground">{ing.unit}</span></p>
                          {urgency.daysLeft !== null && <p className="font-body text-[9px] text-muted-foreground">{formatDays(urgency.daysLeft)} left</p>}
                        </div>
                        <div className="text-right">
                          <p className="font-body text-xs text-foreground">{ing.cost_per_unit > 0 ? `₱${ing.cost_per_unit.toFixed(2)}` : '₱—'}</p>
                          <p className="font-body text-[9px] text-muted-foreground">per {ing.unit}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-secondary/70 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${stockPct}%` }} />
                        </div>
                        <span className="font-body text-[9px] text-muted-foreground shrink-0 w-6 text-right">{stockPct}%</span>
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="py-12 text-center">
                  <Package className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="font-body text-sm text-muted-foreground">No ingredients found</p>
                </div>
              )}
            </div>
          </div>

          <div className="hidden w-full p-4" id="consumption-tab-content">
            <div className="flex gap-2 mb-4">
              {[7, 14, 30].map(d => (
                <button key={d} onClick={() => setLogDays(d)}
                  className={`flex-1 md:flex-none md:w-24 py-2 rounded-xl border font-body text-xs tracking-wider transition-all ${
                    logDays === d
                      ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_12px_-3px_hsl(var(--gold)/0.5)]'
                      : 'bg-card/50 border-border/50 text-foreground hover:border-gold/30'
                  }`}>
                  {d} Days
                </button>
              ))}
            </div>

            {Object.keys(logsByDate).length === 0 ? (
              <div className="py-16 text-center">
                <BarChart3 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-body text-sm text-muted-foreground">No consumption data found for this period</p>
              </div>
            ) : (
              <div className="space-y-4 pb-12">
                {Object.entries(logsByDate)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([date, ings]) => (
                    <div key={date} className="rounded-2xl border border-border/50 bg-card/30 overflow-hidden lux-card">
                      <div className="bg-secondary/40 px-4 py-3 border-b border-border/50 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gold" />
                        <span className="font-body text-sm text-foreground font-medium">
                          {format(new Date(date), 'MMMM d, yyyy')}
                        </span>
                      </div>
                      <div className="divide-y divide-border/30">
                        {Object.values(ings)
                          .sort((a, b) => b.total - a.total)
                          .map((ing, idx) => (
                            <div key={idx} className="flex justify-between items-center px-4 py-3 hover:bg-white/[0.02]">
                              <div className="flex items-center gap-3">
                                <div className="w-2 h-2 rounded-full bg-gold/50"></div>
                                <span className="font-body text-sm text-foreground/90">{ing.name}</span>
                              </div>
                              <span className="font-body text-sm font-medium text-amber-400">-{ing.total.toLocaleString()} <span className="text-xs text-muted-foreground">{ing.unit}</span></span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit / New Ingredient Dialog */}
      <Dialog open={!!editIng} onOpenChange={() => setEditIng(null)}>
        <DialogContent className="bg-card/95 backdrop-blur-xl border-border/50 max-w-sm max-h-[88vh] overflow-y-auto rounded-3xl p-6 shadow-2xl lux-card">
          <DialogHeader>
            <DialogTitle className="font-body text-sm tracking-[0.2em] uppercase text-foreground text-center">
              {editIng === 'new' ? 'Add Ingredient' : 'Edit Ingredient'}
            </DialogTitle>
          </DialogHeader>

          {/* Circular avatar with camera */}
          <div className="flex justify-center pb-2 mt-4">
            <div className="relative group cursor-pointer">
              <div className={`w-24 h-24 rounded-full bg-gradient-to-br ${
                DEPT_GRADIENT[form.department] || DEPT_GRADIENT.kitchen
              } flex items-center justify-center border-4 border-card shadow-lg transition-transform group-hover:scale-105`}>
                <span className="font-body text-xl text-white font-bold">
                  {form.name ? getInitials(form.name) : '?'}
                </span>
              </div>
              <div className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-card border border-border/60 flex items-center justify-center shadow-sm text-muted-foreground group-hover:text-gold group-hover:border-gold/40 transition-colors">
                <Camera className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          <div className="space-y-5 mt-4">
            <div>
              <p className="font-body text-[10px] tracking-[0.25em] uppercase text-gold mb-3 flex items-center gap-2">
                <span className="w-4 h-[1px] bg-gold/50"></span> Basic Information
              </p>
              <div className="space-y-4">
                <div>
                  <label className="font-body text-[10px] text-muted-foreground">Ingredient Name</label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Fresh Salmon"
                    className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 focus-visible:ring-gold/30"
                  />
                </div>

                <div>
                  <label className="font-body text-[10px] text-muted-foreground mb-2 block">Department</label>
                  <div className="grid grid-cols-2 gap-2">
                    {DEPARTMENTS.map(dept => (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, department: dept }))}
                        className={`px-3 py-2 rounded-xl font-body text-xs border transition-all flex items-center gap-2 ${
                          form.department === dept
                            ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_12px_-3px_hsl(var(--gold)/0.4)]'
                            : 'bg-secondary/40 text-foreground border-border/50 hover:border-gold/30'
                        }`}
                      >
                        <span className="text-[14px]">{DEPT_ICONS[dept]}</span> {DEPT_LABELS[dept]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="font-body text-[10px] tracking-[0.25em] uppercase text-gold mb-3 flex items-center gap-2 mt-2">
                <span className="w-4 h-[1px] bg-gold/50"></span> Metrics & Stock
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-body text-[10px] text-muted-foreground">Current Stock</label>
                  <Input
                    value={form.current_stock}
                    onChange={e => setForm(f => ({ ...f, current_stock: e.target.value }))}
                    type="number"
                    placeholder="0.0"
                    className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 focus-visible:ring-gold/30"
                  />
                </div>
                <div>
                  <label className="font-body text-[10px] text-muted-foreground">Unit</label>
                  <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                    <SelectTrigger className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 focus-visible:ring-gold/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {UNITS.map(u => (
                        <SelectItem key={u} value={u} className="font-body">{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="font-body text-[10px] text-muted-foreground">Low Stock Alert</label>
                  <Input
                    value={form.low_stock_threshold}
                    onChange={e => setForm(f => ({ ...f, low_stock_threshold: e.target.value }))}
                    type="number"
                    placeholder="0.0"
                    className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 focus-visible:ring-gold/30"
                  />
                </div>
                <div>
                  <label className="font-body text-[10px] text-muted-foreground">Cost per Unit (₱)</label>
                  <Input
                    value={form.cost_per_unit}
                    onChange={e => setForm(f => ({ ...f, cost_per_unit: e.target.value }))}
                    type="number"
                    placeholder="0.00"
                    className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 focus-visible:ring-gold/30"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-6 mt-2 border-t border-border/30">
            {editIng !== 'new' && (
              <button
                onClick={() => deleteIng(editIng.id)}
                className="w-12 h-12 shrink-0 rounded-xl border border-red-500/40 bg-red-500/10 text-red-400 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                title="Delete Ingredient"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={save}
              className="flex-1 h-12 rounded-xl bg-gradient-gold text-background font-body text-sm tracking-wider shadow-[0_0_18px_-4px_hsl(var(--gold)/0.5)] hover:shadow-[0_0_24px_-4px_hsl(var(--gold)/0.6)] transition-all">
              {editIng === 'new' ? 'Create Ingredient' : 'Save Changes'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Stock Dialog */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="bg-card/95 backdrop-blur-xl border-border/50 max-w-sm rounded-3xl p-6 shadow-2xl lux-card">
          <DialogHeader>
            <DialogTitle className="font-body text-sm tracking-[0.2em] uppercase text-foreground text-center flex justify-center items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center border border-gold/20">
                <ArrowRightLeft className="w-4 h-4 text-gold" />
              </div>
              Transfer Stock
            </DialogTitle>
          </DialogHeader>

          <p className="font-body text-xs text-muted-foreground text-center mt-2 mb-6">
            Move inventory between departments (e.g., from Main Storage to Bar)
          </p>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 relative">
              <div>
                <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">From</Label>
                <Select value={transfer.fromDept} onValueChange={v => setTransfer(t => ({ ...t, fromDept: v, ingredientId: '' }))}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 focus-visible:ring-gold/30">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {DEPARTMENTS.map(d => (
                      <SelectItem key={d} value={d} className="font-body text-xs">
                        <span className="flex items-center gap-2"><span className="text-[14px]">{DEPT_ICONS[d]}</span> {DEPT_LABELS[d]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-1 w-8 h-8 rounded-full bg-card border border-border/50 flex items-center justify-center z-10 text-muted-foreground shadow-sm">
                <ArrowRightLeft className="w-3.5 h-3.5" />
              </div>

              <div>
                <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">To</Label>
                <Select value={transfer.toDept} onValueChange={v => setTransfer(t => ({ ...t, toDept: v }))}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 pl-6 focus-visible:ring-gold/30">
                    <SelectValue placeholder="Dest" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {DEPARTMENTS.map(d => (
                      <SelectItem key={d} value={d} className="font-body text-xs">
                        <span className="flex items-center gap-2"><span className="text-[14px]">{DEPT_ICONS[d]}</span> {DEPT_LABELS[d]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground flex items-center gap-2 mt-2">
                <span className="w-3 h-[1px] bg-gold/50"></span> Item to Transfer
              </Label>
              <Select value={transfer.ingredientId} onValueChange={v => setTransfer(t => ({ ...t, ingredientId: v }))}>
                <SelectTrigger className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 focus-visible:ring-gold/30" disabled={!transfer.fromDept}>
                  <SelectValue placeholder={transfer.fromDept ? "Select ingredient..." : "Select source first"} />
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Quantity</Label>
                <Input
                  value={transfer.quantity}
                  onChange={e => setTransfer(t => ({ ...t, quantity: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 focus-visible:ring-gold/30"
                />
              </div>
              <div>
                <Label className="font-body text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Reason (Optional)</Label>
                <Input
                  value={transfer.reason}
                  onChange={e => setTransfer(t => ({ ...t, reason: e.target.value }))}
                  placeholder="e.g. Restock"
                  className="bg-secondary/40 border-border/50 text-foreground font-body rounded-xl mt-1.5 h-11 focus-visible:ring-gold/30"
                />
              </div>
            </div>

            <button
              onClick={executeTransfer}
              className="w-full h-12 mt-4 rounded-xl bg-gradient-gold text-background font-body text-sm tracking-wider shadow-[0_0_18px_-4px_hsl(var(--gold)/0.5)] hover:shadow-[0_0_24px_-4px_hsl(var(--gold)/0.6)] transition-all flex items-center justify-center gap-2">
              <ArrowRightLeft className="w-4 h-4" /> Execute Transfer
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InventoryDashboard;
