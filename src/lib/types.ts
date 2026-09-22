export type DayStat = {
  date: string;
  production_kwh: number;
  consumption_kwh: number;
  self_consumption_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
  self_consumption_rate: number | null;
  self_sufficiency_rate: number | null;
};

export type WeeklyReport = {
  start_date: string;
  end_date: string;
  production_kwh: number;
  consumption_kwh: number;
  self_consumption_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
  self_consumption_rate: number;
  self_sufficiency_rate: number;
  savings_total_eur: number;
  savings_import_eur: number;
  revenue_export_eur: number;
  price_import: number;
  price_export: number;
  price_export_above: number | null;
  export_cap_kwh: number | null;
  export_at_tier1_kwh: number | null;
  export_at_tier2_kwh: number | null;
  export_cap_remaining_kwh: number | null;
  grid_cost_eur: number | null;
  best_day: string | null;
  best_day_production_kwh: number | null;
  days: DayStat[];
  created_at: string;
  updated_at: string;
};
