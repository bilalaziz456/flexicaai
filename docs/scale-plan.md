# Scale-hardening plan — toward 10,000+ clinics

> Written 2026-07-21 after a scale pressure-test. **Nothing here blocks launch** — the
> app is architected single-node-first on purpose (CLAUDE.md: "add Redis/BullMQ only
> when needed"). This captures what must change as active-clinic count grows, so it
> isn't rediscovered under fire. Much overlaps **§Z** in docs/todo.md (deploy activation).

---

## 0. The good news — what already scales

The **data model is the strong part**: every tenant query is `byClinic()`-scoped with
`(clinic_id, …)` indexes, so a clinic reads only ITS slice regardless of total clinics —
per-clinic cost stays flat as the fleet grows. Also fine: pagination on the big lists
(patients / appointments / admin-clinics), notification fan-out (bounded per clinic),
indexed O(1) session lookup, per-clinic trigram search, the tenant-guard fast path
(a substring check). **None of the below is a rewrite — it's additive infra that plugs
into interfaces we already have** (`Limiter`, the storage module, the cron entrypoints).

---

## 1. Critical — required the moment you run more than one instance

### 1a. Shared rate-limit / throttle store (Redis)
`core/security/rate-limit.ts` is IN-MEMORY per Node process. Horizontally scaled, the
login / reset / AI-scribe limits become per-instance → an attacker hitting different
instances multiplies the effective limit, and the maps grow per-instance.
→ **Back `Limiter` with Redis** (INCR + EXPIRE, or a sliding-window script). The public
surface (`peek`/`hit`/`reset`/`throttle`) stays; only the store swaps. Localized change.

### 1b. Connection pooler (§Z)
Pool is `max: 10` per instance; N instances × 10 blows Postgres `max_connections`.
→ **PgBouncer** (transaction pooling) or a managed pooler (Neon / Supabase / RDS Proxy).
Set the app pool small and let the pooler fan out. Also revisit `max` per instance.

### 1c. Object storage (§Z)
`core/integrations/storage` is local FS — doesn't share across instances and fills disks.
→ **S3-compatible** behind the same module interface (already abstracted).

---

## 2. High — breaks as data/traffic grows (independent of instance count)

### 2a. Crons process ALL clinics in one sequential pass
`processDueRecalls` (`.limit(200)` + an **N+1**: a patient + clinic query PER recall +
sequential WhatsApp sends) and `sendDueAppointmentReminders` (sequential sends) won't
keep up and can time out at fleet scale.
→ **Job queue (BullMQ + Redis):** enqueue per-clinic (or per-batch) jobs, process with
bounded concurrency + provider rate limits + retries/idempotency. Fix the N+1 (join
patient+clinic into the due-rows query, or batch-load). Keep the current inline path as
the small-deployment fallback.

### 2b. Super-admin cross-tenant scans
`listAllTrash` (`collect({kind:"all"})`) scans **9 tables across every clinic with no
limit** and sorts in JS; `/admin/logs` scans all `activity_logs`. Fine at tens of clinics,
fatal at thousands.
→ Add pagination + mandatory date bounds + supporting indexes; for Trash, query one
entity/clinic at a time or redesign (a materialized "trash index", or drop the global
all-clinics view in favour of per-clinic drill-in).

### 2c. Append-only unbounded tables → retention + partitioning
`activity_logs`, `notifications`, `whatsapp_messages` grow toward billions of rows.
→ **Retention/archival** (drop or cold-store old rows) + **time (or clinic) partitioning**
so writes/reads/vacuum stay cheap. **Make the notification prune cron real** (it was
deferred as "optional" — at scale it's mandatory: `delete read where read_at < now-N`).

---

## 3. Medium — as the single DB gets hot

- **Read replicas** for the heavy reports (P&L / overview / finance KPIs / no-show) so
  analytics don't contend with transactional writes. Route reporting reads to a replica.
- **Partition the biggest transactional tables** (`appointments`, `sales`, `visits`) by
  time or clinic once a single node strains.
- **Cross-request cache (Redis) with TTL** for hot, rarely-changing config —
  clinic `features_enabled` / settings, per-user permissions — instead of re-reading every
  request. (The React `cache()` we added is per-request only; this is the next tier.)

---

## 4. Deferred security items (from the A–D pass)

- **CSP** — not set yet. Needs a nonce for the inline theme script (`app/layout.tsx`) +
  Tailwind; roll out **report-only first**, then enforce. Do as its own task.
- **Trusted proxy for rate-limit IP** — `x-forwarded-for` is spoofable unless the app is
  behind a trusted proxy that overwrites it; pin to the platform's client-IP header at §Z.
- **Server Action origins** — set `serverActions.allowedOrigins` to the prod domain(s).

---

## 5. Suggested trigger points (don't do it early)

| When | Do |
|---|---|
| Still single instance (launch) | Nothing here. §Z basics (storage, keys) only. |
| Going multi-instance / a few hundred active clinics | §1 (Redis limits, pooler, S3), §4 (CSP, proxy IP, action origins). |
| Cron backlog / report latency climbs | §2a (job queue + N+1 fix), §2b (super-admin bounds), §2c (retention + prune). |
| Single Postgres strains | §3 (replicas, partitioning, config cache). |

**Principle:** measure first (slow-query log, connection saturation, cron duration,
table sizes), then apply the matching item. Every item above slots into an existing
seam — no architectural rewrite.
