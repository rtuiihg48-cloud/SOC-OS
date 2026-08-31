import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, type PoolClient } from "@workspace/db";

let client: PoolClient;
const tenantId = 900_000 + Math.floor(Math.random() * 90_000);
let observationId: number;

beforeAll(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query(
    "INSERT INTO tenants(id,name,api_key) VALUES ($1,'Traffic DB test',$2)",
    [tenantId, `traffic-test-${tenantId}`],
  );
  const inserted = await client.query(
    `INSERT INTO traffic_observations
      (tenant_id,gateway_id,observation_id,observation_type,observed_at,protocol,direction,source_asset,destination_asset)
     VALUES ($1,'test-gateway','test-observation','FLOW',now(),'TLS','OUTBOUND','endpoint','service')
     RETURNING id`,
    [tenantId],
  );
  observationId = inserted.rows[0].id;
});

afterAll(async () => {
  await client.query("ROLLBACK");
  client.release();
});

describe("traffic evidence database constraints", () => {
  it("rejects tenantless observations", async () => {
    await client.query("SAVEPOINT tenantless");
    await expect(client.query(
      `INSERT INTO traffic_observations
        (tenant_id,gateway_id,observation_id,observation_type,observed_at,protocol,direction)
       VALUES (NULL,'test-gateway','tenantless','HEARTBEAT',now(),'UNKNOWN','UNKNOWN')`,
    )).rejects.toMatchObject({ code: "23514" });
    await client.query("ROLLBACK TO SAVEPOINT tenantless");
  });

  it("rejects duplicate gateway observation IDs within a tenant", async () => {
    await client.query("SAVEPOINT duplicate");
    await expect(client.query(
      `INSERT INTO traffic_observations
        (tenant_id,gateway_id,observation_id,observation_type,observed_at,protocol,direction)
       VALUES ($1,'test-gateway','test-observation','FLOW',now(),'TCP','OUTBOUND')`,
      [tenantId],
    )).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT duplicate");
  });

  it("prevents updates and deletes of traffic evidence", async () => {
    await client.query("SAVEPOINT immutable_update");
    await expect(client.query("UPDATE traffic_observations SET risk_score=99 WHERE id=$1", [observationId]))
      .rejects.toMatchObject({ code: "55000" });
    await client.query("ROLLBACK TO SAVEPOINT immutable_update");

    await client.query("SAVEPOINT immutable_delete");
    await expect(client.query("DELETE FROM traffic_observations WHERE id=$1", [observationId]))
      .rejects.toMatchObject({ code: "55000" });
    await client.query("ROLLBACK TO SAVEPOINT immutable_delete");
  });
});