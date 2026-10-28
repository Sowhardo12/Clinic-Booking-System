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
  { name: 'Dhaka', district: 'Dhaka' },
  { name: 'Rajshahi', district: 'Rajshahi' },
  { name: 'Khulna', district: 'Khulna' },
  { name: 'Natore', district: 'Natore' },
  { name: 'Rangpur', district: 'Rangpur' },
  { name: 'Kurigram', district: 'Kurigram' },
  { name: 'Sylhet', district: 'Sylhet' },
  { name: 'Chittagong', district: 'Chittagong' },
  { name: 'Borishal', district: 'Borishal' },
  { name: 'Maymensing', district: 'Maymensing' },
];

async function seed() {
  console.log('Starting database seeding...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');


    const branchIds: number[] = [];
    for (const b of BRANCHES) {
      const res = await client.query(
        `INSERT INTO branches (branch_name, district) 
         VALUES ($1, $2) 
         ON CONFLICT DO NOTHING 
         RETURNING id`,
        [b.name, b.district]
      );
      if (res.rows.length > 0) {
        branchIds.push(res.rows[0].id);
      } else {
        const existing = await client.query('SELECT id FROM branches WHERE branch_name = $1', [b.name]);
        branchIds.push(existing.rows[0].id);
      }
    }
    console.log(`✓ Seeded ${branchIds.length} branches.`);

  
    const doctorIds: number[] = [];
    for (let i = 1; i <= 50; i++) {
      const name = `Dr. Doctor ${i}`;
      const specialty = i % 2 === 0 ? 'Cardiology' : 'Medicine';
      const res = await client.query(
        `INSERT INTO doctors (full_name, specialty) VALUES ($1, $2) RETURNING id`,
        [name, specialty]
      );
      doctorIds.push(res.rows[0].id);
    }
    console.log(`✓ Seeded ${doctorIds.length} doctors.`);


    for (let i = 0; i < doctorIds.length; i++) {
      const docId = doctorIds[i];
      const branchId = branchIds[i % branchIds.length];
      await client.query(
        `INSERT INTO doctor_branch_assignments (doctor_id, branch_id) VALUES ($1, $2)`,
        [docId, branchId]
      );
    }
    console.log(`✓ Assigned doctors to branches.`);


    const patientCount = 1000;
    for (let i = 1; i <= patientCount; i++) {
      const phone = `+8801700${String(i).padStart(5, '0')}`;
      await client.query(
        `INSERT INTO patients (full_name, phone) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING`,
        [`Patient ${i}`, phone]
      );
    }
    console.log(`✓ Seeded ${patientCount} persistent patients.`);


    const dates = [
      new Date().toISOString().split('T')[0],
      new Date(Date.now() + 86400000).toISOString().split('T')[0],
    ];

    let totalSlots = 0;
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
    console.log(`✓ Generated ${totalSlots} appointment slots.`);

    await client.query('COMMIT');
    console.log(' Seeding completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();