import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchesRepository } from './branches.repository';
import { RedisModule } from 'src/redis/redis.module';
import { BRANCHES_REPOSITORY } from './interfaces/branch.repository.interface';

@Module({
  imports:[RedisModule],
  controllers: [BranchesController],
  providers: [BranchesService, {
    provide: BRANCHES_REPOSITORY,
    useClass:BranchesRepository
  }],
})
export class BranchesModule {}
