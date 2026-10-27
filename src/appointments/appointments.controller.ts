import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { BookAppointmentDto } from './dto/book-appointment.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private appointmentsService: AppointmentsService) {}

  @Post('book')
  @HttpCode(HttpStatus.CREATED)
  async bookAppointment(@Body() dto: BookAppointmentDto) {
    return this.appointmentsService.bookAppointment(dto.slotId, dto.patientId, dto.testRunId);
  }
}