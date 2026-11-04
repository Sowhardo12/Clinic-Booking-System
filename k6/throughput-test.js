
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const status201 = new Counter('booking_success');
const status400 = new Counter('booking_bad_request');
const status409 = new Counter('booking_conflict');
const status500 = new Counter('server_errors');
const otherStatuses = new Counter('other_statuses');

export const options = {
  stages: [
    { duration: '5s', target: 150 },
    { duration: '20s', target: 150 },
    { duration: '5s', target: 0 },
  ],
};

export default function () {
  const url = 'http://localhost:7333/appointments/book';

  const patientId = Math.floor(Math.random() * 5000) + 1;
  const slotId = Math.floor(Math.random() * 15000) + 1;

  const payload = JSON.stringify({
    slotId: slotId,
    patientId: patientId,
    testRunId: 'run-pool-throughput-test',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(url, payload, params);

  // Track HTTP response status codes separately
  if (res.status === 201) {
    status201.add(1);
  } else if (res.status === 400) {
    status400.add(1);
  } else if (res.status === 409) {
    status409.add(1);
  } else if (res.status >= 500) {
    status500.add(1);
  } else {
    otherStatuses.add(1);
  }

  check(res, {
    'status is 201, 400, or 409': (r) =>
      r.status === 201 || r.status === 400 || r.status === 409,
  });

  sleep(0.01);
}
