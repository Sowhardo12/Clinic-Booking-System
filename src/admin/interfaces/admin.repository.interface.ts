export interface IAdminRepository {
  getDoctorIdsByBranch(branchId: number): Promise<number[]>;

  getDoctorById(doctorId: number): Promise<any>;

  getDoctorsOptimized(branchId: number): Promise<any[]>;

  getBookedSlotIdsByBranchAndDate(
    branchId: number,
    date: string,
  ): Promise<number[]>;

  getBookingDetailsBySlotId(slotId: number): Promise<any>;

  getBookingsOptimized(
    branchId: number,
    date: string,
  ): Promise<any[]>;
}

export const ADMIN_REPOSITORY = Symbol('IAdminRepository');
