import { Inject, Injectable, Logger } from '@nestjs/common';
import { AdminRepository } from './admin.repository';
import type { IAdminRepository } from './interfaces/admin.repository.interface';
import { ADMIN_REPOSITORY } from './interfaces/admin.repository.interface';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(@Inject(ADMIN_REPOSITORY) private readonly adminRepo: IAdminRepository) {}
  // constructor(private adminRepo: AdminRepository) {}
  // N+1 Anti-Pattern Implementation
  async getBranchDoctorsNPlusOne(branchId: number) {
    const startTime = Date.now();

    // 1 query to get N doctor IDs
    const doctorIds = await this.adminRepo.getDoctorIdsByBranch(branchId);

    const doctors = [];
    let queryCount = 1; // 1 initial query

    // N queries in a loop (The N+1 Problem)
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

  // Optimized Implementation using a Single Join
  async getBranchDoctorsOptimized(branchId: number) {
    const startTime = Date.now();

    // Exactly 1 SQL query using a JOIN
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
  // N+1 Anti-Pattern for Branch Bookings
    async getBranchBookingsNPlusOne(branchId: number, date: string) {
      const startTime = Date.now();

      // 1 query to get all booked slot IDs
      const slotIds = await this.adminRepo.getBookedSlotIdsByBranchAndDate(branchId, date);

      const bookings = [];
      let queryCount = 1;

      // N queries in a loop
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

    // Optimized Single JOIN for Branch Bookings
    async getBranchBookingsOptimized(branchId: number, date: string) {
      const startTime = Date.now();

      // Exactly 1 SQL query
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
