import { useMemo, useState } from 'react';
import { View, Text, LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Path, Circle, Line, G, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useThemeColors } from '@/lib/theme';

// Renders MODUS charts on mobile (parity with the web ChartCard). MODUS emits
// ```chart { json }``` and this draws a native SVG chart. Interactive: tap a
// bar / point / slice to see its value. Robust: bad JSON or empty data shows a
// small notice instead of crashing.

type ChartSpec = {
  type?: 'bar' | 'line' | 'area' | 'pie';
  title?: string;
  unit?: string;
  data?: Record<string, string | number>[];
};

const PALETTE = ['#7C3AED', '#A78BFA', '#C084FC', '#6D28D9', '#818CF8', '#D8B4FE'];
const H = 220;

export function ChartCard({ raw }: { raw: string }) {
  const c = useThemeColors();
  const [w, setW] = useState(0);
  const [active, setActive] = useState<{ si: number; idx: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const spec = useMemo<ChartSpec | null>(() => {
    try {
      const p = JSON.parse(raw) as ChartSpec;
      if (!p || !Array.isArray(p.data) || p.data.length === 0) return null;
      // `k in data[0]` throws on a number or null row ({"data":[1,2]}), which
      // crashed the whole chat render. Every row must be a plain object.
      if (!p.data.every(r => r !== null && typeof r === 'object' && !Array.isArray(r))) return null;
      return p;
    } catch {
      return null;
    }
  }, [raw]);

  if (!spec) {
    return (
      <View className="rounded-xl border border-border bg-surface px-4 py-3">
        <Text className="text-muted text-xs">Couldn&apos;t render this chart.</Text>
      </View>
    );
  }

  const data = spec.data!;
  const type = spec.type ?? 'bar';
  const labelKey = ['label', 'name', 'x', 'category'].find(k => k in data[0]) ?? Object.keys(data[0])[0];
  const seriesKeys = Object.keys(data[0]).filter(k => k !== labelKey && typeof data[0][k] === 'number');
  const keys = seriesKeys.length ? seriesKeys : ['value'];
  const unit = spec.unit ?? '';
  const num = (r: Record<string, string | number>, k: string) => (typeof r[k] === 'number' ? (r[k] as number) : Number(r[k]) || 0);
  const maxV = Math.max(1, ...data.flatMap(r => keys.map(k => num(r, k))));

  const padL = 34, padR = 10, padT = 10, padB = 24;
  const innerW = Math.max(0, w - padL - padR);
  const innerH = H - padT - padB;
  const baseY = padT + innerH;
  const xCenter = (idx: number) => padL + (innerW / data.length) * (idx + 0.5);
  const yFor = (v: number) => padT + innerH - (v / maxV) * innerH;

  const gridColor = c.border;
  const labelColor = c.muted;

  // Tooltip for the tapped element (SVG overlay). Position depends on chart type.
  function tooltip() {
    if (!active) return null;
    const row = data[active.idx];
    if (!row) return null;
    const val = num(row, keys[active.si] ?? keys[0]);
    const text = `${String(row[labelKey])}: ${val}${unit}`;
    const tw = Math.min(w - 8, text.length * 6.2 + 16);
    let tx: number, ty: number;
    if (type === 'pie') { tx = w / 2 - tw / 2; ty = 6; }
    else {
      const cx = xCenter(active.idx);
      tx = Math.max(4, Math.min(w - tw - 4, cx - tw / 2));
      const topY = type === 'bar' ? baseY - (val / maxV) * innerH : yFor(val);
      ty = Math.max(2, topY - 26);
    }
    return (
      <G>
        <Rect x={tx} y={ty} width={tw} height={20} rx={6} fill={c.text} opacity={0.92} />
        <SvgText x={tx + tw / 2} y={ty + 13.5} fontSize={11} fontWeight="600" fill={c.surface} textAnchor="middle">{text}</SvgText>
      </G>
    );
  }

  function renderBody() {
    if (type === 'pie') {
      const cx = w / 2, cy = H / 2, R = Math.min(w, H) / 2 - 16, r0 = R * 0.5;
      const total = data.reduce((s, row) => s + num(row, keys[0]), 0) || 1;
      let a0 = -Math.PI / 2;
      return data.map((row, idx) => {
        const frac = num(row, keys[0]) / total;
        const a1 = a0 + frac * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (ang: number, rad: number) => `${cx + rad * Math.cos(ang)} ${cy + rad * Math.sin(ang)}`;
        const d = `M ${p(a0, r0)} L ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(a0, r0)} Z`;
        a0 = a1;
        const on = active?.idx === idx;
        return <Path key={idx} d={d} fill={PALETTE[idx % PALETTE.length]} opacity={active && !on ? 0.5 : 1} onPress={() => setActive({ si: 0, idx })} />;
      });
    }

    if (type === 'line' || type === 'area') {
      return keys.map((k, si) => {
        const pts = data.map((row, idx) => `${xCenter(idx)},${yFor(num(row, k))}`);
        const line = `M ${pts.join(' L ')}`;
        const color = PALETTE[si % PALETTE.length];
        return (
          <G key={k}>
            {type === 'area' && (
              <Path d={`${line} L ${xCenter(data.length - 1)},${baseY} L ${xCenter(0)},${baseY} Z`} fill={`url(#grad${si})`} />
            )}
            <Path d={line} stroke={color} strokeWidth={2.5} fill="none" />
            {data.map((row, idx) => {
              const on = active?.si === si && active?.idx === idx;
              return (
                <G key={idx}>
                  <Circle cx={xCenter(idx)} cy={yFor(num(row, k))} r={on ? 5 : 3} fill={color} />
                  {/* larger transparent hit target for easy tapping */}
                  <Circle cx={xCenter(idx)} cy={yFor(num(row, k))} r={14} fill="transparent" onPress={() => setActive({ si, idx })} />
                </G>
              );
            })}
          </G>
        );
      });
    }

    // bar (grouped when multiple series)
    const groupW = innerW / data.length;
    const barPad = groupW * 0.18;
    const usable = groupW - barPad * 2;
    const barW = usable / keys.length;
    return data.map((row, idx) =>
      keys.map((k, si) => {
        const v = num(row, k);
        const h = (v / maxV) * innerH;
        const x = padL + idx * groupW + barPad + si * barW;
        const on = active?.si === si && active?.idx === idx;
        return (
          <Rect
            key={`${idx}-${k}`} x={x} y={baseY - h} width={Math.max(1, barW - 2)} height={Math.max(0, h)} rx={3}
            fill={PALETTE[si % PALETTE.length]} opacity={active && !on ? 0.55 : 1}
            onPress={() => setActive({ si, idx })}
          />
        );
      }),
    );
  }

  return (
    <View className="w-full rounded-xl border border-border bg-surface p-3">
      {spec.title ? <Text className="text-text text-sm font-semibold mb-2">{spec.title}</Text> : null}
      <View onLayout={onLayout} style={{ height: H }}>
        {w > 0 && (
          <Svg width={w} height={H}>
            <Defs>
              {keys.map((_, si) => (
                <LinearGradient key={si} id={`grad${si}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={PALETTE[si % PALETTE.length]} stopOpacity={0.32} />
                  <Stop offset="1" stopColor={PALETTE[si % PALETTE.length]} stopOpacity={0.02} />
                </LinearGradient>
              ))}
            </Defs>

            {/* gridlines + y labels (skip for pie) */}
            {type !== 'pie' && [0, 0.5, 1].map((t, gi) => {
              const y = padT + innerH * (1 - t);
              return (
                <G key={gi}>
                  <Line x1={padL} y1={y} x2={w - padR} y2={y} stroke={gridColor} strokeWidth={1} />
                  <SvgText x={padL - 6} y={y + 3} fontSize={9} fill={labelColor} textAnchor="end">
                    {Math.round(maxV * t)}{unit}
                  </SvgText>
                </G>
              );
            })}

            {renderBody()}

            {/* x labels (skip for pie) */}
            {type !== 'pie' && data.map((row, idx) => (
              <SvgText key={idx} x={xCenter(idx)} y={H - 8} fontSize={9} fill={labelColor} textAnchor="middle">
                {String(row[labelKey])}
              </SvgText>
            ))}

            {tooltip()}
          </Svg>
        )}
      </View>

      {/* legend for multi-series / pie */}
      {(keys.length > 1 || type === 'pie') && (
        <View className="flex-row flex-wrap gap-x-3 gap-y-1 mt-2">
          {(type === 'pie' ? data.map(r => String(r[labelKey])) : keys).map((name, i) => (
            <View key={name} className="flex-row items-center gap-1.5">
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: PALETTE[i % PALETTE.length] }} />
              <Text className="text-muted text-[11px]">{name}</Text>
            </View>
          ))}
        </View>
      )}

      <Text className="text-muted/60 text-[10px] mt-1.5">Tap a {type === 'pie' ? 'slice' : type === 'bar' ? 'bar' : 'point'} to see its value</Text>
    </View>
  );
}
