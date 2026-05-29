import React, { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import { WeatherPoint } from '../types';
import {
  get24hData,
  get7dData,
  get1mData,
  getFullData,
  seedDemoData,
  SeedBase,
} from '../services/storageService';
import {
  Thermometer,
  Droplets,
  Gauge,
  Wind,
  CloudRain,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period    = '24h' | '7j' | '1m' | 'all';
type MetricKey = 'temperature' | 'humidity' | 'pressure' | 'windSpeed' | 'precipitation';
type ChartType = 'area' | 'line' | 'bar';

interface MetricCfg {
  key:        MetricKey;
  normKey:    string;
  label:      string;
  unit:       string;
  color:      string;
  gradId:     string;
  Icon:       React.ComponentType<{ className?: string }>;
  min:        number;
  max:        number;
  chartType:  ChartType;
  dashArray?: string;
}

// ── Configuration des métriques ───────────────────────────────────────────────

const METRICS: MetricCfg[] = [
  {
    key: 'temperature', normKey: 'n_temp',
    label: 'Température', unit: '°C',
    color: '#C04A2A', gradId: 'g_temp',
    Icon: Thermometer, min: -5, max: 45, chartType: 'area',
  },
  {
    key: 'humidity', normKey: 'n_hum',
    label: 'Humidité', unit: '%',
    color: '#0284C7', gradId: 'g_hum',
    Icon: Droplets, min: 0, max: 100, chartType: 'area',
  },
  {
    key: 'pressure', normKey: 'n_pres',
    label: 'Pression', unit: ' hPa',
    color: '#7C3AED', gradId: 'g_pres',
    Icon: Gauge, min: 980, max: 1040, chartType: 'line', dashArray: '5 3',
  },
  {
    key: 'windSpeed', normKey: 'n_wind',
    label: 'Vent', unit: ' km/h',
    color: '#059669', gradId: 'g_wind',
    Icon: Wind, min: 0, max: 60, chartType: 'line',
  },
  {
    key: 'precipitation', normKey: 'n_rain',
    label: 'Précipitations', unit: ' mm',
    color: '#0891B2', gradId: 'g_rain',
    Icon: CloudRain, min: 0, max: 15, chartType: 'bar',
  },
];

const PERIODS: { label: string; value: Period; desc: string }[] = [
  { label: '24H',  value: '24h', desc: 'Dernières 24 heures' },
  { label: '7J',   value: '7j',  desc: 'Derniers 7 jours'    },
  { label: '1M',   value: '1m',  desc: 'Dernier mois'        },
  { label: 'Tout', value: 'all', desc: 'Historique complet'  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise une valeur dans [0, 100] pour l'affichage unifié sur un seul axe */
const norm = (v: number, min: number, max: number) =>
  Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

/** Transforme les WeatherPoints → données normalisées pour Recharts */
function toChartData(raw: WeatherPoint[]): Record<string, unknown>[] {
  return raw.map(p => ({
    ...p,
    n_temp: norm(p.temperature,    -5,  45),
    n_hum:  norm(p.humidity,        0, 100),
    n_pres: norm(p.pressure,      980, 1040),
    n_wind: norm(p.windSpeed,       0,  60),
    n_rain: norm(p.precipitation,   0,  15),
  }));
}

function calcStats(data: WeatherPoint[], key: MetricKey) {
  if (!data.length) return { min: 0, max: 0, avg: 0 };
  const vals = data.map(p => p[key] as number);
  return {
    min: Number(Math.min(...vals).toFixed(1)),
    max: Number(Math.max(...vals).toFixed(1)),
    avg: Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1)),
  };
}

// ── Tooltip personnalisé ──────────────────────────────────────────────────────

const CustomTooltip: React.FC<
  TooltipProps<number, string> & { visible: Set<MetricKey> }
> = ({ active, payload, label, visible }) => {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload as WeatherPoint;

  return (
    <div className="bg-white/95 backdrop-blur-2xl border border-gray-100 rounded-2xl shadow-2xl p-4 min-w-[190px] pointer-events-none">
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.15em] mb-3 pb-2 border-b border-gray-100">
        {label}
      </p>
      <div className="space-y-1.5">
        {METRICS.filter(m => visible.has(m.key)).map(m => (
          <div key={m.key} className="flex items-center justify-between gap-5">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: m.color }}
              />
              <span className="text-[11px] text-gray-500 font-medium">{m.label}</span>
            </div>
            <span className="text-[11px] font-black text-gray-800 tabular-nums">
              {pt[m.key] !== undefined
                ? `${(pt[m.key] as number)}${m.unit}`
                : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Badge statistiques ────────────────────────────────────────────────────────

const StatBadge: React.FC<{ m: MetricCfg; data: WeatherPoint[] }> = ({ m, data }) => {
  const s    = calcStats(data, m.key);
  const Icon = m.Icon;
  return (
    <div
      className="flex-shrink-0 w-[130px] rounded-2xl p-3 border"
      style={{
        background:   `${m.color}08`,
        borderColor:  `${m.color}20`,
      }}
    >
      <div className="flex items-center gap-1.5 mb-2.5">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: m.color }} />
        <span className="text-[10px] font-black uppercase tracking-wider truncate" style={{ color: m.color }}>
          {m.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        {([
          { lbl: 'Min', val: s.min, I: TrendingDown },
          { lbl: 'Moy', val: s.avg, I: Minus        },
          { lbl: 'Max', val: s.max, I: TrendingUp   },
        ] as const).map(({ lbl, val, I }) => (
          <div key={lbl}>
            <I className="w-3 h-3 mx-auto mb-0.5 text-gray-300" />
            <p className="text-[9px] text-gray-400 leading-none mb-0.5">{lbl}</p>
            <p className="text-[11px] font-black tabular-nums leading-none" style={{ color: m.color }}>
              {val}{m.unit.trim()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Composant principal ───────────────────────────────────────────────────────

interface WeatherChartProps {
  /** Incrémenté par le parent pour déclencher un rechargement */
  refreshTrigger?: number;
  /** Vraies valeurs capteurs du dashboard — utilisées pour ancrer le seed */
  currentValues?: SeedBase;
}

export const WeatherChart: React.FC<WeatherChartProps> = ({
  refreshTrigger = 0,
  currentValues,
}) => {
  const [period,    setPeriod]    = useState<Period>('24h');
  const [rawData,   setRawData]   = useState<WeatherPoint[]>([]);
  const [chartData, setChartData] = useState<Record<string, unknown>[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [animKey,   setAnimKey]   = useState(0);

  // Métriques visibles — persistées dans localStorage
  const [visible, setVisible] = useState<Set<MetricKey>>(() => {
    try {
      const saved = localStorage.getItem('vinya_visible_metrics');
      if (saved) return new Set(JSON.parse(saved) as MetricKey[]);
    } catch { /* ignore */ }
    return new Set(['temperature', 'humidity', 'windSpeed', 'precipitation'] as MetricKey[]);
  });

  // Persiste la sélection
  useEffect(() => {
    localStorage.setItem('vinya_visible_metrics', JSON.stringify([...visible]));
  }, [visible]);

  const loadData = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      // Passe les vraies valeurs capteurs pour ancrer l'historique simulé
      await seedDemoData(currentValues);
      const result =
        p === '24h' ? await get24hData() :
        p === '7j'  ? await get7dData()  :
        p === '1m'  ? await get1mData()  :
                      await getFullData();
      setRawData(result);
      setChartData(toChartData(result));
      setAnimKey(k => k + 1);
    } catch (err) {
      console.error('[WeatherChart]', err);
    } finally {
      setLoading(false);
    }
  }, [currentValues]);

  useEffect(() => { loadData(period); }, [period, loadData, refreshTrigger]);

  const toggle = (key: MetricKey) =>
    setVisible(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const currentPeriod = PERIODS.find(p => p.value === period)!;

  return (
    <div
      className="rounded-[2rem] border overflow-hidden"
      style={{
        background:   'linear-gradient(145deg, rgba(255,255,255,0.92), rgba(254,250,224,0.6))',
        backdropFilter: 'blur(24px)',
        borderColor:  'rgba(255,255,255,0.8)',
        boxShadow:    '0 8px 48px rgba(100,13,20,0.07), 0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div className="p-6 md:p-8">

        {/* ── En-tête ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h3 className="text-2xl font-serif font-black text-vinya-secondary leading-tight">
              Historique Météo
            </h3>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mt-1">
              {currentPeriod.desc} &middot; {rawData.length} points agrégés
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Bouton refresh */}
            <button
              onClick={() => loadData(period)}
              disabled={loading}
              className="p-2.5 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors text-gray-400 hover:text-vinya-secondary disabled:opacity-40"
              title="Rafraîchir"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Sélecteur de période */}
            <div className="flex gap-1 bg-gray-100/70 rounded-xl p-1">
              {PERIODS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`
                    px-3.5 py-1.5 rounded-lg text-[11px] font-black tracking-wider
                    transition-all duration-300 select-none
                    ${period === p.value
                      ? 'bg-vinya-secondary text-white shadow-md scale-105'
                      : 'text-gray-400 hover:text-gray-700 hover:bg-white/50'
                    }
                  `}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Légende interactive ── */}
        <div className="flex flex-wrap gap-2 mb-6">
          {METRICS.map(m => {
            const on   = visible.has(m.key);
            const Icon = m.Icon;
            return (
              <button
                key={m.key}
                onClick={() => toggle(m.key)}
                title={on ? `Masquer ${m.label}` : `Afficher ${m.label}`}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-full border
                  text-[11px] font-bold transition-all duration-200 select-none
                  ${on
                    ? 'text-white border-transparent shadow-sm'
                    : 'text-gray-400 bg-transparent border-gray-200 hover:border-gray-300 hover:text-gray-600'
                  }
                `}
                style={on ? { background: m.color, borderColor: m.color } : {}}
              >
                <Icon className="w-3 h-3" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* ── Graphique ── */}
        <div className="relative h-[340px] w-full">

          {/* Overlay de chargement */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 rounded-2xl bg-white/40 backdrop-blur-sm">
              <div className="flex items-center gap-2.5 bg-white/90 backdrop-blur px-5 py-2.5 rounded-full shadow-lg border border-gray-100">
                <RefreshCw className="w-4 h-4 text-vinya-secondary animate-spin" />
                <span className="text-xs font-bold text-gray-500">Chargement des données…</span>
              </div>
            </div>
          )}

          {/* Message vide */}
          {!loading && rawData.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400">
              <CloudRain className="w-10 h-10 opacity-20" />
              <p className="text-sm font-bold">Aucune donnée pour cette période</p>
            </div>
          )}

          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              key={animKey}
              data={chartData}
              margin={{ top: 8, right: 8, left: -28, bottom: 0 }}
            >
              {/* Dégradés pour les Areas */}
              <defs>
                {METRICS.filter(m => m.chartType === 'area').map(m => (
                  <linearGradient key={m.gradId} id={m.gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={m.color} stopOpacity={0.20} />
                    <stop offset="95%" stopColor={m.color} stopOpacity={0.01} />
                  </linearGradient>
                ))}
              </defs>

              <CartesianGrid
                strokeDasharray="2 5"
                vertical={false}
                stroke="#F1F5F9"
              />

              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#CBD5E1', fontSize: 10, fontWeight: 700 }}
                interval="preserveStartEnd"
                dy={8}
              />

              {/* Axe Y unifié 0–100 (valeurs normalisées, vraies valeurs dans le tooltip) */}
              <YAxis domain={[0, 105]} hide />

              <Tooltip
                content={(props) => (
                  <CustomTooltip {...props} visible={visible} />
                )}
                cursor={{
                  stroke:          '#E2E8F0',
                  strokeWidth:      1,
                  strokeDasharray: '4 3',
                }}
              />

              {/* Rendu conditionnel de chaque métrique */}
              {METRICS.map(m => {
                if (!visible.has(m.key)) return null;

                if (m.chartType === 'bar') return (
                  <Bar
                    key={m.key}
                    dataKey={m.normKey}
                    fill={m.color}
                    opacity={0.70}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={16}
                    animationDuration={700}
                    animationEasing="ease-out"
                  />
                );

                if (m.chartType === 'area') return (
                  <Area
                    key={m.key}
                    type="monotone"
                    dataKey={m.normKey}
                    stroke={m.color}
                    strokeWidth={2.5}
                    fill={`url(#${m.gradId})`}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 0, fill: m.color }}
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                );

                // line
                return (
                  <Line
                    key={m.key}
                    type="monotone"
                    dataKey={m.normKey}
                    stroke={m.color}
                    strokeWidth={2}
                    strokeDasharray={m.dashArray}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 0, fill: m.color }}
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ── Ligne de repère de l'échelle normalisée ── */}
        <p className="text-[9px] text-gray-300 text-right mt-2 font-medium select-none">
          Axe normalisé 0–100 · valeurs réelles dans le tooltip
        </p>
      </div>

      {/* ── Barre de statistiques ── */}
      {rawData.length > 0 && (
        <div
          className="px-6 md:px-8 py-5 border-t"
          style={{ borderColor: 'rgba(100,13,20,0.06)', background: 'rgba(254,250,224,0.3)' }}
        >
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
            Statistiques · {currentPeriod.desc}
          </p>
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-custom">
            {METRICS.filter(m => visible.has(m.key)).map(m => (
              <StatBadge key={m.key} m={m} data={rawData} />
            ))}
            {visible.size === 0 && (
              <p className="text-xs text-gray-400 italic py-2">
                Activez au moins une métrique via la légende.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
