# Clinic Booking System: Concurrency & Performance Lab

## Goal

Build a clinic appointment booking backend (NestJS, PostgreSQL, Redis) as a deliberately naive baseline, then find and fix its concurrency and performance problems one at a time. Each fix is measured with load tests (k6) and query plans (`EXPLAIN ANALYZE`), so every decision here is backed by numbers.

Problems covered:

1. Race condition: multiple patients booking the same slot
2. Double submit: retries and double taps creating duplicate bookings
3. Slow reads: sequential scans on slot lookup
4. N+1 queries in admin endpoints
5. Connection pool sizing under load
6. Caching of read-heavy data
7. Payment flow with slot reservation (in progress)

---

## Decision Log

### 1. Concurrency: transaction vs. row lock

**Problem:** `bookSlotNaive` ran `UPDATE ... SET status='booked'` with no transaction, no lock and no availability check. Under 150 VUs on one slot, several patients "successfully" booked it, and each got a ticket.

**Misconception corrected:** A transaction does not lock rows. It only guarantees that all operations succeed or none do (atomicity). Preventing two requests from claiming the same row needs pessimistic locking (`SELECT ... FOR UPDATE`).

**Rule:** `FOR UPDATE` must run inside the `BEGIN ... COMMIT` block. Outside one, the lock is released as soon as the statement ends.

**Steps tested (k6 contention test after each):**

| Step | Change | Result |
|---|---|---|
| Naive | No transaction, no lock, no check | Multiple patients claimed one slot |
| 1 | `BEGIN/COMMIT` only (`findSlotById`) | Race still possible |
| 2 | `BEGIN/COMMIT` + `FOR UPDATE` (`findSlotByIdForUpdate`) | Only one patient books the slot |

**Priority:** The slot update and ticket creation (`patient_tickets`) happen in one atomic transaction. If either fails, both roll back.

### 2. Idempotency keys

**Problem:** Even with locking, a dropped response makes the client retry. The retry sees the slot as booked and returns `409 Conflict`, even though the first request succeeded. A double tap causes the same issue.

**Decision:** The client sends an `Idempotency-Key` header. The server stores it in `idempotency_keys` with a status:

- `processing`: registered when the request starts
- `completed`: set on success, with the response saved
- `failed`: set on error

A duplicate request with the same key returns the saved response instead of re-running the booking.

### 3. Indexes

Query analyzed: available slots for a doctor, at a branch, on a date.

```sql
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_branch_doc_date
ON doctor_schedules (branch_id, doctor_id, for_date);

CREATE INDEX IF NOT EXISTS idx_appointment_slots_schedule_status_time
ON appointment_slots (schedule_id, status, start_time);
```

| | Before | After |
|---|---|---|
| Scan type | Seq Scan on `appointment_slots` (48,000 rows) | Index Scan |
| Join | Hash Join | Nested Loop |
| Execution time | 14.410 ms | 0.300 ms (~48x faster) |
| Planning time | 0.490 ms | 3.159 ms |

**Trade-offs:** reads are faster, writes are slower (index maintenance), and the B+ trees use extra storage.

### 4. Connection pooling

**Why:** Without a pool, each query pays for a TCP handshake and a new Postgres process. A pool keeps connections open and reuses them.

**Setup:** 150 VUs, 10 ms sleep, 30 s per run.

- **Pools 3 / 13 / 23 / 33 (same database state):** throughput, average latency and total requests improved, and P95 dropped sharply. Successful bookings fell and conflicts rose, because more concurrent requests raced for randomly chosen slots.
- **Pools 5 / 15 / 25 (fresh database each run):** 5 to 15 gave a large throughput gain, lower average latency and lower P95. 15 to 25 gave very little.

**Decision:** Pool size **15** for this hardware. Larger pools need more CPU (vertical scaling).

### 5. Caching (Redis)

- Cache data that is mostly static: branch list and doctors per branch (`cache:branches:all`, `cache:branch:{id}:doctors`, TTL 60 s).
- Do not cache data that changes frequently: `appointment_slots` always hits the database.

Check cached keys:

```bash
docker exec -it delta_redis redis-cli keys "*"
```

### 6. N+1 queries (admin endpoints)

Naive version: 1 query for the list, then 1 query per row. Optimized version: a single `JOIN`.

| Case | N+1 | Optimized | Reduction |
|---|---|---|---|
| Branch doctors | 21 queries, 63 ms | 1 query, 6 ms | ~90.5% |
| Branch bookings (2026-11-04) | 82 queries, 462 ms | 1 query, 33 ms | ~92.9% |

The gap grows with data size.

### 7. Payment flow (in progress)

A separate payment gateway service is being built in its own repository and connected through inter-service communication. This keeps the payment logic isolated and lets it be studied on its own. A mock gateway with **85% random success** and simulated delays and failures is used for now.

Booking flow with reservation:

1. Check the slot.
2. If the slot is reserved and the 2-minute reservation has not expired, reject the request.
3. If the reservation has expired, clear it and make the slot available again.
4. Otherwise reserve the slot for 2 minutes.
5. Run the payment.
6. Payment succeeds: slot becomes `booked`. Payment fails: slot is cleared and becomes `available`.

### 8. Planned

- Repository interfaces, with a write-up of why they are needed, why this structure was chosen, the future benefits, and a check for SOLID gaps.
- Patient-side booking history (a patient can see which slots they booked).
- Select-doctor-only booking, where the system picks any free slot.

---

## Domain Model

A clinic has multiple branches. Doctors are assigned to branches (`doctor_branch_assignments`). Each doctor has a schedule per date (`doctor_schedules`) split into 10-minute slots (`appointment_slots`). A patient books a `slotId`, which updates the slot and creates a `patient_tickets` row.

Tables (9): branches, doctors, doctor_branch_assignments, patients, doctor_schedules, appointment_slots, patient_tickets, booking_attempts, idempotency_keys.

Seed data: 10 branches, 200 doctors, 5,000 patients, 48,000+ available slots across 10 days.

## Tech Stack

NestJS 10, TypeScript 5, Node.js, PostgreSQL 15 (`pg`), Redis 7 (`ioredis`), class-validator, Docker Compose, Prometheus, Grafana, k6.

## Project Structure

```
src/
  main.ts                 # bootstrap, global ValidationPipe (whitelist, transform)
  app.module.ts
  appointments/           # booking core (controller, service, repository, dto)
  branches/               # branches, doctors, slot lookup (Redis cached lists)
  admin/                  # N+1 vs optimized endpoints
    naive_implementation/
    updated_implementation/
  database/               # database.service.ts (pg.Pool), schema.sql, seed.ts, migrations/
  redis/                  # redis.service.ts, redis.module.ts
k6/
  contention-test.js      # many VUs on one slot
  throughput-test.js      # 150 VUs, 30 s
docker-compose.yml
```

## Setup

### Prerequisites

Node.js, npm, Docker, Docker Compose, k6.

### Environment

Copy `.env.example` to `.env` and set:

```
PORT=13000
DB_HOST=localhost
DB_PORT=15432
DB_USER=postgres
DB_PASSWORD=<your-password>
DB_NAME=delta_diagnostic
DB_POOL_MAX=15
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Run

```bash
docker compose up -d      # starts Postgres, Redis, Prometheus, Grafana; applies schema.sql
npm install
npm run seed              # truncates and repopulates data
npm run start:dev
```

Reset everything:

```bash
docker compose down -v
docker compose up -d
npm run seed
```

| Service | Port |
|---|---|
| API | 13000 |
| PostgreSQL | 15432 |
| Redis | 6379 |
| Prometheus | 19090 |
| Grafana | 7009 |

### Database access

```bash
docker exec -it delta_postgres_baseline psql -U postgres -d delta_diagnostic
```

## Migrations

Put SQL files in `src/database/migrations/` with a descriptive name, for example `migration_v2_payments.sql`. Apply with:

```bash
docker exec -i delta_postgres_baseline psql -U postgres -d delta_diagnostic < src/database/migrations/migration_v2_payments.sql
```

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/branches` | List branches (cached) |
| GET | `/branches/:branchId/doctors` | Doctors in a branch (cached) |
| GET | `/branches/:branchId/doctors/:doctorId/slots?date=YYYY-MM-DD` | Available slots |
| POST | `/appointments/book` | Book a slot |
| GET | `/admin/branches/:branchId/doctors-n-plus-one` | N+1 version |
| GET | `/admin/branches/:branchId/doctors-optimized` | Single JOIN version |
| GET | `/admin/branches/:branchId/bookings-n-plus-one?date=` | N+1 version |
| GET | `/admin/branches/:branchId/bookings-optimized?date=` | Single JOIN version |

`POST /appointments/book` body:

```json
{ "slotId": 1, "patientId": 10, "testRunId": "manual-test-1" }
```

Optional header: `Idempotency-Key: <unique-key>`

## Testing

### Smoke test

```bash
curl "http://localhost:13000/branches/1/doctors/1/slots?date=2026-10-27"

curl -X POST http://localhost:13000/appointments/book \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-123" \
  -d '{"slotId": 1, "patientId": 10, "testRunId": "manual-test-1"}'
```

Repeating the second request with the same key should return the saved response, not a conflict.

### Concurrency test (k6)

1. Pick an empty slot id from `appointment_slots` (example below uses `4`).
2. From the project root:

```bash
k6 run ./k6/contention-test.js
k6 run ./k6/throughput-test.js
```

3. Count successful attempts for the slot:

```sql
SELECT slot_id, COUNT(*) AS total_success_attempts
FROM booking_attempts
WHERE slot_id = 4 AND test_run_id = 'run-contention-baseline' AND attempt_status = 'success'
GROUP BY slot_id;
```

4. See who claimed it:

```sql
SELECT ba.slot_id, ba.patient_id, p.full_name, ba.created_at
FROM booking_attempts ba
JOIN patients p ON ba.patient_id = p.id
WHERE ba.slot_id = 4 AND ba.test_run_id = 'run-contention-baseline' AND ba.attempt_status = 'success';
```

**Expected:** naive and transaction-only versions show multiple patients on one slot. Transaction + `FOR UPDATE` shows exactly one.

To switch between versions, change this line in `appointments.service.ts`:

```ts
// transaction only
const slot = await this.appointmentsRepo.findSlotById(slotId, client);

// transaction + row lock
const slot = await this.appointmentsRepo.findSlotByIdForUpdate(client, slotId);
```

### Index test

Run the slot lookup with and without the two indexes:

```sql
EXPLAIN ANALYZE
SELECT s.id, s.start_time, s.end_time, s.status, ds.for_date
FROM appointment_slots s
JOIN doctor_schedules ds ON s.schedule_id = ds.id
WHERE ds.branch_id = 1 AND ds.doctor_id = 1
  AND ds.for_date = '2026-11-03' AND s.status = 'available'
ORDER BY s.start_time ASC;
```

Remove an index with `DROP INDEX <index_name>;`.

### Connection pool test

Set `DB_POOL_MAX`, restart the app, run `throughput-test.js`. Compare throughput, average latency, P95 and booking conflicts. Use a fresh database for each run.

### N+1 test

```bash
curl -i "http://localhost:13000/admin/branches/1/bookings-n-plus-one?date=2026-11-04"
curl -i "http://localhost:13000/admin/branches/1/bookings-optimized?date=2026-11-04"
```

The logger reports `totalQueriesExecuted` and `executionTimeMs`.

### Redis cache check

```bash
docker exec -it delta_redis redis-cli keys "*"
```

## Known Issues

- Port values differ across files: k6 scripts hardcode `7333`, some docs use `3000`. Align them with `PORT`.
- `prometheus.yml` is empty.
- No automated tests yet.
- `tree_output.txt` is a broken output file and can be deleted.
- The `naive_implementation/` and `updated_implementation/` folders hold `.txt` files, which should become real code or docs.
