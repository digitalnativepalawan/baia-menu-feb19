import React, { useState } from 'react';
import { 
  DollarSign, BedDouble, TrendingUp, Users, Cloud, 
  ChevronDown, ArrowUpRight, Bed, UtensilsCrossed, 
  Flower2, Briefcase, Lightbulb, Activity, UserPlus
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';

// ─── MOCK DATA ──────────────────────────────────────────────────────────
const MOCK_REVENUE_DATA = [
  { date: 'May 18', revenue: 20000 },
  { date: 'May 19', revenue: 45000 },
  { date: 'May 20', revenue: 30000 },
  { date: 'May 21', revenue: 55000 },
  { date: 'May 22', revenue: 58000 },
  { date: 'May 23', revenue: 80000 },
  { date: 'May 24', revenue: 75000 },
];

const MOCK_OCCUPANCY = [
  { name: 'Occupied', value: 72, color: '#22c55e' }, // Emerald 500
  { name: 'Available', value: 18, color: '#3b82f6' }, // Blue 500
  { name: 'Blocked', value: 6, color: '#a855f7' },   // Purple 500
  { name: 'Out of Order', value: 4, color: '#f59e0b' }, // Amber 500
];

const MOCK_ROOM_STATUS = [
  { name: 'Occupied', value: 34, percent: 71, color: '#22c55e' },
  { name: 'Available', value: 9, percent: 19, color: '#3b82f6' },
  { name: 'To Clean', value: 3, percent: 6, color: '#f59e0b' },
  { name: 'Out of Order', value: 2, percent: 4, color: '#ef4444' }, // Red 500
];

const MOCK_DEPARTMENTS = [
  { name: 'Kitchen', value: 92, color: '#f59e0b' },
  { name: 'Housekeeping', value: 88, color: '#22c55e' },
  { name: 'Reception', value: 84, color: '#3b82f6' },
  { name: 'Maintenance', value: 76, color: '#a855f7' },
];

const MOCK_REQUESTS = [
  { name: 'Completed', value: 14, percent: 58, color: '#22c55e' },
  { name: 'In Progress', value: 6, percent: 25, color: '#3b82f6' },
  { name: 'Pending', value: 3, percent: 13, color: '#f59e0b' },
  { name: 'Overdue', value: 1, percent: 4, color: '#ef4444' },
];

const MOCK_REVENUE_SOURCES = [
  { source: 'Room Bookings', icon: <Bed className="w-4 h-4 text-emerald-400" />, revenue: 298450, percentage: 69, trendData: [20, 30, 25, 40, 35, 50] },
  { source: 'F&B', icon: <UtensilsCrossed className="w-4 h-4 text-amber-400" />, revenue: 78900, percentage: 18, trendData: [10, 12, 15, 14, 18, 20] },
  { source: 'Spa Services', icon: <Flower2 className="w-4 h-4 text-rose-400" />, revenue: 32600, percentage: 8, trendData: [5, 6, 8, 7, 9, 10] },
  { source: 'Other Services', icon: <Briefcase className="w-4 h-4 text-purple-400" />, revenue: 22900, percentage: 5, trendData: [3, 4, 3, 5, 4, 6] },
];

// ─── HELPER COMPONENTS ──────────────────────────────────────────────────

const Sparkline = ({ data, color = '#22c55e' }: { data: number[]; color?: string }) => {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 40;
    const y = 16 - ((d - min) / range) * 16;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="40" height="16" className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const KPICard = ({ title, value, trend, trendUp, icon, iconColor }: any) => (
  <div className="lux-card p-4 flex flex-col justify-between h-full bg-card/40 backdrop-blur-sm border-border/40 hover:border-gold/30 transition-colors">
    <div className="flex items-center gap-2 mb-3">
      <div className="w-6 h-6 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
        {React.cloneElement(icon, { className: `w-3.5 h-3.5 ${iconColor}` })}
      </div>
      <span className="font-body text-xs text-muted-foreground uppercase tracking-wider">{title}</span>
    </div>
    <div>
      <div className="text-xl md:text-2xl font-display text-foreground mb-1.5">{value}</div>
      <div className={`text-[10px] font-body flex items-center ${trendUp ? 'text-emerald-400' : 'text-rose-400'}`}>
        {trendUp ? '▲' : '▼'} {trend} <span className="text-muted-foreground ml-1">vs last week</span>
      </div>
    </div>
  </div>
);

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card/95 backdrop-blur-md border border-border/50 p-3 rounded-lg shadow-xl">
        <p className="font-body text-xs text-muted-foreground mb-1">{label}</p>
        <p className="font-display text-sm text-foreground">
          ₱ {payload[0].value.toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
};

// ─── MAIN DASHBOARD ──────────────────────────────────────────────────────

type DateRange = 'today' | 'yesterday' | 'week' | 'month' | 'ytd' | 'custom';

const ReportsDashboard = () => {
  const [range, setRange] = useState<DateRange>('today');
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();

  const ranges: { key: DateRange; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'ytd', label: 'YTD' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto pb-10">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-serif-display text-foreground mb-1">Reports & Analytics</h1>
          <p className="font-body text-sm text-muted-foreground">Real-time insights to drive better decisions.</p>
        </div>
        
        <div className="flex flex-col items-end gap-3 flex-wrap">
          <div className="flex flex-wrap gap-1.5 justify-end">
            {ranges.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`flex-1 min-w-[68px] min-h-[36px] px-3 rounded-xl border font-display text-[11px] tracking-[0.18em] uppercase transition-all ${
                  range === r.key
                    ? 'bg-gradient-gold text-background border-gold/60 luxury-glow-gold'
                    : 'border-border/60 bg-card/40 backdrop-blur-sm text-muted-foreground hover:border-gold/40 hover:text-foreground'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4 flex-wrap justify-end">
            {/* Weather Widget */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/30 border border-border/30">
              <Cloud className="w-4 h-4 text-sky-400" />
              <div className="flex flex-col">
                <span className="font-display text-[11px] leading-none text-foreground">28°C</span>
                <span className="font-body text-[9px] text-muted-foreground">San Vicente, Palawan</span>
              </div>
            </div>

            {/* Custom Date Picker */}
            {range === 'custom' && (
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 bg-card/30 border-border/40 font-body text-xs text-foreground hover:bg-card/50">
                      {customFrom ? format(customFrom, 'MMM dd, yyyy') : 'From date'} <ChevronDown className="w-3 h-3 ml-2 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar mode="single" selected={customFrom} onSelect={(d) => d && setCustomFrom(d)} initialFocus />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 bg-card/30 border-border/40 font-body text-xs text-foreground hover:bg-card/50">
                      {customTo ? format(customTo, 'MMM dd, yyyy') : 'To date'} <ChevronDown className="w-3 h-3 ml-2 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar mode="single" selected={customTo} onSelect={(d) => d && setCustomTo(d)} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            )}
            
            {/* Avatar */}
            <div className="w-9 h-9 rounded-full bg-gold overflow-hidden border-2 border-border/50 shrink-0">
              <img src="https://api.dicebear.com/7.x/notionists/svg?seed=david&backgroundColor=D4B27A" alt="Avatar" className="w-full h-full object-cover" />
            </div>
          </div>
        </div>
      </div>

      {/* KPI CARDS ROW */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
        <KPICard title="Revenue" value="₱ 432,850" trend="12.4%" trendUp icon={<DollarSign />} iconColor="text-emerald-400" />
        <KPICard title="Occupancy" value="72%" trend="8.6%" trendUp icon={<BedDouble />} iconColor="text-blue-400" />
        <KPICard title="ADR" value="₱ 6,250" trend="5.3%" trendUp icon={<DollarSign />} iconColor="text-purple-400" />
        <KPICard title="RevPAR" value="₱ 4,500" trend="14.1%" trendUp icon={<TrendingUp />} iconColor="text-amber-400" />
        <KPICard title="Total Guests" value="186" trend="9.8%" trendUp icon={<Users />} iconColor="text-sky-400" />
      </div>

      {/* REVENUE OVERVIEW CHART */}
      <div className="lux-card p-5 bg-card/40 backdrop-blur-sm border-border/40">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-body text-sm text-foreground uppercase tracking-wider">Revenue Overview</h3>
          <Button variant="outline" size="sm" className="h-7 text-[10px] uppercase font-body bg-transparent border-border/40">
            Daily <ChevronDown className="w-3 h-3 ml-1 opacity-50" />
          </Button>
        </div>
        <div className="flex flex-col md:flex-row gap-6">
          <div className="h-[250px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={MOCK_REVENUE_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D4B27A" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#D4B27A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="date" stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} dy={10} />
                <YAxis stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `₱${v / 1000}K`} />
                <RechartsTooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="revenue" stroke="#D4B27A" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="md:w-48 flex flex-col justify-center border-t md:border-t-0 md:border-l border-border/20 pt-4 md:pt-0 md:pl-6">
            <p className="font-body text-xs text-muted-foreground mb-1">Total Revenue</p>
            <p className="font-display text-3xl text-foreground mb-2">₱ 432,850</p>
            <p className="font-body text-xs text-emerald-400 flex items-center mb-1">▲ 12.4%</p>
            <p className="font-body text-[10px] text-muted-foreground">vs May 11 - May 17, 2025</p>
          </div>
        </div>
      </div>

      {/* CHARTS GRID: OCCUPANCY & ROOM STATUS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Occupancy Donut */}
        <div className="lux-card p-5 bg-card/40 backdrop-blur-sm border-border/40">
          <h3 className="font-body text-sm text-foreground uppercase tracking-wider mb-6">Occupancy Rate</h3>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="h-[160px] w-[160px] relative shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={MOCK_OCCUPANCY} innerRadius={55} outerRadius={75} paddingAngle={2} dataKey="value" stroke="none">
                    {MOCK_OCCUPANCY.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="font-display text-2xl text-foreground leading-none mb-1">72%</span>
                <span className="font-body text-[10px] text-muted-foreground uppercase">Average</span>
              </div>
            </div>
            <div className="flex-1 w-full space-y-3">
              {MOCK_OCCUPANCY.map((item, i) => (
                <div key={i} className="flex items-center justify-between font-body text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="text-foreground">{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-border/20 text-xs font-body text-emerald-400 flex items-center">
            ▲ 8.6% vs last week
          </div>
        </div>

        {/* Room Status Donut */}
        <div className="lux-card p-5 bg-card/40 backdrop-blur-sm border-border/40">
          <h3 className="font-body text-sm text-foreground uppercase tracking-wider mb-6">Room Status Summary</h3>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="h-[160px] w-[160px] relative shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={MOCK_ROOM_STATUS} innerRadius={55} outerRadius={75} paddingAngle={2} dataKey="value" stroke="none">
                    {MOCK_ROOM_STATUS.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <BedDouble className="w-4 h-4 text-muted-foreground mb-1" />
                <span className="font-display text-xl text-foreground leading-none mb-0.5">48</span>
                <span className="font-body text-[9px] text-muted-foreground uppercase">Total Rooms</span>
              </div>
            </div>
            <div className="flex-1 w-full space-y-3">
              {MOCK_ROOM_STATUS.map((item, i) => (
                <div key={i} className="flex items-center justify-between font-body text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground min-w-[80px]">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3 w-full justify-end">
                    <span className="text-foreground">{item.value}</span>
                    <span className="text-muted-foreground w-8 text-right">({item.percent}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-border/20">
            <Button variant="link" className="h-auto p-0 text-gold hover:text-gold/80 font-body text-xs">
              View Housekeeping Board <ArrowUpRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* CHARTS GRID: DEPARTMENT & REQUESTS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Department Performance */}
        <div className="lux-card p-5 bg-card/40 backdrop-blur-sm border-border/40 flex flex-col">
          <h3 className="font-body text-sm text-foreground uppercase tracking-wider mb-6">Department Performance</h3>
          <div className="flex-1 h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={MOCK_DEPARTMENTS} layout="vertical" margin={{ top: 0, right: 30, left: -20, bottom: 0 }} barSize={12}>
                <XAxis type="number" hide domain={[0, 100]} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} stroke="#ffffff60" fontSize={11} width={100} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {MOCK_DEPARTMENTS.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Custom X Axis Labels below the chart to simulate the image */}
          <div className="flex justify-between pl-[80px] pr-[30px] font-body text-[10px] text-muted-foreground mt-2">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
          <div className="mt-4 pt-4 border-t border-border/20">
            <Button variant="link" className="h-auto p-0 text-gold hover:text-gold/80 font-body text-xs">
              View All Departments <ArrowUpRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>

        {/* Service Requests */}
        <div className="lux-card p-5 bg-card/40 backdrop-blur-sm border-border/40 flex flex-col">
          <h3 className="font-body text-sm text-foreground uppercase tracking-wider mb-6">Service Requests</h3>
          <div className="flex-1 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="h-[160px] w-[160px] relative shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={MOCK_REQUESTS} innerRadius={55} outerRadius={75} paddingAngle={2} dataKey="value" stroke="none">
                    {MOCK_REQUESTS.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="font-display text-2xl text-foreground leading-none mb-1">24</span>
                <span className="font-body text-[10px] text-muted-foreground uppercase">Total</span>
              </div>
            </div>
            <div className="flex-1 w-full space-y-3">
              {MOCK_REQUESTS.map((item, i) => (
                <div key={i} className="flex items-center justify-between font-body text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground min-w-[80px]">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3 w-full justify-end">
                    <span className="text-foreground">{item.value}</span>
                    <span className="text-muted-foreground w-10 text-right">({item.percent}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-border/20">
            <Button variant="link" className="h-auto p-0 text-gold hover:text-gold/80 font-body text-xs">
              View All Requests <ArrowUpRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* BOTTOM ROW: REVENUE SOURCES & INSIGHTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* Top Revenue Sources (Takes 2 columns on large screens) */}
        <div className="lux-card p-5 bg-card/40 backdrop-blur-sm border-border/40 lg:col-span-2 flex flex-col">
          <h3 className="font-body text-sm text-foreground uppercase tracking-wider mb-6">Top Revenue Sources</h3>
          <div className="flex-1 overflow-x-auto scrollbar-hide">
            <table className="w-full min-w-[400px]">
              <thead>
                <tr className="border-b border-border/20">
                  <th className="text-left font-body text-[10px] text-muted-foreground uppercase pb-3 font-normal">Source</th>
                  <th className="text-left font-body text-[10px] text-muted-foreground uppercase pb-3 font-normal">Revenue</th>
                  <th className="text-left font-body text-[10px] text-muted-foreground uppercase pb-3 font-normal">Percentage</th>
                  <th className="text-right font-body text-[10px] text-muted-foreground uppercase pb-3 font-normal pr-2">Trend</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_REVENUE_SOURCES.map((source, i) => (
                  <tr key={i} className="border-b border-border/10 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded bg-white/5 border border-white/5">{source.icon}</div>
                        <span className="font-body text-xs text-foreground">{source.source}</span>
                      </div>
                    </td>
                    <td className="py-4 font-display text-sm text-foreground">₱ {source.revenue.toLocaleString()}</td>
                    <td className="py-4 font-body text-xs text-muted-foreground">{source.percentage}%</td>
                    <td className="py-4 text-right pr-2">
                      <div className="flex justify-end">
                        <Sparkline data={source.trendData} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 pt-4 border-t border-border/20">
            <Button variant="link" className="h-auto p-0 text-gold hover:text-gold/80 font-body text-xs">
              View Full Report <ArrowUpRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>

        {/* Insights List */}
        <div className="lux-card p-5 bg-card/40 backdrop-blur-sm border-border/40 flex flex-col">
          <h3 className="font-body text-sm text-foreground uppercase tracking-wider mb-6">Insights</h3>
          <div className="flex-1 space-y-6">
            
            <div className="flex gap-3">
              <div className="mt-0.5 p-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 shrink-0 h-fit">
                <Lightbulb className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div>
                <p className="font-body text-xs text-emerald-400 mb-1">Revenue is up 12.4%</p>
                <p className="font-body text-xs text-muted-foreground leading-relaxed">Great job! Your revenue increased compared to last week.</p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <div className="mt-0.5 p-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 shrink-0 h-fit">
                <Activity className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div>
                <p className="font-body text-xs text-blue-400 mb-1">Occupancy improving</p>
                <p className="font-body text-xs text-muted-foreground leading-relaxed">Your occupancy rate improved by 8.6% this week.</p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <div className="mt-0.5 p-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 shrink-0 h-fit">
                <UserPlus className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div>
                <p className="font-body text-xs text-purple-400 mb-1">More guests</p>
                <p className="font-body text-xs text-muted-foreground leading-relaxed">You hosted 17 more guests compared to last week.</p>
              </div>
            </div>

          </div>
          <div className="mt-6 pt-4 border-t border-border/20">
            <Button variant="link" className="h-auto p-0 text-gold hover:text-gold/80 font-body text-xs">
              View All Insights <ArrowUpRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ReportsDashboard;
