import { Inject, Injectable, Logger } from '@nestjs/common';
import { AdminRepository } from './admin.repository';
import type { IAdminRepository } from './interfaces/admin.repository.interface';
import { ADMIN_REPOSITORY } from './interfaces/admin.repository.interface';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(@Inject(ADMIN_REPOSITORY) private readonly adminRepo: IAdminRepository) {}
  async getBranchDoctorsNPlusOne(branchId: number) {
    const startTime = Date.now();
    const doctorIds = await this.adminRepo.getDoctorIdsByBranch(branchId);
    const doctors = [];
    let queryCount = 1;
    for (const docId of doctorIds) {
      const doc = await this.adminRepo.getDoctorById(docId);
      if (doc) {
        doctors.push(doc);
        queryCount++;
      }
    }

    const duration = Date.now() - startTime;
    this.logger.warn(`[N+1 ANTI-PATTERN] Executed ${queryCount} database queries in ${duration}ms for branch ID ${branchId}`);

    return {
      pattern: 'N+1 Query Anti-Pattern',
      metrics: {
        totalQueriesExecuted: queryCount,
        executionTimeMs: duration,
        doctorsFetched: doctors.length,
      },
      data: doctors,
    };
  }
  async getBranchDoctorsOptimized(branchId: number) {
    const startTime = Date.now();
    const doctors = await this.adminRepo.getDoctorsOptimized(branchId);
    const duration = Date.now() - startTime;
    this.logger.log(`[OPTIMIZED JOIN] Executed 1 database query in ${duration}ms for branch ID ${branchId}`);

    return {
      pattern: 'Optimized Relational JOIN',
      metrics: {
        totalQueriesExecuted: 1,
        executionTimeMs: duration,
        doctorsFetched: doctors.length,
      },
      data: doctors,
    };
  }
    async getBranchBookingsNPlusOne(branchId: number, date: string) {
      const startTime = Date.now();
      const slotIds = await this.adminRepo.getBookedSlotIdsByBranchAndDate(branchId, date);
      const bookings = [];
      let queryCount = 1;
      for (const slotId of slotIds) {
        const details = await this.adminRepo.getBookingDetailsBySlotId(slotId);
        if (details) {
          bookings.push(details);
          queryCount++;
        }
      }
      const duration = Date.now() - startTime;
      this.logger.warn(`[N+1 ANTI-PATTERN] Executed ${queryCount} queries in ${duration}ms for branch ${branchId} on ${date}`);
      return {
        pattern: 'N+1 Query Anti-Pattern (Branch Bookings)',
        metrics: {
          totalQueriesExecuted: queryCount,
          executionTimeMs: duration,
          bookingsFound: bookings.length,
        },
        data: bookings,
      };
    }
      async getBranchBookingsOptimized(branchId: number, date: string) {
      const startTime = Date.now();
      const bookings = await this.adminRepo.getBookingsOptimized(branchId, date);
      const duration = Date.now() - startTime;
      this.logger.log(`[OPTIMIZED JOIN] Executed 1 query in ${duration}ms for branch ${branchId} on ${date}`);
      return {
        pattern: 'Optimized Relational JOIN (Branch Bookings)',
        metrics: {
          totalQueriesExecuted: 1,
          executionTimeMs: duration,
          bookingsFound: bookings.length,
        },
        data: bookings,
      };
    }
}
