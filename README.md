# Clinic Booking System: Concurrency & Performance Lab

A NestJS + PostgreSQL + Redis backend for a multi-branch clinic appointment system. It started as a deliberately naive baseline. Each flaw was then reproduced under load (k6), fixed, and measured again (k6, `EXPLAIN ANALYZE`).

## Goal

Learn and demonstrate how a booking system behaves under high concurrency, and how to make it correct, fast and maintainable. Every design decision below is backed by a test result.

## Highlights

| Area | Problem | Fix | Result |
|---|---|---|---|
| Concurrency | Many patients booked the same slot | Transaction + `SELECT ... FOR UPDATE` | Exactly 1 booking per slot |
| Idempotency | Retry or double tap returned `409` after a successful booking | `Idempotency-Key` header + `idempotency_keys` table | Duplicate requests return the saved response |
| Query speed | Seq Scan over 48,000 slots | Two composite indexes | 14.410 ms → 0.300 ms (~48x) |
| N+1 | 1 query per row in admin endpoints | Single `JOIN` | ~90.5% and ~92.9% faster |
| Pooling | Connection setup overhead under 150 VUs | Tuned `pg` pool | Best size: 15 on this hardware |
| Caching | Repeated reads of static data | Redis for branches and doctors only | Slots never cached |
| Payments | Payment inside a DB transaction held connections and blocked slots | Reserve → commit → pay outside the transaction | Short transactions, gateway replaceable |
| Design | Business logic coupled to infrastructure | Controller → Service → Repository, interfaces, dependency injection | SOLID-aligned, swappable implementations |
| Observability | No visibility into runtime behavior | Prometheus metrics endpoint | `/metrics` |

---

## Architecture and SOLID

Layers (N-tier):

```
Controller  →  Service  →  Repository / PaymentGateway (interfaces)  →  PostgreSQL / Redis / Payment service
 HTTP         business      data access and external systems
```

- **Controller:** HTTP request and response only.
- **Service:** business rules (booking, reservation, transactions, idempotency).
- **Repository:** SQL only.

### Dependency injection and Dependency Inversion

Services depend on interfaces, not concrete classes. NestJS injects the implementation through a token:

```ts
// Before: tightly coupled to the concrete class
constructor(private appointmentsRepo: AppointmentsRepository) {}

// After: depends on an abstraction, implementation injected by Nest
constructor(
  @Inject(APPOINTMENTS_REPOSITORY)
  private readonly appointmentsRepo: IAppointmentsRepository,
  @Inject(PAYMENT_GATEWAY)
  private readonly paymentGateway: IPaymentGateway,
) {}
```

The module binds the token to an implementation:

```ts
{ provide: PAYMENT_GATEWAY, useClass: MockPaymentGateway }  // swap for a real gateway here
```

### SOLID applied

| Principle | How it is applied |
|---|---|
| **S**ingle Responsibility | Payment logic moved out of `AppointmentsService` into its own module. The service handles booking rules only. |
| **O**pen/Closed | Replacing the mock gateway with a real one means adding a new class that implements `IPaymentGateway`. `AppointmentsService` is not edited. |
| **L**iskov Substitution | Any `IPaymentGateway` implementation (mock or real) can be used without changing the service's behavior. |
| **I**nterface Segregation | The bloated repository interface (it mixed several concerns) is being split into smaller, focused interfaces. |
| **D**ependency Inversion | High-level business logic depends on interfaces (`IAppointmentsRepository`, `IPaymentGateway`), injected via NestJS DI tokens. |

Further benefits: services can be unit tested with fake repositories, and the database access method can change without touching business logic.

---

## Decision Log

### 1. Concurrency: transaction vs. row lock

**Problem:** `bookSlotNaive` ran `UPDATE ... SET status='booked'` with no transaction, lock or availability check. Under 150 VUs on one slot, several patients "successfully" booked it and each got a ticket.

**Misconception corrected:** A transaction does not lock rows. It guarantees atomicity (all operations succeed or none do). Preventing two requests from claiming the same row needs pessimistic locking (`SELECT ... FOR UPDATE`).

**Rule:** `FOR UPDATE` must run inside `BEGIN ... COMMIT`. Outside a transaction, the lock is released when the statement ends.

| Step | Change | k6 contention result |
|---|---|---|
| Naive | No transaction, no lock, no check | Multiple patients claimed one slot |
| 1 | `BEGIN/COMMIT` only (`findSlotById`) | Race still possible |
| 2 | `BEGIN/COMMIT` + `FOR UPDATE` (`findSlotByIdForUpdate`) | Only one patient books the slot |

**Priority:** consistency. The slot update and ticket creation succeed or fail together.

### 2. Pessimistic vs. optimistic locking

Optimistic locking suits workloads where conflicts are rare. Here, many users compete for the same slot, so conflicts are expected. Row-level locking is the better fit than version checks and retries.

### 3. Idempotency keys

**Problem:** Even with locking, a dropped response makes the client retry. The retry sees a booked slot and returns `409`, though the first request succeeded. A double tap does the same.

**Decision:** The client sends an `Idempotency-Key` header. The server stores it in `idempotency_keys`:

- `processing`: registered when the request starts
- `completed`: set on success, response saved
- `failed`: set on error

A repeated key returns the saved response and does not run the booking again.

### 4. Indexes

Query: available slots for a doctor, at a branch, on a date.

```sql
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_branch_doc_date
ON doctor_schedules (branch_id, doctor_id, for_date);

CREATE INDEX IF NOT EXISTS idx_appointment_slots_schedule_status_time
ON appointment_slots (schedule_id, status, start_time);
```

| | Before | After |
|---|---|---|
| Scan | Seq Scan on `appointment_slots` (48,000 rows) | Index Scan |
| Join | Hash Join | Nested Loop |
| Execution time | 14.410 ms | 0.300 ms (~48x faster) |
| Planning time | 0.490 ms | 3.159 ms |

**Trade-offs:** faster reads, slower writes (index maintenance), extra storage for the B+ trees.

### 5. Connection pooling

Without a pool, each query pays for a TCP handshake and a new Postgres process. A pool keeps connections open and reuses them.

Setup: 150 VUs, 10 ms sleep, 30 s per run.

- **Pools 3 / 13 / 23 / 33 (same database state):** throughput, average latency and total requests improved, and P95 dropped sharply. Successful bookings fell and conflicts rose, because more concurrent requests raced for random slots.
- **Pools 5 / 15 / 25 (fresh database each run):** 5 → 15 gave a large throughput gain with lower average latency and P95. 15 → 25 gave very little.

**Decision:** pool size **15** for this hardware. A larger pool needs more CPU (vertical scaling).

### 6. Caching (Redis)

- Cached: branch list and doctors per branch (`cache:branches:all`, `cache:branch:{id}:doctors`, TTL 60 s). They rarely change.
- Not cached: `appointment_slots`. It changes constantly and stale data would cause wrong availability.

### 7. N+1 queries (admin endpoints)

Naive: 1 query for the list, then 1 query per row. Optimized: a single `JOIN`.

| Case | N+1 | Optimized | Reduction |
|---|---|---|---|
| Branch doctors | 21 queries, 63 ms | 1 query, 6 ms | ~90.5% |
| Branch bookings (2026-11-04) | 82 queries, 462 ms | 1 query, 33 ms | ~92.9% |

The gap grows with data size.

### 8. Technology choices

- **PostgreSQL** (not SQLite or MongoDB): the data is highly relational (patients, doctors, branches, schedules, slots, tickets, payments). Postgres provides JOINs, transactions, row-level locking and query planning tools. SQLite has limited concurrent writes. MongoDB uses a different data model that does not fit the learning goals.
- **N-tier architecture:** separates HTTP, business logic and data access, so each is easier to maintain, test and replace.

### 9. Payment flow and slot reservation

A mock payment gateway (85% random success, simulated delays and failures) stands in for a real one. It sits behind `IPaymentGateway`.

**First version (rejected).** Payment ran inside the database transaction:

1. Violated SRP: `bookAppointment` did too much.
2. Violated OCP: switching to a real gateway meant editing the core booking method.
3. Violated ISP: the appointments interface was bloated.
4. The transaction held a pooled connection for the whole payment call.
5. The slot stayed locked or reserved while waiting, so real users saw it as unavailable.

**Current flow.** Payment happens outside the transaction:

1. `BEGIN`: lock the slot (`FOR UPDATE`). If it is reserved and expired, clean it (`findAndCleanExpiredSlot`).
2. If the slot is available, set `status = reserved` with a 2-minute expiry. `COMMIT` and release the connection.
3. Call the payment gateway through `IPaymentGateway`.
4. **Success:** in a new transaction, set the slot to `booked`, clear the expiry, create the ticket and payment record.
5. **Failure:** set the slot back to `available`.

If the slot is reserved and not yet expired, the request is rejected.

**Fix:** ticket creation used to happen before the booking was confirmed. It now runs after confirmation, so a failed booking never leaves a ticket or payment record.

**Known flaw:** expired reservations are only cleaned when a patient explicitly tries that slot. If the gateway never responds, the slot keeps showing as reserved in listings until then.

**Out of scope (lab project):** refunds when the gateway responds after the reservation has expired.

### 10. Observability

The app exposes Prometheus metrics via `prom-client`:

```bash
curl -i http://localhost:13000/metrics
```

---

## Scalability and Future Work

If this became a production system:

- Background job to release expired reservations (removes the flaw above)
- Real payment gateway implementing `IPaymentGateway`, with webhooks for async confirmation
- Refund handling for payments that complete after a reservation expires
- Split the bloated repository interface fully (ISP)
- Patient booking history endpoint
- "Select doctor only" booking, where the system picks any free slot
- Automated unit, integration and e2e tests
- Read replicas and a larger pool on bigger hardware
- Rate limiting and authentication

---

## Domain Model

A clinic has multiple branches. Doctors are assigned to branches (`doctor_branch_assignments`). Each doctor has a schedule per date (`doctor_schedules`), split into 10-minute slots (`appointment_slots`). A patient books a `slotId`, which updates the slot and creates a `patient_tickets` row.

Tables: `branches`, `doctors`, `doctor_branch_assignments`, `patients`, `doctor_schedules`, `appointment_slots`, `patient_tickets`, `booking_attempts`, `idempotency_keys`.

Seed data: 10 branches, 200 doctors, 5,000 patients, 48,000+ available slots over 10 days.

## Tech Stack

NestJS 10, TypeScript 5, Node.js, PostgreSQL 15 (`pg`), Redis 7 (`ioredis`), class-validator, Docker Compose, Prometheus, Grafana, k6.

## Project Structure

```
src/
  main.ts                 # bootstrap, global ValidationPipe (whitelist, transform)
  app.module.ts
  appointments/           # booking core (controller, service, repository, interfaces, dto)
  payments/               # IPaymentGateway + mock implementation
  branches/               # branches, doctors, slot lookup (Redis cached lists)
  admin/                  # N+1 vs optimized endpoints
  database/               # database.service.ts (pg.Pool), schema.sql, seed.ts, migrations/
  redis/                  # redis.service.ts, redis.module.ts
k6/
  contention-test.js      # many VUs on one slot
  throughput-test.js      # 150 VUs, 30 s
docker-compose.yml
```

---

## Setup

### Prerequisites

Node.js, npm, Docker, Docker Compose, k6.

### Environment

Copy `.env.example` to `.env`:

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

Full reset:

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

Put SQL files in `src/database/migrations/` with a descriptive name, for example `migration_v2_payments.sql`. Apply:

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
| GET | `/metrics` | Prometheus metrics |

`POST /appointments/book` body:

```json
{ "slotId": 1, "patientId": 10, "testRunId": "manual-test-1" }
```

Optional header: `Idempotency-Key: <unique-key>`

---

## Testing

### Smoke test

```bash
curl "http://localhost:13000/branches/1/doctors/1/slots?date=2026-10-27"

curl -X POST http://localhost:13000/appointments/book \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-123" \
  -d '{"slotId": 1, "patientId": 10, "testRunId": "manual-test-1"}'
```

Repeating the second request with the same key returns the saved response, not a conflict.

### Concurrency test (k6)

1. Pick an available slot id from `appointment_slots` (example: `4`).
2. From the project root:

```bash
k6 run ./k6/contention-test.js
k6 run ./k6/throughput-test.js
```

3. Count successful attempts:

```sql
SELECT slot_id, COUNT(*) AS total_success_attempts
FROM booking_attempts
WHERE slot_id = 4 AND test_run_id = 'run-contention-baseline' AND attempt_status = 'success'
GROUP BY slot_id;
```

4. See who claimed the slot:

```sql
SELECT ba.slot_id, ba.patient_id, p.full_name, ba.created_at
FROM booking_attempts ba
JOIN patients p ON ba.patient_id = p.id
WHERE ba.slot_id = 4 AND ba.test_run_id = 'run-contention-baseline' AND ba.attempt_status = 'success';
```

**Expected:** the naive and transaction-only versions show multiple patients on one slot. Transaction + `FOR UPDATE` shows exactly one.

To reproduce the earlier versions, change the lookup in `appointments.service.ts`:

```ts
// transaction only
const slot = await this.appointmentsRepo.findSlotById(slotId, client);

// transaction + row lock
const slot = await this.appointmentsRepo.findSlotByIdForUpdate(client, slotId);
```

### Index test

Run with and without the two indexes:

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

### Payment flow check

Book a slot several times with different patients. About 85% of payments succeed. On failure, the slot returns to `available`. On success, it becomes `booked` with a null expiry, and a ticket exists. Check:

```sql
SELECT id, status, reservation_expires_at FROM appointment_slots WHERE id = 1;
```

(Adjust the column name to match your schema.)

## Known Issues

- k6 scripts hardcode port `7333`. Align them with `PORT` (`13000`).
- Expired reservations are cleaned lazily, only when a patient tries that slot.
- No refund handling for late gateway responses.
- No automated tests yet.
