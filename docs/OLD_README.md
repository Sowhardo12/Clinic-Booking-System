for now: 

run docker-compose up -d  (will create the tables)
then run : npm run seed  (will populat the fields)

when seeded:
check db: docker exec -it delta_postgres_baseline psql -U postgres -d delta_diagnostic
migration: update sql file keep inside migrations/ folder with a suitable name (i.e: migration_v2_payments.sql)
run in bash: 
docker exec -i delta_postgres_baseline psql -U postgres -d delta_diagnostic < src/database/migrations/migration_v2_payments.sql

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

read: faster
write: slower due to indexing
storage overhead: more space to store the B+ tree


next: we wanna overload the database with K6 load, and check if Database connection pooling has any effects or not. Normally when Postgresql wants to run a query, it needs to create a TCP connection, so there is 3 way handshake involves, and then pg creates a new process, and all these happens before a query is executed. So it is normal when there are less queries, but if multiple concurrent requests comes and this same process is maintained, then there comes a significant overhead (the time lost just to create the connection). So pg actually keeps some conneciton open, and when i need to run a query, i just pick one connection from the pool and use it and send it back to the pool so that some other request can use it. 

so we test in 4 phases 
conneciton pools: 3,13,23,33 
we send 150 VU's sending requests with a 10 ms break and this runs for 30seconds.

result: increasing the pool size from 3 to 33,while keeping existing database, improved throughput(request per second), avg latency  and total numbe of requests. the P95 significantly dropped. But becuase of more concurrent requets, the successful booking decreased and raised more booking conflicts. As more database connection adds more requets to flow, and ID is generated at random, so more requets racing for the same appointment slot.

now we run these tests again, with same state of database everytime:
we try with 5,15,25 conn pools with fresh database everytime:

result: from pool 5 to pool 15, significant throughput increase, means more req are passing, and avg latency has reduced. P95 has also decreased. As for booking, the number of successful booking increase but booking conflicts also increaed. from pool 15-25, we saw very small improvement or change so for this setup 15 is best connection pool with this setup, my CPU capability. With vertical scaling, this pool size can be increased with more improvement. 


Now we move to caching, but before that we have to make some decision :
1. Cache the data that is mostly static and less likely to change
2. do not Cache the data that changes frequently, in this case, appointment_slots

so only for viewing branches data and doctor information, we cache that in redis, becuase they don't change frequently. 

docker exec -it delta_redis redis-cli keys "*"  - >  check redis keys in memory

working fine 
now we need to keep realism in this, which is adding payment process, becuase a clinic or any booking 
is half-finished without the payment part, and payment part is complex and needs secure transaction and 
many times its more prone to error (causing payment failurs) so a concrete payment gateway is needed.
For in depth understanding of the payment process, we will create a gateway in the seperate repository and then connect using inter-service communication.


payment is ongoing development, meanwhile i thought about another thing, can we show N+1 query problem here? 
we will keep one endpoint for admin, admin can see all the doctors from a branch 
naive way: fetch all the doctors id from a branch (1 query)
then loop through N doctors and for each fetch their information
so for 100 doctors in the branch, total 101 database query needed, which is normal for small scale, but if there are 10000 doctors, then it becomes troublesome. 
so we optimize this. 

some other scenerio : 

show me all doctors from a branch 
1. i have a branch with branch id, and a date, for that day i wanna see which patients booked in the branch

req:
curl -i "http://localhost:7333/admin/branches/1/bookings-n-plus-one?date=2026-11-04"
curl -i "http://localhost:7333/admin/branches/1/bookings-optimized?date=2026-11-04"




[for both case: result:]

Case 1: Branch Doctors
N+1: 21 queries, 63 ms
Optimized: 1 query, 6 ms
Time reduction: ~90.5% (63 ms → 6 ms)

Case 2: Branch Bookings (2026-11-04)
N+1: 82 queries, 462 ms
Optimized: 1 query, 33 ms
Time reduction: ~92.9% (462 ms → 33 ms)

deduction: for large number of data, the optimized query is very efficiant.




next plan: add a payment module integrated and add network delays and payment failures and all cases. 
then: add interface to all the repositories. and explain why is it needed. also discuss why this deisgn structure for the project and what future benefits can be there. also check for SOLID principle gaps.


adding: a payment system (fake) which will have 85% payment success through randomness just to mock the process. When a slot is being booked, first the slot will be checked, if its not available but reserved and reservation (2m) time hasent exceeded, then its a no go. If the reservation has exceeded the time then the slot is cleared and made available and slot can be booked for 2 mins, and then payment will happen, if it fails then the slot will be automatically cleared and declared available so that some other request can attempt to book it. If the payment happens then the the slot status will be booked.



[[[[[why did we use Interface in repositories?]]]]]


without interface : 
@Injectable()
export class AppointmentsService {
  constructor(
    private appointmentsRepo: AppointmentsRepository,
  ) {}
}

the repository class is tightly coupled with the service class. with interface: 

constructor(
  @Inject(APPOINTMENTS_REPOSITORY)
  private readonly appointmentsRepo: IAppointmentsRepository,
) {}

benefits: 
1. loose coupoling 
2. Dependency Inversion DIP : High-level business logic should depend on abstractions rather than concrete implementations.
3. Open-Close principle: Can change or modify the repository class without touching the service class


[[[[[why did we use Postgresql, not SQLLite or Mongodb?]]]]]

PostgreSQL was chosen because the clinic booking system has highly relational data involving patients, doctors, branches, schedules, slots, tickets, and payments. It provides the database features we want to explore, including JOINs, transactions, row-level locking, concurrency control, and query optimization. SQLite has more limited concurrent-write capabilities, while MongoDB uses a different data model, making PostgreSQL the best fit for our learning objectives.

[[[[[why did we use n=3 tier architecture?]]]]]

We chose N-tier (Controller → Service → Repository) architecture to separate responsibilities and reduce coupling in the Clinic Booking System. The Controller handles HTTP requests and responses, the Service manages business logic (booking rules, transactions, idempotency, etc.), and the Repository handles database operations (SQL queries). This separation makes the application easier to maintain, test, debug, and extend because changes in one layer don't necessarily require changes in others. It also allows us to replace implementations, such as database access methods, without rewriting the business logic.

[[[[[why used Pessimistic locking not Optimisitc locking?]]]]]

Optimistic locking is useful where concurrency conflicts are rare, but in our case, the conflicts
are more imminent. So row level locking is more important than looking at the version, less chances of 
concurrency.



for the last part: we add server observability using promethous client
curl -i http://localhost:7333/metrics  to seee all the metrics



current problem: we have detected a problem with the concurrent booking logic. Although our payment 
system is a mocking payment system but it has two problems.
1. SOLID - SRP: too many implementaiton is inside the bookAppointment class 
2. SOLID - OCP: if wanna change the mock payment with actual one, we will have to touch the core bookAppointment class 
3. SOLID - ISP: the IAppointment interface is bloated (connected with 1, doing many things)
4. the payment occurs inside a database transaction, so the connection is hold for that moment, and unless someone else is trying the slot, the slot will show reserved (unavailable) so real users will think that slot is unavailable. 
5. the payment occurs inside a database transaction, so in real world that may take time and it takes up 
a connection for long. we need to introduce a mock payment service, so when user is able to book the slot, 
the slot is reserved with the expiration time, and then the payment info is sent to the mock gateway/payment service (we wont use real but system should be so that later we can replace with real one - through interface). and connection is released. when payment success message is sent, then the slots status is changed to 'booked' from 'reserved' and expiary date becomes null. and if payment is failed then failed status will be sent and the slot status will become 'available' from 'reserved'. 


solved:
1. The payment is taken to a seperate module, and implemented in the Appointment Service through abstraction (interface), now the OCP is solved, and SRP is somehow solved, the Appointment Service does only its needed to do. Payment is seperated
2. When available slot is found, slot is reserved with expiration and then the commit happens. now payment either returns failure or success. if failure, then the slot is released and made available. if success then the slot is marked booked with null expiration. We are also keeping the clean findAndCleanExpiredSlot when trying a slot for availibility, becuase in case, if due to network delay the response does not come from the payment service, then the slot is expired but reserved. unless the patient explicitly click the slot (only then the clean method will be called) the slot will show reserved. Its a flaw: will be fixed in the future

out of scope: as we are using mock payment, we will not handle refund on final booking failure due to delay in response from payment gateway meanwhile the reserved slot is expired. 


need to talk about future scalability and future works of this project 
(bring real payment system, bring refund system) if it were to be a real system but its a lab.

some problems solved:

ticket generation was happening bfore the confirm booking, so swaped their step position. If the final booking fails, there should not be any tickits or payment record recorded.
