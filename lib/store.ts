"use client";
import { create } from "zustand";
import { analyzeBestPair, AnalyzeResult, DualMarketInput, Fees } from "./arbitrage";

type State = {
  budget: number;
  fees: Fees;
  markets: [DualMarketInput, DualMarketInput];
  result: AnalyzeResult | null;
  setMarkets: (m: [DualMarketInput, DualMarketInput]) => void;
  setBudget: (b: number) => void;
  setFees: (f: Fees) => void;
  analyze: () => void;
};

export const useArbStore = create<State>((set, get) => ({
  budget: 1000,
  fees: { bookWinFee: 0, polyWinFee: 0 },
  markets: [
    { type: "predict", yesPrice: 0.55, noPrice: 0.45 },
    { type: "book", yesOdds: 1.6, noOdds: 2.3, oddsFormat: "decimal" },
  ],
  result: null,
  setMarkets: (m) => set({ markets: m }),
  setBudget: (b) => set({ budget: b }),
  setFees: (f) => set({ fees: f }),
  analyze: () => {
    const { markets, budget, fees } = get();
    const r = analyzeBestPair(markets[0], markets[1], budget, fees);
    set({ result: r });
  },
}));
