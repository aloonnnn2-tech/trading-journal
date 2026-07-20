export interface Strategy {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StrategyBreakdown {
  strategy: Strategy;
  trades: number;
  winRate: number | null;
  totalPL: number;
}
