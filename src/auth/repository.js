import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { hashToken } from "./credentials.js";
import { publicUser } from "./normalization.js";

export class AuthRepository {
  constructor(dbPath) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
    this.setupSchema();
  }

  setupSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('TenantAdmin', 'TenantUser')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_user_tenants (
        user_id TEXT NOT NULL,
        tenant TEXT NOT NULL COLLATE NOCASE,
        PRIMARY KEY (user_id, tenant),
        FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant TEXT NOT NULL COLLATE NOCASE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_user_id
        ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS auth_user_tenants_tenant
        ON auth_user_tenants(tenant);
      CREATE TABLE IF NOT EXISTS auth_company_tenant_flows (
        flow_hash TEXT PRIMARY KEY,
        tenants_json TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_company_sessions (
        token_hash TEXT PRIMARY KEY,
        tenants_json TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  }

  createCompanyTenantFlow(token, tenants, expiresAt) {
    this.db
      .prepare(
        `INSERT INTO auth_company_tenant_flows (
          flow_hash, tenants_json, expires_at
        ) VALUES (?, ?, ?)`,
      )
      .run(hashToken(token), JSON.stringify(tenants), expiresAt);
  }

  getCompanyTenantFlow(token, now) {
    const row = this.db
      .prepare(
        `SELECT tenants_json FROM auth_company_tenant_flows
         WHERE flow_hash = ? AND expires_at > ?`,
      )
      .get(hashToken(token), now);
    return row ? JSON.parse(row.tenants_json) : null;
  }

  deleteCompanyTenantFlow(token) {
    this.db
      .prepare("DELETE FROM auth_company_tenant_flows WHERE flow_hash = ?")
      .run(hashToken(token));
  }

  registerCompanySession(token, tenants, expiresAt) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO auth_company_sessions (
          token_hash, tenants_json, expires_at
        ) VALUES (?, ?, ?)`,
      )
      .run(hashToken(token), JSON.stringify(tenants), expiresAt);
  }

  getCompanySessionTenants(token, now) {
    const row = this.db
      .prepare(
        `SELECT tenants_json FROM auth_company_sessions
         WHERE token_hash = ? AND expires_at > ?`,
      )
      .get(hashToken(token), now);
    return row ? JSON.parse(row.tenants_json) : null;
  }

  deleteCompanySession(token) {
    this.db
      .prepare("DELETE FROM auth_company_sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }

  createUser({ id, username, displayName, salt, hash, role, actorId, now, tenants }) {
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO auth_users (
            id, username, display_name, password_salt, password_hash,
            role, is_active, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(id, username, displayName, salt, hash, role, actorId, now, now);
      const addTenant = this.db.prepare(
        "INSERT INTO auth_user_tenants (user_id, tenant) VALUES (?, ?)",
      );
      for (const tenant of tenants) addTenant.run(id, tenant);
    });
    insert();
  }

  findUserById(userId) {
    return this.db.prepare("SELECT * FROM auth_users WHERE id = ?").get(userId);
  }

  findActiveUserByUsername(username) {
    return this.db
      .prepare("SELECT * FROM auth_users WHERE username = ? AND is_active = 1")
      .get(username);
  }

  getUserTenants(userId) {
    return this.db
      .prepare(
        "SELECT tenant FROM auth_user_tenants WHERE user_id = ? ORDER BY tenant",
      )
      .all(userId)
      .map((row) => row.tenant);
  }

  getPublicUser(userId) {
    const user = this.findUserById(userId);
    return user
      ? { ...publicUser(user), tenants: this.getUserTenants(user.id) }
      : null;
  }

  listAllUsers() {
    return this.db
      .prepare("SELECT * FROM auth_users ORDER BY username")
      .all()
      .map((user) => ({
        ...publicUser(user),
        tenants: this.getUserTenants(user.id),
      }));
  }

  listUsersByTenant(tenant) {
    return this.db
      .prepare(
        `SELECT u.* FROM auth_users u
         JOIN auth_user_tenants ut ON ut.user_id = u.id
         WHERE ut.tenant = ? ORDER BY u.username`,
      )
      .all(tenant)
      .map((user) => ({ ...publicUser(user), tenants: [tenant] }));
  }

  hasMembership(userId, tenant) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM auth_user_tenants WHERE user_id = ? AND tenant = ?",
        )
        .get(userId, tenant),
    );
  }

  deleteUser(userId) {
    this.db.prepare("DELETE FROM auth_users WHERE id = ?").run(userId);
  }

  deleteMembership(userId, tenant) {
    const remove = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM auth_sessions WHERE user_id = ? AND tenant = ?")
        .run(userId, tenant);
      this.db
        .prepare(
          "DELETE FROM auth_user_tenants WHERE user_id = ? AND tenant = ?",
        )
        .run(userId, tenant);
      const remaining = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM auth_user_tenants WHERE user_id = ?",
        )
        .get(userId).count;
      if (remaining === 0) this.deleteUser(userId);
    });
    remove();
  }

  createLocalSession({ token, userId, tenant, expiresAt, now }) {
    this.db
      .prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
      .run(now);
    this.db
      .prepare(
        `INSERT INTO auth_sessions (
          token_hash, user_id, tenant, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(hashToken(token), userId, tenant, expiresAt, now);
  }

  getLocalSession(token, now) {
    return this.db
      .prepare(
        `SELECT u.*, s.tenant AS session_tenant,
                s.expires_at AS session_expires_at
         FROM auth_sessions s
         JOIN auth_users u ON u.id = s.user_id
         JOIN auth_user_tenants ut
           ON ut.user_id = u.id AND ut.tenant = s.tenant
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
      )
      .get(hashToken(token), now);
  }

  deleteLocalSession(token) {
    this.db
      .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }

  close() {
    this.db.close();
  }
}
