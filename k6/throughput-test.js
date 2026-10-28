import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 100 },
    { duration: '20s', target: 100 },
    { duration: '5s', target: 0 },
  ],
};

export default function () {
  // const url = 'http://host.docker.internal:3000/appointments/book';
  const url = 'http://localhost:3000/appointments/book';
  const patientId = Math.floor(Math.random() * 1000) + 1;
  
  // Distribute requests across different slots (slots 1 to 500)
  const slotId = Math.floor(Math.random() * 500) + 1;

  const payload = JSON.stringify({
    slotId: slotId,
    patientId: patientId,
    testRunId: 'run-throughput-baseline',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(url, payload, params);
  
  check(res, {
    'status is 201 or 400 or 409': (r) => r.status === 201 || r.status === 400 || r.status === 409,
  });

  sleep(0.01);
}