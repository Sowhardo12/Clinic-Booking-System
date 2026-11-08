import { Module,NestModule,MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { BranchesModule } from './branches/branches.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { RedisModule } from './redis/redis.module';
import { AdminModule } from './admin/admin.module';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { ObservabilityModule } from './observability/observability.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    BranchesModule,
    AppointmentsModule,
    RedisModule,
    AdminModule,
    ObservabilityModule,
  ],
})
export class AppModule implements NestModule{
  configure(consumer: MiddlewareConsumer) {
      consumer.apply(RequestLoggerMiddleware).forRoutes('*');
    }
}
