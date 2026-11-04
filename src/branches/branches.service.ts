import { Injectable } from '@nestjs/common';
import { BranchesRepository } from './branches.repository';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class BranchesService {
  constructor(private branchesRepo: BranchesRepository) {}

  async getBranches() {

    return this.branchesRepo.findAllBranches();
  }

  async getDoctors(branchId: number) {
    return this.branchesRepo.findDoctorsByBranch(branchId);
  }

  async getSlots(branchId: number, doctorId: number, date: string) {
    return this.branchesRepo.findAvailableSlots(branchId, doctorId, date);
  }
}
