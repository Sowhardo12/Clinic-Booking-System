---
name: api-documentation-maker
description: Inspect the existing NestJS API implementation and create or update accurate Markdown API documentation in docs/API.md. Use when asked to document API endpoints, refresh API documentation, or audit API docs against the code.
---

# API Documentation Maker

## Purpose

Generate maintainable, implementation-accurate API documentation for this repository. The output file is `docs/API.md`.

## Operating rules

1. Treat the source code as the source of truth. Do not invent endpoints, fields, defaults, validation rules, status codes, authentication requirements, or response examples.
2. Do not modify application source code, database schema, migrations, environment files, tests, or configuration. This skill is documentation-only.
3. Inspect the implementation before writing. Do not rely only on README files, old documentation, comments, or route names.
4. If implementation and existing documentation disagree, document the current implementation and add a short **Documentation notes / discrepancies** section describing the mismatch.
5. If a detail cannot be confirmed from the code, write `Not specified in the implementation` rather than guessing.
6. Keep examples consistent with DTO validation and actual controller/service behavior. Use clearly marked illustrative IDs and values.
7. Do not expose secrets, credentials, real patient data, or values copied from `.env` files.
8. Preserve useful existing documentation when updating `docs/API.md`; do not delete accurate material merely to make the document shorter.
9. Do not add dependencies or generate an OpenAPI/Swagger setup unless explicitly requested.

## Repository conventions

- This project uses NestJS and TypeScript.
- Follow the existing API route prefixes and response envelope, if one is implemented.
- Inspect controllers, DTOs, guards, pipes, interceptors, services, and relevant repository methods to establish actual behavior.
- For database-backed endpoints, inspect relevant SQL only when needed to confirm filters, ordering, pagination, or response fields.
- The project may contain naive and updated implementations. Document the implementation currently wired into the active module/controller. Do not assume a folder named `updated_implementation` is active.

## Workflow

### 1. Discover the API surface

- Inspect the project structure and locate `main.ts`, root/module registration, controllers, DTOs, guards, and interceptors.
- Find every controller registered by the application.
- Identify global prefixes, versioning, global pipes, interceptors, and exception filters.
- Trace each route far enough to understand its actual request handling and response shape.
- Distinguish public, authenticated, and role-restricted routes only when the code establishes that distinction.

### 2. Extract endpoint details

For each implemented endpoint, record:

- HTTP method and full path, including any global prefix.
- Short purpose.
- Authentication and authorization requirements, if confirmed.
- Path parameters, query parameters, and request body fields.
- Required/optional status, types, defaults, validation constraints, and accepted formats.
- Successful response status and response body shape.
- Known error responses and the conditions that produce them.
- Important side effects, such as creating a booking, reserving a slot, or writing a payment record.
- Relevant behavior such as caching, idempotency, pagination, or filtering, but only when verified.

Do not describe internal implementation details as API guarantees unless they affect observable behavior.

### 3. Write the documentation

Create the `docs/` directory if it does not exist. Create or update `docs/API.md` with this structure:

1. Title and brief project/API overview.
2. Base URL and global behavior (prefix, validation, response envelope), where confirmed.
3. Authentication and authorization overview, where confirmed.
4. Endpoint index grouped by controller or domain.
5. Detailed endpoint sections.
6. Common response and error formats, where confirmed.
7. Example requests using `curl`.
8. Documentation notes / discrepancies and unconfirmed details.

For each endpoint, use a consistent layout:

- `METHOD /path`
- Purpose
- Authentication / permissions
- Parameters table
- Request body example, when applicable
- Success response example
- Error cases
- Observable side effects / behavior

Use Markdown tables for fields and concise JSON or curl code blocks for examples. Avoid documenting implementation-only helper methods as endpoints.

### 4. Validate the result

Before finishing:

- Compare every documented endpoint against its controller decorator and active module registration.
- Check that parameter names and DTO fields match the source exactly.
- Check that examples use valid field names and plausible values.
- Check that documented status codes and response envelopes match actual code paths.
- Check that no secrets or real personal data were included.
- Confirm that only `docs/API.md` (and the `docs/` directory if newly created) was changed.

If the repository has a documentation lint or Markdown validation command, run it only if it is already available and does not modify application files. Do not run the full application or destructive database commands just to generate documentation.

## Completion report

When done, report:

- The documentation file path.
- Number of endpoints documented.
- Which controllers/modules were covered.
- Any routes or behaviors that could not be confirmed.
- Validation performed.
- Any discrepancies between existing docs and implementation.

Do not claim complete API coverage if some registered controllers or routes could not be inspected.
