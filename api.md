# API Endpoints

## 1. `POST /appointments/book`

**Request Body** (`BookAppointmentDto`):
- `slotId` (required, integer) - The appointment slot ID to book
- `patientId` (required, integer) - The patient ID making the booking
- `testRunId` (optional, string) - Optional test run identifier

**Headers** (optional):
- `idempotency-key` (string) - For idempotent request deduplication

**Response** (HTTP 201 Created):
```json
{
  "message": "Booked successfully (Idempotent + Transactional + Row Locked)",
  "slot": { /* updated appointment slot object */ },
  "ticket": { /* issued patient ticket object */ }
}
```

---

## 2. `GET /branches`

**Request**: None

**Response**: Array of active branch objects (ordered by `id ASC`):
- Fields: `id`, `name`, `address`, `is_active`

---

## 3. `GET /branches/{branchId}/doctors`

**Path Parameter**:
- `branchId` (required, integer) - Branch identifier

**Response**: Array of doctor objects:
- Fields: `id` (integer), `full_name` (string), `specialty` (string)

---

## 4. `GET /branches/{branchId}/doctors/{doctorId}/slots`

**Path Parameters** (both required, integer):
- `branchId` - Branch identifier
- `doctorId` - Doctor identifier

**Query Parameter** (optional, string):
- `date` - Format: YYYY-MM-DD to filter slots by date

**Response**: Array of available slot objects:
- Fields: `id` (integer), `start_time` (string/time), `end_time` (string/time), `status` (string), `for_date` (date)