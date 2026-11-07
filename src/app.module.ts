import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { BranchesModule } from './branches/branches.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { RedisModule } from './redis/redis.module';
import { AdminModule } from './admin/admin.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    BranchesModule,
    AppointmentsModule,
    RedisModule,
    AdminModule,
  ],
})
export class AppModule {}
