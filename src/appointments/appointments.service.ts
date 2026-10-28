import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AppointmentsRepository } from './appointments.repository';

@Injectable()
export class AppointmentsService {
  constructor(private appointmentsRepo: AppointmentsRepository) {}

  async bookAppointment(slotId: number, patientId: number, testRunId?: string) {
  const client = await this.appointmentsRepo.getClient();
  try {
    await client.query('BEGIN');
    //just TRANSACTION
    // const slot = await this.appointmentsRepo.findSlotById(slotId, client);
    //TRANSACTION+ROW LOCKINGS
    const slot = await this.appointmentsRepo.findSlotByIdForUpdate(client, slotId);
    if (!slot) throw new NotFoundException('Appointment slot not found.');

    if (slot.status !== 'available') {
      await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'failed_unavailable', client);
      await client.query('COMMIT');
      throw new ConflictException('Slot is already booked or blocked.');
    }

    const ticket = await this.appointmentsRepo.issueTicket(slotId, patientId, testRunId, client);
    const updatedSlot = await this.appointmentsRepo.bookSlotNaive(slotId, patientId, client);
    await this.appointmentsRepo.logBookingAttempt(slotId, patientId, testRunId, 'success', client);

    await client.query('COMMIT');
    return { message: 'Booked (Transaction)', slot: updatedSlot, ticket };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {}); // harmless if already committed
    throw err;
  } finally {
    client.release();
  }
}
}