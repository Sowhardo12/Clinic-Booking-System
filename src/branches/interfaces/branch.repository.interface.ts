export interface IBranchesRepository {
  findAllBranches(): Promise<any[]>;

  findDoctorsByBranch(branchId: number): Promise<any[]>;

  findAvailableSlots(
    branchId: number,
    doctorId: number,
    date: string,
  ): Promise<any[]>;
}

export const BRANCHES_REPOSITORY = Symbol('IBranchesRepository');
