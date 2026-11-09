# Project Structure

```
.
├── .env
├── .env.example
├── .git/
├── .gitignore
├── Connection Pool Performance Comparison.png
├── docker-compose.yml
├── k6/
├── package.json
├── package-lock.json
├── prometheus.yml
├── README.md
├── src/
│   ├── app.module.ts
│   ├── branches/
│   │   ├── branches.controller.ts
│   │   ├── branches.module.ts
│   │   ├── branches.repository.ts
│   │   └── branches.service.ts
│   ├── database/
│   │   ├── database.module.ts
│   │   ├── database.service.ts
│   │   ├── schema.sql
│   │   └── seed.ts
│   ├── redis/
│   │   ├── redis.module.ts
│   │   └── redis.service.ts
│   └── appointments/
│       ├── appointments.controller.ts
│       ├── appointments.module.ts
│       ├── appointments.repository.ts
│       ├── appointments.service.ts
│       ├── dto/
│       │   └── book-appointment.dto.ts
│       ├── naive_implementation/
│       │   ├── repo.txt
│       │   └── service.txt
│       ├── updated_implementation/
│       │   ├── repo.txt
│       │   └── service.txt
│       └── naive_implementation/
│           ├── repo.txt
│           └── service.txt
├── tsconfig.json
└── tree_output.txt
```