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
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('TenantAdmin')),
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
        active_tenant TEXT,
        expires_at TEXT NOT NULL
      );
    `);
    const companySessionColumns = this.db
      .prepare("PRAGMA table_info(auth_company_sessions)")
      .all();
    if (!companySessionColumns.some((column) => column.name === "active_tenant")) {
      this.db.exec(
        "ALTER TABLE auth_company_sessions ADD COLUMN active_tenant TEXT",
      );
    }
    const userColumns = this.db
      .prepare("PRAGMA table_info(auth_users)")
      .all();
    if (userColumns.some((column) => column.name === "username")) {
      this.migrateUsersToEmailIdentity();
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_password_reset_challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resend_available_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        verified_at TEXT,
        reset_token_hash TEXT,
        notification_otp_id TEXT,
        customer_id TEXT,
        order_id TEXT,
        otp_code_hash TEXT,
        consumed_at TEXT,
        request_ip TEXT,
        FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS auth_password_reset_challenges_email
        ON auth_password_reset_challenges(email, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS auth_password_reset_challenges_token
        ON auth_password_reset_challenges(reset_token_hash)
        WHERE reset_token_hash IS NOT NULL;
    `);
    const challengeColumns = this.db
      .prepare("PRAGMA table_info(auth_password_reset_challenges)")
      .all();
    const challengeMigrations = [
      ["notification_otp_id", "TEXT"],
      ["customer_id", "TEXT"],
      ["order_id", "TEXT"],
      ["otp_code_hash", "TEXT"],
    ];
    for (const [name, type] of challengeMigrations) {
      if (!challengeColumns.some((column) => column.name === name)) {
        this.db.exec(
          `ALTER TABLE auth_password_reset_challenges ADD COLUMN ${name} ${type}`,
        );
      }
    }
    this.db.prepare("DELETE FROM auth_users WHERE role = 'TenantUser'").run();
  }

  migrateUsersToEmailIdentity() {
    this.db.pragma("foreign_keys = OFF");
    try {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE auth_users_email_identity (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('TenantAdmin')),
            is_active INTEGER NOT NULL DEFAULT 1,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          INSERT INTO auth_users_email_identity (
            id, email, display_name, password_salt, password_hash,
            role, is_active, created_by, created_at, updated_at
          )
          SELECT
            id, LOWER(username), display_name, password_salt, password_hash,
            role, is_active, created_by, created_at, updated_at
          FROM auth_users
          WHERE role = 'TenantAdmin';
          DROP TABLE auth_users;
          ALTER TABLE auth_users_email_identity RENAME TO auth_users;
        `);
      })();
    } finally {
      this.db.pragma("foreign_keys = ON");
    }
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

  registerCompanySession(token, tenants, activeTenant, expiresAt) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO auth_company_sessions (
          token_hash, tenants_json, active_tenant, expires_at
        ) VALUES (?, ?, ?, ?)`,
      )
      .run(hashToken(token), JSON.stringify(tenants), activeTenant, expiresAt);
  }

  getCompanySession(token, now) {
    const row = this.db
      .prepare(
        `SELECT tenants_json, active_tenant FROM auth_company_sessions
         WHERE token_hash = ? AND expires_at > ?`,
      )
      .get(hashToken(token), now);
    return row
      ? {
          tenants: JSON.parse(row.tenants_json),
          activeTenant: row.active_tenant,
        }
      : null;
  }

  setCompanySessionTenant(token, tenant) {
    return this.db
      .prepare(
        "UPDATE auth_company_sessions SET active_tenant = ? WHERE token_hash = ?",
      )
      .run(tenant, hashToken(token)).changes;
  }

  deleteCompanySession(token) {
    this.db
      .prepare("DELETE FROM auth_company_sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }

  createUser({
    id,
    email,
    displayName,
    salt,
    hash,
    role,
    actorId,
    now,
    tenants,
  }) {
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO auth_users (
            id, email, display_name, password_salt, password_hash,
            role, is_active, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(
          id,
          email,
          displayName,
          salt,
          hash,
          role,
          actorId,
          now,
          now,
        );
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

  findActiveUserByEmail(email) {
    return this.db
      .prepare("SELECT * FROM auth_users WHERE email = ? AND is_active = 1")
      .get(email);
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
      .prepare("SELECT * FROM auth_users ORDER BY email")
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
         WHERE ut.tenant = ? ORDER BY u.email`,
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

  deleteLocalSessionsForUser(userId) {
    this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
  }

  updateUserEmail(userId, email, now) {
    return this.db
      .prepare(
        "UPDATE auth_users SET email = ?, updated_at = ? WHERE id = ?",
      )
      .run(email, now, userId).changes;
  }

  getLatestPasswordResetChallenge(email) {
    return this.db
      .prepare(
        `SELECT * FROM auth_password_reset_challenges
         WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(email);
  }

  countPasswordResetChallenges(email, since) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM auth_password_reset_challenges
         WHERE email = ? AND created_at >= ?`,
      )
      .get(email, since).count;
  }

  countPasswordResetChallengesByIp(requestIp, since) {
    if (!requestIp) return 0;
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM auth_password_reset_challenges
         WHERE request_ip = ? AND created_at >= ?`,
      )
      .get(requestIp, since).count;
  }

  createPasswordResetChallenge(challenge) {
    this.db
      .prepare(
        `INSERT INTO auth_password_reset_challenges (
          id, user_id, email, created_at, expires_at, resend_available_at,
          request_ip, notification_otp_id, customer_id, order_id, otp_code_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      )
      .run(
        challenge.id,
        challenge.userId,
        challenge.email,
        challenge.createdAt,
        challenge.expiresAt,
        challenge.resendAvailableAt,
        challenge.requestIp || null,
        challenge.notificationOtpId || null,
        challenge.customerId || null,
        challenge.orderId || null,
        challenge.otpCodeHash || null,
      );
  }

  setPasswordResetNotification(challengeId, notificationOtpId) {
    return this.db
      .prepare(
        "UPDATE auth_password_reset_challenges SET notification_otp_id = ? WHERE id = ?",
      )
      .run(notificationOtpId, challengeId).changes;
  }

  setPasswordResetOtpHash(challengeId, otpCodeHash) {
    return this.db
      .prepare(
        "UPDATE auth_password_reset_challenges SET otp_code_hash = ? WHERE id = ?",
      )
      .run(otpCodeHash, challengeId).changes;
  }

  invalidatePasswordResetChallenges(email, now) {
    this.db
      .prepare(
        `UPDATE auth_password_reset_challenges
         SET consumed_at = COALESCE(consumed_at, ?)
         WHERE email = ? AND consumed_at IS NULL`,
      )
      .run(now, email);
  }

  incrementPasswordResetAttempt(id, bypassLimit = false) {
    return this.db
      .prepare(
        `UPDATE auth_password_reset_challenges
         SET attempt_count = attempt_count + 1
         WHERE id = ? AND consumed_at IS NULL
           AND verified_at IS NULL
           AND (? = 1 OR attempt_count < 5)`,
      )
      .run(id, bypassLimit ? 1 : 0).changes;
  }

  markPasswordResetVerified(id, resetTokenHash, now) {
    return this.db
      .prepare(
        `UPDATE auth_password_reset_challenges
         SET verified_at = ?, reset_token_hash = ?
         WHERE id = ? AND consumed_at IS NULL AND verified_at IS NULL`,
      )
      .run(now, resetTokenHash, id).changes;
  }

  findPasswordResetByToken(tokenHash, now, bypassExpiry = false) {
    return this.db
      .prepare(
        `SELECT * FROM auth_password_reset_challenges
         WHERE reset_token_hash = ? AND verified_at IS NOT NULL
           AND consumed_at IS NULL
           AND (? = 1 OR expires_at > ?)`,
      )
      .get(tokenHash, bypassExpiry ? 1 : 0, now);
  }

  completePasswordReset({ challengeId, userId, salt, hash, now }) {
    const complete = this.db.transaction(() => {
      const challenge = this.db
        .prepare(
          `UPDATE auth_password_reset_challenges
           SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
        )
        .run(now, challengeId);
      if (challenge.changes !== 1) return false;
      const result = this.db
        .prepare(
          `UPDATE auth_users
           SET password_salt = ?, password_hash = ?, updated_at = ?
           WHERE id = ? AND is_active = 1`,
        )
        .run(salt, hash, now, userId);
      if (result.changes !== 1) return false;
      this.deleteLocalSessionsForUser(userId);
      return true;
    });
    return complete();
  }

  close() {
    this.db.close();
  }
}
