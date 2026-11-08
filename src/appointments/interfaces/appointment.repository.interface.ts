import { PoolClient } from 'pg';

export interface IAppointmentsRepository {
  getClient(): Promise<PoolClient>;

  findSlotById(slotId: number, client?: PoolClient): Promise<any>;

  findSlotByIdForUpdate(client: PoolClient, slotId: number): Promise<any>;

  logBookingAttempt(
    slotId: number,
    patientId: number,
    testRunId: string | undefined,
    status: string,
    client?: PoolClient,
  ): Promise<void>;

  bookSlotNaive(slotId: number, patientId: number, client?: PoolClient): Promise<any>;

  issueTicket(
    slotId: number,
    patientId: number,
    testRunId?: string,
    client?: PoolClient,
  ): Promise<any>;

  findIdempotencyKey(key: string, client?: PoolClient): Promise<any>;

  createIdempotencyKeyPending(
    key: string,
    patientId: number,
    client?: PoolClient,
  ): Promise<any>;

  completeIdempotencyKey(
    key: string,
    responseStatus: number,
    responseBody: any,
    client?: PoolClient,
  ): Promise<void>;

  failIdempotencyKey(key: string, client?: PoolClient): Promise<void>;

  findAndCleanExpiredSlot(client: PoolClient, slotId: number): Promise<any>;

  reserveSlot(
    client: PoolClient,
    slotId: number,
    patientId: number,
    holdMinutes?: number,
  ): Promise<any>;

  confirmBooking(client: PoolClient, slotId: number, patientId: number): Promise<any>;

  releaseSlot(client: PoolClient, slotId: number, patientId: number): Promise<void>;

  recordPayment(
    client: PoolClient,
    slotId: number,
    patientId: number,
    status: string,
    txnId: string,
  ): Promise<any>;

  findActiveBookingByPatientAndSlot(
    client: PoolClient,
    slotId: number,
    patientId: number,
  ): Promise<any>;
}

export const APPOINTMENTS_REPOSITORY = Symbol('IAppointmentsRepository');
