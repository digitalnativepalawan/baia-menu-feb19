import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { getStaffSession } from '@/lib/session';
import { toast } from 'sonner';
import { useResortProfile } from '@/hooks/useResortProfile';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Clock, Home, ChevronDown, ChevronUp, CreditCard, Check, ArrowLeft, Printer, CalendarIcon, BedDouble } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { formatDistanceToNow, format } from 'date-fns';
import CashierReceipt from './CashierReceipt';

const CashierBoard = () => {
  const qc = useQueryClient();
  const { data: resortProfile } = useResortProfile();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<string>('');
  const [chargeToRoom, setChargeToRoom] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<any | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [completedDate, setCompletedDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('cashier-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        qc.invalidateQueries({ queryKey: ['cashier-orders'] });
        qc.invalidateQueries({ queryKey: ['cashier-completed'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  // Fetch today's Served orders only
  const { data: orders = [] } = useQuery({
    queryKey: ['cashier-orders'],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('orders')
        .select('*')
        .in('status', ['Ready', 'Served'])
        .gte('created_at', start.toISOString())
        .order('created_at', { ascending: true })
        .limit(300);
      return data || [];
    },
    refetchInterval: 5000,
  });

  // Fetch completed orders for selected date
  const { data: completedOrders = [] } = useQuery({
    queryKey: ['cashier-completed', completedDate],
    queryFn: async () => {
      const dayStart = `${completedDate}T00:00:00`;
      const dayEnd = `${completedDate}T23:59:59`;
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'Paid')
        .is('room_id', null)
        .neq('payment_type', 'Charge to Room')
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .order('created_at', { ascending: false })
        .limit(300);
      return data || [];
    },
    refetchInterval: 10000,
  });

  // Active bookings for charge-to-room
  const { data: activeBookings = [] } = useQuery({
    queryKey: ['cashier-active-bookings'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('resort_ops_bookings')
        .select('id, check_in, check_out, unit_id, guest_id, resort_ops_guests(full_name), resort_ops_units:unit_id(name)')
        .lte('check_in', today)
        .gte('check_out', today)
        .limit(50);
      return (data || []) as any[];
    },
  });

  // Handle payment confirmation
  const handleConfirmPayment = async () => {
    if (!selectedOrder || busy) return;
    const paymentType = chargeToRoom ? 'Charge to Room' : selectedPayment;
    if (!paymentType) return;

    setBusy(true);
    try {
      const staffSession = getStaffSession();
      const staffName = staffSession?.name || 'Cashier';
      const items = (selectedOrder.items as any[]) || [];
      const subtotal = items.reduce((s: number, i: any) => s + i.price * (i.qty || i.quantity || 1), 0);
      const sc = Number(selectedOrder.service_charge || 0);
      const grandTotal = subtotal + sc;

      const updateData: any = chargeToRoom
        ? { status: 'room_charge', payment_type: paymentType }
        : { status: 'Paid', payment_type: paymentType, closed_at: new Date().toISOString() };

      if (chargeToRoom && selectedBooking) {
        const booking = activeBookings.find(b => b.id === selectedBooking);
        if (booking?.unit_id) {
          updateData.room_id = booking.unit_id;

          // Insert room_transaction for folio
          await (supabase.from('room_transactions' as any) as any).insert({
            unit_id: booking.unit_id,
            unit_name: booking.resort_ops_units?.name || '',
            guest_name: booking.resort_ops_guests?.full_name || selectedOrder.guest_name || '',
            booking_id: booking.id,
            transaction_type: 'room_charge',
            order_id: selectedOrder.id,
            amount: subtotal,
            tax_amount: 0,
            service_charge_amount: sc,
            total_amount: grandTotal,
            payment_method: 'Charge to Room',
            staff_name: staffName,
            notes: `Cashier settlement — ${selectedOrder.location_detail || selectedOrder.order_type}`,
          });
        }
      }

      await supabase.from('orders').update(updateData).eq('id', selectedOrder.id);

      setReceiptOrder({ ...selectedOrder, payment_type: paymentType });
      setSelectedOrder(null);
      setSelectedPayment('');
      setChargeToRoom(false);
      setSelectedBooking(null);

      qc.invalidateQueries({ queryKey: ['cashier-orders'] });
      qc.invalidateQueries({ queryKey: ['room-transactions'] });
      toast.success('Payment confirmed');
    } finally {
      setBusy(false);
    }
  };

  const activePaymentMethods = paymentMethods.filter(m => m.is_active && m.name !== 'Charge to Room');

  const handleOrderSelect = useCallback((order: any) => {
    if (order.status === 'Paid' || order.status === 'room_charge') {
      setReceiptOrder(order);
    } else {
      setSelectedOrder(order);
      setChargeToRoom(false);
      setSelectedPayment('');
      setSelectedBooking(null);
    }
  }, []);

  // Auto-detect in-stay guest for the selected order
  const selectedOrderInStay = useMemo(() => {
    if (!selectedOrder) return null;
    // Match by room_id
    if (selectedOrder.room_id) {
      return activeBookings.find((b: any) => b.unit_id === selectedOrder.room_id) || null;
    }
    // Match by location_detail against unit name (e.g. "COT(1)")
    if (selectedOrder.location_detail) {
      const loc = selectedOrder.location_detail.trim().toLowerCase();
      const match = activeBookings.find((b: any) => {
        const unitName = b.resort_ops_units?.name?.trim()?.toLowerCase();
        return unitName && unitName === loc;
      });
      if (match) return match;
    }
    // Match by guest name
    if (selectedOrder.guest_name) {
      const name = selectedOrder.guest_name.toLowerCase().trim();
      return activeBookings.find((b: any) => {
        const guestName = b.resort_ops_guests?.full_name?.toLowerCase()?.trim();
        return guestName && guestName === name;
      }) || null;
    }
    return null;
  }, [selectedOrder, activeBookings]);

  // Receipt view
  if (receiptOrder) {
    return <CashierReceipt order={receiptOrder} onDone={() => setReceiptOrder(null)} />;
  }

  return (
    <div className="min-h-0 flex flex-col md:flex-row md:h-full md:overflow-hidden max-w-full">
      {/* Left: Order list */}
      <div className="flex-1 flex flex-col md:overflow-hidden border-r border-border/50 min-w-0">
        {/* Summary */}
        <div className="flex items-center gap-4 px-4 py-3 border-b border-border bg-card/50 flex-shrink-0">
          <span className="font-display text-sm text-foreground tracking-wider">
            {orders.length} order{orders.length !== 1 ? 's' : ''} awaiting settlement
          </span>
        </div>

        <div className="flex-1 md:overflow-y-auto">
          {/* Flat list of served orders */}
          {orders.length > 0 ? (
            <div className="p-3 space-y-2">
              {orders.map(order => (
                <OrderRow
                  key={order.id}
                  order={order}
                  selected={selectedOrder?.id === order.id}
                  onSelect={() => handleOrderSelect(order)}
                />
              ))}
            </div>
          ) : (
            <p className="font-body text-sm text-muted-foreground text-center py-12">No orders awaiting settlement</p>
          )}

          {/* Completed — date picker + stacked cards */}
          <div className="px-3 pb-4">
            <Collapsible open={completedOpen} onOpenChange={setCompletedOpen}>
              <CollapsibleTrigger className="w-full flex items-center justify-between bg-secondary/50 border border-border rounded-lg px-4 py-3 hover:bg-secondary transition-colors">
                <span className="font-display text-xs tracking-wider text-muted-foreground">
                  ✓ Completed ({completedOrders.length})
                </span>
                {completedOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <CalendarIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <Input
                    type="date"
                    value={completedDate}
                    onChange={e => setCompletedDate(e.target.value || format(new Date(), 'yyyy-MM-dd'))}
                    className="bg-secondary border-border text-foreground font-body text-sm h-9 w-auto"
                  />
                </div>
                {completedOrders.length === 0 && (
                  <p className="font-body text-xs text-muted-foreground text-center py-4">No completed orders for this date</p>
                )}
                {completedOrders.map(order => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    selected={false}
                    onSelect={() => handleOrderSelect(order)}
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
      </div>

      {/* Right: Payment Panel */}
      <div className="w-full md:w-[400px] lg:w-[440px] flex-shrink-0 bg-card/50 flex flex-col md:overflow-y-auto">
        {selectedOrder ? (
          <BillOutPanel
            order={selectedOrder}
            paymentMethods={activePaymentMethods}
            selectedPayment={selectedPayment}
            onSelectPayment={(p) => { setSelectedPayment(p); setChargeToRoom(false); }}
            chargeToRoom={chargeToRoom}
            onChargeToRoom={() => { setChargeToRoom(true); setSelectedPayment(''); }}
            activeBookings={activeBookings}
            selectedBooking={selectedBooking}
            onSelectBooking={setSelectedBooking}
            onConfirm={handleConfirmPayment}
            busy={busy}
            onBack={() => setSelectedOrder(null)}
            onPreviewReceipt={() => setReceiptOrder(selectedOrder)}
            inStayBooking={selectedOrderInStay}
          />
        ) : (
          <DailySummary completed={completedOrders} />
        )}
      </div>
    </div>
  );
};

/** Clean, minimal order row */
const OrderRow = ({ order, selected, onSelect }: {
  order: any;
  selected: boolean;
  onSelect: () => void;
}) => {
  const elapsed = formatDistanceToNow(new Date(order.created_at), { addSuffix: false });
  const isPaid = order.status === 'Paid';
  const isRoomCharge = order.status === 'room_charge';
  const isReady = order.status === 'Ready';

  return (
    <div
      onClick={onSelect}
      className={`rounded-xl border border-border/60 p-3 transition-all cursor-pointer active:scale-[0.98] overflow-hidden min-w-0 ${
        isPaid || isRoomCharge ? 'opacity-70 hover:opacity-90' : 'hover:bg-secondary/30'
      } ${selected ? 'ring-2 ring-gold bg-gold/5' : 'bg-card/90'}`}
    >
      <div className="flex items-start justify-between mb-1.5">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm text-foreground tracking-wider truncate">
            {order.guest_name || order.location_detail || order.order_type}
          </p>
          {order.guest_name && order.location_detail && (
            <p className="font-body text-xs text-muted-foreground truncate">{order.location_detail}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground flex-shrink-0 ml-2">
          {(isPaid || isRoomCharge) && <Printer className="w-3 h-3 text-gold" />}
          <Clock className="w-3 h-3" />
          <span className="font-body text-[11px] tabular-nums">{elapsed}</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Badge variant="outline" className={`font-body text-[10px] h-5 ${
          isRoomCharge ? 'border-blue-400/50 text-blue-400' :
          isPaid ? 'border-emerald-400/50 text-emerald-400' :
          isReady ? 'border-cyan-400/50 text-cyan-400' :
          'border-amber-400/50 text-amber-400'
        }`}>
          {isRoomCharge ? 'Room Charge — On Folio' : isPaid ? 'Paid' : isReady ? 'Ready — Awaiting Serve' : 'Pending Payment'}
        </Badge>
        <span className="font-display text-sm text-gold tabular-nums">₱{order.total.toLocaleString()}</span>
      </div>
    </div>
  );
};

/** Bill Out / Payment panel */
const BillOutPanel = ({
  order, paymentMethods, selectedPayment, onSelectPayment,
  chargeToRoom, onChargeToRoom, activeBookings, selectedBooking,
  onSelectBooking, onConfirm, busy, onBack, onPreviewReceipt, inStayBooking
}: {
  order: any;
  paymentMethods: any[];
  selectedPayment: string;
  onSelectPayment: (p: string) => void;
  chargeToRoom: boolean;
  onChargeToRoom: () => void;
  activeBookings: any[];
  selectedBooking: string | null;
  onSelectBooking: (id: string | null) => void;
  onConfirm: () => void;
  busy: boolean;
  onBack: () => void;
  onPreviewReceipt: () => void;
  inStayBooking: any | null;
}) => {
  const items = (order.items as any[]) || [];
  const subtotal = items.reduce((s: number, i: any) => s + i.price * (i.qty || i.quantity || 1), 0);
  const sc = Number(order.service_charge || 0);
  const total = subtotal + sc;

  const isInStay = !!inStayBooking || /^(COT|SUI)/i.test(order?.location_detail || '') || !!order?.room_id;
  const canConfirm = chargeToRoom ? !!selectedBooking : !!selectedPayment;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Button variant="ghost" size="icon" onClick={onBack} className="w-8 h-8 md:hidden">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <p className="font-display text-base tracking-wider text-foreground">
            {order.location_detail || order.order_type}
          </p>
          {order.guest_name && (
            <p className="font-body text-xs text-muted-foreground">{order.guest_name}</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onPreviewReceipt} className="gap-1.5 font-display text-xs tracking-wider">
          <Printer className="w-3.5 h-3.5" /> Preview
        </Button>
        {isInStay && (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 font-body text-[10px]">
            <BedDouble className="w-3 h-3 mr-1" /> In-Stay
          </Badge>
        )}
      </div>

      {/* Itemized bill */}
      <div className="flex-1 md:overflow-y-auto px-4 py-3 space-y-4">
        <div className="space-y-1">
          {items.map((item: any, idx: number) => (
            <div key={idx} className="flex justify-between font-body text-sm">
              <span className="text-foreground">{item.qty || item.quantity || 1}× {item.name}</span>
              <span className="text-muted-foreground tabular-nums">₱{(item.price * (item.qty || item.quantity || 1)).toLocaleString()}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-border/50 pt-3 space-y-1">
          <div className="flex justify-between font-body text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">₱{subtotal.toLocaleString()}</span>
          </div>
          {sc > 0 && (
            <div className="flex justify-between font-body text-sm">
              <span className="text-muted-foreground">Service Charge</span>
              <span className="tabular-nums">₱{sc.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between font-display text-2xl text-gold pt-2">
            <span>Total</span>
            <span className="tabular-nums">₱{total.toLocaleString()}</span>
          </div>
        </div>

        {/* Payment Method Selection */}
        <div className="space-y-3">
          {/* In-stay guest: Charge to Room as primary */}
          {isInStay && (
            <>
              {!chargeToRoom ? (
                <button
                  onClick={() => { onChargeToRoom(); if (inStayBooking) onSelectBooking(inStayBooking.id); }}
                  className="w-full min-h-[56px] rounded-xl border-2 border-blue-400 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 font-display text-sm tracking-wider transition-all flex items-center justify-center gap-2"
                >
                  <BedDouble className="w-5 h-5" />
                  Charge to Room — {inStayBooking?.resort_ops_units?.name || order?.location_detail || 'Room'}
                </button>
              ) : (
                <div className="rounded-xl border-2 border-gold bg-gold/10 p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <BedDouble className="w-4 h-4 text-gold" />
                    <span className="font-display text-sm tracking-wider text-gold">Charging to {inStayBooking?.resort_ops_units?.name || order?.location_detail || 'Room'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{inStayBooking?.resort_ops_guests?.full_name || order?.guest_name || 'Guest'}</p>
                  <button
                    onClick={() => { onSelectPayment(''); }}
                    className="text-xs text-muted-foreground underline mt-1"
                  >
                    Cancel — pay now instead
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 my-2">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground font-display tracking-wider">OR PAY NOW</span>
                <Separator className="flex-1" />
              </div>
            </>
          )}

          <p className="font-display text-xs tracking-wider text-muted-foreground">
            {isInStay ? 'PAY NOW' : 'SELECT PAYMENT METHOD'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {paymentMethods.map(m => (
              <button
                key={m.id}
                onClick={() => onSelectPayment(m.name)}
                className={`min-h-[52px] rounded-xl border-2 font-display text-sm tracking-wider transition-all ${
                  selectedPayment === m.name && !chargeToRoom
                    ? 'border-gold bg-gold/10 text-gold'
                    : 'border-border bg-card text-foreground hover:border-accent/40'
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Confirm button */}
      <div className="p-4 border-t border-border flex-shrink-0">
        <Button
          onClick={onConfirm}
          disabled={!canConfirm || busy}
          size="lg"
          className="w-full min-h-[56px] font-display text-base tracking-wider gap-2 bg-gold text-primary-foreground hover:bg-gold/90"
        >
          {busy ? 'Processing…' : (
            <>
              <Check className="w-5 h-5" />
              Confirm Payment — ₱{total.toLocaleString()}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

/** Daily cash reconciliation summary */
const DailySummary = ({ completed }: { completed: any[] }) => {
  const summary = useMemo(() => {
    const methods: Record<string, { count: number; total: number }> = {};
    let totalRevenue = 0;
    let registerRevenue = 0;
    let roomChargeTotal = 0;
    let roomChargeCount = 0;

    completed.forEach(o => {
      const method = o.payment_type || 'Pending';
      const amount = Number(o.total) || 0;
      if (!methods[method]) methods[method] = { count: 0, total: 0 };
      methods[method].count += 1;
      methods[method].total += amount;
      totalRevenue += amount;
      if (method === 'Charge to Room') {
        roomChargeTotal += amount;
        roomChargeCount += 1;
      } else {
        registerRevenue += amount;
      }
    });

    return { methods, totalRevenue, registerRevenue, roomChargeTotal, roomChargeCount, orderCount: completed.length };
  }, [completed]);

  const sortedMethods = useMemo(() => {
    return Object.entries(summary.methods).sort((a, b) => b[1].total - a[1].total);
  }, [summary.methods]);

  const cashEntry = summary.methods['Cash'];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <p className="font-display text-xs tracking-wider text-muted-foreground">
          DAILY SUMMARY — {format(new Date(), 'MMM d, yyyy')}
        </p>
      </div>

      <div className="flex-1 px-4 py-4 space-y-5">
        <div className="text-center space-y-1">
          <p className="font-body text-xs text-muted-foreground uppercase tracking-wider">Register Revenue Today</p>
          <p className="font-display text-3xl text-gold tabular-nums">₱{summary.registerRevenue.toLocaleString()}</p>
          <p className="font-body text-xs text-muted-foreground">{summary.orderCount - summary.roomChargeCount} settled order{(summary.orderCount - summary.roomChargeCount) !== 1 ? 's' : ''}</p>
        </div>

        {summary.roomChargeCount > 0 && (
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-3 space-y-0.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Home className="w-4 h-4 text-blue-400" />
                <span className="font-display text-xs tracking-wider text-blue-400">ROOM CHARGES</span>
              </div>
              <span className="font-body text-xs text-blue-400">{summary.roomChargeCount} order{summary.roomChargeCount !== 1 ? 's' : ''}</span>
            </div>
            <p className="font-display text-lg text-blue-400 tabular-nums">₱{summary.roomChargeTotal.toLocaleString()}</p>
            <p className="font-body text-[10px] text-muted-foreground">Charged to guest rooms — settled at checkout</p>
          </div>
        )}

        {cashEntry && (
          <div className="rounded-xl border-2 border-gold/40 bg-gold/5 p-4 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-gold" />
                <span className="font-display text-sm tracking-wider text-gold">CASH</span>
              </div>
              <Badge className="bg-gold/20 text-gold border-gold/30 font-body text-xs">{cashEntry.count} orders</Badge>
            </div>
            <p className="font-display text-2xl text-gold tabular-nums">₱{cashEntry.total.toLocaleString()}</p>
            <p className="font-body text-[11px] text-muted-foreground">Amount to reconcile with cash drawer</p>
          </div>
        )}

        {sortedMethods.length > 0 && (
          <div className="space-y-2">
            <p className="font-display text-xs tracking-wider text-muted-foreground">BREAKDOWN BY METHOD</p>
            <div className="space-y-1">
              {sortedMethods.filter(([m]) => m !== 'Charge to Room').map(([method, data]) => (
                <div key={method} className={`flex items-center justify-between rounded-lg px-3 py-2 ${method === 'Cash' ? 'bg-gold/5' : 'bg-secondary/50'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`font-body text-sm ${method === 'Cash' ? 'text-gold font-semibold' : 'text-foreground'}`}>{method}</span>
                    <span className="font-body text-xs text-muted-foreground">({data.count})</span>
                  </div>
                  <span className={`font-display text-sm tabular-nums ${method === 'Cash' ? 'text-gold' : 'text-foreground'}`}>₱{data.total.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {cashEntry && cashEntry.count > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="w-full flex items-center justify-between bg-secondary/50 border border-border rounded-lg px-4 py-3 hover:bg-secondary transition-colors">
              <span className="font-display text-xs tracking-wider text-muted-foreground">CASH TRANSACTIONS ({cashEntry.count})</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-1">
              {completed.filter(o => o.payment_type === 'Cash').map(o => (
                <div key={o.id} className="flex items-center justify-between rounded-lg bg-card/80 border border-border/50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-body text-xs text-foreground truncate">{o.location_detail || o.order_type}</p>
                    <p className="font-body text-[10px] text-muted-foreground">{o.closed_at ? format(new Date(o.closed_at), 'h:mm a') : '—'}</p>
                  </div>
                  <span className="font-display text-sm text-gold tabular-nums">₱{Number(o.total).toLocaleString()}</span>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {summary.orderCount === 0 && (
          <p className="font-body text-sm text-muted-foreground text-center py-8">No paid orders yet today</p>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border text-center">
        <p className="font-body text-[10px] text-muted-foreground">Tap an order to settle · Tap completed to reprint</p>
      </div>
    </div>
  );
};

export default CashierBoard;
