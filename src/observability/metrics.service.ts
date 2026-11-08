import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService {
  public httpRequestsTotal: client.Counter<string>;
  public httpRequestDuration: client.Histogram<string>;
  public bookingAttemptsTotal: client.Counter<string>;

  constructor() {
    // Clear any existing metrics to avoid duplicate registration errors on hot-reload
    client.register.clear();

    // Collect default Node.js metrics globally
    client.collectDefaultMetrics();

    // Custom Counter: Total HTTP Requests
    this.httpRequestsTotal = new client.Counter({
      name: 'clinic_http_requests_total',
      help: 'Total number of HTTP requests received',
      labelNames: ['method', 'path', 'status'],
    });

    // Custom Histogram: HTTP Request Latency
    this.httpRequestDuration = new client.Histogram({
      name: 'clinic_http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'path', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    });

    // Custom Counter: Booking Attempts
    this.bookingAttemptsTotal = new client.Counter({
      name: 'clinic_booking_attempts_total',
      help: 'Total number of clinic appointment booking attempts',
      labelNames: ['status'],
    });
  }

  async getMetrics(): Promise<string> {
    return client.register.metrics();
  }
}
