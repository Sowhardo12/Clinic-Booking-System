import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);

    const startTime = Date.now();
    const { method, originalUrl, body } = req;

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const { statusCode } = res;


      const logPayload = {
        timestamp: new Date().toISOString(),
        requestId,
        method,
        url: originalUrl,
        statusCode,
        durationMs: duration,
        patientId: body?.patientId || null,
        slotId: body?.slotId || null,
      };

      if (statusCode >= 500) {
        this.logger.error(JSON.stringify(logPayload));
      } else if (statusCode >= 400) {
        this.logger.warn(JSON.stringify(logPayload));
      } else {
        this.logger.log(JSON.stringify(logPayload));
      }
    });

    next();
  }
}
