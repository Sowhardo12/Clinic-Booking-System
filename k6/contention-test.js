import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 100 }, // Ramp up to 100 concurrent users hammering the same slot
    { duration: '10s', target: 100 },
    { duration: '5s', target: 0 },
  ],
};

export default function () {
  const url = 'http://localhost:7333/appointments/book';

  // Map virtual users across our 5,000 seeded patients
  const patientId = (__VU - 1) % 5000 + 1;

  const payload = JSON.stringify({
    slotId: 50, // Target a specific slot to test row locking + pool contention
    patientId: patientId,
    testRunId: 'run-pool-contention-test',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(url, payload, params);

  check(res, {
    'status is 201 or 409': (r) => r.status === 201 || r.status === 409,
  });

  sleep(0.01);
}
