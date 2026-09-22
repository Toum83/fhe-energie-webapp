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
  best_day: string | null;
  best_day_production_kwh: number | null;
  days: DayStat[];
  created_at: string;
  updated_at: string;
};
