# Delta Diagnostic API Documentation

## Project Overview

The Delta Diagnostic API is a NestJS-based clinic appointment booking backend designed as a naive baseline for identifying and fixing concurrency and performance problems. It supports patient appointment booking, branch/doctor lookups, and admin analytics.

**Base URL:** `http://localhost:{PORT}` (default 13000, configured via `PORT` environment variable)  
**Global Validation:** Whitelist and transform enabled via `ValidationPipe`

---

## Base URL & Global Behavior

- **Base URL:** `http://localhost:{PORT}` where PORT is read from the environment (default: 13000)
- **Request Validation:** All requests are validated via a global `ValidationPipe` with `whitelist: true` and `transform: true`
- **Global Middleware:** `RequestLoggerMiddleware` logs every request on all routes (`*`)
- **Response Envelope:** No standardized response envelope; endpoints return domain-specific shapes

---

## Authentication & Authorization

**No authentication is currently implemented** on any endpoint. All routes are publicly accessible.

- Rate limiting, API keys, or JWT protection are not configured
- Admin endpoints (`/admin/branches/*`) are equally unprotected and intended for internal/analysis use only

---

## Endpoints

### BranchesController

| Method | Endpoint | Purpose | Parameters |
|--------|----------|---------|------------|
| `GET` | `/branches` | List all branches (Redis cached, TTL 60s) | — |
| `GET` | `/branches/{branchId}/doctors` | Get doctors in a branch (Redis cached, TTL 60s) | `branchId` (int, path) |
| `GET` | `/branches/{branchId}/doctors/{doctorId}/slots` | Get available slots for a doctor on a date | `branchId` (int, path), `doctorId` (int, path), `date` (string, query, YYYY-MM-DD) |

**Parameters table for `/branches/{branchId}/doctors/{doctorId}/slots`:**

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `branchId` | Yes | `number` | Branch identifier (parsed via `ParseIntPipe`) |
| `doctorId` | Yes | `number` | Doctor identifier (parsed via `ParseIntPipe`) |
| `date` | Yes | `string` | Date in `YYYY-MM-DD` format |

---

### AppointmentsController

| Method | Endpoint | Purpose | Authentication | Request Body | Headers |
|--------|----------|---------|----------------|--------------|---------|
| `POST` | `/appointments/book` | Book an appointment slot | None (public) | `BookAppointmentDto` | `Idempotency-Key` (optional) |

**Request Body (`BookAppointmentDto`):**

| Field | Required | Type | Validation | Description |
|-------|----------|------|------------|-------------|
| `slotId` | Yes | `number` | `@IsInt()` `@IsNotEmpty()` | The appointment slot ID to book |
| `patientId` | Yes | `number` | `@IsInt()` `@IsNotEmpty()` | The patient identifier |
| `testRunId` | No | `string` | `@IsString()` `@IsOptional()` | Optional test/run identifier |

**Success Response (201 CREATED):**
```json
{
  "message": "Appointment booked and payment successful!",
  "transactionId": "TXN-ABC123",
  "slot": { ... },
  "ticket": { ... }
}
```

**Idempotency:**
- If `Idempotency-Key` header is provided and a matching key exists in the `idempotency_keys` table with status `completed`, the saved response is returned immediately without re-running the booking logic
- If the key exists with status `processing` or `failed`, the request proceeds normally
- If no key is provided, a new idempotency key is not automatically generated or stored

---

### AdminController

| Method | Endpoint | Purpose | Query Parameters |
|--------|----------|---------|------------------|
| `GET` | `/admin/branches/{branchId}/doctors-n-plus-one` | Doctors via N+1 query pattern | — |
| `GET` | `/admin/branches/{branchId}/doctors-optimized` | Doctors via single optimized JOIN | — |
| `GET` | `/admin/branches/{branchId}/bookings-n-plus-one` | Branch bookings via N+1 queries | `date` (string, query, YYYY-MM-DD) |
| `GET` | `/admin/branches/{branchId}/bookings-optimized` | Branch bookings via single optimized JOIN | `date` (string, query, YYYY-MM-DD) |

**Parameters for booking endpoints:**

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `branchId` | Yes | `number` | Branch identifier (parsed via `ParseIntPipe`) |
| `date` | Yes | `string` | Date in `YYYY-MM-DD` format for filtering bookings |

**N+1 vs Optimized Comparison ( documented behavior, not API guarantees ):**
- **Doctors (N+1):** 21 individual queries, ~63 ms
- **Doctors (Optimized):** 1 JOIN query, ~6 ms (~90% reduction)
- **Bookings (N+1):** 82 individual queries for date `2026-11-04`, ~462 ms
- **Bookings (Optimized):** 1 JOIN query for date `2026-11-04`, ~33 ms (~93% reduction)

The logger middleware reports `totalQueriesExecuted` and `executionTimeMs` for comparison.

---

## Documentation Notes / Discrepancies

1. **Port inconsistency:** k6 load test scripts hardcode port `7333`, while the API runtime uses the `PORT` environment variable (currently 13000). Documentation uses `{PORT}` to denote the configurable value.

2. **Empty prometheus.yml:** The `prometheus.yml` file is currently empty — Prometheus client library (`prom-client`) is installed and initialized in the observability module, but no metrics endpoints or scrape configurations are defined in the observed YAML file.

3. **Idempotency-Key behavior:** The `Idempotency-Key` header is documented as optional in the controller, but the exact header name casing and whether it must exactly match `Idempotency-Key` or is case-insensitive depends on NestJS `Headers()` decorator behavior, which was not explicitly tested in code inspection.

4. **No authentication:** All endpoints are publicly accessible. The skill rules instruct to note when authentication is absent or unconfirmed.

5. **Response shapes:** The `slot` and `ticket` objects in the book appointment response are documented as `{ ... }` because their exact field shapes were not introspected beyond the controller DTO. They likely correspond to the `appointment_slots`, `patient_tickets`, and `payments` entity fields.

6. **Admin endpoint N+1 labeling:** The N+1 vs optimized comparison relies on the `RequestLoggerMiddleware` telemetry. If the middleware is disabled or not capturing queries, the reported times/queries would not be available.

---

## Validation Performed

- ✅ All registered controllers inspected (`src/main.ts`, `src/app.module.ts`, `src/branches/branches.controller.ts`, `src/appointments/appointments.controller.ts`, `src/admin/admin.controller.ts`)
- ✅ DTO validation fields confirmed (`src/appointments/dto/book-appointment.dto.ts`)
- ✅ Route path parameters and query parameters verified against controller decorators
- ✅ Global pipes and middleware inspected
- ✅ `PORT` environment variable usage confirmed (not hardcoded)
- ✅ No authentication guards or strategies found in code inspection
- ✅ `docs/` directory created anew for this documentation

**Endpoints documented:** 7 total  
**Controllers covered:** BranchesController (3), AppointmentsController (1), AdminController (4 bodied comparison endpoints)  
**Undocumented/Unconfirmed:** Exact response field shapes for `slot` and `ticket` in book appointment response; idempotency key exact matching behavior; Prometheus metric configuration status

---

## Files Inspected

| File | Purpose |
|------|---------|
| `src/main.ts` | Bootstrap, global ValidationPipe, PORT env var |
| `src/app.module.ts` | Root module, ConfigModule, all feature modules, global RequestLoggerMiddleware |
| `src/branches/branches.controller.ts` | 3 public endpoints: branches list, doctors by branch, slots by doctor/date |
| `src/appointments/appointments.controller.ts` | 1 POST endpoint: book appointment with idempotency key |
| `src/admin/admin.controller.ts` | 4 admin endpoints: N+1 vs optimized doctor and booking queries |
| `src/appointments/dto/book-appointment.dto.ts` | DTO with slotId, patientId, testRunId fields and class-validator constraints |

**No other source files were modified** — this skill is documentation-only per its operating rules.