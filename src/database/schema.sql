CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    branch_name VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS doctors (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    specialty VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS doctor_branch_assignments (
    id SERIAL PRIMARY KEY,
    doctor_id INT REFERENCES doctors(id) ON DELETE CASCADE,
    branch_id INT REFERENCES branches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctor_schedules (
    id SERIAL PRIMARY KEY,
    doctor_id INT REFERENCES doctors(id) ON DELETE CASCADE,
    branch_id INT REFERENCES branches(id) ON DELETE CASCADE,
    for_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INT DEFAULT 10,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointment_slots (
    id SERIAL PRIMARY KEY,
    schedule_id INT REFERENCES doctor_schedules(id) ON DELETE CASCADE,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status VARCHAR(50) DEFAULT 'available',
    patient_id INT REFERENCES patients(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_attempts (
    id SERIAL PRIMARY KEY,
    slot_id INT NOT NULL,
    patient_id INT NOT NULL,
    test_run_id VARCHAR(100),
    attempt_status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_tickets (
  id           SERIAL PRIMARY KEY,
  slot_id      INTEGER NOT NULL REFERENCES appointment_slots(id),
  patient_id   INTEGER NOT NULL REFERENCES patients(id),
  test_run_id  VARCHAR(100),
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id SERIAL PRIMARY KEY,
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    patient_id INT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'processing', -- 'processing', 'completed', 'failed'
    response_status INT,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_doctor_schedules_branch_doc_date
ON doctor_schedules (branch_id, doctor_id, for_date);

CREATE INDEX IF NOT EXISTS idx_appointment_slots_schedule_status_time
ON appointment_slots (schedule_id, status, start_time);



ALTER TABLE appointment_slots ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;


CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    slot_id INT NOT NULL REFERENCES appointment_slots(id) ON DELETE CASCADE,
    patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL DEFAULT 500.00,
    payment_status VARCHAR(50) NOT NULL,
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
