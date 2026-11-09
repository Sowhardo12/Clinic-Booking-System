import { Module } from '@nestjs/common';
import { MockPaymentGateway } from './mock-payment.service';
import { PAYMENT_GATEWAY } from './interface/payment-gateway.interface';


@Module({
  providers: [MockPaymentGateway,
    {
      provide: PAYMENT_GATEWAY,
      useClass:MockPaymentGateway
    }],
})
export class PaymentModule {}
