import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { AppointmentsRepository } from './appointments.repository';

@Injectable()
export class AppointmentsService {
  constructor(private appointmentsRepo: AppointmentsRepository) {}

  async bookAppointment(slotId: number, patientId: number, testRunId?: string, idempotencyKey?: string) {
    // 1. If an idempotency key is provided, check its existing status first
    if (idempotencyKey) {
      const existing = await this.appointmentsRepo.findIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.status === 'completed') {
          // Return cached response instantly
          return existing.response_body;
        }
        if (existing.status === 'processing') {
          throw new ConflictException('A request with this idempotency key is currently being processed.');
        }
      }
    }

    const client = await this.appointmentsRepo.getClient();

    try {
      await client.query('BEGIN');

      // Register idempotency key as 'processing' if provided
      if (idempotencyKey) {
        const existingInTx = await this.appointmentsRepo.findIdempotencyKey(idempotencyKey, client);
        if (existingInTx) {
          if (existingInTx.status === 'completed') {
            await client.query('COMMIT');
            return existingInTx.response_body;
          }
          throw new ConflictException('Concurrent request with same idempotency key.');
        } else {
          await this.appointmentsRepo.createIdempotencyKeyPending(idempotencyKey, patientId, client);
        }
      }

      // 2. Lock slot row with FOR UPDATE
      const slot = await this.appointmentsRepo.findSlotByIdForUpdate(client, slotId);
      if (!slot) {
        await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'failed_unavailable', client);
        await client.query('COMMIT');
        throw new NotFoundException('Appointment slot not found.');
      }

      if (slot.status !== 'available') {
        await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'failed_unavailable', client);
        await client.query('COMMIT');
        throw new ConflictException('Slot is already booked or blocked.');
      }

      // 3. Issue ticket and update slot
      const ticket = await this.appointmentsRepo.issueTicket(slotId, patientId, testRunId, client);
      const updatedSlot = await this.appointmentsRepo.bookSlotNaive(slotId, patientId, client);
      await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'success', client);

      const responsePayload = {
        message: 'Booked successfully (Idempotent + Transactional + Row Locked)',
        slot: updatedSlot,
        ticket,
      };

      // 4. Complete idempotency record
      if (idempotencyKey) {
        await this.appointmentsRepo.completeIdempotencyKey(idempotencyKey, 201, responsePayload, client);
      }

      await client.query('COMMIT');
      return responsePayload;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (idempotencyKey) {
        await this.appointmentsRepo.failIdempotencyKey(idempotencyKey).catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
