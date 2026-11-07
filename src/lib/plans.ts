import { BillingCycle, cycleDays } from "./constants";
import { sql, sqlOne } from "./db";

export type PlanRow = {
  id: string;
  name: string;
  code: string | null;
  price: string;
  price_monthly: string | null;
  price_yearly: string | null;
  max_domains: number;
  interval_days: number;
  check_interval_minutes: number;
  history_days: number;
  max_telegram_groups: number;
  badge: string | null;
  sort_order: number;
  is_active: boolean;
};

const PLAN_SELECT = `
  id, name, code, price::text, price_monthly::text, price_yearly::text,
  max_domains, interval_days, check_interval_minutes,
  COALESCE(history_days, 7)::int AS history_days,
  COALESCE(max_telegram_groups, 1)::int AS max_telegram_groups,
  badge, COALESCE(sort_order, 100)::int AS sort_order,
  COALESCE(is_active, TRUE) AS is_active
`;

export async function listActivePlans(): Promise<PlanRow[]> {
  return sql<PlanRow>(
    `SELECT ${PLAN_SELECT}
     FROM plans
     WHERE COALESCE(is_active, TRUE) = TRUE
     ORDER BY sort_order ASC, price_monthly ASC NULLS LAST, price ASC`,
  );
}

export async function getPlanById(id: string): Promise<PlanRow | null> {
  return sqlOne<PlanRow>(`SELECT ${PLAN_SELECT} FROM plans WHERE id = $1`, [id]);
}

export function planAmount(
  plan: Pick<PlanRow, "price" | "price_monthly" | "price_yearly">,
  cycle: BillingCycle,
): number {
  if (cycle === "YEARLY") {
    return Number(plan.price_yearly ?? Number(plan.price) * 10);
  }
  return Number(plan.price_monthly ?? plan.price);
}

export function expireAtForCycle(cycle: BillingCycle, from = new Date()): Date {
  return new Date(from.getTime() + cycleDays(cycle) * 24 * 60 * 60 * 1000);
}

export async function domainQuotaForUser(userId: string): Promise<{
  max_domains: number;
  extra_domain_slots: number;
  total_slots: number;
  used: number;
}> {
  const row = await sqlOne<{
    max_domains: number;
    extra_domain_slots: number;
    used: number;
  }>(
    `SELECT COALESCE(p.max_domains, 1)::int AS max_domains,
            COALESCE(u.extra_domain_slots, 0)::int AS extra_domain_slots,
            (SELECT count(*)::int FROM domains d WHERE d.user_id = u.id) AS used
     FROM users u
     LEFT JOIN plans p ON p.id = u.plan_id
     WHERE u.id = $1`,
    [userId],
  );
  const max = row?.max_domains ?? 1;
  const extra = row?.extra_domain_slots ?? 0;
  return {
    max_domains: max,
    extra_domain_slots: extra,
    total_slots: max + extra,
    used: row?.used ?? 0,
  };
}
