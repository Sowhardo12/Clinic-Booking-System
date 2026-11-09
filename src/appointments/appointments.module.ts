import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentsRepository } from './appointments.repository';
import { APPOINTMENTS_REPOSITORY } from './interfaces/appointment.repository.interface';
import { MetricsService } from 'src/observability/metrics.service';
import { PAYMENT_GATEWAY } from 'src/payments/interface/payment-gateway.interface';
import { MockPaymentGateway } from 'src/payments/mock-payment.service';
import { PaymentModule } from 'src/payments/payment.module';
@Module({
  imports: [PaymentModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService,MetricsService,
    {
      provide: APPOINTMENTS_REPOSITORY,
      useClass:AppointmentsRepository
    },
    {
      provide: PAYMENT_GATEWAY,
      useClass:MockPaymentGateway
    },
  ],
})
export class AppointmentsModule {}
