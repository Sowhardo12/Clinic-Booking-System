import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 15432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password123',
      database: process.env.DB_NAME || 'delta_diagnostic',
      max: parseInt(process.env.DB_POOL_MAX, 10) || 25,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.pool.on('error', (err) => {
          console.error('Unexpected error on idle PostgreSQL client', err);
        });

  }

//   async onModuleInit() {
//     await this.pool.connect();
//   }
//
//   async onModuleDestroy() {
//     await this.pool.end();
//   }
async onModuleInit() {
    try {
      const client = await this.pool.connect();
      client.release();
      console.log('PostgreSQL connection pool successfully initialized.');
    } catch (err) {
      console.error('❌ Failed to connect to PostgreSQL pool:', err);
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
    console.log('PostgreSQL connection pool closed.');
  }

  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }
}
