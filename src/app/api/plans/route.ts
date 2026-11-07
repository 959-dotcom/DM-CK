import { listActivePlans } from "@/lib/plans";
import { handleRouteError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    const plans = await listActivePlans();
    return jsonOk({
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        price: p.price,
        price_monthly: p.price_monthly ?? p.price,
        price_yearly: p.price_yearly ?? String(Number(p.price) * 10),
        max_domains: p.max_domains,
        interval_days: p.interval_days,
        check_interval_minutes: p.check_interval_minutes,
        history_days: p.history_days,
        max_telegram_groups: p.max_telegram_groups,
        badge: p.badge,
        sort_order: p.sort_order,
      })),
      addon: {
        code: "extra_domain",
        name: "Extra Domain Slot",
        price_per_slot_monthly: 50,
        unit: "domain/month",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
