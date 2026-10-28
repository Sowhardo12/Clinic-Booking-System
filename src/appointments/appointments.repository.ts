import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PoolClient } from 'pg';

@Injectable()
export class AppointmentsRepository {
  constructor(private db: DatabaseService) {}

  getClient(): Promise<PoolClient> {
    return this.db.getClient();
  }

  // uses the transaction client if given, else the normal pool
  private run(sql: string, params: any[], client?: PoolClient) {
    return client ? client.query(sql, params) : this.db.query(sql, params);
  }
  //without locking
  async findSlotById(slotId: number, client?: PoolClient) {
    const r = await this.run('SELECT * FROM appointment_slots WHERE id = $1', [slotId], client);
    return r.rows[0];
  }
  //with locking : using FOR UPDATE
  async findSlotByIdForUpdate(client: PoolClient, slotId: number) {
    const r = await client.query('SELECT * FROM appointment_slots WHERE id = $1 FOR UPDATE', [slotId]);
    return r.rows[0];
  }

  async logBookingAttempt(slotId: number, patientId: number, testRunId: string | undefined, status: string, client?: PoolClient) {
    await this.run(
      `INSERT INTO booking_attempts (slot_id, patient_id, test_run_id, attempt_status) VALUES ($1, $2, $3, $4)`,
      [slotId, patientId, testRunId || null, status],
      client,
    );
  }

  async bookSlotNaive(slotId: number, patientId: number, client?: PoolClient) {
    const r = await this.run(
      `UPDATE appointment_slots SET status = 'booked', patient_id = $1 WHERE id = $2 RETURNING *`,
      [patientId, slotId],
      client,
    );
    return r.rows[0];
  }

  async issueTicket(slotId: number, patientId: number, testRunId?: string, client?: PoolClient) {
    const r = await this.run(
      `INSERT INTO patient_tickets (slot_id, patient_id, test_run_id) VALUES ($1, $2, $3) RETURNING *`,
      [slotId, patientId, testRunId || null],
      client,
    );
    return r.rows[0];
  }
}