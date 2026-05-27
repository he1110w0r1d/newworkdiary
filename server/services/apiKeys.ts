import crypto from "node:crypto";
import { pool } from "../db";

const DEMO_USER_ID = 1;

export type ApiKeyRecord = {
  id: number;
  user_id: number;
  agent_id: number | null;
  scopes: string[];
};

export type AgentApiKeyListItem = {
  id: number;
  agent_id: number | null;
  agent_name: string | null;
  key_mask: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
};

export type AgentProfile = {
  id: number;
  name: string;
  description: string | null;
  provider: string | null;
  default_color: string | null;
  skill_doc: string | null;
  scopes: string[];
  key_mask: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export function createRawApiKey() {
  return `wdk_${crypto.randomBytes(24).toString("base64url")}`;
}

export function hashApiKey(rawKey: string) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function maskApiKey(rawKey: string) {
  return `${rawKey.slice(0, 8)}...${rawKey.slice(-6)}`;
}

export async function createAgentApiKey({
  name,
  scopes,
  expiresAt,
  userId = DEMO_USER_ID,
}: {
  name: string;
  scopes: string[];
  expiresAt?: string | null;
  userId?: number;
}) {
  const rawKey = createRawApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyMask = maskApiKey(rawKey);

  const result = await pool.query<{
    api_key_id: number;
    agent_id: number;
    key_mask: string;
    scopes: string[];
    expires_at: string | null;
  }>(
    `
      WITH agent AS (
        INSERT INTO agents (user_id, name, provider, description)
        VALUES ($1, $2, 'custom', 'Created from 作业本 Agent Key page')
        RETURNING id
      ),
      key AS (
        INSERT INTO api_keys (user_id, agent_id, key_hash, key_mask, scopes, expires_at)
        SELECT $1, agent.id, $3, $4, $5::varchar[], $6::timestamptz
        FROM agent
        RETURNING id, agent_id, key_mask, scopes, expires_at::text
      )
      SELECT id AS api_key_id, agent_id, key_mask, scopes, expires_at
      FROM key
    `,
    [userId, name, keyHash, keyMask, scopes, expiresAt ?? null],
  );

  return {
    ...result.rows[0],
    rawKey,
  };
}

export async function findApiKey(rawKey: string) {
  const keyHash = hashApiKey(rawKey);
  const result = await pool.query<ApiKeyRecord>(
    `
      SELECT id, user_id, agent_id, scopes
      FROM api_keys
      WHERE key_hash = $1
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `,
    [keyHash],
  );

  return result.rows[0] ?? null;
}

export async function listAgentApiKeys(userId = DEMO_USER_ID) {
  const result = await pool.query<AgentApiKeyListItem>(
    `
      SELECT
        api_keys.id,
        api_keys.agent_id,
        agents.name AS agent_name,
        api_keys.key_mask,
        api_keys.scopes,
        api_keys.expires_at::text,
        api_keys.created_at::text
      FROM api_keys
      LEFT JOIN agents ON agents.id = api_keys.agent_id
      WHERE api_keys.user_id = $1
      ORDER BY api_keys.created_at DESC, api_keys.id DESC
    `,
    [userId],
  );

  return result.rows;
}

export async function revokeAgentApiKey(id: number, userId = DEMO_USER_ID) {
  const result = await pool.query(
    `
      DELETE FROM api_keys
      WHERE id = $1 AND user_id = $2
    `,
    [id, userId],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function getAgentProfileByApiKey(key: ApiKeyRecord): Promise<AgentProfile | null> {
  if (!key.agent_id) return null;

  const result = await pool.query<AgentProfile>(
    `
      SELECT
        agents.id,
        agents.name,
        agents.description,
        agents.provider,
        agents.default_color,
        agents.skill_doc,
        api_keys.scopes,
        api_keys.key_mask,
        api_keys.expires_at::text,
        agents.created_at::text,
        agents.updated_at::text
      FROM agents
      INNER JOIN api_keys ON api_keys.agent_id = agents.id
      WHERE agents.id = $1
        AND agents.user_id = $2
        AND api_keys.id = $3
    `,
    [key.agent_id, key.user_id, key.id],
  );

  return result.rows[0] ?? null;
}

export async function updateAgentProfileByApiKey(
  key: ApiKeyRecord,
  patch: {
    name?: string;
    description?: string | null;
    provider?: string | null;
    defaultColor?: string | null;
    skillDoc?: string | null;
  },
): Promise<AgentProfile | null> {
  if (!key.agent_id) return null;

  const current = await getAgentProfileByApiKey(key);
  if (!current) return null;

  await pool.query(
    `
      UPDATE agents
      SET name = $3,
          description = $4,
          provider = $5,
          default_color = $6,
          skill_doc = $7,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
    `,
    [
      key.agent_id,
      key.user_id,
      patch.name?.trim() || current.name,
      patch.description === undefined ? current.description : patch.description,
      patch.provider === undefined ? current.provider : patch.provider,
      patch.defaultColor === undefined ? current.default_color : patch.defaultColor,
      patch.skillDoc === undefined ? current.skill_doc : patch.skillDoc,
    ],
  );

  return getAgentProfileByApiKey(key);
}

export function hasScope(record: ApiKeyRecord, requiredScope: string) {
  return record.scopes.includes("all") || record.scopes.includes(requiredScope);
}

export async function recordAuditLog({
  key,
  action,
  targetType,
  targetId,
  requestMeta = {},
}: {
  key: ApiKeyRecord;
  action: string;
  targetType?: string;
  targetId?: number;
  requestMeta?: Record<string, unknown>;
}) {
  await pool.query(
    `
      INSERT INTO agent_audit_logs (
        user_id,
        agent_id,
        api_key_id,
        action,
        target_type,
        target_id,
        request_meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      key.user_id,
      key.agent_id,
      key.id,
      action,
      targetType ?? null,
      targetId ?? null,
      JSON.stringify(requestMeta),
    ],
  );
}
