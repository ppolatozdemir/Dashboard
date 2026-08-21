import path from "path";
import { randomBytes, randomUUID } from "crypto";
import { UserServiceClient } from "./client.js";
import {
  GLOBAL_ACCESS_TENANT,
  getCompanyTenantScopes,
  hasPageAccess,
  ROLES,
} from "./constants.js";
import { parseCookies } from "./cookies.js";
import {
  hashPassword,
  hashToken,
  verifyPasswordOrDummy,
} from "./credentials.js";
import { AuthError } from "./error.js";
import { identityFromCompanyToken } from "./jwt.js";
import {
  hasGlobalTenantAccess,
  normalizeTenant,
  normalizeEmail,
  normalizeText,
} from "./normalization.js";
import { authorizeUserCreation } from "./policy.js";
import { AuthRepository } from "./repository.js";
import { NotificationClient } from "./notification-client.js";

export class AuthService {
  constructor({
    dbPath = process.env.AUTH_DB_PATH ||
      path.join(process.cwd(), "data", "auth.db"),
    userServiceUrl =
      process.env.USER_SERVICE_URL || "https://api.user.awstest.hebiar.com",
    applicationId = process.env.USER_SERVICE_APPLICATION_ID || "MainUI",
    authorizationScheme = process.env.USER_SERVICE_AUTH_SCHEME || "Bearer",
    sessionHours = Number(process.env.AUTH_SESSION_HOURS || 8),
    notificationClient = new NotificationClient(),
    passwordResetBypassLimits =
      process.env.PASSWORD_RESET_BYPASS_LIMITS === "true",
  } = {}) {
    this.repository = new AuthRepository(dbPath);
    this.db = this.repository.db;
    this.client = new UserServiceClient({
      userServiceUrl: userServiceUrl.replace(/\/$/, ""),
      applicationId,
      authorizationScheme,
    });
    this.userServiceUrl = this.client.userServiceUrl;
    this.applicationId = applicationId;
    this.authorizationScheme = authorizationScheme;
    this.sessionHours = sessionHours;
    this.notificationClient = notificationClient;
    this.passwordResetBypassLimits = passwordResetBypassLimits;
    this.companyCookie = "dashboard_company_token";
    this.companyTenantFlowCookie = "dashboard_company_tenant_flow";
    this.localCookie = "dashboard_session";
  }

  setupSchema() {
    this.repository.setupSchema();
  }

  createCompanyTenantFlow(tenants) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const normalizedTenants = [...new Set(tenants.map(normalizeTenant))];
    this.repository.createCompanyTenantFlow(
      token,
      normalizedTenants,
      expiresAt,
    );
    return { token, maxAge: 5 * 60 * 1000 };
  }

  getCompanyTenantFlow(token) {
    if (!token) return null;
    return this.repository.getCompanyTenantFlow(
      token,
      new Date().toISOString(),
    );
  }

  deleteCompanyTenantFlow(token) {
    if (token) this.repository.deleteCompanyTenantFlow(token);
  }

  registerCompanySession(token, tenants, activeTenant, expiresAt) {
    const normalizedTenants = [...new Set(tenants.map(normalizeTenant))];
    this.repository.registerCompanySession(
      token,
      normalizedTenants,
      normalizeTenant(activeTenant),
      expiresAt,
    );
  }

  getCompanySession(token) {
    return this.repository.getCompanySession(
      token,
      new Date().toISOString(),
    );
  }

  switchCompanyTenant(token, identity, tenant) {
    tenant = normalizeTenant(tenant);
    if (identity.role !== ROLES.OWNER_ADMIN) {
      throw new AuthError(403, "Tenant değiştirme yetkiniz yok");
    }
    const session = this.getCompanySession(token);
    if (!session || !session.tenants.includes(tenant)) {
      throw new AuthError(403, "Seçilen tenant bu oturum için yetkili değil");
    }
    if (!this.repository.setCompanySessionTenant(token, tenant)) {
      throw new AuthError(401, "Oturum sona erdi, tekrar giriş yapın");
    }
    return tenant;
  }

  cookieOptions(maxAge) {
    return {
      httpOnly: true,
      sameSite: "strict",
      secure:
        process.env.AUTH_COOKIE_SECURE === "true" ||
        process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    };
  }

  clearCookies(res) {
    const options = this.cookieOptions(0);
    res.clearCookie(this.companyCookie, options);
    res.clearCookie(this.companyTenantFlowCookie, options);
    res.clearCookie(this.localCookie, options);
  }

  logout(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    this.deleteLocalSession(cookies[this.localCookie]);
    if (cookies[this.companyCookie]) {
      this.repository.deleteCompanySession(cookies[this.companyCookie]);
    }
    this.deleteCompanyTenantFlow(cookies[this.companyTenantFlowCookie]);
    this.clearCookies(res);
  }

  getRequestCookies(req) {
    return parseCookies(req.headers.cookie);
  }

  async callUserService(endpoint, options = {}) {
    return this.client.call(endpoint, options);
  }

  async companyLogin({ email, password, tenant }) {
    email = normalizeEmail(email);
    tenant = normalizeText(tenant);
    if (!email || !password) {
      throw new AuthError(400, "E-posta ve şifre zorunludur");
    }
    const response = await this.callUserService("/Auth/login", {
      method: "POST",
      // The external CommerceLab API still names its email field "username".
      body: tenant
        ? { username: email, password, tenant }
        : { username: email, password },
    });
    const data = response.data || {};
    if (data.token) {
      return {
        kind: "authenticated",
        token: data.token,
        expire: data.expire,
        identity: await this.validateCompanyToken(data.token),
      };
    }
    if (data.status === 401 || response.status === 401) {
      throw new AuthError(401, "E-posta veya şifre hatalı");
    }
    if (Array.isArray(data.data) && data.data.length > 0) {
      return { kind: "tenant", tenants: data.data };
    }
    const serviceError = data.errorMessage || data.errorMesssage;
    throw new AuthError(
      response.status >= 400 ? response.status : 502,
      serviceError || "CommerceLab girişi tamamlanamadı",
    );
  }

  async validateCompanyToken(token) {
    const response = await this.callUserService("/Roles/GetRolesAsync", {
      token,
    });
    const serviceError =
      response.data?.errorMessage || response.data?.errorMesssage;
    if (response.status === 401 || response.data?.status === 401) {
      throw new AuthError(401, "Oturum sona erdi, tekrar giriş yapın");
    }
    if (
      response.status < 200 ||
      response.status >= 300 ||
      response.data?.isSuccess === false ||
      serviceError
    ) {
      throw new AuthError(502, "Token kimlik servisi tarafından doğrulanamadı");
    }
    return identityFromCompanyToken(token);
  }

  createUser(actor, input) {
    const user = authorizeUserCreation(actor, input);
    const now = new Date().toISOString();
    const id = randomUUID();
    const { salt, hash } = hashPassword(user.password);
    try {
      this.repository.createUser({
        id,
        ...user,
        salt,
        hash,
        actorId: actor.id || actor.email,
        now,
      });
    } catch (error) {
      if (
        error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
        error.message?.includes("auth_users.email")
      ) {
        throw new AuthError(409, "Bu e-posta adresi zaten tanımlı");
      }
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new AuthError(409, "Bu kullanıcı adı zaten tanımlı");
      }
      throw error;
    }
    return this.getPublicUser(id);
  }

  getUserTenants(userId) {
    return this.repository.getUserTenants(userId);
  }

  withTenants(user) {
    return { ...user, tenants: this.getUserTenants(user.id) };
  }

  getPublicUser(userId) {
    return this.repository.getPublicUser(userId);
  }

  listUsers(actor) {
    if (hasGlobalTenantAccess(actor)) {
      return this.repository.listAllUsers();
    }
    if (actor.role === ROLES.OWNER_ADMIN || actor.role === ROLES.TENANT_ADMIN) {
      return this.repository.listUsersByTenant(normalizeTenant(actor.tenant));
    }
    throw new AuthError(403, "Kullanıcı listesini görüntüleme yetkiniz yok");
  }

  deleteUser(actor, userId) {
    if (actor.role !== ROLES.OWNER_ADMIN) {
      throw new AuthError(403, "Kullanıcı silme yetkiniz yok");
    }

    const user = this.repository.findUserById(userId);
    if (!user) throw new AuthError(404, "Kullanıcı bulunamadı");
    if (actor.source === "local" && actor.id === user.id) {
      throw new AuthError(400, "Kendi kullanıcınızı silemezsiniz");
    }
    const tenant = normalizeTenant(actor.tenant);
    if (hasGlobalTenantAccess(actor)) {
      this.repository.deleteUser(userId);
      return;
    }
    this.repository.deleteMembership(userId, tenant);
  }

  updateUser(actor, userId, input) {
    if (actor.role !== ROLES.OWNER_ADMIN && actor.role !== ROLES.TENANT_ADMIN) {
      throw new AuthError(403, "Kullanıcı güncelleme yetkiniz yok");
    }
    const user = this.repository.findUserById(userId);
    if (!user) throw new AuthError(404, "Kullanıcı bulunamadı");
    if (
      !hasGlobalTenantAccess(actor) &&
      !this.repository.hasMembership(userId, normalizeTenant(actor.tenant))
    ) {
      throw new AuthError(403, "Kullanıcı bu tenant için yetkili değil");
    }
    const email = normalizeText(input.email).toLowerCase();
    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new AuthError(400, "Geçerli bir e-posta adresi girilmelidir");
    }
    try {
      this.repository.updateUserEmail(userId, email, new Date().toISOString());
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new AuthError(409, "Bu e-posta adresi zaten tanımlı");
      }
      throw error;
    }
    return this.getPublicUser(userId);
  }

  localLogin({ tenant, email, password }) {
    tenant = normalizeTenant(tenant);
    email = normalizeEmail(email);
    if (!email || !password) {
      throw new AuthError(400, "E-posta ve şifre zorunludur");
    }
    const user = this.repository.findActiveUserByEmail(email);
    if (!user || !verifyPasswordOrDummy(password, user)) {
      throw new AuthError(401, "E-posta veya şifre hatalı");
    }
    const tenants = this.getUserTenants(user.id);
    if (!tenant && tenants.length > 1) {
      return { kind: "tenant", tenants };
    }
    const selectedTenant = tenant || tenants[0];
    if (!selectedTenant || !tenants.includes(selectedTenant)) {
      throw new AuthError(403, "Kullanıcı seçilen tenant için yetkili değil");
    }
    return this.createLocalLogin(user, selectedTenant);
  }

  createLocalLogin(user, tenant) {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.sessionHours * 60 * 60 * 1000,
    );
    this.repository.createLocalSession({
      token,
      userId: user.id,
      tenant,
      expiresAt: expiresAt.toISOString(),
      now: now.toISOString(),
    });
    return {
      kind: "authenticated",
      token,
      maxAge: expiresAt.getTime() - now.getTime(),
      identity: this.identityFromLocalUser(
        user,
        tenant,
        expiresAt.toISOString(),
      ),
    };
  }

  identityFromLocalUser(user, tenant, expiresAt) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: ROLES.TENANT_ADMIN,
      tenant,
      source: "local",
      tenantScope: tenant,
      expiresAt,
    };
  }

  getLocalSession(token) {
    const row = this.repository.getLocalSession(token, new Date().toISOString());
    return row
      ? this.identityFromLocalUser(
          row,
          row.session_tenant,
          row.session_expires_at,
        )
      : null;
  }

  deleteLocalSession(token) {
    if (token) this.repository.deleteLocalSession(token);
  }

  async requestPasswordReset({ email, requestIp } = {}) {
    const normalizedEmail = normalizeText(email).toLowerCase();
    const genericResponse = {
      message:
        "E-posta adresi kayıtlıysa, şifre sıfırlama kodu gönderilecektir.",
    };
    if (
      !normalizedEmail ||
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      console.warn("[Password reset] Request ignored: invalid email format");
      return genericResponse;
    }

    const user = this.repository.findActiveUserByEmail(normalizedEmail);
    if (!user || user.role !== ROLES.TENANT_ADMIN) {
      console.warn("[Password reset] Request ignored: no eligible local TenantAdmin", {
        email: normalizedEmail,
        userFound: Boolean(user),
        role: user?.role,
      });
      return genericResponse;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const latest = this.repository.getLatestPasswordResetChallenge(
      normalizedEmail,
    );
    if (
      !this.passwordResetBypassLimits &&
      latest &&
      latest.resend_available_at > nowIso
    ) {
      console.warn("[Password reset] Request ignored: cooldown active", {
        email: normalizedEmail,
        resendAvailableAt: latest.resend_available_at,
      });
      return genericResponse;
    }
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    if (
      this.repository.countPasswordResetChallenges(normalizedEmail, hourAgo) >=
        5 ||
      this.repository.countPasswordResetChallengesByIp(requestIp, hourAgo) >= 20
    ) {
      console.warn("[Password reset] Request ignored: hourly limit reached", {
        email: normalizedEmail,
        requestIp,
      });
      return genericResponse;
    }

    const challenge = {
      id: randomUUID(),
      userId: user.id,
      email: normalizedEmail,
      createdAt: nowIso,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      resendAvailableAt: new Date(now.getTime() + 3 * 60 * 1000).toISOString(),
      requestIp,
    };
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    challenge.otpCodeHash = hashToken(otpCode);
    this.repository.invalidatePasswordResetChallenges(
      normalizedEmail,
      nowIso,
    );
    this.repository.createPasswordResetChallenge(challenge);
    try {
      console.info("[Password reset] Challenge created; sending notification", {
        email: normalizedEmail,
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt,
      });
      await this.notificationClient.sendNotification({
        email: normalizedEmail,
        otpCode,
      });
      console.info("[Password reset] Notification accepted by provider", {
        email: normalizedEmail,
        challengeId: challenge.id,
      });
    } catch (error) {
      console.error("[Password reset] Notification delivery failed", {
        email: normalizedEmail,
        challengeId: challenge.id,
        status: error.status,
        message: error.message,
      });
      this.repository.invalidatePasswordResetChallenges(
        normalizedEmail,
        new Date().toISOString(),
      );
    }
    return genericResponse;
  }

  async verifyPasswordReset({ email, otpCode } = {}) {
    const normalizedEmail = normalizeText(email).toLowerCase();
    const code = normalizeText(otpCode);
    const invalid = () => {
      throw new AuthError(400, "OTP kodu geçersiz veya süresi dolmuş");
    };
    if (
      !normalizedEmail ||
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      !code ||
      code.length > 32
    ) {
      return invalid();
    }
    const now = new Date();
    const nowIso = now.toISOString();
    const challenge = this.repository.getLatestPasswordResetChallenge(
      normalizedEmail,
    );
    if (
      !challenge ||
      !challenge.otp_code_hash ||
      (!this.passwordResetBypassLimits && challenge.expires_at <= nowIso) ||
      challenge.consumed_at ||
      challenge.verified_at ||
      (!this.passwordResetBypassLimits && challenge.attempt_count >= 5)
    ) {
      return invalid();
    }
    if (
      !this.repository.incrementPasswordResetAttempt(
        challenge.id,
        this.passwordResetBypassLimits,
      )
    ) {
      return invalid();
    }
    const verified = hashToken(code) === challenge.otp_code_hash;
    if (!verified) return invalid();
    const resetToken = randomBytes(32).toString("base64url");
    if (
      !this.repository.markPasswordResetVerified(
        challenge.id,
        hashToken(resetToken),
        nowIso,
      )
    ) {
      return invalid();
    }
    return {
      resetToken,
      expiresAt: challenge.expires_at,
    };
  }

  resetPassword({ resetToken, password } = {}) {
    const token = normalizeText(resetToken);
    if (!token || typeof password !== "string" || password.length < 10 || password.length > 200) {
      throw new AuthError(400, "Şifre 10-200 karakter arasında olmalıdır");
    }
    const challenge = this.repository.findPasswordResetByToken(
      hashToken(token),
      new Date().toISOString(),
      this.passwordResetBypassLimits,
    );
    if (!challenge) {
      throw new AuthError(400, "Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş");
    }
    const { salt, hash } = hashPassword(password);
    if (
      !this.repository.completePasswordReset({
        challengeId: challenge.id,
        userId: challenge.user_id,
        salt,
        hash,
        now: new Date().toISOString(),
      })
    ) {
      throw new AuthError(400, "Şifre sıfırlama işlemi tamamlanamadı");
    }
  }

  async authenticateRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const companyToken = cookies[this.companyCookie];
    if (companyToken) return this.authenticateCompanyToken(companyToken);
    const localToken = cookies[this.localCookie];
    if (localToken) {
      const identity = this.getLocalSession(localToken);
      if (identity) return identity;
    }
    throw new AuthError(401, "Oturum açmanız gerekiyor");
  }

  async authenticateCompanyToken(token) {
    const identity = await this.validateCompanyToken(token);
    const session = this.getCompanySession(token);
    if (session) {
      identity.allowedTenants = session.tenants;
      identity.tenant = session.activeTenant || identity.tenant;
    } else {
      identity.allowedTenants = [identity.tenant].filter(Boolean);
    }
    identity.tenantScope =
      normalizeTenant(identity.tenant) === GLOBAL_ACCESS_TENANT
        ? null
        : identity.tenant;
    return identity;
  }

  requireAuth = async (req, res, next) => {
    try {
      req.auth = await this.authenticateRequest(req);
      req.tenantScope = req.auth.tenantScope;
      next();
    } catch (error) {
      if (error.status === 401) this.clearCookies(res);
      this.sendError(res, error);
    }
  };

  requireWrite = (req, res, next) => {
    next();
  };

  requireTenantAccess = (tenant) => (req, res, next) => {
    const currentTenant = normalizeTenant(req.auth?.tenant);
    const tenantScopes = getCompanyTenantScopes(currentTenant);
    if (
      hasGlobalTenantAccess(req.auth) ||
      currentTenant === normalizeTenant(tenant) ||
      tenantScopes.includes(normalizeTenant(tenant))
    ) {
      return next();
    }
    return res.status(403).json({
      error: `${tenant} tenantı için erişim yetkiniz yok`,
    });
  };

  requirePageAccess = (page) => (req, res, next) => {
    if (hasPageAccess(req.auth, page)) return next();
    return res.status(403).json({
      error: "Bu sayfaya erişim yetkiniz yok",
    });
  };

  sendError(res, error) {
    const status = error instanceof AuthError ? error.status : 500;
    if (!(error instanceof AuthError)) console.error("Auth hatası:", error);
    return res.status(status).json({
      error:
        error instanceof AuthError
          ? error.message
          : "Kimlik doğrulama işlemi tamamlanamadı",
    });
  }

  close() {
    this.repository.close();
  }
}

export default new AuthService();
