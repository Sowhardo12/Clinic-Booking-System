import { Body, Controller, Post, HttpCode,Headers, HttpStatus } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { BookAppointmentDto } from './dto/book-appointment.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private appointmentsService: AppointmentsService) {}

  @Post('book')
  @HttpCode(HttpStatus.CREATED)
  async bookAppointment(@Body() dto: BookAppointmentDto,@Headers('idempotency-key') idempotencyKey?: string,) {
    return this.appointmentsService.bookAppointment(dto.slotId, dto.patientId, dto.testRunId,idempotencyKey);
  }
}
