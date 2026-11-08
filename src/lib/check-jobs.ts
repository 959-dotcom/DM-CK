import { newId, sql, sqlOne } from "./db";
import { runDomainCheck } from "./domain-check";

export type CheckJobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export type CheckJobRow = {
  id: string;
  user_id: string;
  status: CheckJobStatus;
  total: number;
  completed: number;
  failed: number;
  domain_ids: string;
  results: string;
  current_domain_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type CheckJobResultItem = {
  domainId: string;
  ok: boolean;
  error?: string;
};

function parseJsonArray<T>(raw: string | null | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function jobPublicView(row: CheckJobRow) {
  const domainIds = parseJsonArray<string>(row.domain_ids, []);
  const results = parseJsonArray<CheckJobResultItem>(row.results, []);
  const doneIds = new Set(results.map((r) => r.domainId));
  return {
    id: row.id,
    status: row.status,
    total: row.total,
    completed: row.completed,
    failed: row.failed,
    currentDomainId: row.current_domain_id,
    error: row.error,
    pendingDomainIds: domainIds.filter((id) => !doneIds.has(id)),
    results,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    percent:
      row.total <= 0 ? 100 : Math.round((row.completed / row.total) * 100),
  };
}

export async function createCheckAllJob(
  userId: string,
  domainIds: string[],
): Promise<CheckJobRow> {
  const id = newId("cjob");
  await sql(
    `INSERT INTO domain_check_jobs
      (id, user_id, status, total, completed, failed, domain_ids, results)
     VALUES ($1,$2,'PENDING',$3,0,0,$4,'[]')`,
    [id, userId, domainIds.length, JSON.stringify(domainIds)],
  );
  const row = await sqlOne<CheckJobRow>(
    `SELECT id, user_id, status, total, completed, failed,
            domain_ids, results, current_domain_id, error,
            created_at::text, updated_at::text
     FROM domain_check_jobs WHERE id = $1`,
    [id],
  );
  if (!row) throw new Error("Failed to create check job");
  return row;
}

export async function getCheckJobForUser(
  jobId: string,
  userId: string,
): Promise<CheckJobRow | null> {
  return sqlOne<CheckJobRow>(
    `SELECT id, user_id, status, total, completed, failed,
            domain_ids, results, current_domain_id, error,
            created_at::text, updated_at::text
     FROM domain_check_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId],
  );
}

/**
 * Advance a check-all job by running up to `batchSize` remaining domains.
 * Designed for Vercel serverless: each poll does a small batch.
 */
export async function advanceCheckJob(
  jobId: string,
  userId: string,
  batchSize = 2,
): Promise<CheckJobRow> {
  const job = await getCheckJobForUser(jobId, userId);
  if (!job) throw new Error("Job not found");
  if (job.status === "DONE" || job.status === "FAILED") return job;

  const domainIds = parseJsonArray<string>(job.domain_ids, []);
  const results = parseJsonArray<CheckJobResultItem>(job.results, []);
  const doneIds = new Set(results.map((r) => r.domainId));
  const pending = domainIds.filter((id) => !doneIds.has(id));

  if (pending.length === 0) {
    await sql(
      `UPDATE domain_check_jobs
       SET status = 'DONE', current_domain_id = NULL, updated_at = NOW()
       WHERE id = $1`,
      [jobId],
    );
    const done = await getCheckJobForUser(jobId, userId);
    if (!done) throw new Error("Job missing");
    return done;
  }

  await sql(
    `UPDATE domain_check_jobs
     SET status = 'RUNNING', current_domain_id = $2, updated_at = NOW()
     WHERE id = $1`,
    [jobId, pending[0]],
  );

  const batch = pending.slice(0, Math.max(1, batchSize));
  let completed = job.completed;
  let failed = job.failed;

  for (const domainId of batch) {
    await sql(
      `UPDATE domain_check_jobs
       SET current_domain_id = $2, updated_at = NOW() WHERE id = $1`,
      [jobId, domainId],
    );
    try {
      await runDomainCheck(domainId);
      results.push({ domainId, ok: true });
      completed += 1;
    } catch (err) {
      results.push({
        domainId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      completed += 1;
      failed += 1;
    }
  }

  const remaining = domainIds.length - results.length;
  const status: CheckJobStatus = remaining <= 0 ? "DONE" : "RUNNING";

  await sql(
    `UPDATE domain_check_jobs
     SET status = $2,
         completed = $3,
         failed = $4,
         results = $5,
         current_domain_id = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      jobId,
      status,
      completed,
      failed,
      JSON.stringify(results),
      status === "DONE" ? null : pending[batch.length] ?? null,
    ],
  );

  const updated = await getCheckJobForUser(jobId, userId);
  if (!updated) throw new Error("Job missing after advance");
  return updated;
}
