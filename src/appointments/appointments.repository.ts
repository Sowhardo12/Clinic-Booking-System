import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PoolClient } from 'pg';

@Injectable()
export class AppointmentsRepository {
  constructor(private db: DatabaseService) {}

  getClient(): Promise<PoolClient> {
    return this.db.getClient();
  }


  private run(sql: string, params: any[], client?: PoolClient) {
    return client ? client.query(sql, params) : this.db.query(sql, params);
  }

  async findSlotById(slotId: number, client?: PoolClient) {
    const r = await this.run('SELECT * FROM appointment_slots WHERE id = $1', [slotId], client);
    return r.rows[0];
  }

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
  async findIdempotencyKey(key: string, client?: PoolClient) {
      const r = await this.run('SELECT * FROM idempotency_keys WHERE idempotency_key = $1', [key], client);
      return r.rows[0];
    }

    async createIdempotencyKeyPending(key: string, patientId: number, client?: PoolClient) {
      const r = await this.run(
        `INSERT INTO idempotency_keys (idempotency_key, patient_id, status) VALUES ($1, $2, 'processing') RETURNING *`,
        [key, patientId],
        client,
      );
      return r.rows[0];
    }

    async completeIdempotencyKey(key: string, responseStatus: number, responseBody: any, client?: PoolClient) {
      await this.run(
        `UPDATE idempotency_keys SET status = 'completed', response_status = $1, response_body = $2 WHERE idempotency_key = $3`,
        [responseStatus, JSON.stringify(responseBody), key],
        client,
      );
    }

    async failIdempotencyKey(key: string, client?: PoolClient) {
      await this.run(
        `UPDATE idempotency_keys SET status = 'failed' WHERE idempotency_key = $1`,
        [key],
        client,
      );
  }

    async findAndCleanExpiredSlot(client: PoolClient, slotId: number) {
      const r = await client.query(
        `SELECT * FROM appointment_slots WHERE id = $1 FOR UPDATE`,
        [slotId]
      );
      const slot = r.rows[0];


      if (slot && slot.status === 'reserved' && slot.reserved_until && new Date() > new Date(slot.reserved_until)) {
        await client.query(
          `UPDATE appointment_slots SET status = 'available', patient_id = NULL, reserved_until = NULL WHERE id = $1`,
          [slotId]
        );
        slot.status = 'available';
        slot.patient_id = null;
        slot.reserved_until = null;
      }
      return slot;
    }


    async reserveSlot(client: PoolClient, slotId: number, patientId: number, holdMinutes: number = 2) {
      const r = await client.query(
        `UPDATE appointment_slots
         SET status = 'reserved', patient_id = $1, reserved_until = NOW() + MAKE_INTERVAL(mins => $2)
         WHERE id = $3 AND (status = 'available' OR (status = 'reserved' AND reserved_until < NOW()))
         RETURNING *`,
        [patientId, holdMinutes, slotId]
      );
      return r.rows[0];
    }


    async confirmBooking(client: PoolClient, slotId: number, patientId: number) {
      const r = await client.query(
        `UPDATE appointment_slots
         SET status = 'booked', reserved_until = NULL
         WHERE id = $1 AND status = 'reserved'
           AND reserved_until > NOW() AND patient_id = $2
         RETURNING *`,
        [slotId, patientId]
      );
      return r.rows[0];
    }


    async releaseSlot(client: PoolClient, slotId: number, patientId: number) {
      await client.query(
        `UPDATE appointment_slots
         SET status = 'available', patient_id = NULL, reserved_until = NULL
         WHERE id = $1 AND patient_id = $2`,
        [slotId, patientId]
      );
    }


    async recordPayment(client: PoolClient, slotId: number, patientId: number, status: string, txnId: string) {
      const r = await client.query(
        `INSERT INTO payments (slot_id, patient_id, payment_status, transaction_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        [slotId, patientId, status, txnId]
      );
      return r.rows[0];
  }

    async findActiveBookingByPatientAndSlot(client: PoolClient, slotId: number, patientId: number) {
      const r = await client.query(
        `SELECT * FROM appointment_slots WHERE id = $1 AND patient_id = $2 AND status IN ('booked', 'reserved')`,
        [slotId, patientId]
      );
      return r.rows[0];
    }
}
