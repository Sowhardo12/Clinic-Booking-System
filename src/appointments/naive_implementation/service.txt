import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AppointmentsRepository } from './appointments.repository';

@Injectable()
export class AppointmentsService {
  constructor(private appointmentsRepo: AppointmentsRepository) {}

  async bookAppointment(slotId: number, patientId: number, testRunId?: string) {
    // 1. Check if slot exists and is available (Naive check)
    const slot = await this.appointmentsRepo.findSlotById(slotId);
    if (!slot) {
      throw new NotFoundException('Appointment slot not found.');
    }

    if (slot.status !== 'available') {
      await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'failed_unavailable');
      throw new ConflictException('Slot is already booked or blocked.');
    }

    const ticket = await this.appointmentsRepo.issueTicket(slotId, patientId, testRunId);

    // 2. Log successful attempt (even in naive flow)
    await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'success');

    // 3 MAIN SLOT UPDATE
    const updatedSlot = await this.appointmentsRepo.bookSlotNaive(slotId, patientId);

    return {
      message: 'Appointment booked successfully (Naive Baseline)',
      slot: updatedSlot,
      ticket:ticket,

    };
  }
}