# Bitespeed Identity Reconciliation Service

A backend service that identifies and consolidates customer contact information across multiple purchases. When a customer uses different email addresses or phone numbers, this service links them to a single identity.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Package Manager**: pnpm

## Database Schema

The service uses a single `Contact` table:

| Column           | Type         | Description                                      |
| ---------------- | ------------ | ------------------------------------------------ |
| `id`             | SERIAL (PK)  | Auto-incremented primary key                     |
| `phoneNumber`    | VARCHAR(20)  | Customer phone number (nullable)                 |
| `email`          | VARCHAR(255) | Customer email address (nullable)                |
| `linkedId`       | INTEGER (FK) | References the primary contact's `id` (nullable) |
| `linkPrecedence` | VARCHAR(10)  | `"primary"` or `"secondary"`                     |
| `createdAt`      | TIMESTAMP    | Record creation time                             |
| `updatedAt`      | TIMESTAMP    | Last update time                                 |
| `deletedAt`      | TIMESTAMP    | Soft-delete timestamp (nullable)                 |

## Project Structure

```
├── server.ts                # Express app setup and startup
├── routes/
│   └── identify.ts          # POST /identify route with request validation
├── services/
│   └── ContactService.ts    # Core identification and linking logic
├── db/
│   ├── pool.ts              # PostgreSQL connection pool
│   └── migrate.ts           # Database migration script
├── types/
│   └── Contact.ts           # TypeScript interfaces (Contact, IdentifyRequest, IdentifyResponse)
├── package.json
└── tsconfig.json
```

## API

### `POST /identify`

Accepts a JSON body with at least one of `email` or `phoneNumber` and returns a consolidated contact.

**Request body:**

```json
{
  "email": "example@test.com",
  "phoneNumber": "1234567890"
}
```

**Response:**

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["example@test.com", "alt@test.com"],
    "phoneNumbers": ["1234567890", "0987654321"],
    "secondaryContactIds": [2, 3]
  }
}
```

- `primaryContactId` — the `id` of the oldest (primary) contact in the linked group.
- `emails` — all known emails, primary contact's email listed first.
- `phoneNumbers` — all known phone numbers, primary contact's phone listed first.
- `secondaryContactIds` — `id`s of every secondary contact in the group.

### `GET /health`

Returns `{ "status": "ok", "timestamp": "..." }` for health checks.

## How It Works — Identification Flow

When a request hits `POST /identify`, the service runs the following steps inside a database transaction:

1. **Lookup** — Query the `Contact` table for any existing rows whose `email` or `phoneNumber` matches the incoming values.

2. **No matches → Create primary** — If no rows are found, this is a brand-new customer. A new contact is inserted with `linkPrecedence = "primary"` and `linkedId = NULL`.

3. **Matches found → Resolve primaries** — For every matched contact, determine the root primary contact (if a matched row is secondary, follow its `linkedId` to the primary). Collect all unique primary IDs.

4. **Multiple primaries → Merge clusters** — If the matched contacts belong to different primary groups, the groups must be merged:
   - The **oldest** primary (by `createdAt`) is kept as the true primary.
   - Every other primary is **demoted** to secondary (its `linkedId` is set to the true primary and `linkPrecedence` is changed to `"secondary"`).
   - All secondaries that pointed to a demoted primary are **reassigned** to the true primary.

5. **Check for new information** — If the incoming `email` or `phoneNumber` does not already exist in the merged cluster, a new **secondary** contact is created to record the new information.

6. **Build response** — All contacts in the cluster are gathered. The response lists the primary contact's `id`, all unique emails and phone numbers (primary contact's values first), and all secondary contact `id`s.

### Example Walkthrough

| Step | Request                                               | Result                                                                                                                 |
| ---- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1    | `{ "email": "a@x.com", "phoneNumber": "111" }`       | No existing contact. Creates **Contact 1** (primary).                                                                  |
| 2    | `{ "email": "b@x.com", "phoneNumber": "222" }`       | No match. Creates **Contact 2** (primary).                                                                             |
| 3    | `{ "email": "a@x.com", "phoneNumber": "222" }`       | Matches Contact 1 (via email) and Contact 2 (via phone). Two primaries found → Contact 2 is demoted to secondary under Contact 1. Returns both contacts linked under Contact 1. |

## Setup

### Prerequisites

- Node.js ≥ 18
- PostgreSQL
- pnpm

### Installation

```bash
pnpm install
```

### Environment Variables

Create a `.env` file in the project root:

```
DATABASE_URL=postgresql://user:password@localhost:5432/bitespeed
PORT=3000
NODE_ENV=development
```

### Run Database Migration

```bash
pnpm migrate
```

This creates the `Contact` table and its indexes.

### Start the Server

```bash
# Development (with hot reload)
pnpm dev

# Production
pnpm start
```

The server starts on the port specified by `PORT` (defaults to `3000`).