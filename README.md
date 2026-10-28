for now: 

run docker-compose up -d
then run : npm run seed

when seeded:
check db: docker exec -it delta_postgres_baseline psql -U postgres -d delta_diagnostic

port now: 15432

NAIVE IMPLEMENTATION: 
---------------------
We have thousands of slots, for different doctors across different branches. Now there are registered patient
in the database, we wanna load test and see the what happens during the spike, specifically latency and concurrency. some flaws are intentionally kept: 

1. normal queries without any optimization 
2. no database locking preventing race condition 



Addition: lets say the patient can have their own record like I have booked this slot, and this happens 



Test Reproduction method: [][][] naive implementation
--------------------------------
docker compose down -v
docker compose up -d  (recreate and populate)
npm run seed

run: npm run start:dev

test ::
curl "http://localhost:3000/branches/1/doctors/1/slots?date=2026-10-27"
curl -X POST http://localhost:3000/appointments/book \
  -H "Content-Type: application/json" \
  -d '{"slotId": 1, "patientId": 10, "testRunId": "manual-test-1"}'

  to check if server and db are working 

then open powershell and go to the dir :C:\Users\nohan\OneDrive\Documents\MyProjects\Clinic Management System Lab

[pick up a particular empty slot id] from appointment_slots table 

run: on that slot 

k6 run .\k6\contention-test.js
k6 run .\k6\throughput-test.js

then enter db:  assume [slotId=1]

[1] Check how many success booking attempts were logged for slot 1
SELECT slot_id, COUNT(*) as total_success_attempts 
FROM booking_attempts 
WHERE slot_id = 1 AND test_run_id = 'run-contention-baseline' AND attempt_status = 'success'
GROUP BY slot_id;

[2] Inspect all patients who successfully claimed slot 1 in the audit log
-- (In a naive baseline, you will often see multiple patients claiming the same slot!)
-
SELECT ba.slot_id, ba.patient_id, p.full_name, ba.created_at
FROM booking_attempts ba
JOIN patients p ON ba.patient_id = p.id
WHERE ba.slot_id = 1 AND ba.test_run_id = 'run-contention-baseline' AND ba.attempt_status = 'success';

issue found: multiple patinet was able to successfully book one slot 
we had 
1. No transaction
2. No atomic guard
3. No lock

we have created a patient ticket record, so whenever a patient request found the slot as available, marked it as successful and created a ticket entry, so we saw multiple patients 
ticket marked the same slot. 

