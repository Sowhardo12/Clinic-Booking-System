import { Injectable } from '@nestjs/common';
import { IPaymentResult, IPaymentGateway } from './interface/payment-gateway.interface';
import * as crypto from 'crypto';

@Injectable()
export class MockPaymentGateway implements IPaymentGateway {
  async processPayment(amount: number, patientId: number, slotId: number): Promise<IPaymentResult> {

    await new Promise((resolve) => setTimeout(resolve, 500));


    const isSuccess = Math.random() < 0.85;
    const transactionId = `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    if (!isSuccess) {
      return {
        success: false,
        transactionId,
        errorMessage: 'Payment declined by gateway simulation.',
      };
    }

    return {
      success: true,
      transactionId,
    };
  }
}
