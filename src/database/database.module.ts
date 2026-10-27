import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [DatabaseService], // initiate and register in the DI container
  exports: [DatabaseService],
})
export class DatabaseModule {}