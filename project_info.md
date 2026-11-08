# Delta Clinic Booking System: Technical Analysis

## Project Overview

**Name:** Delta Clinic Booking System - Naive Baseline
**Version:** 1.0.0
**Description:** A clinic appointment booking backend built as a deliberately naive baseline, designed to identify and fix concurrency and performance problems through measurement with load tests (k6) and query plans (`EXPLAIN ANALYZE`).

**Goal:** Start with a naive implementation, measure its failings, and iteratively fix concurrency and performance problems one at a time, with each fix backed by quantitative data.

---

## Technology Stack

| Category | Technologies |
|---|---|
| Framework | NestJS 10, TypeScript 5 |
| Runtime | Node.js |
| Database | PostgreSQL 15 (`pg` library) |
| Cache | Redis 7 (`ioredis` library) |
| Validation | class-validator, class-transformer |
| Observability | Prometheus, Grafana |
| Load Testing | k6 |
| Containerization | Docker Compose |

### Key Dependencies (package.json)
- `@nestjs/common`: ^10.0.0
- `@nestjs/core`: ^10.0.0
- `@nestjs/platform-express`: ^10.0.0
- `@prometheus-io/client`: ^0.16.1
- `ioredis`: ^6.0.0
- `pg`: ^8.11.3
- `prom-client`: ^15.1.3
- `class-validator`: ^0.14.1
- `class-transformer`: ^0.5.1

---

## Project Structure

```
src/
  main.ts                    # Bootstrap, global ValidationPipe
  app.module.ts              # Root module with middleware & imports
  app.module.ts              # Bootstrap, global ValidationPipe (whitelist, transform)
  
  appointments/              # Core booking module (controller, service, repository, dto)
    dto/
      book-appointment.dto.ts
    naive_implementation/    # Legacy/naive code files
    updated_implementation/  # Improved implementation files
    
  branches/                  # Branches, doctors, slot lookup (Redis cached lists)
    interfaces/              # Branch repository interface
    
  admin/                     # N+1 vs optimized endpoints
    interfaces/              # Admin repository interface
    naive_implementation/
    updated_implementation/
    
  database/                  # Database service, schema, seeding
    migrations/              # SQL migration files
    
  redis/                     # Redis service discovery
  
  observability/             # Prometheus metrics and controller
  
  common/                    # Shared middleware
    middleware/
      request-logger.middleware.ts

k6/                        # Load test scripts
  contention-test.js         # Many VUs on one slot
  throughput-test.js         # 150 VUs, 30s duration

docker-compose.yml           # PostgreSQL, Redis, Prometheus, Grafana
.env.example                 # Environment configuration
```

### Supporting Files
- `schema.sql` - Complete PostgreSQL schema (9 tables)
- `seed.ts` - High-volume database seeder (~48,000+ slots, 5,000 patients)
- `tree_output.txt` - Noted as broken, can be deleted
- `prometheus.yml` - Currently empty
- `Connection Pool Performance Comparison.png` - Visual performance data

---

## Domain Model

### Entity Relationship Diagram

```
branches (1--* doctor_branch_assignments) doctors (1--* doctor_branch_assignments)
doctors (1--* doctor_schedules) doctor_schedules (1--* appointment_slots)
branches (1--* doctor_schedules) via doctor_id
appointment_slots (1--* patient_tickets) patients (1--* patient_tickets)
appointment_slots (1--* payments) booking_attempts (tracks all attempts)
```

### Table Details (9 core tables)

| Table | Key Fields | Description |
|---|---|---|
| `branches` | `id`, `branch_name`, `district`, `is_active` | Clinic branches |
| `doctors` | `id`, `full_name`, `specialty`, `is_active` | Medical staff |
| `doctor_branch_assignments` | `id`, `doctor_id`, `branch_id` | Many-to-many link |
| `patients` | `id`, `full_name`, `phone` (UNIQUE), `created_at` | Patient registry |
| `doctor_schedules` | `id`, `doctor_id`, `branch_id`, `for_date`, `slot_duration_minutes` | Daily schedules |
| `appointment_slots` | `id`, `schedule_id`, `start_time`, `end_time`, `status`, `patient_id`, `reserved_until` | 10-min appointment slots |
| `patient_tickets` | `id`, `slot_id`, `patient_id`, `test_run_id`, `issued_at` | Booked tickets |
| `booking_attempts` | `id`, `slot_id`, `patient_id`, `test_run_id`, `attempt_status` | All booking attempts logged |
| `idempotency_keys` | `id`, `idempotency_key` (UNIQUE), `patient_id`, `status`, `response_status`, `response_body` | Idempotency support |
| `payments` | `id`, `slot_id`, `patient_id`, `amount`, `payment_status`, `transaction_id` | Payment records |

### Seed Data
- **10 branches** (Dhaka Central, Rajshahi Medical Hub, etc.)
- **200 doctors** across specialties (Cardiology, Neurology, Orthopedics, etc.)
- **5,000 patients** with persistent phone numbers
- **48,000+ available slots** across 10 days (18:00-22:00, 10-min intervals)
- Each doctor assigned to one branch cyclically

---

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET /branches` | List branches (Redis cached) |
| `GET /branches/:branchId/doctors` | Doctors in branch (Redis cached, TTL 60s) |
| `GET /branches/:branchId/doctors/:doctorId/slots?date=YYYY-MM-DD` | Available slots for doctor on date |
| `POST /appointments/book` | Book a slot (with idempotency support) |

**POST /appointments/book - Request Body**
```json
{
  "slotId": 1,
  "patientId": 10,
  "testRunId": "manual-test-1"
}
```
**Headers:**
- `Idempotency-Key: <unique-key>` (optional)

**Response (201):**
```json
{
  "message": "Appointment booked and payment successful!",
  "transactionId": "TXN-ABC123",
  "slot": { ... },
  "ticket": { ... }
}
```

### Admin Endpoints (for comparison/analysis)

| Method | Endpoint | Description |
|---|---|---|
| `GET /admin/branches/:branchId/doctors-n-plus-one` | N+1 query pattern |
| `GET /admin/branches/:branchId/doctors-optimized` | Single JOIN query |
| `GET /admin/branches/:branchId/bookings-n-plus-one?date=YYYY-MM-DD` | N+1 booking queries |
| `GET /admin/branches/:branchId/bookings-optimized?date=YYYY-MM-DD` | Single JOIN for bookings |

---

## Concurrency & Performance Design

### 1. Transaction & Row Locking (FOR UPDATE)

**Problem:** naive `bookSlotNaive` had no transaction, no lock, and no availability check. Under 150 VUs, multiple patients could "successfully" book the same slot.

**Solution:** Use `SELECT ... FOR UPDATE` inside a `BEGIN ... COMMIT` block to pessimistically lock the row during the transaction.

**Implementation flow:**
```typescript
await client.query('BEGIN');
// Lock the slot row
const slot = await this.appointmentsRepo.findSlotByIdForUpdate(client, slotId);
// Check availability, reserve, process payment, confirm booking
await client.query('COMMIT');
```

**Rule:** `FOR UPDATE` must run inside the `BEGIN ... COMMIT` block. Outside one, the lock is released as soon as the statement ends.

### 2. Idempotency Keys

**Problem:** Even with locking, dropped responses cause retries. The retry sees the slot as booked and returns `409 Conflict`, even though the first request succeeded.

**Solution:** Client sends `Idempotency-Key` header. Server stores it in `idempotency_keys` table with status:
- `processing`: registered when request starts
- `completed`: set on success, response saved
- `failed`: set on error

A duplicate request with the same key returns the saved response instead of re-running the booking.

### 3. Slot Reservation (2-Minute Hold)

Before payment confirmation, slots are temporarily reserved for 2 minutes:
```sql
UPDATE appointment_slots
SET status = 'reserved', patient_id = $1, reserved_until = NOW() + MAKE_INTERVAL(mins => $2)
WHERE id = $3 AND (status = 'available' OR (status = 'reserved' AND reserved_until < NOW()))
RETURNING *
```

If payment fails, the slot is released back to `available`. If payment succeeds, the slot becomes permanently `booked`.

### 4. Connection Pool Sizing

**Testing:** 150 VUs, 10 ms sleep, 30 s per run with pool sizes 3/13/23/33 and 5/15/25.

**Results:**
- **Pools 3/13/23/33:** Throughput improved, latency decreased, P95 dropped sharply. However, successful bookings fell and conflicts rose due to more concurrent requests racing for slots.
- **Pools 5/15/25:** 5→15 gave large throughput gain, lower average latency and lower P95. 15→25 gave very little additional benefit.

**Decision:** Pool size **15** for this hardware. Larger pools need more CPU (vertical scaling).

### 5. Caching Strategy (Redis)

**Cache data that is mostly static:**
- `cache:branches:all` - Branch list (TTL 60s)
- `cache:branch:{id}:doctors` - Doctors per branch (TTL 60s)

**Do NOT cache:** Data that changes frequently (`appointment_slots` always hits the database).

**Check cached keys:**
```bash
docker exec -it delta_redis redis-cli keys "*"
```

### 6. N+1 Query Optimization

**Admin endpoints compare N+1 vs optimized single JOIN:**

| Case | N+1 Queries | Time | Optimized Queries | Time | Reduction |
|---|---|---|---|---|---|
| Branch doctors | 21 queries | 63 ms | 1 query | 6 ms | ~90.5% |
| Branch bookings (2026-11-04) | 82 queries | 462 ms | 1 query | 33 ms | ~92.9% |

**Implementation:**
- N+1: 1 initial query + N individual queries in loop
- Optimized: Single `JOIN` across all relevant tables

### 7. Indexes (Performance)

Two critical composite indexes were created in `schema.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_branch_doc_date
ON doctor_schedules (branch_id, doctor_id, for_date);

CREATE INDEX IF NOT EXISTS idx_appointment_slots_schedule_status_time
ON appointment_slots (schedule_id, status, start_time);
```

**Results:** 
- Before: Seq Scan on `appointment_slots` (48,000 rows), Hash Join, 14.410 ms execution
- After: Index Scan, Nested Loop, 0.300 ms execution (~48x faster)

---

## Key Implementation Files

### appointments/appointments.service.ts

The core booking service with full concurrency control:

1. **Idempotency check** - Returns cached response if key exists and completed
2. **Transaction start** - `BEGIN`
3. **Clean expired reservations** - `findAndCleanExpiredSlot` auto-releases old reservations
4. **Duplicate booking check** - Verify patient hasn't already booked/reserved
5. **Status check** - Reject if slot not `available`
6. **Reserve slot** - Temporary 2-minute hold with `status = 'reserved'`
7. **Payment simulation** - `Math.random() < 0.85` (85% success rate)
8. **Payment success:** Record payment, issue ticket, confirm booking (status → `booked`)
9. **Payment failure:** Release slot, throw error
10. **Commit/rollback** - All-or-nothing transaction

### branches/branches.service.ts

Redis-cached service methods:
- `getBranches()` - Cache `cache:branches:all` with 60s TTL
- `getDoctors(branchId)` - Cache `cache:branch:{id}:doctors` with 60s TTL
- `getSlots(branchId, doctorId, date)` - Direct DB query (no caching)

### admin/admin.service.ts

N+1 vs optimized comparison methods:
- `getBranchDoctorsNPlusOne()` - 1 query + N loops
- `getBranchDoctorsOptimized()` - Single JOIN
- `getBranchBookingsNPlusOne()` - 1 query + N loops per slot
- `getBranchBookingsOptimized()` - Single JOIN across tickets, patients, slots, schedules, doctors

---

## Database Schema (schema.sql Summary)

The schema includes 9 tables with proper foreign key constraints and cascading deletes. Key indexes are:

```sql
-- Composite indexes for performance
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_branch_doc_date
ON doctor_schedules (branch_id, doctor_id, for_date);

CREATE INDEX IF NOT EXISTS idx_appointment_slots_schedule_status_time
ON appointment_slots (schedule_id, status, start_time);

-- Slot reservation support
ALTER TABLE appointment_slots ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  slot_id INT NOT NULL REFERENCES appointment_slots(id) ON DELETE CASCADE,
  patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL DEFAULT 500.00,
  payment_status VARCHAR(50) NOT NULL,
  transaction_id VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## Setup & Configuration

### Environment Variables (.env.example)

```
PORT=3000                              # API server port
DB_HOST=localhost                      # PostgreSQL host
DB_PORT=15432                          # PostgreSQL port
DB_USER=postgres                       # Database user
DB_PASSWORD=password123                # Database password
DB_NAME=delta_diagnostic               # Database name
DB_POOL_MAX=15                         # Connection pool size
REDIS_HOST=localhost                   # Redis host
REDIS_PORT=6379                        # Redis port
```

**Note:** The `.env` file should be created from the example. The project currently uses `PORT=13000` in runtime.

### Docker Compose Services

| Service | Port | Description |
|---|---|---|
| postgres | 15432 | PostgreSQL 15 |
| prometheus | 19090 | Prometheus monitoring |
| grafana | 7009 | Grafana dashboard |
| redis | 6379 | Redis 7 |

### Running the Application

```bash
# Start infrastructure
docker compose up -d

# Install dependencies
npm install

# Seed the database (truncates and repopulates)
npm run seed

# Start development server
npm run start:dev
```

### Database Access

```bash
docker exec -it delta_postgres_baseline psql -U postgres -d delta_diagnostic
```

### Migrations

Place SQL files in `src/database/migrations/` with descriptive names, e.g., `migration_v2_payments.sql`. Apply with:

```bash
docker exec -i delta_postgres_baseline psql -U postgres -d delta_diagnostic < src/database/migrations/migration_v2_payments.sql
```

---

## Testing

### Smoke Test

```bash
# Check slots availability
curl "http://localhost:13000/branches/1/doctors/1/slots?date=2026-10-27"

# Book an appointment
curl -X POST http://localhost:13000/appointments/book \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-123" \
  -d '{"slotId": 1, "patientId": 10, "testRunId": "manual-test-1"}'
```

### Concurrency Test (k6)

```bash
# Run contention test (many VUs on one slot)
k6 run ./k6/contention-test.js

# Run throughput test (150 VUs, 30s)
k6 run ./k6/throughput-test.js
```

### Index Test

```sql
EXPLAIN ANALYZE
SELECT s.id, s.start_time, s.end_time, s.status, ds.for_date
FROM appointment_slots s
JOIN doctor_schedules ds ON s.schedule_id = ds.id
WHERE ds.branch_id = 1 AND ds.doctor_id = 1
  AND ds.for_date = '2026-11-03' AND s.status = 'available'
ORDER BY s.start_time ASC;
```

### N+1 Test

```bash
curl -i "http://localhost:13000/admin/branches/1/bookings-n-plus-one?date=2026-11-04"
curl -i "http://localhost:13000/admin/branches/1/bookings-optimized?date=2026-11-04"
```

The logger reports `totalQueriesExecuted` and `executionTimeMs`.

### Redis Cache Check

```bash
docker exec -it delta_redis redis-cli keys "*"
```

---

## Known Issues & TODOs

### Port Inconsistency
- k6 scripts hardcode `7333`, some docs use `3000`
- Need to align with `PORT` environment variable

### Infrastructure
- `prometheus.yml` is empty - needs configuration
- No automated tests yet (beyond manual smoke tests)
- `tree_output.txt` is broken and can be deleted

### Code Structure
- `naive_implementation/` and `updated_implementation/` folders hold `.txt` files
- These should become real code or proper documentation
- Repository interfaces exist but could be expanded

### Planned Features
- Repository interfaces with full write-up (SOLID analysis)
- Patient-side booking history
- Select-doctor-only booking (system picks any free slot)
- Payment flow integration with external gateway

### Performance Gaps
- Consider implementing read replicas for scaling
- Explore connection pool scaling strategies
- Evaluate caching strategy for appointment slots (currently read-through only)
- Investigate pagination for large result sets

---

## Decision Log Summary

### 1. Concurrency: transaction vs. row lock
- **Problem:** Naive booking allowed multiple patients to claim same slot
- **Fix:** `FOR UPDATE` inside `BEGIN...COMMIT` block
- **Result:** Only one patient can book per slot

### 2. Idempotency keys
- **Problem:** Retries after dropped responses cause 409 conflicts
- **Fix:** Store keys in DB with processing/completed/failed status
- **Result:** Duplicate requests return saved response

### 3. Indexes
- **Problem:** Sequential scans on 48K row table (14.410 ms)
- **Fix:** Composite indexes on `doctor_schedules(branch_id, doctor_id, for_date)` and `appointment_slots(schedule_id, status, start_time)`
- **Result:** Index scans, 0.300 ms (~48x faster)

### 4. Connection pooling
- **Problem:** Pool size affects throughput and conflict rate
- **Fix:** Pool size 15 optimal for this hardware
- **Result:** Good throughput with acceptable conflict rate

### 5. Caching
- **Problem:** Repeated DB queries for branch/doctor data
- **Fix:** Redis cache with 60s TTL for branches and per-branch doctors
- **Result:** Dramatic query reduction on read-heavy data

### 6. N+1 queries (admin endpoints)
- **Problem:** 82 queries for branch bookings, 21 for doctor list
- **Fix:** Single JOIN queries replacing N+1 patterns
- **Result:** 90-93% query reduction, 6-33ms vs 462-63ms

### 7. Payment flow (in progress)
- **Status:** Mock gateway with 85% random success
- **Goal:** Isolated payment service in separate repository

### 8. Planned
- Repository interfaces SOLID analysis
- Patient booking history
- Select-doctor booking flow