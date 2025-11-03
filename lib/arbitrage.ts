"use client";
import Decimal from "decimal.js";
import { toDecimal, OddsFormat } from "./odds";

export type Side = "YES" | "NO";

export type MarketPredict = {
  type: "predict";
  side: Side; // which outcome to buy on predict market
  price: number; // 0..1
};

export type MarketBook = {
  type: "book";
  side: Side; // which outcome's odds at the bookmaker
  odds: number | string; // allow string for fractional like 5/2
  oddsFormat?: OddsFormat;
};

export type MarketInput = MarketPredict | MarketBook;

// Dual-side inputs (UI convenience): allow providing both YES/NO at once.
export type DualPredict = {
  type: "predict";
  yesPrice?: number; // 0..1
  noPrice?: number;  // 0..1 (not necessarily 1-yesPrice)
};
export type DualBook = {
  type: "book";
  yesOdds?: number | string;
  noOdds?: number | string;
  oddsFormat?: OddsFormat;
};
export type DualMarketInput = DualPredict | DualBook;

export type Fees = {
  bookWinFee?: number; // e.g., 0.02 meaning 2% of profit
  polyWinFee?: number; // e.g., 0.02
};

export type GraphPoint = { y: number; profitA: number; profitB: number };

export type AnalyzeResult = {
  type: "Book-Book" | "Cross-Market" | "No Arbitrage" | "Invalid";
  arbitrage: boolean;
  message?: string;
  conditionText?: string;
  y_range?: [number, number];
  y_equal?: number;
  stakes?: { A: number; B: number; labels?: { A: string; B: string } };
  profit_equal?: number;
  roi_equal?: number; // expressed as fraction, e.g. 0.0155 for 1.55%
  return_if_A?: number;
  return_if_B?: number;
  graph?: GraphPoint[];
  chosenSides?: { A: Side; B: Side };
  inputsUsed?:
    | { kind: "Cross-Market"; P: number; O: number; predSide: Side; bookSide: Side }
    | { kind: "Book-Book"; O1: number; O2: number; sideA: Side; sideB: Side };
};

function d(n: number | string | Decimal): Decimal {
  return new Decimal(n);
}

function round(n: Decimal | number, dp = 2): number {
  const x = n instanceof Decimal ? n : new Decimal(n);
  return Number(x.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function normalizeMarket(input: MarketInput): { kind: "predict" | "book"; side: Side; price?: Decimal; odds?: Decimal; label: string } {
  if (input.type === "predict") {
    return { kind: "predict", side: input.side, price: d(input.price), label: `Predict ${input.side}` };
  }
  const fmt: OddsFormat = input.oddsFormat ?? "decimal";
  const dec = toDecimal(fmt, input.odds);
  return { kind: "book", side: input.side, odds: d(dec), label: `Book ${input.side}` };
}

export function analyzeTwoMarkets(
  mA: MarketInput,
  mB: MarketInput,
  budget: number,
  fees?: Fees
): AnalyzeResult {
  try {
    const B = d(budget);
    if (!B.isFinite() || B.lte(0)) return { type: "Invalid", arbitrage: false, message: "Invalid budget" };

    const A = normalizeMarket(mA);
    const Bm = normalizeMarket(mB);

    // Identify case
    const kinds = [A.kind, Bm.kind].sort().join("+");

    if (kinds === "book+book") {
      // Require opposite sides
      if (A.side === Bm.side) {
        return { type: "Invalid", arbitrage: false, message: "Book-Book 需要对立方向（YES vs NO）" };
      }
      const O1 = A.odds!; // market A odds
      const O2 = Bm.odds!; // market B odds

      const cond = d(1).div(O1).add(d(1).div(O2));
      const conditionText = `1/O1 + 1/O2 = ${round(d(1).div(O1), 4)} + ${round(d(1).div(O2), 4)} = ${round(cond, 4)}`;
      if (cond.gte(1)) {
        return { type: "No Arbitrage", arbitrage: false, conditionText };
      }

      // y range and equal
      const y_min = d(1).div(O1);
      const y_max = d(1).minus(d(1).div(O2));
      const y_equal = O2.div(O1.add(O2));

      // ROI equal
      const roi_equal = O1.mul(O2).div(O1.add(O2)).minus(1); // fraction

      // stakes at equal
      const stakeA = y_equal.mul(B);
      const stakeB = d(1).minus(y_equal).mul(B);

      // profit at equal (both sides equal)
      const profit_equal = stakeA.mul(O1).minus(B); // == stakeB*O2 - B
      const return_if_A = B.add(profit_equal);
      const return_if_B = return_if_A;

      // Profit curves
      const graph = sampleGraph(y_min, y_max, (y) => B.mul(d(y).mul(O1)).minus(B), (y) => B.mul(d(1).minus(y).mul(O2)).minus(B));

      return {
        type: "Book-Book",
        arbitrage: true,
        conditionText: conditionText,
        y_range: [round(y_min, 4), round(y_max, 4)],
        y_equal: round(y_equal, 4),
        stakes: { A: round(stakeA), B: round(stakeB), labels: { A: "Book "+A.side, B: "Book "+Bm.side } },
        profit_equal: round(profit_equal),
        roi_equal: Number(roi_equal.toNumber()),
        return_if_A: round(return_if_A),
        return_if_B: round(return_if_B),
        graph,
        chosenSides: { A: A.side, B: Bm.side },
        inputsUsed: { kind: "Book-Book", O1: Number(O1.toNumber()), O2: Number(O2.toNumber()), sideA: A.side, sideB: Bm.side },
      };
    }

    if (kinds === "book+predict") {
      // Determine which is which
      const pred = A.kind === "predict" ? A : Bm;
      const book = A.kind === "book" ? A : Bm;

      // Require opposite sides across markets
      if (pred.side === book.side) {
        return { type: "Invalid", arbitrage: false, message: "Cross-Market 需要对立方向（Predict 与 Book 方向相反）" };
      }

      const P = pred.price!; // price for chosen side on predict
      const O = book.odds!; // decimal odds for opposite side on book

      // Base margins
      const bookEdge = (fees?.bookWinFee ?? 0);
      const polyEdge = (fees?.polyWinFee ?? 0);

      // Adjusted win multipliers for profit portions
      const bookWinMult = d(1).minus(bookEdge).mul(O.minus(1)); // (1-c)*(O-1)
      const polyWinMult = d(1).minus(polyEdge).mul(d(1).div(P).minus(1)); // (1-f)*(1/P - 1)

      // Condition check uses raw P + 1/O < 1 (without fees) as common convention
      const cond = P.add(d(1).div(O));
      const conditionText = `P + 1/O = ${round(P, 4)} + ${round(d(1).div(O), 4)} = ${round(cond, 4)}`;
      if (cond.gte(1)) {
        return { type: "No Arbitrage", arbitrage: false, conditionText };
      }

      // y range and equal
      const y_min = P;
      const y_max = d(1).minus(d(1).div(O));
      const y_equal = P.mul(O).div(P.mul(O).add(1));

      // ROI at equal using adjusted multipliers on profits
      const profit_equal_frac = bookWinMult.sub( polyEdge ? d(0) : d(0) ); // not used directly
      // Direct formula for profit at equal (with fees applied to win legs):
      const stakeA = y_equal.mul(B); // predict spend
      const stakeB = d(1).minus(y_equal).mul(B); // book stake

      const profit_if_yes = stakeA.mul(polyWinMult).sub(stakeB); // predict win profit - book loss
      const profit_if_no = stakeB.mul(bookWinMult).sub(stakeA);  // book win profit - predict loss
      const profit_equal = profit_if_yes; // equal by construction
      const roi_equal = profit_equal.div(B);

      const return_if_A = B.add(profit_if_yes);
      const return_if_B = B.add(profit_if_no);

      // Profit curves (apply fee-adjusted multipliers)
      const profitYes = (y: number) => B.mul(d(y).mul(polyWinMult)).sub(B.mul(d(1).minus(d(y))));
      const profitNo = (y: number) => B.mul(d(1).minus(d(y)).mul(bookWinMult)).sub(B.mul(d(y)));
      const graph = sampleGraph(y_min, y_max, profitYes, profitNo);

      return {
        type: "Cross-Market",
        arbitrage: true,
        conditionText: conditionText,
        y_range: [round(y_min, 4), round(y_max, 4)],
        y_equal: round(y_equal, 4),
        stakes: { A: round(stakeA), B: round(stakeB), labels: { A: pred.label, B: book.label } },
        profit_equal: round(profit_equal),
        roi_equal: Number(roi_equal.toNumber()),
        return_if_A: round(return_if_A),
        return_if_B: round(return_if_B),
        graph,
        chosenSides: { A: pred.side, B: book.side },
        inputsUsed: { kind: "Cross-Market", P: Number(P.toNumber()), O: Number(O.toNumber()), predSide: pred.side, bookSide: book.side },
      };
    }

    if (kinds === "predict+predict") {
      return { type: "Invalid", arbitrage: false, message: "Poly–Poly 暂不支持（未来扩展）" };
    }

    return { type: "Invalid", arbitrage: false, message: "未知输入组合" };
  } catch (e: any) {
    return { type: "Invalid", arbitrage: false, message: e?.message ?? String(e) };
  }
}

// Enumerate best pairing from dual-side market inputs. Returns best arbitrage by roi_equal.
export function analyzeBestPair(
  mA: DualMarketInput,
  mB: DualMarketInput,
  budget: number,
  fees?: Fees
): AnalyzeResult {
  // Build candidate pairs
  const cands: Array<{ a: MarketInput; b: MarketInput; label: string }> = [];
  const push = (a: MarketInput, b: MarketInput) => cands.push({ a, b, label: `${a.type}:${(a as any).side} vs ${b.type}:${(b as any).side}` });

  const AisBook = mA.type === "book";
  const BisBook = mB.type === "book";
  const AisPred = mA.type === "predict";
  const BisPred = mB.type === "predict";

  try {
    if (AisBook && BisBook) {
      const fmtA = (mA as DualBook).oddsFormat ?? "decimal";
      const fmtB = (mB as DualBook).oddsFormat ?? "decimal";
      if ((mA as DualBook).yesOdds != null && (mB as DualBook).noOdds != null)
        push({ type: "book", side: "YES", odds: (mA as DualBook).yesOdds!, oddsFormat: fmtA }, { type: "book", side: "NO", odds: (mB as DualBook).noOdds!, oddsFormat: fmtB });
      if ((mA as DualBook).noOdds != null && (mB as DualBook).yesOdds != null)
        push({ type: "book", side: "NO", odds: (mA as DualBook).noOdds!, oddsFormat: fmtA }, { type: "book", side: "YES", odds: (mB as DualBook).yesOdds!, oddsFormat: fmtB });
    } else if (AisPred && BisBook) {
      const fmtB = (mB as DualBook).oddsFormat ?? "decimal";
      if ((mA as DualPredict).yesPrice != null && (mB as DualBook).noOdds != null)
        push({ type: "predict", side: "YES", price: (mA as DualPredict).yesPrice! }, { type: "book", side: "NO", odds: (mB as DualBook).noOdds!, oddsFormat: fmtB });
      if ((mA as DualPredict).noPrice != null && (mB as DualBook).yesOdds != null)
        push({ type: "predict", side: "NO", price: (mA as DualPredict).noPrice! }, { type: "book", side: "YES", odds: (mB as DualBook).yesOdds!, oddsFormat: fmtB });
    } else if (AisBook && BisPred) {
      const fmtA = (mA as DualBook).oddsFormat ?? "decimal";
      if ((mB as DualPredict).yesPrice != null && (mA as DualBook).noOdds != null)
        push({ type: "book", side: "NO", odds: (mA as DualBook).noOdds!, oddsFormat: fmtA }, { type: "predict", side: "YES", price: (mB as DualPredict).yesPrice! });
      if ((mB as DualPredict).noPrice != null && (mA as DualBook).yesOdds != null)
        push({ type: "book", side: "YES", odds: (mA as DualBook).yesOdds!, oddsFormat: fmtA }, { type: "predict", side: "NO", price: (mB as DualPredict).noPrice! });
    } else if (AisPred && BisPred) {
      return { type: "Invalid", arbitrage: false, message: "Poly–Poly 暂不支持（未来扩展）" };
    }
  } catch (e: any) {
    return { type: "Invalid", arbitrage: false, message: e?.message ?? String(e) };
  }

  if (cands.length === 0) return { type: "Invalid", arbitrage: false, message: "请至少填写每个市场的一侧数值" };

  // Evaluate all candidates, pick best roi (profit_equal/B)
  let best: AnalyzeResult | null = null;
  for (const { a, b } of cands) {
    const r = analyzeTwoMarkets(a, b, budget, fees);
    if (!best) best = r;
    else {
      const rScore = r.arbitrage ? (r.roi_equal ?? -Infinity) : -Infinity;
      const bScore = best.arbitrage ? (best.roi_equal ?? -Infinity) : -Infinity;
      if (rScore > bScore) best = r;
    }
  }
  return best ?? { type: "Invalid", arbitrage: false, message: "无法评估" };
}

export type NearSuggestion = {
  label: string;
  kind: "Cross-Market" | "Book-Book";
  // Positive margin means not yet arbitrage; negative/zero means already arbitrage
  margin: number;
  // Targets to reach the strict inequality (boundary values)
  targets:
    | { kind: "Cross-Market"; P: number; O: number; P_max: number; O_min: number; predSide: Side; bookSide: Side }
    | { kind: "Book-Book"; O1: number; O2: number; O1_min: number; O2_min: number; sideA: Side; sideB: Side };
  changeScore: number; // smaller is closer (percentage change of the easiest lever)
  lever: string; // textual hint of the easiest lever
};

// Compute how far each pairing is from the arbitrage threshold and what targets would make it hold
export function nearArbSuggestions(mA: DualMarketInput, mB: DualMarketInput): NearSuggestion[] {
  const out: NearSuggestion[] = [];
  const push = (s: NearSuggestion) => out.push(s);
  const AisBook = mA.type === "book";
  const BisBook = mB.type === "book";
  const AisPred = mA.type === "predict";
  const BisPred = mB.type === "predict";

  const addCross = (P: number | undefined, O: number | string | undefined, predSide: Side, bookSide: Side, aLabel: string) => {
    if (P == null || O == null) return;
    const Odec = typeof O === 'number' ? O : Number(O);
    if (!(isFinite(P) && isFinite(Odec) && P > 0 && P < 1 && Odec > 1)) return;
    const margin = P + 1 / Odec - 1; // <0 arbitrage
    const O_min = 1 / (1 - P);
    const P_max = Math.max(0, 1 - 1 / Odec);
    const leverO = O_min > Odec ? (O_min / Odec - 1) : 0;
    const leverP = P_max < P ? (1 - P_max / P) : 0;
    const changeScore = Math.min(leverO || Infinity, leverP || Infinity);
    const lever = (changeScore === leverO) ? `将 ${bookSide} 赔率提升至 ≥ ${round(O_min, 4)}` : `将 ${predSide} 价格降低至 ≤ ${round(P_max, 4)}`;
    push({
      label: `${aLabel}`,
      kind: "Cross-Market",
      margin: Number(margin),
      targets: { kind: "Cross-Market", P, O: Odec, P_max, O_min, predSide, bookSide },
      changeScore: Number(changeScore),
      lever,
    });
  };

  const addBook = (O1?: number | string, O2?: number | string, sideA: Side = "YES", sideB: Side = "NO", label = "Book-Book") => {
    if (O1 == null || O2 == null) return;
    const a = typeof O1 === 'number' ? O1 : Number(O1);
    const b = typeof O2 === 'number' ? O2 : Number(O2);
    if (!(isFinite(a) && isFinite(b) && a > 1 && b > 1)) return;
    const margin = 1 / a + 1 / b - 1; // <0 arbitrage
    const O1_min = 1 / (1 - 1 / b);
    const O2_min = 1 / (1 - 1 / a);
    const lever1 = O1_min > a ? (O1_min / a - 1) : 0;
    const lever2 = O2_min > b ? (O2_min / b - 1) : 0;
    const changeScore = Math.min(lever1 || Infinity, lever2 || Infinity);
    const lever = (changeScore === lever1) ? `将 Book ${sideA} 赔率提升至 ≥ ${round(O1_min, 4)}` : `将 Book ${sideB} 赔率提升至 ≥ ${round(O2_min, 4)}`;
    push({
      label,
      kind: "Book-Book",
      margin: Number(margin),
      targets: { kind: "Book-Book", O1: a, O2: b, O1_min, O2_min, sideA, sideB },
      changeScore: Number(changeScore),
      lever,
    });
  };

  // Enumerate
  if (AisPred && BisBook) {
    addCross((mA as DualPredict).yesPrice, (mB as DualBook).noOdds, "YES", "NO", "Predict YES vs Book NO");
    addCross((mA as DualPredict).noPrice, (mB as DualBook).yesOdds, "NO", "YES", "Predict NO vs Book YES");
  }
  if (AisBook && BisPred) {
    addCross((mB as DualPredict).yesPrice, (mA as DualBook).noOdds, "YES", "NO", "Predict YES vs Book NO");
    addCross((mB as DualPredict).noPrice, (mA as DualBook).yesOdds, "NO", "YES", "Predict NO vs Book YES");
  }
  if (AisBook && BisBook) {
    addBook((mA as DualBook).yesOdds, (mB as DualBook).noOdds, "YES", "NO", "Book YES vs Book NO");
    addBook((mA as DualBook).noOdds, (mB as DualBook).yesOdds, "NO", "YES", "Book NO vs Book YES");
  }

  // sort by (margin, changeScore)
  return out
    .filter(s => isFinite(s.margin))
    .sort((a, b) => {
      const am = a.margin, bm = b.margin;
      if ((am < 0) !== (bm < 0)) return am < 0 ? -1 : 1; // arbitrage ones first
      if (am !== bm) return am - bm;
      return a.changeScore - b.changeScore;
    });
}

function sampleGraph(
  yMin: Decimal,
  yMax: Decimal,
  profitA: (y: number) => Decimal,
  profitB: (y: number) => Decimal
): GraphPoint[] {
  const min = yMin.toNumber();
  const max = yMax.toNumber();
  const points = 60;
  const arr: GraphPoint[] = [];
  if (!(max > min)) return arr;
  for (let i = 0; i <= points; i++) {
    const y = min + ((max - min) * i) / points;
    const pA = profitA(y);
    const pB = profitB(y);
    arr.push({ y: round(y, 4), profitA: round(pA), profitB: round(pB) });
  }
  return arr;
}
