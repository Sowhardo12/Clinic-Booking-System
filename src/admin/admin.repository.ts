import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AdminRepository {
  constructor(private db: DatabaseService) {}

  // Step 1 of N+1: Get just the doctor IDs assigned to a branch
  async getDoctorIdsByBranch(branchId: number) {
    const res = await this.db.query(
      'SELECT doctor_id FROM doctor_branch_assignments WHERE branch_id = $1',
      [branchId]
    );
    return res.rows.map((row) => row.doctor_id);
  }

  // Step 2 of N+1: Query individual doctor details in a loop
  async getDoctorById(doctorId: number) {
    const res = await this.db.query(
      'SELECT * FROM doctors WHERE id = $1',
      [doctorId]
    );
    return res.rows[0];
  }

  // Optimized version: Single relational JOIN query
  async getDoctorsOptimized(branchId: number) {
    const res = await this.db.query(
      `SELECT d.id, d.full_name, d.specialty, d.is_active
       FROM doctors d
       JOIN doctor_branch_assignments dba ON d.id = dba.doctor_id
       WHERE dba.branch_id = $1`,
      [branchId]
    );
    return res.rows;
  }
  // --- N+1 Version ---
    // Step 1: Get all slot IDs booked for a specific branch and date
    async getBookedSlotIdsByBranchAndDate(branchId: number, date: string) {
      const res = await this.db.query(
        `SELECT s.id AS slot_id
         FROM appointment_slots s
         JOIN doctor_schedules ds ON s.schedule_id = ds.id
         WHERE ds.branch_id = $1 AND ds.for_date = $2 AND s.status = 'booked'`,
        [branchId, date]
      );
      return res.rows.map((row) => row.slot_id);
    }

    // Step 2: Loop query to fetch ticket and patient info per slot ID
    async getBookingDetailsBySlotId(slotId: number) {
      const res = await this.db.query(
        `SELECT pt.id AS ticket_id, pt.issued_at, p.id AS patient_id, p.full_name, p.phone, s.start_time, s.end_time, d.full_name AS doctor_name
         FROM patient_tickets pt
         JOIN patients p ON pt.patient_id = p.id
         JOIN appointment_slots s ON pt.slot_id = s.id
         JOIN doctor_schedules ds ON s.schedule_id = ds.id
         JOIN doctors d ON ds.doctor_id = d.id
         WHERE pt.slot_id = $1`,
        [slotId]
      );
      return res.rows[0];
    }

    // --- Optimized Version ---
    // Single query using relational JOINs across branches, schedules, slots, tickets, and patients
    async getBookingsOptimized(branchId: number, date: string) {
      const res = await this.db.query(
        `SELECT pt.id AS ticket_id, pt.issued_at, p.id AS patient_id, p.full_name, p.phone, s.start_time, s.end_time, d.full_name AS doctor_name
         FROM patient_tickets pt
         JOIN patients p ON pt.patient_id = p.id
         JOIN appointment_slots s ON pt.slot_id = s.id
         JOIN doctor_schedules ds ON s.schedule_id = ds.id
         JOIN doctors d ON ds.doctor_id = d.id
         WHERE ds.branch_id = $1 AND ds.for_date = $2
         ORDER BY s.start_time ASC`,
        [branchId, date]
      );
      return res.rows;
    }
}
