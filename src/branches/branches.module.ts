import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchesRepository } from './branches.repository';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports:[RedisModule],
  controllers: [BranchesController],
  providers: [BranchesService, BranchesRepository],
})
export class BranchesModule {}
