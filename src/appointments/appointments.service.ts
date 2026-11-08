import { Injectable, Inject, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { AppointmentsRepository } from './appointments.repository';
import { APPOINTMENTS_REPOSITORY } from './interfaces/appointment.repository.interface';
import { IAppointmentsRepository } from './interfaces/appointment.repository.interface';
import * as crypto from 'crypto';

@Injectable()
export class AppointmentsService {
  constructor( @Inject(APPOINTMENTS_REPOSITORY) private readonly appointmentsRepo: IAppointmentsRepository) {}
  // constructor(private appointmentsRepo: AppointmentsRepository) {}

  async bookAppointment(slotId: number, patientId: number, testRunId?: string, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.appointmentsRepo.findIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.status === 'completed') return existing.response_body;
        if (existing.status === 'processing') throw new ConflictException('Request currently processing.');
      }
    }

    const client = await this.appointmentsRepo.getClient();

    try {
      await client.query('BEGIN');

      if (idempotencyKey) {
        const existingInTx = await this.appointmentsRepo.findIdempotencyKey(idempotencyKey, client);
        if (existingInTx?.status === 'completed') {
          await client.query('COMMIT');
          return existingInTx.response_body;
        }
        await this.appointmentsRepo.createIdempotencyKeyPending(idempotencyKey, patientId, client);
      }

      // 1. Check and clean expired reservations, lock row
      const slot = await this.appointmentsRepo.findAndCleanExpiredSlot(client, slotId);
      if (!slot) {
        await client.query('COMMIT');
        throw new NotFoundException('Appointment slot not found.');
      }

      const existing_booking = await this.appointmentsRepo.findActiveBookingByPatientAndSlot(client, slotId, patientId)
      if (existing_booking) {
        await client.query('COMMIT');
        throw new BadRequestException('You have already booked this slot');
      }

      if (slot.status !== 'available') {
        await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'failed_unavailable', client);
        await client.query('COMMIT');
        throw new ConflictException('Slot is currently booked or reserved by another patient.');
      }

      // 2. Temporarily reserve the slot for 2 minutes
      const reservedSlot = await this.appointmentsRepo.reserveSlot(client, slotId, patientId, 2);
      if (!reservedSlot) {
        await client.query('COMMIT');
        throw new ConflictException('Failed to secure temporary hold on slot.');
      }

      // 3. Simulate Payment Gateway Processing (e.g., 85% success probability)
      const isPaymentSuccessful = Math.random() < 0.85;
      const transactionId = `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      if (!isPaymentSuccessful) {
        // Payment Failed: Record failure, release slot immediately back to available
        await this.appointmentsRepo.recordPayment(client, slotId, patientId, 'failed', transactionId);
        await this.appointmentsRepo.releaseSlot(client, slotId, patientId);
        await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'failed_payment', client);

        await client.query('COMMIT');
        throw new BadRequestException({
          message: 'Payment failed. Slot has been released back to available.',
          transactionId,
        });
      }

      // 4. Payment Success: Record payment, issue permanent ticket, mark slot as booked
      await this.appointmentsRepo.recordPayment(client, slotId, patientId, 'success', transactionId);
      const ticket = await this.appointmentsRepo.issueTicket(slotId, patientId, testRunId, client);
      const bookedSlot = await this.appointmentsRepo.confirmBooking(client, slotId, patientId);
      await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'success', client);

      const responsePayload = {
        message: 'Appointment booked and payment successful!',
        transactionId,
        slot: bookedSlot,
        ticket,
      };

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
