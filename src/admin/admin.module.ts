import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRepository } from './admin.repository';
import { ADMIN_REPOSITORY } from './interfaces/admin.repository.interface';
@Module({
  controllers: [AdminController],
  providers: [AdminService, {
    provide: ADMIN_REPOSITORY,
    useClass:AdminRepository
  }],
})
export class AdminModule {}
