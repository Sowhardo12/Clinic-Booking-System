import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentsRepository } from './appointments.repository';
import { APPOINTMENTS_REPOSITORY } from './interfaces/appointment.repository.interface';

@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService,
    {
      provide: APPOINTMENTS_REPOSITORY,
      useClass:AppointmentsRepository
    }],
})
export class AppointmentsModule {}
