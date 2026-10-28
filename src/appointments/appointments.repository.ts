import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AppointmentsRepository {
  constructor(private db: DatabaseService) {}

  async findSlotById(slotId: number) {
    const result = await this.db.query('SELECT * FROM appointment_slots WHERE id = $1', [slotId]);
    return result.rows[0];
  }

  async logBookingAttempt(slotId: number, patientId: number, testRunId: string, status: string) {
    await this.db.query(
      `INSERT INTO booking_attempts (slot_id, patient_id, test_run_id, attempt_status) VALUES ($1, $2, $3, $4)`,
      [slotId, patientId, testRunId || null, status]
    );
  }

  async bookSlotNaive(slotId: number, patientId: number) {
    
    const query = `
      UPDATE appointment_slots 
      SET status = 'booked', patient_id = $1 
      WHERE id = $2 
      RETURNING *;
    `;
    const result = await this.db.query(query, [patientId, slotId]);
    return result.rows[0];
  }
  async issueTicket(slotId: number, patientId: number, testRunId?: string) {
  const result = await this.db.query(
    `INSERT INTO patient_tickets (slot_id, patient_id, test_run_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [slotId, patientId, testRunId || null]
  );
  return result.rows[0];
}
}