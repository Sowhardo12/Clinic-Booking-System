import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService {
  private registry: client.Registry;
  public httpRequestsTotal: client.Counter<string>;
  public httpRequestDuration: client.Histogram<string>;
  public bookingAttemptsTotal: client.Counter<string>;

  constructor() {
    this.registry = new client.Registry();

    // Collect default Node.js metrics (CPU, memory, event loop lag, etc.)
    client.collectDefaultMetrics({ register: this.registry });

    // Custom Counter: Total HTTP Requests
    this.httpRequestsTotal = new client.Counter({
      name: 'clinic_http_requests_total',
      help: 'Total number of HTTP requests received',
      labelNames: ['method', 'path', 'status'],
      registers: [this.registry],
    });

    // Custom Histogram: HTTP Request Latency
    this.httpRequestDuration = new client.Histogram({
      name: 'clinic_http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'path', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    // Custom Counter: Booking Attempts (success vs conflict vs payment failed)
    this.bookingAttemptsTotal = new client.Counter({
      name: 'clinic_booking_attempts_total',
      help: 'Total number of clinic appointment booking attempts',
      labelNames: ['status'],
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
