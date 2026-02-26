import { PoolClient } from "pg";
import pool from "../db/pool";
import { Contact, IdentifyRequest, IdentifyResponse } from "../types/Contact";


//db helper functions
async function findContactsByEmailOrPhone(
  client: PoolClient,
  email: string | null | undefined,
  phoneNumber: string | null | undefined
): Promise<Contact[]> {
  const conditions: string[] = [];
  const values: (string | null)[] = [];
  let i = 1;

  if (email) {
    conditions.push(`email = $${i++}`);
    values.push(email);
  }
  if (phoneNumber) {
    conditions.push(`"phoneNumber" = $${i++}`);
    values.push(phoneNumber);
  }

  if (conditions.length === 0) return [];

  const res = await client.query<Contact>(
    `SELECT * FROM "Contact"
     WHERE (${conditions.join(" OR ")})
       AND "deletedAt" IS NULL
     ORDER BY "createdAt" ASC`,
    values
  );
  return res.rows;
}

async function findAllContactsInCluster(
  client: PoolClient,
  primaryId: number
): Promise<Contact[]> {
  const res = await client.query<Contact>(
    `SELECT * FROM "Contact"
     WHERE (id = $1 OR "linkedId" = $1)
       AND "deletedAt" IS NULL
     ORDER BY "createdAt" ASC`,
    [primaryId]
  );
  return res.rows;
}

async function createContact(
  client: PoolClient,
  email: string | null | undefined,
  phoneNumber: string | null | undefined,
  linkedId: number | null,
  linkPrecedence: "primary" | "secondary"
): Promise<Contact> {
  const res = await client.query<Contact>(
    `INSERT INTO "Contact" (email, "phoneNumber", "linkedId", "linkPrecedence", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING *`,
    [email ?? null, phoneNumber ?? null, linkedId, linkPrecedence]
  );
  return res.rows[0];
}

async function demoteToSecondary(
  client: PoolClient,
  contactId: number,
  newPrimaryId: number
): Promise<void> {
  await client.query(
    `UPDATE "Contact"
     SET "linkedId" = $2, "linkPrecedence" = 'secondary', "updatedAt" = NOW()
     WHERE id = $1`,
    [contactId, newPrimaryId]
  );
}

async function reassignSecondaries(
  client: PoolClient,
  oldPrimaryId: number,
  newPrimaryId: number
): Promise<void> {
  // Reassign all secondaries that were linked to the old primary
  await client.query(
    `UPDATE "Contact"
     SET "linkedId" = $2, "updatedAt" = NOW()
     WHERE "linkedId" = $1 AND "deletedAt" IS NULL`,
    [oldPrimaryId, newPrimaryId]
  );
}


//main function required
export async function identify(
  req: IdentifyRequest
): Promise<IdentifyResponse> {
  const { email, phoneNumber } = req;

  // Must have at least one
  if (!email && !phoneNumber) {
    throw new Error("At least one of email or phoneNumber is required.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Find all contacts that match the incoming email OR phone
    const matchedContacts = await findContactsByEmailOrPhone(
      client,
      email,
      phoneNumber
    );

    //No matches means brand new primary contact 
    if (matchedContacts.length === 0) {
      const newContact = await createContact(
        client,
        email,
        phoneNumber,
        null,
        "primary"
      );
      await client.query("COMMIT");

      return buildResponse([newContact]);
    }

    // Resolve the true primary for each matched contact
    const primaryIds = new Set<number>();
    for (const c of matchedContacts) {
      primaryIds.add(c.linkPrecedence === "primary" ? c.id : c.linkedId!);
    }

    // Load the full clusters for all discovered primaries
    let allPrimaries: Contact[] = [];
    let allContacts: Contact[] = [];

    for (const pid of primaryIds) {
      const cluster = await findAllContactsInCluster(client, pid);
      allContacts.push(...cluster);
      const primaryContact = cluster.find((c) => c.id === pid)!;
      allPrimaries.push(primaryContact);
    }

    // Deduplicate allContacts
    const seen = new Map<number, Contact>();
    for (const c of allContacts) seen.set(c.id, c);
    allContacts = Array.from(seen.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    //  If multiple primaries means keep the oldest, demote the rest
    if (allPrimaries.length > 1) {
      allPrimaries.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      const truePrimary = allPrimaries[0];

      for (let i = 1; i < allPrimaries.length; i++) {
        const todemote = allPrimaries[i];
        // First reassign todemote's secondaries to truePrimary
        await reassignSecondaries(client, todemote.id, truePrimary.id);
        // Then demote todemote itself
        await demoteToSecondary(client, todemote.id, truePrimary.id);
        // Update in-memory so we have fresh data below
        todemote.linkPrecedence = "secondary";
        todemote.linkedId = truePrimary.id;
      }

      // Refresh allContacts after structural changes
      const refreshed = await findAllContactsInCluster(client, truePrimary.id);
      allContacts = refreshed;
    }

    const primaryContact = allContacts.find(
      (c) => c.linkPrecedence === "primary"
    )!;

    // Check if the incoming info is entirely new (new email+phone combo not yet recorded)
    const incomingEmailExists =
      !email || allContacts.some((c) => c.email === email);
    const incomingPhoneExists =
      !phoneNumber || allContacts.some((c) => c.phoneNumber === phoneNumber);

    if (!incomingEmailExists || !incomingPhoneExists) {
      // Add a new secondary contact with the novel information
      await createContact(
        client,
        email,
        phoneNumber,
        primaryContact.id,
        "secondary"
      );

      // Refresh cluster
      const refreshed = await findAllContactsInCluster(
        client,
        primaryContact.id
      );
      allContacts = refreshed;
    }

    await client.query("COMMIT");
    return buildResponse(allContacts);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}


//response building
function buildResponse(contacts: Contact[]): IdentifyResponse {
  const primary = contacts.find((c) => c.linkPrecedence === "primary")!;
  const secondaries = contacts.filter((c) => c.linkPrecedence === "secondary");

  // Collect ordered, deduplicated emails & phones (primary first)
  const emails: string[] = [];
  const phones: string[] = [];
  const secondaryIds: number[] = [];

  const addEmail = (e: string | null) => {
    if (e && !emails.includes(e)) emails.push(e);
  };
  const addPhone = (p: string | null) => {
    if (p && !phones.includes(p)) phones.push(p);
  };

  // Primary values go first
  addEmail(primary.email);
  addPhone(primary.phoneNumber);

  for (const s of secondaries) {
    addEmail(s.email);
    addPhone(s.phoneNumber);
    secondaryIds.push(s.id);
  }

  return {
    contact: {
      primaryContactId: primary.id,
      emails,
      phoneNumbers: phones,
      secondaryContactIds: secondaryIds,
    },
  };
}