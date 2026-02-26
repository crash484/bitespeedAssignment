import pool from "./pool";

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Contact" (
        id              SERIAL PRIMARY KEY,
        "phoneNumber"   VARCHAR(20),
        email           VARCHAR(255),
        "linkedId"      INTEGER REFERENCES "Contact"(id) ON DELETE SET NULL,
        "linkPrecedence" VARCHAR(10) NOT NULL CHECK ("linkPrecedence" IN ('primary', 'secondary')),
        "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
        "deletedAt"     TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_email       ON "Contact"(email)         WHERE "deletedAt" IS NULL;
      CREATE INDEX IF NOT EXISTS idx_contact_phone       ON "Contact"("phoneNumber")  WHERE "deletedAt" IS NULL;
      CREATE INDEX IF NOT EXISTS idx_contact_linked_id   ON "Contact"("linkedId")     WHERE "deletedAt" IS NULL;
    `);

    console.log("migration complete Contact table is ready.");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});