import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Clock, Flame, GlassWater, Home, Receipt, Send,
  ConciergeBell, History, LayoutGrid, MoreHorizontal,
  ChefHat, CheckCircle2, ClipboardList, ChevronRight,
  ArrowUpDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow, isToday } from 'date-fns';
import { groupOrdersByUnit, type OrderGroup } from '@/lib/groupOrders';

const COL_COLORS: Record<string, string> = {
  New: 'border-t-gold',
  Preparing: 'border-t-orange-400',
  Ready: 'border-t-emerald-400',
};

const STATUS_BORDER: Record<string, string> = {
  New: 'border-l-gold',
  Preparing: 'border-l-orange-400',
  Ready: 'border-l-emerald-400',
  Served: 'border-l-[hsl(210,70%,50%)]',
  Paid: 'border-l-emerald-400',
};

const isInHouseUnit = (unitKey: string): boolean => {
  if (!unitKey) return false;
  const u = unitKey.toUpperCase();
  return u.includes('COT') || u.includes('SUI');
};

type NavTab = 'orders' | 'history' | 'tables' | 'more';
type StatusFilter = 'all' | 'New' | 'Preparing' | 'Ready';

const WaitstaffBoard = () => {
  const qc = useQueryClient();
  const [activeUnit, setActiveUnit] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Ready');
  const [navTab, setNavTab] = useState<NavTab>('orders');

  useEffect(() => {
    const channel = supabase
      .channel('waitstaff-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        qc.invalidateQueries({ queryKey: ['waitstaff-orders'] });
        qc.invalidateQueries({ queryKey: ['waitstaff-served-today'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const { data: orders = [] } = useQuery({
    queryKey: ['waitstaff-orders'],
    queryFn: async () => {
      const { data } = await supabase
        .from('orders')
        .select('*')
        .in('status', ['New', 'Preparing', 'Ready'])
        .order('created_at', { ascending: true })
        .limit(300);
      return data || [];
    },
    refetchInterval: 5000,
  });

  const { data: servedToday = [] } = useQuery({
    queryKey: ['waitstaff-served-today'],
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('orders')
        .select('id, status, created_at')
        .eq('status', 'Served')
        .gte('created_at', since.toISOString());
      return data || [];
    },
    refetchInterval: 10000,
  });

  const { activeGroups, allUnitKeys } = useMemo(() => {
    const ag = groupOrdersByUnit(orders);
    const keys = [...new Set(ag.map(g => g.key))];
    return { activeGroups: ag, allUnitKeys: keys };
  }, [orders]);

  const unitFilteredGroups = useMemo(() => {
    if (!activeUnit) return activeGroups;
    return activeGroups.filter(g => g.key === activeUnit);
  }, [activeGroups, activeUnit]);

  const visibleGroups = useMemo(() => {
    if (statusFilter === 'all') return unitFilteredGroups;
    return unitFilteredGroups.filter(g => g.worstStatus === statusFilter);
  }, [unitFilteredGroups, statusFilter]);

  const readyGroups = useMemo(() =>
    unitFilteredGroups.filter(g => g.worstStatus === 'Ready'),
    [unitFilteredGroups]);

  const newCount = unitFilteredGroups.filter(g => g.worstStatus === 'New').length;
  const preparingCount = unitFilteredGroups.filter(g => g.worstStatus === 'Preparing').length;
  const readyCount = readyGroups.length;
  const servedCount = servedToday.length;

  const columns = useMemo(() => {
    const cols: Record<string, OrderGroup[]> = { New: [], Preparing: [], Ready: [] };
    unitFilteredGroups.forEach(g => {
      const col = g.worstStatus as keyof typeof cols;
      if (cols[col]) cols[col].push(g);
      else cols.New.push(g);
    });
    return cols;
  }, [unitFilteredGroups]);

  const handleSendGroupToCashier = useCallback(async (group: OrderGroup) => {
    const ids = group.orders.map(o => o.id);
    const isInHouse = isInHouseUnit(group.key);

    if (isInHouse) {
      const { data: unit } = await supabase
        .from('resort_ops_units')
        .select('id')
        .ilike('name', `%${group.key}%`)
        .single();
      await supabase
        .from('orders')
        .update({ status: 'Served', ready_for_billing: true, room_id: unit?.id })
        .in('id', ids);
      qc.invalidateQueries({ queryKey: ['waitstaff-orders'] });
      qc.invalidateQueries({ queryKey: ['waitstaff-served-today'] });
      toast.success(`${group.label} — charges added to room bill`);
    } else {
      await supabase.from('orders').update({ status: 'Served' }).in('id', ids);
      qc.invalidateQueries({ queryKey: ['waitstaff-orders'] });
      qc.invalidateQueries({ queryKey: ['waitstaff-served-today'] });
      qc.invalidateQueries({ queryKey: ['cashier-orders'] });
      toast.success(`${group.label} sent to Cashier`);
    }
  }, [qc]);

  return (
    <div className="h-full flex flex-col">
      {/* ── Desktop: 3-column kanban ── */}
      <div className="hidden md:flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50 flex-shrink-0 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setActiveUnit(null)}
            className={`font-display text-xs tracking-wider px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
              !activeUnit ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground border border-border'
            }`}
          >
            All ({activeGroups.length})
          </button>
          {allUnitKeys.map(key => {
            const group = activeGroups.find(g => g.key === key)!;
            return (
              <button
                key={key}
                onClick={() => setActiveUnit(activeUnit === key ? null : key)}
                className={`font-display text-xs tracking-wider px-3 py-1.5 rounded-full whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  activeUnit === key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground border border-border'
                }`}
              >
                {group.label}
                <span className={`text-[10px] font-body font-bold rounded-full w-5 h-5 flex items-center justify-center ${
                  activeUnit === key ? 'bg-foreground/20 text-foreground' : 'bg-muted text-muted-foreground'
                }`}>{group.items.length}</span>
              </button>
            );
          })}
        </div>
        <div className="flex-1 overflow-auto">
          <div className="grid gap-3 p-4 md:grid-cols-3">
            {(['New', 'Preparing', 'Ready'] as const).map(col => (
              <div key={col} className={`flex flex-col border-t-4 ${COL_COLORS[col]} rounded-t-lg bg-secondary/30`}>
                <div className="px-3 py-2 flex items-center justify-between">
                  <h3 className="font-display text-sm tracking-wider text-foreground">{col}</h3>
                  <span className="font-body text-xs text-muted-foreground font-bold bg-muted rounded-full w-6 h-6 flex items-center justify-center">
                    {columns[col].length}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 max-h-[60vh]">
                  {columns[col].map(group => (
                    <GroupCard key={group.key} group={group} onSendToCashier={handleSendGroupToCashier} compact />
                  ))}
                  {columns[col].length === 0 && (
                    <p className="font-body text-xs text-muted-foreground text-center py-8">No orders</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mobile: Dashboard layout ── */}
      <div className="md:hidden flex flex-col flex-1 overflow-y-auto pb-20">
        {/* Unit filter pills */}
        <div className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto scrollbar-hide flex-shrink-0">
          <UnitPill
            label="All"
            count={activeGroups.reduce((s, g) => s + g.items.length, 0)}
            active={!activeUnit}
            onClick={() => setActiveUnit(null)}
          />
          {allUnitKeys.map(key => {
            const group = activeGroups.find(g => g.key === key)!;
            const isWalkIn = !isInHouseUnit(key);
            return (
              <UnitPill
                key={key}
                label={isWalkIn ? 'Walk-In' : group.label}
                count={group.items.length}
                active={activeUnit === key}
                onClick={() => setActiveUnit(activeUnit === key ? null : key)}
              />
            );
          })}
        </div>

        {/* Status sub-filter */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide flex-shrink-0">
          {(['New', 'Preparing', 'Ready'] as const).map(s => {
            const count = unitFilteredGroups.filter(g => g.worstStatus === s).length;
            const isActive = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(isActive ? 'all' : s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body text-xs whitespace-nowrap transition-all border ${
                  isActive
                    ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_10px_-3px_hsl(var(--gold)/0.5)]'
                    : 'bg-card/50 border-border/50 text-foreground hover:border-gold/30'
                }`}
              >
                {s}
                {count > 0 && (
                  <span className={`text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${
                    isActive ? 'bg-background/20' : 'bg-secondary'
                  }`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Stats tiles */}
        <div className="grid grid-cols-4 gap-2 px-4 pb-4">
          <StatTile
            icon={<ClipboardList className="w-5 h-5" />}
            iconBg="bg-emerald-500/20 text-emerald-400"
            value={activeGroups.length + servedCount}
            label="Total Orders"
            sub="Today"
          />
          <StatTile
            icon={<ChefHat className="w-5 h-5" />}
            iconBg="bg-blue-500/20 text-blue-400"
            value={preparingCount}
            label="Preparing"
            sub="In Progress"
          />
          <StatTile
            icon={<ConciergeBell className="w-5 h-5" />}
            iconBg="bg-amber-500/20 text-amber-400"
            value={readyCount}
            label="Ready"
            sub="Ready to Serve"
          />
          <StatTile
            icon={<CheckCircle2 className="w-5 h-5" />}
            iconBg="bg-purple-500/20 text-purple-400"
            value={servedCount}
            label="Served"
            sub="Completed"
          />
        </div>

        {/* Main order list — Ready Orders highlighted */}
        {navTab === 'orders' && (
          <div className="px-4 space-y-4">
            {/* Ready Orders section */}
            {(statusFilter === 'all' || statusFilter === 'Ready') && readyGroups.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-base text-foreground tracking-wide">Ready Orders</h2>
                    <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-body text-xs font-bold">
                      {readyGroups.length}
                    </span>
                  </div>
                  <button className="flex items-center gap-1 text-muted-foreground font-body text-xs hover:text-foreground transition-colors">
                    Sort by: Time <ArrowUpDown className="w-3 h-3" />
                  </button>
                </div>
                <div className="space-y-3">
                  {readyGroups.map(group => (
                    <GroupCard key={group.key} group={group} onSendToCashier={handleSendGroupToCashier} />
                  ))}
                </div>
              </div>
            )}

            {/* Other status orders (non-Ready) */}
            {(statusFilter === 'New' || statusFilter === 'Preparing') && visibleGroups.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-base text-foreground tracking-wide">
                      {statusFilter} Orders
                    </h2>
                    <span className="w-6 h-6 rounded-full bg-secondary text-muted-foreground flex items-center justify-center font-body text-xs font-bold">
                      {visibleGroups.length}
                    </span>
                  </div>
                </div>
                <div className="space-y-3">
                  {visibleGroups.map(group => (
                    <GroupCard key={group.key} group={group} onSendToCashier={handleSendGroupToCashier} />
                  ))}
                </div>
              </div>
            )}

            {visibleGroups.length === 0 && readyGroups.length === 0 && (
              <div className="py-16 text-center">
                <ConciergeBell className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="font-body text-sm text-muted-foreground">No active orders</p>
              </div>
            )}

            {/* Today's Orders summary */}
            <div className="rounded-2xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-sm text-foreground tracking-wide">Today's Orders</h3>
                <button className="flex items-center gap-1 font-body text-xs text-gold hover:text-gold/80 transition-colors">
                  View All <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <StatusChip label="New" count={newCount} color="text-gold border-gold/30 bg-gold/10" />
                <StatusChip label="Preparing" count={preparingCount} color="text-orange-400 border-orange-400/30 bg-orange-400/10" />
                <StatusChip label="Ready" count={readyCount} color="text-emerald-400 border-emerald-400/30 bg-emerald-400/10" active />
                <StatusChip label="Served" count={servedCount} color="text-blue-400 border-blue-400/30 bg-blue-400/10" />
              </div>
            </div>
          </div>
        )}

        {/* History tab */}
        {navTab === 'history' && (
          <div className="px-4 py-8 text-center">
            <History className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="font-body text-sm text-muted-foreground">
              {servedCount > 0 ? `${servedCount} orders served today` : 'No served orders today'}
            </p>
          </div>
        )}

        {/* Tables / More tabs */}
        {(navTab === 'tables' || navTab === 'more') && (
          <div className="px-4 py-8 text-center">
            <LayoutGrid className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="font-body text-sm text-muted-foreground">Coming soon</p>
          </div>
        )}
      </div>

      {/* ── Bottom Nav (mobile only) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border/50">
        <div className="flex items-center justify-around py-2 px-4 safe-bottom">
          <NavItem icon={<ConciergeBell className="w-5 h-5" />} label="Orders" active={navTab === 'orders'} onClick={() => setNavTab('orders')} />
          <NavItem icon={<History className="w-5 h-5" />} label="History" active={navTab === 'history'} onClick={() => setNavTab('history')} />
          <NavItem icon={<LayoutGrid className="w-5 h-5" />} label="Tables" active={navTab === 'tables'} onClick={() => setNavTab('tables')} />
          <NavItem icon={<MoreHorizontal className="w-5 h-5" />} label="More" active={navTab === 'more'} onClick={() => setNavTab('more')} />
        </div>
      </nav>
    </div>
  );
};

/* ── Reusable sub-components ── */

const UnitPill = ({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body text-xs whitespace-nowrap transition-all border ${
      active
        ? 'bg-gradient-gold text-background border-gold/60 shadow-[0_0_10px_-3px_hsl(var(--gold)/0.5)]'
        : 'bg-card/50 border-border/50 text-foreground hover:border-gold/30'
    }`}
  >
    {label}
    <span className={`text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${
      active ? 'bg-background/20' : 'bg-secondary text-muted-foreground'
    }`}>{count}</span>
  </button>
);

const StatTile = ({ icon, iconBg, value, label, sub }: {
  icon: React.ReactNode; iconBg: string; value: number; label: string; sub: string;
}) => (
  <div className="rounded-2xl border border-border/50 bg-card/50 p-3 flex flex-col items-center text-center gap-2 backdrop-blur-sm">
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
      {icon}
    </div>
    <div>
      <p className="font-display text-xl text-foreground leading-none">{value}</p>
      <p className="font-body text-[9px] text-foreground/80 mt-0.5 leading-tight">{label}</p>
      <p className="font-body text-[9px] text-muted-foreground leading-tight">{sub}</p>
    </div>
  </div>
);

const StatusChip = ({ label, count, color, active }: {
  label: string; count: number; color: string; active?: boolean;
}) => (
  <div className={`flex-1 flex flex-col items-center py-1.5 rounded-xl border font-body text-[10px] ${
    active ? 'bg-card border-border/60' : 'border-transparent'
  } ${color}`}>
    <span className="text-foreground/70">{label}</span>
    <span className="font-bold text-sm">{count}</span>
  </div>
);

const NavItem = ({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center gap-1 py-1 px-3 transition-colors ${
      active ? 'text-gold' : 'text-muted-foreground hover:text-foreground'
    }`}
  >
    {icon}
    <span className="font-body text-[10px]">{label}</span>
    {active && <div className="w-1 h-1 rounded-full bg-gold" />}
  </button>
);

/* ── Group Card ── */
const GroupCard = ({ group, onSendToCashier, compact }: {
  group: OrderGroup;
  onSendToCashier: (g: OrderGroup) => Promise<void>;
  compact?: boolean;
}) => {
  const [busy, setBusy] = useState(false);
  const elapsed = formatDistanceToNow(new Date(group.oldestCreatedAt), { addSuffix: false });
  const isReady = group.worstStatus === 'Ready';
  const borderClass = STATUS_BORDER[group.worstStatus] || 'border-l-border';
  const isInHouse = isInHouseUnit(group.key);

  const foodItems = group.items.filter(i => { const d = i.department || 'kitchen'; return d === 'kitchen' || d === 'both'; });
  const barItems = group.items.filter(i => i.department === 'bar' || i.department === 'both');

  const handleSend = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try { await onSendToCashier(group); } finally { setBusy(false); }
  };

  return (
    <div className={`rounded-2xl border border-border/50 border-l-4 ${borderClass} bg-card/80 backdrop-blur-sm overflow-hidden ${
      group.worstStatus === 'New' ? 'new-order-card' : ''
    }`}>
      {/* Card header */}
      <div className={`${compact ? 'px-3 pt-3 pb-2' : 'px-4 pt-4 pb-3'}`}>
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            <p className="font-display text-base text-foreground tracking-wide truncate">{group.label}</p>
            {group.guestName && (
              <p className="font-body text-xs text-muted-foreground">{group.guestName}</p>
            )}
          </div>
          <div className="flex items-center gap-1 text-muted-foreground shrink-0">
            <Clock className="w-3.5 h-3.5" />
            <span className="font-body text-xs tabular-nums">{elapsed}</span>
          </div>
        </div>

        {/* Badge row */}
        <div className="flex items-center gap-2">
          {foodItems.length > 0 && (
            <div className="flex items-center gap-1 text-orange-400">
              <Flame className="w-3.5 h-3.5" />
              <span className="font-body text-xs">{foodItems.length}</span>
            </div>
          )}
          {barItems.length > 0 && (
            <div className="flex items-center gap-1 text-blue-400">
              <GlassWater className="w-3.5 h-3.5" />
              <span className="font-body text-xs">{barItems.length}</span>
            </div>
          )}
          {group.hasRoomCharge && (
            <Badge variant="outline" className="font-body text-[10px] h-5 gap-1 bg-blue-500/15 text-blue-300 border-blue-500/30">
              <Home className="w-3 h-3" /> Room
            </Badge>
          )}
          {group.hasTab && !group.hasRoomCharge && (
            <Badge variant="outline" className="font-body text-[10px] h-5 gap-1 bg-purple-500/15 text-purple-300 border-purple-500/30">
              <Receipt className="w-3 h-3" /> Tab
            </Badge>
          )}
        </div>
      </div>

      {/* Items */}
      <div className={`border-t border-border/40 ${compact ? 'px-3 py-2' : 'px-4 py-3'} space-y-1.5`}>
        {group.items.slice(0, compact ? 4 : 8).map((item, idx) => (
          <div key={idx} className="flex items-center justify-between gap-2">
            <span className="font-body text-sm text-foreground truncate">{item.qty}× {item.name}</span>
            <span className="font-body text-sm text-gold tabular-nums shrink-0">
              ₱{(item.price * item.qty).toLocaleString()}
            </span>
          </div>
        ))}
        {group.items.length > (compact ? 4 : 8) && (
          <p className="font-body text-[11px] text-muted-foreground">+{group.items.length - (compact ? 4 : 8)} more…</p>
        )}
      </div>

      {/* Footer */}
      <div className={`border-t border-border/40 ${compact ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-3'}`}>
        {isReady ? (
          <div className="flex items-center gap-3">
            <span className="font-display text-xl text-gold tabular-nums">₱{group.total.toLocaleString()}</span>
            <button
              onClick={handleSend}
              disabled={busy}
              className={`flex-1 py-3 rounded-xl font-body text-sm font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-60 ${
                isInHouse
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {busy ? 'Processing…' : isInHouse
                ? <><Home className="w-4 h-4" /> Charge to Room</>
                : <><Send className="w-4 h-4" /> Send to Cashier</>}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="font-display text-xl text-gold tabular-nums">₱{group.total.toLocaleString()}</span>
            <span className={`font-body text-xs px-2.5 py-1 rounded-full border ${
              group.worstStatus === 'New'
                ? 'border-gold/30 text-gold bg-gold/10'
                : 'border-orange-400/30 text-orange-400 bg-orange-400/10'
            }`}>
              {group.worstStatus}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default WaitstaffBoard;
