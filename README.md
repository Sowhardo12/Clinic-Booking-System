for now: 

run docker-compose up -d  (will create the tables)
then run : npm run seed  (will populat the fields)

when seeded:
check db: docker exec -it delta_postgres_baseline psql -U postgres -d delta_diagnostic

port now: 15432
backend port: 13000

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
curl "http://localhost:13000/branches/1/doctors/1/slots?date=2026-10-27"
curl -X POST http://localhost:3000/appointments/book \
  -H "Content-Type: application/json" \
  -d '{"slotId": 1, "patientId": 10, "testRunId": "manual-test-1"}'

  to check if server and db are working 

then open powershell and go to the dir :C:\Users\nohan\OneDrive\Documents\MyProjects\Clinic Management System Lab

[pick up a particular empty slot id] from appointment_slots table 

run: on that slot [go to the dir in powershell and run from there]

k6 run .\k6\contention-test.js
k6 run .\k6\throughput-test.js

then enter db:  assume [slotId=4]
r
[1] Check how many success booking attempts were logged for slot 4
SELECT slot_id, COUNT(*) as total_success_attempts 
FROM booking_attempts 
WHERE slot_id = 4 AND test_run_id = 'run-contention-baseline' AND attempt_status = 'success'
GROUP BY slot_id;

[2] Inspect all patients who successfully claimed slot 4 in the audit log
-- (In a naive baseline, you will often see multiple patients claiming the same slot!)
-
SELECT ba.slot_id, ba.patient_id, p.full_name, ba.created_at
FROM booking_attempts ba
JOIN patients p ON ba.patient_id = p.id
WHERE ba.slot_id = 4 AND ba.test_run_id = 'run-contention-baseline' AND ba.attempt_status = 'success';

issue found: multiple patinet was able to successfully book one slot 
we had 
1. No transaction
2. No atomic guard
3. No lock

we have created a patient ticket record, so whenever a patient request found the slot as available, marked it as successful and created a ticket entry, so we saw multiple patients 
ticket marked the same slot. 

NEXT checking : 
--------------
currently we do not use Lock or Availibility check before the row update. 
1. add just availibility check before row update 
2. add transaction around row update (Row lock)
3. put both ticketing and row update inside one transaction (multiple operation)


Our priority: System has to stay consistent. The slot booking and ticket table update 
should happen in atomic operation, they need to be added together. If one fails, the other one should fail, and if one gets success, other one also should get success. 


My misconception: Database transaction automatically locks the rows. 
Clear one: Database Transaction makes sure all the operation either will happen or not happen at all. It does not gaurentee that the row will be locked. for that, Pessimitic locking is needed (FOR UPDATE). And For update should always inside the BEGIN COMMIT block, otherwise if the FOR UPDATE is before the BEGIN, the query is run and the lock is released. For UPDATE is one way of Pessimistic Locking.


Our modification: we first add Transaction only (BEGIN, COMMIT), and then run the k6
test again and compare, after that we add the for update one. 
/////////
for normal/transaction only check: inside appointment.service.ts: 
use this line: const slot = await this.appointmentsRepo.findSlotById(slotId, client);
for transacton+forUpdate check: inside same file,
use this line: const slot = await this.appointmentsRepo.findSlotByIdForUpdate(client, slotId);
/////////

result: after transaction+forUpdate: only one patient was able to book the slot 


Concurrency problem is fixed now. We have another issue, and that is prevention of double 
clicking. An user taps book, the transaction and row locking actually books the slot and even ticket is generated, now the response has to come back but due to network error, the response drops. User or client browser might retry (double tap), and another request goes and sees the same slot is already booked and show 409 conflict HTTP error. Or user may simply double tap the 
button which may cause the same issue. Or in future there might be option for user to just select the doctor, and the system finds any available slots from that doctor from that branch on the day. prevention is the usage of IDEMPOTENCY KEY. 

working's of Idempotency KEY: 
---------------------------
Under the same request/unit of request, when the client sends a request, the client generates an idempotency key and sends the key with the
request header. Server has a table with a record of idempotency key and saved status. When the req arrives, the server checks if the key is already there or not. if not there, then the server runs the operation, saves the response along with the idempotency key and sends back response. When the duplicate request is same, the key remains the same, so the server does not run the same operation, rather sends back the response previously saved with the idempotency key.

now need to test: 
Idempotency-Key: test-key-123
have to insert it into the POST request to make a booking : working 


now we populate more datainto it, and check core searching (without composite indexes) and then check
the EXPLAIN ANALYZE and then add indexes and then run EXPLAIN ANALYZE to see changes 

the query we wanna run: 
------------------------
SELECT s.id, s.start_time, s.end_time, s.status, ds.for_date
FROM appointment_slots s
JOIN doctor_schedules ds ON s.schedule_id = ds.id
WHERE ds.branch_id = 1 
  AND ds.doctor_id = 1 
  AND ds.for_date = '2026-11-03' 
  AND s.status = 'available'
ORDER BY s.start_time ASC;

goal: check availibility of slot of a doctor at branch and in a date 


                                                             QUERY PLAN
-------------------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=1231.83..1231.89 rows=24 width=34) (actual time=14.315..14.320 rows=24 loops=1)
   Sort Key: s.start_time
   Sort Method: quicksort  Memory: 26kB
   ->  Hash Join  (cost=56.01..1231.28 rows=24 width=34) (actual time=0.516..14.260 rows=24 loops=1)
         Hash Cond: (s.schedule_id = ds.id)
         ->  Seq Scan on appointment_slots s  (cost=0.00..1049.00 rows=48000 width=34) (actual time=0.019..9.280 rows=48000 loops=1)
               Filter: ((status)::text = 'available'::text)
         ->  Hash  (cost=56.00..56.00 rows=1 width=8) (actual time=0.470..0.472 rows=1 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 9kB
               ->  Seq Scan on doctor_schedules ds  (cost=0.00..56.00 rows=1 width=8) (actual time=0.011..0.452 rows=1 loops=1)
                     Filter: ((branch_id = 1) AND (doctor_id = 1) AND (for_date = '2026-11-03'::date))
                     Rows Removed by Filter: 1999
 Planning Time: 0.490 ms
 Execution Time: 14.410 ms
(14 rows)


now add: indexes 
1. Composite index for fast schedule lookup by branch, doctor, and date
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_branch_doc_date 
ON doctor_schedules (branch_id, doctor_id, for_date);


2. Composite index for fast slot filtering by schedule and status, sorted by start time
CREATE INDEX IF NOT EXISTS idx_appointment_slots_schedule_status_time 
ON appointment_slots (schedule_id, status, start_time);

if need delete: DROP INDEX title_idx;


                                                                                   QUERY PLAN
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=58.24..58.30 rows=24 width=34) (actual time=0.175..0.178 rows=24 loops=1)
   Sort Key: s.start_time
   Sort Method: quicksort  Memory: 26kB
   ->  Nested Loop  (cost=0.69..57.69 rows=24 width=34) (actual time=0.128..0.143 rows=24 loops=1)
         ->  Index Scan using idx_doctor_schedules_branch_doc_date on doctor_schedules ds  (cost=0.28..8.30 rows=1 width=8) (actual time=0.088..0.089 rows=1 loops=1)
               Index Cond: ((branch_id = 1) AND (doctor_id = 1) AND (for_date = '2026-11-03'::date))
         ->  Index Scan using idx_appointment_slots_schedule_status_time on appointment_slots s  (cost=0.41..49.15 rows=24 width=34) (actual time=0.033..0.040 rows=24 loops=1)
               Index Cond: ((schedule_id = ds.id) AND ((status)::text = 'available'::text))
 Planning Time: 3.159 ms
 Execution Time: 0.300 ms


result analysis: slight planning time increase but significant increase in execution time (48x)
