# Test Strategy — Delta Clinic Booking System

## Scope & Exclusions

### Scope
This strategy covers **functional testing** for the Delta Clinic Booking System, a NestJS v10 + TypeScript v5 backend for clinic appointment booking. It encompasses:

- **Public API endpoints**: branch lookup, doctor lookup, slot availability, appointment booking with idempotency
- **Admin endpoints**: N+1 vs optimized query pattern comparison
- **Concurrency and transaction behavior**: `FOR UPDATE` row locking, slot reservation lifecycle, idempotency key retries
- **Payment/reservation lifecycle**: controlled payment gateway; failure mode is deterministic (forced `false` instead of `Math.random()`), slot release on failure
- **Data integrity**: duplicate booking prevention, active booking checks, slot status transitions
- **Redis caching**: branch lists and per-branch doctor caches with 60s TTL
- **Observability**: `/metrics` endpoint behavior and structured request logging
- **API validation**: DTO constraints (`class-validator`, `class-transformer`)

### Exclusions
- **Performance/load testing**: k6 contention-test.js and throughput-test.js are **separate** tools; this strategy does not replace them. Functional concurrency tests must assert invariants, not throughput.
- **E2E cybersecurity testing**: no authentication is implemented; scope does not include auth/authorization test suites.
- **Schema or migration changes**: this skill is documentation-only; no `ALTER TABLE`, `CREATE INDEX`, or seed operations are performed.
- **Docker service management**: do not start/stop/recreate containers. A dedicated test database and Redis namespace must be pre-provisioned.
- **Unit test execution**: this strategy proposes a plan; it does not run tests or assert coverage numbers.

## Test Pyramid & Boundaries

| Layer | Focus | Example Techniques |
|---|---|---|
| **Unit** | Isolated logic and decision branches | - Service method branches (payment success/failure)<br>- Repository query filter branches<br>- Idempotency key status transitions<br>- DTO validation guard clauses<br>**Framework:** Jest with mock/stub isolation (no real DB) |
| **Integration** | Real database and cache interactions, transaction behavior | - `BEGIN...COMMIT` transaction boundaries<br>- `FOR UPDATE` lock contention<br>- Slot reservation (2-min hold) and auto-release<br>- Idempotency key lifecycle (processing → completed/failed)<br>- Payment success/failure persistence<br>- Redis cache hit/miss/expiry<br>- **Do not assert response execution times** in functional/integration tests; execution time metrics are relevant to performance/load testing (k6) only<br>**Framework:** Jest with test database (dedicated `test_db`) and test Redis namespace |
| **E2E** | HTTP contracts, routing, validation, complete workflows | - `POST /appointments/book` with valid/invalid DTOs<br>- `Idempotency-Key` header behavior<br>- Branch/doctor/slot lookup GET endpoints<br>- Admin N+1 vs optimized endpoint responses<br>- Error response codes and shapes<br>**Framework:** NestJS/Test great-circle or Playwright against `http://localhost:{PORT}` |

**Boundary Rule:** Unit tests must not use a real PostgreSQL connection or Redis client. Integration tests must use a **dedicated test database** and **test Redis namespace** (not the developer's ordinary database). E2E tests must run against the local development server only.

## Proposed Frameworks

| Purpose | Framework | Rationale |
|---|---|---|
| Unit tests | **Jest** | Jest is **not** in devDependencies in package.json (only @nestjs/testing is present). Unit tests use NestJS test utilities with mock isolation, no real DB. |
| Integration tests | **Jest** + **Supertest** + **@nestjs/testing** | Integration tests use Jest with a dedicated test database (`delta_diagnostic_test`). Supertest is used for HTTP-level assertions against the running NestJS app. |
| E2E tests | **Jest** + **Supertest** + **@nestjs/testing** | E2E tests run via `nest test e2e` using `@nestjs/testing` module. Supertest-style HTTP assertions against `http://localhost:{PORT}`. No separate Playwright dependency assumed. |
| Test data seeding | **SQL fixtures** (manual `INSERT` scripts) or **ts-node** seed with `TEST_DB` prefix | Deterministic fixtures; avoid the high-volume `seed.ts` which truncates 9 tables. Use minimal INSERT statements for specific scenarios. |

## Current Dependency Gaps

| Gap | Impact | Proposed Resolution (do not implement yet) |
|---|---|---|
| **No test database configured** | Integration and E2E tests have no target DB | Create a `test.env` or document that `DB_NAME=delta_diagnostic_test` must exist before running integration tests. Do not modify `schema.sql` or `seed.ts`. |
| **No test Redis namespace/instance** | Redis cache tests cannot isolate cache hit/miss/expiry | Use a separate Redis database number (e.g., `REDIS_DB=15`) or a labeled instance. Do not modify `src/redis/redis.service.ts`. |
| **No Jest test scaffolding for repositories/services** | No existing `*..spec.ts` files for the repo layer | Generate minimal test skeletons that import the real repository and mock the `PoolClient` where needed. |
| **No E2E test runner configured** | `npm test` / `npm run e2e` not mapped to a working pipeline | Add an `e2e` script to `package.json` if one is not present; ensure `docker compose up -d` runs first. |
| **No test fixture utility** | Repetitive `TRUNCATE`/INSERT patterns across tests | Create a small `test/fixtures.ts` with helper functions for inserting minimal branches/doctors/patients/slots. |

## Environment Isolation & Safety Rules

| Rule | Detail |
|---|---|
| **Dedicated test DB** | Use a separate database (e.g., `delta_diagnostic_test`). Never run integration tests against `delta_diagnostic` production data. |
| **Test Redis namespace** | **Verify whether Redis DB selection is configurable** before relying on `REDIS_DB=15`. Inspect `src/redis/redis.service.ts` — the Redis client is configured with only `host` and `port` from environment variables; it does **not** include a `db` parameter to select a specific Redis database number. If Redis does not support database selection via URI or the `db` parameter is unsupported, tests must use alternative isolation (e.g., separate Redis instance or different port). Do not assume `REDIS_DB=15` works without verification. |
| **No TRUNCATE in tests** | Tests must `INSERT` only the rows they need and `DELETE`/`ROLLBACK` their own changes. The `seed.ts` script truncates 9 tables — **do not call it from test scripts**. |
| **Transaction rollback for integration tests** | **Not guaranteed** — the application manages its own database pool connections via `DatabaseService.getClient()`, which returns a new client from the pool each time. Integration tests must not rely on automatic transaction rollback to clean state; each test must explicitly `INSERT` only the rows it needs and `DELETE` them afterward, or manage its own transaction via `getClient()`. Pool connections are not automatically released back to the transaction. |
| **No Docker service changes** | Do not `docker compose up/down` or rebuild images as part of test execution. Infrastructure must be pre-provisioned. |
| **k6 tests remain separate** | Functional concurrency tests must assert invariants (e.g., "only one patient can book slot X"). Do not treat k6 throughput tests as functional test substitutes. |

## Deterministic Fixture Strategy

1. **Minimal per-test inserts** — Insert only the branches, doctors, patients, and slots required for the specific scenario.
2. **Fixture helper** — Create a `test/fixtures.ts` with functions like:
   - `insertBranch(name, district)` → returns branch ID
   - `insertDoctor(specialty, branchId)` → returns doctor ID
   - `insertPatient(phone)` → returns patient ID (phone must be UNIQUE)
   - `insertSlot(scheduleId, startTime, endTime)` → returns slot ID
3. **Cleanup** — After each test, delete rows by the test's own IDs (do not rely on global TRUNCATE). Use `DELETE FROM patients WHERE phone = $1` or `TRUNCATE ... RESTART IDENTITY CASCADE` only for the test's own temporary schema.
4. **Idempotency key per test** — Generate a unique key (e.g., `test-key-{__TEST_ID}`) so idempotency retries do not collide across tests.
5. **Slot status tracking** — Always start slots as `available`; after a test, restore the slot to `available` status (lazy reset) so subsequent tests are not blocked. This is a **lazy** cleanup pattern — the background `findAndCleanExpiredSlot()` mechanism only runs at the start of each booking attempt and does **not** execute as a background garbage-collector. Tests must explicitly reset slot status between runs.

## Concurrency-Test Approach

- **Functional concurrency** (not performance): Assert that invariants hold under concurrent load.
- **Invariant example**: "After 100 concurrent `POST /appointments/book` requests for the same `slotId`, exactly one patient ticket is issued and the slot status is `booked`." — Verify via the test database, not via k6 throughput numbers.

- **Same idempotency key concurrent invariant**: "When 100 concurrent `POST /appointments/book` requests all use the same `Idempotency-Key` header for the same `slotId`, exactly one patient ticket is issued (idempotency key returns cached response from the first request) and the slot status is `booked`. No duplicate booking should occur, and the idempotency key status should remain `completed`." — Verify via the test database. This tests that the idempotency check at the start of `bookAppointment` works correctly under concurrent load, short-circuiting the DB logic after the first request. |
- **Do not use k6 as a functional test framework**: k6 is a load/performance tool. Functional concurrency tests must be written in Jest/integration test style with proper assertions on database state.
- **If k6 is used for functional validation**: Run with a single slot and verify the `FOR UPDATE` lock prevents double-booking. Track `status = 'booked'` count in the database after the run. But this is supplementary, not a replacement for unit/integration assertions.

## Proposed Commands (supported by eventual configuration)

| Command | Description |
|---|---|
| `npm run test:unit` | `jest --testPathPattern="src/**/*.spec"` — runs unit tests (will need `*.spec.ts` files) |
| `npm run test:integration` | `jest --testPathPattern="integration/"` — runs integration tests against test DB |
| `npm run test:e2e` | `nest test e2e` — runs e2e tests against `http://localhost:{PORT}` |
| `npm run test:concurrency` | Custom script that runs a small Jest suite asserting slot-booking invariants under concurrency (spawns multiple Promise calls to `bookAppointment` via the test client). |
| `psql -U postgres -d delta_diagnostic_test` | Access the test database for manual fixture verification. |
| `docker exec -it delta_redis redis-cli -n 15 KEYS "*"` | Inspect test Redis namespace (if using `REDIS_DB=15`). |

## Phased Implementation Order & Exit Criteria

| Phase | Deliverable | Exit Criteria |
|---|---|---|
| **Phase 1 — Foundations** | - Create `test/` directory with fixture helpers<br>- Configure `DB_NAME=delta_diagnostic_test` in a test `.env`<br>- Write first integration test: slot lookup returns expected data<br>- Verify Redis cache hit/miss with test namespace | Unit test scaffolding exists; integration test passes against test DB; Redis test namespace is reachable; no test data leaks across runs. |
| **Phase 2 — Booking Core** | - Integration tests for `bookAppointment`: success, failed payment, duplicate booking prevention<br>- Idempotency key lifecycle test (processing → completed, retry returns cached response)<br>- Unit tests for service decision branches (payment success/failure) | All booking flow paths have integration test coverage; idempotency key status transitions verified; duplicate booking throws `BadRequestException`; payment failure releases slot and returns error; payment status='failed' persists in `payments` table and slot status='available' is restored (verified against `releaseSlot()` and `recordPayment()` implementation). |
| **Phase 3 — Admin & Observability** | - E2E tests for admin N+1 vs optimized endpoints (response shapes, query metrics logged)<br>- Unit tests for `MetricsService` counter/histogram registration<br>- Integration test for `/metrics` endpoint returns `text/plain` | Admin endpoints return correct data shapes; N+1 vs optimized metrics are logged; `/metrics` endpoint is reachable and returns Prometheus-format data. |
| **Phase 4 — Validation & Cleanup** | - E2E tests for DTO validation (invalid `slotId`, out-of-range `patientId`)</br>- Integration tests for Redis cache expiry (force miss after TTL)<br>- Coverage report generation (acceptable threshold to be decided) | All critical paths (booking, idempotency, reservation, admin lookups) have test coverage; no failing tests; coverage meets agreed minimum (e.g., 80% for unit, integration defined per feature). |

**Note:** Exit criteria are intentionally phrased as *functional* goals, not coverage percentages. The goal is that every code path described in `AGENTS.md` and the source code has at least one test verifying its observable behavior.

## Unknown Behaviors / Product Decisions

| Behavior | Status | Notes |
|---|---|---|
| **Idempotency-Key header case-sensitivity** | `Needs implementation review` | The `@Headers('idempotency-key')` decorator behavior regarding casing was not explicitly verified in code inspection. |
| **Exact response shape of `slot` and `ticket` in book appointment 201** | `Needs product decision` | Documented as `{ ... }` in API docs; exact field mapping to `appointment_slots`, `patient_tickets`, `payments` entities was not introspected. |
| ** whether `Idempotency-Key` is required or optional** | `Needs implementation review` | Controller accepts it as optional (`?`), but idempotency logic only fires when a key is provided. |
| **Redis cache eviction policy beyond TTL** | `Needs implementation review` | Cache uses `EX` TTL of 60s; behavior if Redis memory is full is unknown. |
| **Error response body shape for 409 Conflict, 400 Bad Request** | `Needs implementation review` | Some errors throw objects (`{ message, transactionId }`), others throw strings. Consistency should be verified. |
| **Concurrent booking with `FOR UPDATE` outside `BEGIN...COMMIT`** | `Needs implementation review` | The codebase correctly uses `FOR UPDATE` inside transactions, but edge cases (e.g., manual commit) were not inspected. |

## Completion Report

### Inspected Modules (all source files reviewed)
| Module | Key Files |
|---|---|
| `src/main.ts` | Global ValidationPipe, app bootstrap, PORT env var |
| `src/app.module.ts` | Root module, ConfigModule, all feature modules, global RequestLoggerMiddleware |
| `src/branches/` | controller (3 routes), service (Redis-cached), repository (3 queries), interface |
| `src/appointments/` | controller (1 POST book), service (full concurrency control), repository (FOR UPDATE, reservation, idempotency), DTO, interface |
| `src/admin/` | controller (4 N+1 vs optimized routes), service (comparison logic), repository (N+1 + optimized SQL) |
| `src/observability/` | metrics.service (prom-client counters/histograms), metrics.controller (/metrics endpoint) |
| `src/common/middleware/request-logger.middleware.ts` | Structured JSON request logging with status-code-aware levels |
| `src/database/database.service.ts` | Pool configuration (max from `DB_POOL_MAX`), query, getClient |
| `src/redis/redis.service.ts` | Redis get/set/del with 60s TTL, onModuleInit/onModuleDestroy |

### Deliverables Created
1. **`docs/testing/TEST_STRATEGY.md`** — this file (scope, test pyramid, frameworks, dependency gaps, environment isolation, fixture strategy, concurrency approach, proposed commands, phased implementation, unknown behaviors)
2. **`docs/testing/COVERAGE_MATRIX.md`** — generated below

### Dependency Gaps Identified
- No test database configured (`delta_diagnostic_test` must be created separately)
- No test Redis namespace/instance (use `REDIS_DB` env var; verify configurability first)
- No Jest test skeletons for repository/service layers
- No E2E test runner configuration
- No test fixture utility for deterministic data setup
- Idempotency-Key casing behavior unverified
- Exact response shape for book appointment not introspected

### Unknown Behaviors (require product/implementation review)
- Idempotency-Key header case-sensitivity
- Exact `slot`/`ticket` response field shapes in book appointment 201
- Whether `Idempotency-Key` is required or optional
- Redis cache eviction under memory pressure
- Error response body shape consistency
- `FOR UPDATE` contract edge cases
- Relationship between `Verified` (code-inspected) and `Not tested` (no automated test) statuses

### Decisions Needed
1. **Create `test/.env`** with `DB_NAME=delta_diagnostic_test` and optionally `REDIS_DB=15` (verify Redis DB selection first)
2. **Generate minimal Jest test skeletons** for each feature (booking, idempotency, admin, branches)
3. **Determine idempotency key policy**: required vs optional, exact header name casing
4. **Define acceptable test coverage thresholds** per layer (unit/integration/E2E)
5. **Decide on error response shape normalization** (consolidate object vs string throws)
6. **Clarify `Verified` vs `Not tested` status distinction**: `Verified` = behavior confirmed via code inspection; `Not tested` = no automated test written yet. These are independent statuses.

---
*This strategy was generated by inspecting the actual codebase. No application source code, database schema, migrations, or Docker configuration was modified. No tests were executed.*