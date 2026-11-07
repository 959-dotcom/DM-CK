import { sql } from "@/lib/db";
import { handleRouteError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    const plans = await sql<{
      id: string;
      name: string;
      price: string;
      max_domains: number;
      interval_days: number;
      check_interval_minutes: number;
    }>(
      `SELECT id, name, price::text, max_domains, interval_days, check_interval_minutes
       FROM plans
       ORDER BY price ASC`,
    );
    return jsonOk({ plans });
  } catch (err) {
    return handleRouteError(err);
  }
}
