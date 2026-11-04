import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 15432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password123',
  database: process.env.DB_NAME || 'delta_diagnostic',
});

const BRANCHES = [
  { name: 'Dhaka Central', district: 'Dhaka' },
  { name: 'Rajshahi Medical Hub', district: 'Rajshahi' },
  { name: 'Khulna Care', district: 'Khulna' },
  { name: 'Natore Diagnostic', district: 'Natore' },
  { name: 'Rangpur Health', district: 'Rangpur' },
  { name: 'Kurigram Clinic', district: 'Kurigram' },
  { name: 'Sylhet Eastern', district: 'Sylhet' },
  { name: 'Chittagong Port View', district: 'Chittagong' },
  { name: 'Borishal Riverview', district: 'Borishal' },
  { name: 'Mymensingh Northern', district: 'Mymensing' },
];

const SPECIALTIES = [
  'Cardiology',
  'Neurology',
  'Orthopedics',
  'Pediatrics',
  'Dermatology',
  'Medicine',
  'Gynecology',
  'Ophthalmology',
];

async function seed() {
  console.log('🌱 Starting high-volume database seeding (~48,000+ slots, 5,000 patients)...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Clean existing test data safely
    console.log('🧹 Cleaning old mock data...');
    await client.query(`
      TRUNCATE TABLE patient_tickets, booking_attempts, idempotency_keys,
                     appointment_slots, doctor_schedules, doctor_branch_assignments,
                     patients, doctors, branches RESTART IDENTITY CASCADE;
    `);

    // 1. Seed Branches
    const branchIds: number[] = [];
    for (const b of BRANCHES) {
      const res = await client.query(
        `INSERT INTO branches (branch_name, district) VALUES ($1, $2) RETURNING id`,
        [b.name, b.district]
      );
      branchIds.push(res.rows[0].id);
    }
    console.log(`✓ Seeded ${branchIds.length} branches.`);

    // 2. Seed 200 Doctors
    const doctorCount = 200;
    const doctorIds: number[] = [];
    for (let i = 1; i <= doctorCount; i++) {
      const name = `Dr. Specialist ${i}`;
      const specialty = SPECIALTIES[i % SPECIALTIES.length];
      const res = await client.query(
        `INSERT INTO doctors (full_name, specialty) VALUES ($1, $2) RETURNING id`,
        [name, specialty]
      );
      doctorIds.push(res.rows[0].id);
    }
    console.log(`✓ Seeded ${doctorIds.length} doctors.`);

    // 3. Assign Doctors to Branches
    for (let i = 0; i < doctorIds.length; i++) {
      const docId = doctorIds[i];
      const branchId = branchIds[i % branchIds.length];
      await client.query(
        `INSERT INTO doctor_branch_assignments (doctor_id, branch_id) VALUES ($1, $2)`,
        [docId, branchId]
      );
    }
    console.log(`✓ Assigned doctors across branches.`);

    // 4. Seed 5,000 Persistent Patients
    const patientCount = 5000;
    console.log(`⏳ Seeding ${patientCount} patients (this may take a moment)...`);

    // Batch insert patients for performance
    const patientBatchSize = 500;
    for (let i = 0; i < patientCount; i += patientBatchSize) {
      const values: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      for (let j = 1; j <= patientBatchSize && (i + j) <= patientCount; j++) {
        const pNum = i + j;
        const phone = `+88017${String(pNum).padStart(7, '0')}`;
        const name = `Patient ${pNum}`;
        values.push(`($${paramIndex}, $${paramIndex + 1})`);
        params.push(name, phone);
        paramIndex += 2;
      }

      await client.query(
        `INSERT INTO patients (full_name, phone) VALUES ${values.join(', ')} ON CONFLICT (phone) DO NOTHING`,
        params
      );
    }
    console.log(`✓ Seeded ${patientCount} persistent patients.`);

    // 5. Seed Schedules and Slots (10 Days: today + next 9 days)
    const daysToSeed = 10;
    const dates: string[] = [];
    const today = new Date();
    for (let d = 0; d < daysToSeed; d++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + d);
      dates.push(targetDate.toISOString().split('T')[0]);
    }

    let totalSlots = 0;
    console.log(`⏳ Generating schedules and appointment slots across ${daysToSeed} days...`);

    for (const docId of doctorIds) {
      const assignRes = await client.query('SELECT branch_id FROM doctor_branch_assignments WHERE doctor_id = $1', [docId]);
      const branchId = assignRes.rows[0].branch_id;

      for (const dDate of dates) {
        const schedRes = await client.query(
          `INSERT INTO doctor_schedules (doctor_id, branch_id, for_date, start_time, end_time, slot_duration_minutes)
           VALUES ($1, $2, $3, '18:00:00', '22:00:00', 10) RETURNING id`,
          [docId, branchId, dDate]
        );
        const scheduleId = schedRes.rows[0].id;

        // Generate 24 slots per schedule (18:00 to 22:00 at 10-min intervals)
        let currentMinutes = 18 * 60;
        const endMinutes = 22 * 60;

        while (currentMinutes < endMinutes) {
          const startH = Math.floor(currentMinutes / 60).toString().padStart(2, '0');
          const startM = (currentMinutes % 60).toString().padStart(2, '0');
          const startTime = `${startH}:${startM}:00`;

          currentMinutes += 10;
          const endH = Math.floor(currentMinutes / 60).toString().padStart(2, '0');
          const endM = (currentMinutes % 60).toString().padStart(2, '0');
          const endTime = `${endH}:${endM}:00`;

          await client.query(
            `INSERT INTO appointment_slots (schedule_id, start_time, end_time, status) VALUES ($1, $2, $3, 'available')`,
            [scheduleId, startTime, endTime]
          );
          totalSlots++;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`🎉 High-volume seeding completed successfully! Total Appointment Slots Generated: ${totalSlots}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ High-volume seeding failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
