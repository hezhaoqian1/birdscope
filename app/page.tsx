"use client";
import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Tooltip as ShTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useArbStore } from "@/lib/store";
import { AnalyzeResult, DualMarketInput, nearArbSuggestions } from "@/lib/arbitrage";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Legend, ReferenceLine, Area, ReferenceArea, ReferenceDot, AreaChart } from "recharts";
import { Coins, TrendingUp, ShieldCheck, Percent, PiggyBank, Wallet, Target } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/theme-toggle";

type FieldErrors = Partial<Record<string, string>>;

export default function Home() {
  const { markets, setMarkets, budget, setBudget, fees, setFees, result, analyze } = useArbStore();
  const [y, setY] = useState<number | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [safetyMargin, setSafetyMargin] = useState(0.001); // 0.1%

  const onAnalyze = () => {
    setErrors({});
    analyze();
  };

  const yRange = result?.y_range ?? null;
  const yEqual = result?.y_equal ?? null;
  const activeY = useMemo(() => {
    if (!yRange) return null;
    if (y == null) return yEqual ?? yRange[0];
    const [min, max] = yRange;
    return Math.min(max, Math.max(min, y));
  }, [y, yRange, yEqual]);

  const activePoint = useMemo(() => {
    if (!result?.graph || activeY == null) return null;
    // find nearest
    let best = result.graph[0];
    let bestDiff = Math.abs(result.graph[0].y - activeY);
    for (const p of result.graph) {
      const diff = Math.abs(p.y - activeY);
      if (diff < bestDiff) {
        best = p;
        bestDiff = diff;
      }
    }
    return best;
  }, [result, activeY]);

  const eqPoint = useMemo(() => {
    if (!result?.graph || result.y_equal == null) return null;
    const target = result.y_equal;
    let best = result.graph[0];
    let bestDiff = Math.abs(result.graph[0].y - target);
    for (const p of result.graph) {
      const diff = Math.abs(p.y - target);
      if (diff < bestDiff) { best = p; bestDiff = diff; }
    }
    return best;
  }, [result]);

  useEffect(() => {
    if (autoAnalyze) analyze();
  }, [markets, budget, fees, autoAnalyze]);

  const money = (n?: number) => n == null ? '-' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (r?: number) => r == null ? '-' : `${(r * 100).toFixed(2)}%`;

  // Apply targets from helper suggestions
  const applyTargetCross = (which: 'O' | 'P') => {
    const hints = nearArbSuggestions(markets[0] as any, markets[1] as any);
    if (!hints.length) return;
    const best = hints[0];
    if (best.kind !== 'Cross-Market') return;
    const t: any = best.targets;
    const next = [...markets] as DualMarketInput[];
    const predIndex = next[0].type === 'predict' ? 0 : 1;
    const bookIndex = 1 - predIndex;
    if (which === 'O') {
      const target = Number((t.O_min * (1 + safetyMargin)).toFixed(4));
      const book = { ...(next[bookIndex] as any) };
      if (t.bookSide === 'YES') book.yesOdds = target; else book.noOdds = target;
      next[bookIndex] = { type: 'book', yesOdds: book.yesOdds, noOdds: book.noOdds, oddsFormat: (book.oddsFormat ?? 'decimal') } as any;
    } else {
      const target = Number((t.P_max * (1 - safetyMargin)).toFixed(4));
      const pred = { ...(next[predIndex] as any) };
      if (t.predSide === 'YES') pred.yesPrice = target; else pred.noPrice = target;
      next[predIndex] = { type: 'predict', yesPrice: pred.yesPrice, noPrice: pred.noPrice } as any;
    }
    setMarkets(next);
    if (autoAnalyze) analyze();
  };

  const applyTargetBook = (which: 1 | 2) => {
    const hints = nearArbSuggestions(markets[0] as any, markets[1] as any);
    if (!hints.length) return;
    const best = hints[0];
    if (best.kind !== 'Book-Book') return;
    const t: any = best.targets;
    const next = [...markets] as DualMarketInput[];
    // We don't know which side lives in which market; try both to set matching side
    const targetVal = Number(( (which === 1 ? t.O1_min : t.O2_min) * (1 + safetyMargin)).toFixed(4));
    const setSide = (m: any, side: 'YES'|'NO', val: number) => { if (side === 'YES') m.yesOdds = val; else m.noOdds = val; };
    const a = { ...(next[0] as any) }; const b = { ...(next[1] as any) };
    if (a.type === 'book') setSide(a, which === 1 ? t.sideA : t.sideB, targetVal);
    if (b.type === 'book') setSide(b, which === 1 ? t.sideA : t.sideB, targetVal);
    next[0] = a.type === 'book' ? { type: 'book', yesOdds: a.yesOdds, noOdds: a.noOdds, oddsFormat: (a.oddsFormat ?? 'decimal') } as any : next[0];
    next[1] = b.type === 'book' ? { type: 'book', yesOdds: b.yesOdds, noOdds: b.noOdds, oddsFormat: (b.oddsFormat ?? 'decimal') } as any : next[1];
    setMarkets(next);
    if (autoAnalyze) analyze();
  };

  const marginInfo = useMemo(() => {
    if (!result?.inputsUsed) return null;
    if (result.type === 'Cross-Market') {
      const u: any = result.inputsUsed;
      const delta = 1 - (u.P + 1 / u.O); // >0 is headroom
      return { kind: 'Cross-Market', delta, formula: `1 - (P + 1/O) = ${(1 - (u.P + 1/u.O)).toFixed(4)}` } as const;
    }
    if (result.type === 'Book-Book') {
      const u: any = result.inputsUsed;
      const delta = 1 - (1 / u.O1 + 1 / u.O2);
      return { kind: 'Book-Book', delta, formula: `1 - (1/O1 + 1/O2) = ${(1 - (1/u.O1 + 1/u.O2)).toFixed(4)}` } as const;
    }
    return null;
  }, [result]);

  const minProfitSeries = useMemo(() => {
    if (!result?.graph) return [] as { y: number; p: number }[];
    return result.graph.map(g => ({ y: g.y, p: Math.min(g.profitA, g.profitB) }));
  }, [result]);

  return (
    <div className="min-h-screen w-full bg-background text-foreground relative">
      <div className="absolute inset-0 grid-overlay" />
      <div className="mx-auto max-w-7xl p-6 md:p-10 space-y-6 relative">
        <div className="aurora-header rounded-2xl p-4 md:p-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight bg-gradient-to-r from-emerald-400 via-sky-400 to-indigo-400 bg-clip-text text-transparent">BirdScope</h1>
            <div className="text-xs md:text-sm opacity-70 mt-1">智能套利检测器 · Quant Dashboard</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="rounded-full">MVP</Badge>
            <Badge className="rounded-full" variant="outline">Book-Book</Badge>
            <Badge className="rounded-full" variant="outline">Cross-Market</Badge>
            <ThemeToggle />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MarketCard
            title="市场 A"
            market={markets[0]}
            onChange={(m) => setMarkets([m, markets[1]])}
          />
          <MarketCard
            title="市场 B"
            market={markets[1]}
            onChange={(m) => setMarkets([markets[0], m])}
          />
          <Card className="glass card-accent card-hover-lift">
            <CardHeader>
              <CardTitle>预算 / 手续费</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="budget">预算（B）</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-60">$</span>
                  <Input id="budget" type="number" inputMode="decimal" className="pl-7" value={budget} onChange={(e) => setBudget(Number(e.target.value || 0))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="bookFee">Book 盈利手续费</Label>
                  <div className="relative">
                    <Input id="bookFee" type="number" step="0.001" className="pr-8" value={fees.bookWinFee ?? 0} onChange={(e) => setFees({ ...fees, bookWinFee: clamp01Num(Number(e.target.value || 0)) })} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 opacity-60">%</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="polyFee">Poly 盈利手续费</Label>
                  <div className="relative">
                    <Input id="polyFee" type="number" step="0.001" className="pr-8" value={fees.polyWinFee ?? 0} onChange={(e) => setFees({ ...fees, polyWinFee: clamp01Num(Number(e.target.value || 0)) })} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 opacity-60">%</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm flex items-center gap-2">自动分析
                      <TooltipProvider><ShTooltip><TooltipTrigger asChild><span className="text-xs opacity-70 cursor-help">(?)</span></TooltipTrigger><TooltipContent>输入变化时自动重算；关闭则需点击“开始分析”。</TooltipContent></ShTooltip></TooltipProvider>
                    </div>
                    <div className="text-xs opacity-70">输入变更后自动计算</div>
                  </div>
                  <Switch checked={autoAnalyze} onCheckedChange={setAutoAnalyze} />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">安全边际 %
                    <TooltipProvider><ShTooltip><TooltipTrigger asChild><span className="text-xs opacity-70 cursor-help">(?)</span></TooltipTrigger><TooltipContent>应用助手目标时自动留出缓冲：提高 O 或降低 P，避免刚好卡在边界。默认 0.10%。</TooltipContent></ShTooltip></TooltipProvider>
                  </Label>
                  <Input type="number" step="0.05" value={(safetyMargin * 100).toFixed(2)} onChange={(e) => setSafetyMargin(Math.max(0, Number(e.target.value || 0) / 100))} />
                </div>
              </div>
              <div className="flex gap-3">
                <Button className="flex-1 btn-primary-gradient" onClick={onAnalyze}><span className="inline-flex items-center"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M19 5l-8 8-4-4-4 4"/></svg>开始分析</span></Button>
                <Button variant="outline" onClick={() => { setMarkets([{ type: 'predict', yesPrice: 0.55, noPrice: 0.45 }, { type: 'book', yesOdds: 1.6, noOdds: 2.3, oddsFormat: 'decimal' }]); setBudget(1000); }}>示例</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {result?.arbitrage && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="glass">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Percent className="h-4 w-4"/>ROI</CardTitle></CardHeader>
              <CardContent>
                <div className="text-4xl font-semibold metric-kpi">{pct(result.roi_equal)}</div>
                <div className="text-xs opacity-70 mt-1">等利润点的年化率（单笔 ROI）</div>
                {!!minProfitSeries.length && (
                  <div className="mt-3 h-[36px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={minProfitSeries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="minP" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <Area dataKey="p" stroke="none" fill="url(#minP)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="glass">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><PiggyBank className="h-4 w-4"/>固定利润</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">${money(result.profit_equal)}</div>
                <div className="text-xs opacity-70 mt-1">预算 {money(budget)} · y_equal={result.y_equal}</div>
              </CardContent>
            </Card>
            <Card className="glass">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4"/>推荐下注</CardTitle></CardHeader>
              <CardContent>
                <div className="text-sm flex items-center justify-between"><span className="opacity-70 truncate pr-2">{result.stakes?.labels?.A ?? 'A'}</span><span className="font-medium">${money(result.stakes?.A)}</span></div>
                <div className="text-sm flex items-center justify-between"><span className="opacity-70 truncate pr-2">{result.stakes?.labels?.B ?? 'B'}</span><span className="font-medium">${money(result.stakes?.B)}</span></div>
              </CardContent>
            </Card>
          </div>
        )}

        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="glass card-accent card-hover-lift">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Target className="h-4 w-4"/>阈值余量</CardTitle></CardHeader>
              <CardContent>
                {marginInfo ? (
                  <>
                    <div className="text-sm opacity-70 mb-1">{marginInfo.kind} · {marginInfo.formula}</div>
                    <div className="text-3xl font-semibold">{(Math.max(0, marginInfo.delta) * 100).toFixed(2)}%</div>
                    <div className="text-xs opacity-70 mb-2">趋近 0% 即临界；数值越大，安全余量越多</div>
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, marginInfo.delta / 0.05 * 100))}%` }} /></div>
                  </>
                ) : <div className="opacity-70 text-sm">输入后可查看阈值余量。</div>}
              </CardContent>
            </Card>

            <Card className="glass card-accent card-hover-lift">
              <CardHeader className="pb-2"><CardTitle>策略与倾斜</CardTitle></CardHeader>
              <CardContent>
                {result?.y_range ? (
                  <div className="space-y-3">
                    <div className="segmented">
                      <button className="seg-item" onClick={() => setY(result.y_equal!)}>等利润</button>
                      <button className="seg-item" onClick={() => setY(Number((result.y_range![0] + (result.y_equal! - result.y_range![0]) * 0.25).toFixed(4)))}>偏向A</button>
                      <button className="seg-item" onClick={() => setY(Number((result.y_equal! + (result.y_range![1] - result.y_equal!) * 0.25).toFixed(4)))}>偏向B</button>
                    </div>
                    <div className="text-xs opacity-70">当前 y={activeY?.toFixed(4)} · Π_A={activePoint?.profitA} · Π_B={activePoint?.profitB}</div>
                  </div>
                ) : <div className="opacity-70 text-sm">请先输入并分析。</div>}
              </CardContent>
            </Card>

            <Card className="glass card-accent card-hover-lift">
              <CardHeader className="pb-2"><CardTitle>执行清单</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {result?.stakes ? (
                  <>
                    <div className="flex items-center justify-between"><span className="opacity-70 truncate pr-2">{result.stakes.labels?.A}</span><span className="font-mono tabular-nums">${money(result.stakes.A)}</span></div>
                    <div className="flex items-center justify-between"><span className="opacity-70 truncate pr-2">{result.stakes.labels?.B}</span><span className="font-mono tabular-nums">${money(result.stakes.B)}</span></div>
                    <Button size="sm" variant="outline" onClick={() => {
                      const txt = `Pair: ${result.stakes?.labels?.A} vs ${result.stakes?.labels?.B}\nBudget: ${budget}\nStakes: ${result.stakes?.A} / ${result.stakes?.B}\nROI: ${pct(result.roi_equal)}\nProfit: $${money(result.profit_equal)}\nCondition: ${result.conditionText}`;
                      navigator.clipboard?.writeText(txt);
                    }}>复制下单清单</Button>
                  </>
                ) : <div className="opacity-70">分析后显示建议下单清单。</div>}
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-1 glass card-accent card-hover-lift">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>结果卡片</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {result && (
                <div className={`status-banner ${result.arbitrage ? 'status-good' : 'status-warn'} text-xs font-medium` }>
                  {result.arbitrage ? `套利成立 · 固定利润 $${money(result.profit_equal)} · ROI ${pct(result.roi_equal)}` : '未成立 · 请参考下方助手建议'}
                </div>
              )}
              <KV label="类型" value={result?.type ?? "-"} />
              <KV label="配对" value={result?.stakes?.labels ? `${result.stakes.labels.A} vs ${result.stakes.labels.B}` : '-'} />
              <KV label="条件" value={result?.conditionText ? `${result.conditionText} ${result.arbitrage ? '< 1' : '>= 1'}` : '-'} />
              {result?.inputsUsed && result.type === 'Cross-Market' && (
                <KV label="使用数值" value={`P=${(result.inputsUsed as any).P} · O=${(result.inputsUsed as any).O}`} />
              )}
              {result?.inputsUsed && result.type === 'Book-Book' && (
                <KV label="使用数值" value={`O1=${(result.inputsUsed as any).O1} · O2=${(result.inputsUsed as any).O2}`} />
              )}
              <KV label="是否套利" value={result ? (result.arbitrage ? '✅ 是' : '❌ 否') : '-'} />
              <KV label="y 区间" value={result?.y_range ? `[${result.y_range[0]}, ${result.y_range[1]}]` : '-'} />
              <KV label="y_equal" value={result?.y_equal?.toString() ?? '-'} />
              {result?.stakes ? (
                <div className="space-y-1">
                  <div className="opacity-70">下注建议</div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="truncate pr-2">{result.stakes.labels?.A ?? 'A'}</div>
                    <div className="font-medium font-mono tabular-nums">${money(result.stakes.A)}</div>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => navigator.clipboard?.writeText(String(result.stakes?.A ?? ''))}>复制</Button>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="truncate pr-2">{result.stakes.labels?.B ?? 'B'}</div>
                    <div className="font-medium font-mono tabular-nums">${money(result.stakes.B)}</div>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => navigator.clipboard?.writeText(String(result.stakes?.B ?? ''))}>复制</Button>
                  </div>
                </div>
              ) : (
                <KV label="下注建议" value="-" />
              )}
              <div className="flex items-center justify-between">
                <div className="opacity-70">固定利润</div>
                {result?.profit_equal != null ? (
                  <AnimatedNumber value={result.profit_equal} prefix="$" className="font-semibold" />
                ) : <span>-</span>}
              </div>
              <div className="flex items-center justify-between">
                <div className="opacity-70">ROI(等利润)</div>
                {result?.roi_equal != null ? (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-400/30 rounded-full px-2">
                    {(result.roi_equal * 100).toFixed(2)}%
                  </Badge>
                ) : <span>-</span>}
              </div>
              {result?.roi_equal != null && result.roi_equal < 0.005 && (
                <div className="text-xs text-amber-500">风险提示：利润率 &lt; 0.5% 或接近边界</div>
              )}
              <KV label="回款A/B" value={result?.return_if_A ? `${result.return_if_A} / ${result.return_if_B}` : '-'} />
              {result?.message && <div className="text-xs text-red-500">{result.message}</div>}
            </CardContent>
          </Card>

          <Card className="md:col-span-2 glass card-accent card-hover-lift relative">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M19 5l-8 8-4-4-4 4"/></svg>利润曲线</CardTitle>
            </CardHeader>
            <CardContent>
              {result?.graph && result?.y_range ? (
                <div className="space-y-3">
                  <div className="h-[220px] md:h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={result.graph} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="lineA" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#f59e0b" />
                            <stop offset="100%" stopColor="#fb923c" />
                          </linearGradient>
                          <linearGradient id="lineB" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#60a5fa" />
                            <stop offset="100%" stopColor="#3b82f6" />
                          </linearGradient>
                          <linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#fb923c" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#fb923c" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="fillB" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="y" type="number" domain={[result.y_range[0], result.y_range[1]]} tickFormatter={(v) => v.toFixed(3)} />
                        <YAxis tickFormatter={(v) => `$${v}`}/>
                        <RTooltip formatter={(value: any) => `$${value}`} labelFormatter={(l) => `y=${l}`}/>
                        <Legend />
                        <ReferenceLine x={result.y_range[0]} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'y_min', position: 'insideTop' }} />
                        <ReferenceLine x={result.y_equal!} stroke="#22c55e" strokeDasharray="3 3" label={{ value: 'y_equal', position: 'insideTop' }} />
                        <ReferenceLine x={result.y_range[1]} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'y_max', position: 'insideTop' }} />
                        {eqPoint && <ReferenceDot x={result.y_equal!} y={Math.max(eqPoint.profitA, eqPoint.profitB)} r={4} fill="#22c55e" stroke="none" />}
                        <Area type="monotone" dataKey="profitA" stroke="none" fill="url(#fillA)" />
                        <Area type="monotone" dataKey="profitB" stroke="none" fill="url(#fillB)" />
                        <Line type="monotone" dataKey="profitA" name="结果A利润" stroke="url(#lineA)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="profitB" name="结果B利润" stroke="url(#lineB)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    <Label>分配比例 y（A 方）</Label>
                    <Slider
                      min={result.y_range[0]}
                      max={result.y_range[1]}
                      step={0.0001}
                      value={[activeY ?? result.y_range[0]]}
                      onValueChange={(v) => setY(v[0])}
                    />
                    {activePoint && (
                      <div className="text-xs opacity-80">y={activePoint.y} · Π_A={activePoint.profitA} · Π_B={activePoint.profitB}</div>
                    )}
                    <div className="text-xs opacity-60">提示：y 表示分配给左侧“{result.stakes?.labels?.A ?? 'A'}”的预算占比。在 y_equal 处两种结果的利润相等；靠近 y_min 或 y_max 时其中一边利润接近 0，可用于倾斜偏好。</div>
                  </div>
                </div>
              ) : (
                <div className="text-sm opacity-70">请先完成输入并点击“开始分析”。</div>
              )}
            </CardContent>
          </Card>
        </div>

        {!result?.arbitrage && (
          <div className="grid grid-cols-1">
            <Card className="glass">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 6v12"/><path d="M6 12h12"/></svg>接近成立 · 助手建议</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {(() => {
                  const hints = nearArbSuggestions(markets[0] as any, markets[1] as any);
                  if (!hints.length) return <div className="opacity-70">请输入足够的双方数值以计算建议。</div>;
                  const best = hints[0];
                  if (best.margin < 0) return <div className="opacity-70">当前已满足套利条件。</div>;
                  return (
                    <div className="space-y-2">
                      <div>最接近成立的配对：<span className="font-medium">{best.label}</span></div>
                      {best.kind === 'Cross-Market' ? (
                        <div>
                          <div>阈值：P + 1/O &lt; 1，目前差距 <span className="font-medium">{best.margin.toFixed(4)}</span></div>
                          <div className="mt-1">目标其一：<span className="font-medium">{(best.targets as any).bookSide}</span> 赔率提升至 ≥ <span className="font-medium">{(best.targets as any).O_min.toFixed(4)}</span></div>
                          <div>或：<span className="font-medium">{(best.targets as any).predSide}</span> 价格降低至 ≤ <span className="font-medium">{(best.targets as any).P_max.toFixed(4)}</span></div>
                          <div className="opacity-70 mt-1">建议优先操作：{best.lever}</div>
                          <div className="flex gap-2 mt-2">
                            <Button size="sm" variant="outline" onClick={() => applyTargetCross('O')}>应用赔率目标</Button>
                            <Button size="sm" variant="outline" onClick={() => applyTargetCross('P')}>应用价格目标</Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div>阈值：1/O1 + 1/O2 &lt; 1，目前差距 <span className="font-medium">{best.margin.toFixed(4)}</span></div>
                          <div className="mt-1">目标其一：Book {(best.targets as any).sideA} 赔率 ≥ <span className="font-medium">{(best.targets as any).O1_min.toFixed(4)}</span></div>
                          <div>或：Book {(best.targets as any).sideB} 赔率 ≥ <span className="font-medium">{(best.targets as any).O2_min.toFixed(4)}</span></div>
                          <div className="opacity-70 mt-1">建议优先操作：{best.lever}</div>
                          <div className="flex gap-2 mt-2">
                            <Button size="sm" variant="outline" onClick={() => applyTargetBook(1)}>应用 O1 目标</Button>
                            <Button size="sm" variant="outline" onClick={() => applyTargetBook(2)}>应用 O2 目标</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="opacity-70">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function MarketCard({ title, market, onChange }: { title: string; market: DualMarketInput; onChange: (m: DualMarketInput) => void }) {
  const [kind, setKind] = useState<"predict" | "book">(market.type);
  // Predict prices
  const [pYes, setPYes] = useState<number>(market.type === 'predict' ? ((market as any).yesPrice ?? 0.5) : 0.5);
  const [pNo, setPNo] = useState<number>(market.type === 'predict' ? ((market as any).noPrice ?? 0.5) : 0.5);
  // Book odds
  const [oYes, setOYes] = useState<string | number>(market.type === 'book' ? ((market as any).yesOdds ?? 1.8) : 1.8);
  const [oNo, setONo] = useState<string | number>(market.type === 'book' ? ((market as any).noOdds ?? 2.2) : 2.2);
  const [oddsFormat, setOddsFormat] = useState<'decimal' | 'american' | 'fractional'>(market.type === 'book' ? ((market as any).oddsFormat ?? 'decimal') : 'decimal');

  const applyPredict = (yes = pYes, no = pNo) => {
    onChange({ type: 'predict', yesPrice: Number(yes), noPrice: Number(no) });
  };
  const applyBook = (yes = oYes, no = oNo, fmt = oddsFormat) => {
    onChange({ type: 'book', yesOdds: yes, noOdds: no, oddsFormat: fmt });
  };
  const sync = (nextKind = kind) => {
    if (nextKind === 'predict') applyPredict();
    else applyBook();
  };

  // Keep local inputs in sync when parent updates (e.g., 示例按钮)
  useEffect(() => {
    setKind(market.type);
    if (market.type === 'predict') {
      setPYes((market as any).yesPrice ?? 0.5);
      setPNo((market as any).noPrice ?? 0.5);
    } else {
      setOYes((market as any).yesOdds ?? 1.8);
      setONo((market as any).noOdds ?? 2.2);
      setOddsFormat((market as any).oddsFormat ?? 'decimal');
    }
  }, [market]);

  return (
    <Card className="glass card-hover-lift">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>类型</Label>
            <Select
              value={kind}
              onValueChange={(v: any) => { setKind(v); sync(v); }}
            >
              <SelectTrigger><SelectValue placeholder="选择类型"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="predict">预测市场</SelectItem>
                <SelectItem value="book">菠菜</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div />
        </div>

        {kind === 'predict' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">YES 价格 P <span className="tag-yes">YES</span></Label>
              <Input type="number" inputMode="decimal" step="0.001" value={pYes} onChange={(e) => { const v = Number(e.target.value || 0); setPYes(v); applyPredict(v, pNo); }} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">NO 价格 P <span className="tag-no">NO</span></Label>
              <Input type="number" inputMode="decimal" step="0.001" value={pNo} onChange={(e) => { const v = Number(e.target.value || 0); setPNo(v); applyPredict(pYes, v); }} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">YES 赔率 O <span className="tag-yes">YES</span></Label>
              <Input value={oYes} onChange={(e) => { const v = e.target.value; setOYes(v); applyBook(v, oNo, oddsFormat); }} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">NO 赔率 O <span className="tag-no">NO</span></Label>
              <Input value={oNo} onChange={(e) => { const v = e.target.value; setONo(v); applyBook(oYes, v, oddsFormat); }} />
            </div>
            <div className="space-y-2 col-span-2 md:col-span-1">
              <Label>格式</Label>
              {/* Mobile: Select */}
              <div className="block md:hidden">
                <Select value={oddsFormat} onValueChange={(v: any) => { setOddsFormat(v); applyBook(oYes, oNo, v); }}>
                  <SelectTrigger><SelectValue placeholder="格式"/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="decimal">Decimal</SelectItem>
                    <SelectItem value="american">American</SelectItem>
                    <SelectItem value="fractional">Fractional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Desktop: Segmented */}
              <div className="segmented w-full hidden md:flex">
                <button type="button" className={`seg-item ${oddsFormat==='decimal' ? 'active' : ''}`} onClick={() => { setOddsFormat('decimal'); applyBook(oYes, oNo, 'decimal'); }}>Decimal</button>
                <button type="button" className={`seg-item ${oddsFormat==='american' ? 'active' : ''}`} onClick={() => { setOddsFormat('american'); applyBook(oYes, oNo, 'american'); }}>American</button>
                <button type="button" className={`seg-item ${oddsFormat==='fractional' ? 'active' : ''}`} onClick={() => { setOddsFormat('fractional'); applyBook(oYes, oNo, 'fractional'); }}>Fractional</button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function clamp01Num(n: number) {
  return Math.max(0, Math.min(1, n));
}

function AnimatedNumber({ value, prefix = "", className = "" }: { value: number; prefix?: string; className?: string }) {
  const [display, setDisplay] = useState<number>(0);
  const [prev, setPrev] = useState<number>(0);

  useMemo(() => {
    setPrev(display);
  }, [value]);

  // simple RAF tween
  useEffect(() => {
    const start = performance.now();
    const from = prev;
    const to = value;
    const dur = 500;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p; // easeInOut
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span className={className}>{prefix}{display.toFixed(2)}</span>;
}
