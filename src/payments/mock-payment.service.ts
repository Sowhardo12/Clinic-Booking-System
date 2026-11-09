import { Injectable } from '@nestjs/common';
import { IPaymentResult, IPaymentGateway } from './interface/payment-gateway.interface';
import * as crypto from 'crypto';

@Injectable()
export class MockPaymentGateway implements IPaymentGateway {
  async processPayment(amount: number, patientId: number, slotId: number): Promise<IPaymentResult> {
    // Simulate real-world network latency (e.g., 500ms external API call)
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Simulate 85% success probability for realism
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
