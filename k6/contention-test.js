import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '3s', target: 50 },  // Ramp up to 50 concurrent users
    { duration: '5s', target: 50 },  // Hold 50 users hammering slotId 1
    { duration: '2s', target: 0 },   // Ramp down
  ],
};

export default function () {
  const url = 'http://localhost:3000/appointments/book';
  // const url = 'http://host.docker.internal:3000/appointments/book';
  
  // Each virtual user maps to a distinct persistent patient record (1 to 1000)
  const patientId = (__VU - 1) % 1000 + 1;
  
  const payload = JSON.stringify({
    slotId: 4, // Target exact same slot to trigger race condition
    patientId: patientId,
    testRunId: 'run-contention-baseline',
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

  sleep(0.05);
}