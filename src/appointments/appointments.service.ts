import { Injectable, ConflictException, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { AppointmentsRepository } from './appointments.repository';
import { IPaymentGateway } from 'src/payments/interface/payment-gateway.interface';
import { PAYMENT_GATEWAY } from 'src/payments/interface/payment-gateway.interface';
import { MetricsService } from '../observability/metrics.service';
import { APPOINTMENTS_REPOSITORY } from './interfaces/appointment.repository.interface';

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(APPOINTMENTS_REPOSITORY) private readonly appointmentsRepo: AppointmentsRepository,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: IPaymentGateway,
    private metricsService: MetricsService,
  ) {}

  async bookAppointment(slotId: number, patientId: number, testRunId?: string, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.appointmentsRepo.findIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.status === 'completed') return existing.response_body;
        if (existing.status === 'processing') throw new ConflictException('Request currently processing.');
      }
    }

    // --- PHASE 1: Fast Transaction to Secure Temporary Hold (Connection Released Immediately) ---
    const client = await this.appointmentsRepo.getClient();
    let reservedSlot:any;
    try {
      await client.query('BEGIN');

      const slot = await this.appointmentsRepo.findAndCleanExpiredSlot(client, slotId);
      if (!slot) {
        await client.query('COMMIT');
        throw new NotFoundException('Appointment slot not found.');
      }

      const existingBooking = await this.appointmentsRepo.findActiveBookingByPatientAndSlot(client, slotId, patientId);
      if (existingBooking) {
        await client.query('COMMIT');
        throw new BadRequestException('You have already booked this slot.');
      }

      if (slot.status !== 'available') {
        await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'failed_unavailable', client);
        await client.query('COMMIT');
        throw new ConflictException('Slot is currently booked or reserved by another patient.');
      }

      // Reserve slot for 2 minutes
      reservedSlot = await this.appointmentsRepo.reserveSlot(client, slotId, patientId, 2);
      if (!reservedSlot) {
        throw new ConflictException('Failed to reserve appointment slot.');
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release(); // DB Connection returned immediately to pool!
    }

    // --- PHASE 2: External Payment Gateway Call (No DB Connection Held) ---
    const consultationFee = 500.00;
    const paymentResult = await this.paymentGateway.processPayment(consultationFee, patientId, slotId);

    // --- PHASE 3: Finalize Booking State in a New Short Transaction ---
    const finalClient = await this.appointmentsRepo.getClient();
    try {
      await finalClient.query('BEGIN');

      if (!paymentResult.success) {
        // Payment Failed: Revert slot status back to 'available'
        await this.appointmentsRepo.recordPayment(finalClient, slotId, patientId, 'failed', paymentResult.transactionId);
        await this.appointmentsRepo.releaseSlot(finalClient, slotId, patientId);
        this.metricsService.bookingAttemptsTotal.inc({ status: 'failed_payment' });

        await finalClient.query('COMMIT');
        throw new BadRequestException({
          message: 'Payment failed. Slot has been released back to available.',
          transactionId: paymentResult.transactionId,
          error: paymentResult.errorMessage,
        });
      }

      // Payment Success: Confirm booking and issue ticket

      const bookedSlot = await this.appointmentsRepo.confirmBooking(finalClient, slotId, patientId);
      if (!bookedSlot) {
        throw new ConflictException('Failed to finally book appointment slot. already booked by someone else');
        //refund payment option here
      }
      await this.appointmentsRepo.recordPayment(finalClient, slotId, patientId, 'success', paymentResult.transactionId);
      const ticket = await this.appointmentsRepo.issueTicket(slotId, patientId, testRunId, finalClient);
      this.metricsService.bookingAttemptsTotal.inc({ status: 'success' });

      const responsePayload = {
        message: 'Appointment booked and payment successful!',
        transactionId: paymentResult.transactionId,
        slot: bookedSlot,
        ticket,
      };

      if (idempotencyKey) {
        await this.appointmentsRepo.completeIdempotencyKey(idempotencyKey, 201, responsePayload, finalClient);
      }

      await finalClient.query('COMMIT');
      return responsePayload;
    } catch (err) {
      await finalClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      finalClient.release();
    }
  }
}
