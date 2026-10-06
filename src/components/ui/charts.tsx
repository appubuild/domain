import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompactCurrency, formatNumber } from '@/lib/format';

const AXIS = { stroke: 'hsl(var(--muted-foreground))', fontSize: 11, tickLine: false, axisLine: false };

const tooltipStyle = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 10,
    fontSize: 12,
    color: 'hsl(var(--popover-foreground))',
    boxShadow: '0 12px 40px -12px rgb(15 23 42 / 0.35)',
  },
  labelStyle: { color: 'hsl(var(--muted-foreground))', fontSize: 11, marginBottom: 2 },
};

export function RevenueAreaChart({
  data,
  dataKey = 'value',
  xKey = 'label',
  height = 240,
  currency = true,
  color = 'hsl(var(--primary))',
  secondaryKey,
  secondaryLabel,
}: {
  data: Record<string, unknown>[];
  dataKey?: string;
  xKey?: string;
  height?: number;
  currency?: boolean;
  color?: string;
  secondaryKey?: string;
  secondaryLabel?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(value) => (currency ? formatCompactCurrency(Number(value)) : formatNumber(Number(value)))} width={64} />
        <Tooltip
          {...tooltipStyle}
          formatter={(value: number | string, name: string) => [
            currency ? formatCompactCurrency(Number(value)) : formatNumber(Number(value)),
            name === dataKey ? (currency ? 'Revenue' : 'Count') : name,
          ]}
        />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#grad-${dataKey})`} name={currency ? 'Revenue' : 'Count'} />
        {secondaryKey && (
          <Line type="monotone" dataKey={secondaryKey} stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name={secondaryLabel ?? secondaryKey} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarsChart({
  data,
  dataKey,
  xKey = 'label',
  height = 240,
  color = 'hsl(var(--primary))',
  currency,
  stackedKey,
  stackedLabel,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  xKey?: string;
  height?: number;
  color?: string;
  currency?: boolean;
  stackedKey?: string;
  stackedLabel?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(value) => (currency ? formatCompactCurrency(Number(value)) : formatNumber(Number(value)))} width={64} />
        <Tooltip
          {...tooltipStyle}
          formatter={(value: number | string) => (currency ? formatCompactCurrency(Number(value)) : formatNumber(Number(value)))}
        />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={38} name={currency ? 'Revenue' : 'Count'} />
        {stackedKey && <Bar dataKey={stackedKey} fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} maxBarSize={38} name={stackedLabel ?? stackedKey} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LinesChart({
  data,
  series,
  xKey = 'label',
  height = 240,
}: {
  data: Record<string, unknown>[];
  series: { key: string; label: string; color: string }[];
  xKey?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} />
        <YAxis {...AXIS} width={48} tickFormatter={(value) => formatNumber(Number(value))} />
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((entry) => (
          <Line key={entry.key} type="monotone" dataKey={entry.key} name={entry.label} stroke={entry.color} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

const DONUT_COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#38bdf8', '#34d399', '#f472b6', '#facc15', '#a78bfa'];

export function DonutChart({
  data,
  height = 220,
  innerRadius = 52,
  currency,
}: {
  data: { name: string; value: number }[];
  height?: number;
  innerRadius?: number;
  currency?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={innerRadius} outerRadius={82} paddingAngle={2} strokeWidth={0}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle} formatter={(value: number | string) => (currency ? formatCompactCurrency(Number(value)) : formatNumber(Number(value)))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data, dataKey = 'value', color = 'hsl(var(--primary))', height = 40 }: { data: Record<string, unknown>[]; dataKey?: string; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.12} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
