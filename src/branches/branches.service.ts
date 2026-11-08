import { Injectable, Inject } from '@nestjs/common';
import { BranchesRepository } from './branches.repository';
import { RedisService } from '../redis/redis.service';
import { BRANCHES_REPOSITORY } from './interfaces/branch.repository.interface';
import { IBranchesRepository } from './interfaces/branch.repository.interface';
@Injectable()

export class BranchesService {
  constructor(@Inject(BRANCHES_REPOSITORY) private readonly branchesRepo: IBranchesRepository,
    private redisService: RedisService,) { }

  async getBranches() {
    const cache_key = 'cache:branches:all';
    const cached = await this.redisService.get(cache_key);
    if (cached) {
      return JSON.parse(cached);
    }
    //cache miss
    const branches = await this.branchesRepo.findAllBranches();
    await this.redisService.set(cache_key, JSON.stringify(branches), 60);
    return branches;
  }

  async getDoctors(branchId: number) {
      const cacheKey = `cache:branch:${branchId}:doctors`;

      const cached = await this.redisService.get(cacheKey);
    if (cached) {
        console.log("Cache Hit")
        return JSON.parse(cached);
      }
      console.log("Cache Miss- db query")
      const doctors = await this.branchesRepo.findDoctorsByBranch(branchId);
    await this.redisService.set(cacheKey, JSON.stringify(doctors), 60);
    console.log("Added to cache")

      return doctors;
    }

  async getSlots(branchId: number, doctorId: number, date: string) {
    return this.branchesRepo.findAvailableSlots(branchId, doctorId, date);
  }
}
