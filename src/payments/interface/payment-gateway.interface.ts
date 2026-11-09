export interface IPaymentResult {
  success: boolean;
  transactionId: string;
  errorMessage?: string;
}

export interface IPaymentGateway {
  processPayment(amount: number, patientId: number, slotId: number): Promise<IPaymentResult>;
}

export const PAYMENT_GATEWAY = Symbol('IPaymentGateway');
