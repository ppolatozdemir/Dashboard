import assert from "node:assert/strict";
import test from "node:test";
import { AuthService, ROLES } from "../src/lib/auth-service.js";
import {
  COMPANY_LOGIN_TENANTS,
  getAccessiblePages,
  getCompanyLoginTenant,
  getCompanyTenantOptions,
  getCompanyTenantScopes,
  PAGES,
} from "../src/auth/constants.js";
import {
  authorizeTaskProject,
  taskProjectKeysFor,
} from "../src/auth/task-policy.js";

const owner = {
  id: "owner-1",
  email: "owner@commercelab.com.tr",
  role: ROLES.OWNER_ADMIN,
  tenant: "CL",
  source: "commercelab",
  allowedTenants: ["KLD", "ABC", "HDV"],
};

function createService() {
  return new AuthService({ dbPath: ":memory:" });
}

function createResetService(notificationClient, options = {}) {
  return new AuthService({
    dbPath: ":memory:",
    notificationClient,
    passwordResetBypassLimits: false,
    ...options,
  });
}

test("CommerceLab login tenant options remain fixed and ordered", () => {
  assert.deepEqual(COMPANY_LOGIN_TENANTS, [
    "OLKA",
    "MCC",
    "SCH",
    "A101",
    "GRC",
    "MRDIY",
    "DEC",
    "CL",
    "HD",
  ]);
});

test("Tenant project mappings scope task creation and persist admin changes", () => {
  const service = createService();
  try {
    assert.deepEqual(taskProjectKeysFor({ tenant: "OLKA" }, service.repository), [
      "ASCS",
      "KLA",
      "OLK",
      "SKCH",
    ]);
    assert.deepEqual(taskProjectKeysFor({ tenant: "HDV" }, service.repository), [
      "HDV",
      "KFC",
    ]);
    assert.ok(taskProjectKeysFor({ tenant: "CL" }, service.repository).includes("MC"));
    assert.throws(
      () => authorizeTaskProject({ tenant: "HD" }, "MC", service.repository),
      /aktif tenantınız/,
    );

    service.repository.replaceTenantProjects(
      "MCC",
      [{ key: "OLK", name: "Olka" }],
      "owner-1",
    );
    assert.ok(!taskProjectKeysFor({ tenant: "OLKA" }, service.repository).includes("OLK"));
    assert.deepEqual(taskProjectKeysFor({ tenant: "MCC" }, service.repository), [
      "OLK",
    ]);
    service.repository.replaceTenantProjects("MCC", [], "owner-1");
    assert.deepEqual(taskProjectKeysFor({ tenant: "MCC" }, service.repository), []);
  } finally {
    service.close();
  }
});

test("page access follows the owner and tenant access plan", () => {
  assert.deepEqual(
    getAccessiblePages({ role: ROLES.OWNER_ADMIN, tenant: "CL" }),
    [
      PAGES.DAILY,
      PAGES.CLOSED,
      PAGES.RFR,
      PAGES.REJECT,
      PAGES.PROJECT_REPORT,
      PAGES.CREATE_TASK,
      PAGES.PROJECT_BOARD,
      PAGES.OLKA_SPRINT,
      PAGES.TENANT_MANAGEMENT,
    ],
  );

  const olkaAdminPages = getAccessiblePages({
    role: ROLES.TENANT_ADMIN,
    tenant: "OLKA",
  });
  assert.ok(olkaAdminPages.includes(PAGES.UNSPRINTED));
  assert.ok(olkaAdminPages.includes(PAGES.LABEL_SYNC));
  assert.ok(olkaAdminPages.includes(PAGES.OLKA_DEPLOY));
  assert.ok(olkaAdminPages.includes(PAGES.OLKA_ROADMAP));
  assert.ok(olkaAdminPages.includes(PAGES.OLKA_SPRINT));
  assert.ok(!olkaAdminPages.includes(PAGES.DAILY));

  const hdAdminPages = getAccessiblePages({
    role: ROLES.TENANT_ADMIN,
    tenant: "HD",
  });
  assert.ok(hdAdminPages.includes(PAGES.HDV_STATUS));
  assert.ok(!hdAdminPages.includes(PAGES.OLKA_DEPLOY));
  assert.ok(!hdAdminPages.includes(PAGES.OLKA_SPRINT));
  assert.ok(!hdAdminPages.includes(PAGES.CLOSED));

  const clTenantAdminPages = getAccessiblePages({
    role: ROLES.TENANT_ADMIN,
    tenant: "CL",
  });
  assert.ok(clTenantAdminPages.includes(PAGES.DAILY));
  assert.ok(clTenantAdminPages.includes(PAGES.CLOSED));
  assert.ok(clTenantAdminPages.includes(PAGES.OLKA_SPRINT));
  assert.ok(!clTenantAdminPages.includes(PAGES.TENANT_MANAGEMENT));
});

test("page middleware rejects pages outside the access plan", () => {
  const service = createService();
  const denied = { statusCode: null, body: null };
  let proceeded = false;

  service.requirePageAccess(PAGES.DAILY)(
    { auth: { role: ROLES.TENANT_ADMIN, tenant: "KLD" } },
    {
      status(code) {
        denied.statusCode = code;
        return this;
      },
      json(body) {
        denied.body = body;
      },
    },
    () => {
      proceeded = true;
    },
  );

  assert.equal(proceeded, false);
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.body, {
    error: "Bu sayfaya erişim yetkiniz yok",
  });
  service.close();
});

test("Password reset is enumeration-safe, rate limited, and revokes local sessions", async () => {
  const sent = [];
  const notificationClient = {
    async sendNotification(request) {
      sent.push(request);
    },
  };
  const service = createResetService(notificationClient);
  const actor = {
    ...owner,
    role: ROLES.OWNER_ADMIN,
  };
  try {
    const user = service.createUser(actor, {
      email: "reset@example.com",
      displayName: "Reset User",
      password: "old-password-123",
      role: ROLES.TENANT_ADMIN,
      tenants: ["KLD"],
    });

    const login = service.localLogin({
      email: "reset@example.com",
      password: "old-password-123",
      tenant: "KLD",
    });

    const response = await service.requestPasswordReset({
      email: "reset@example.com",
      requestIp: "127.0.0.1",
    });
    assert.match(response.message, /kayıtlıysa/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, "reset@example.com");
    await service.requestPasswordReset({
      email: "reset@example.com",
      requestIp: "127.0.0.1",
    });
    assert.equal(sent.length, 1);
    await service.requestPasswordReset({
      email: "nobody@example.com",
      requestIp: "127.0.0.1",
    });
    assert.equal(sent.length, 1);

    const verificationRequest = sent[0];
    const otpCode = verificationRequest.otpCode;
    const verification = await service.verifyPasswordReset({
      email: "reset@example.com",
      otpCode,
    });
    service.resetPassword({
      resetToken: verification.resetToken,
      password: "new-password-123",
    });
    assert.throws(
      () =>
        service.resetPassword({
          resetToken: verification.resetToken,
          password: "another-password-123",
        }),
      /geçersiz veya süresi dolmuş/,
    );
    assert.equal(service.getLocalSession(login.token), null);
    assert.equal(
      service.localLogin({
        email: "reset@example.com",
        password: "new-password-123",
        tenant: "KLD",
      }).kind,
      "authenticated",
    );
  } finally {
    service.close();
  }
});

test("Password reset limits can be bypassed explicitly", async () => {
  const sent = [];
  const service = createResetService(
    {
      async sendNotification(request) {
        sent.push(request);
      },
    },
    { passwordResetBypassLimits: true },
  );
  try {
    service.createUser(owner, {
      email: "bypass@example.com",
      displayName: "Bypass User",
      password: "old-password-123",
      role: ROLES.TENANT_ADMIN,
      tenants: ["KLD"],
    });

    await service.requestPasswordReset({
      email: "bypass@example.com",
      requestIp: "127.0.0.2",
    });
    await service.requestPasswordReset({
      email: "bypass@example.com",
      requestIp: "127.0.0.2",
    });

    assert.equal(sent.length, 2);
  } finally {
    service.close();
  }
});

test("User email updates are validated and scoped to the actor tenant", () => {
  const service = createService();
  try {
    const user = service.createUser(owner, {
      email: "old@example.com",
      displayName: "Editable User",
      password: "strong-pass-123",
      role: ROLES.TENANT_ADMIN,
      tenants: ["KLD"],
    });
    const tenantAdmin = {
      id: "tenant-admin",
      email: "admin@example.com",
      role: ROLES.TENANT_ADMIN,
      tenant: "KLD",
      source: "local",
    };
    assert.equal(
      service.updateUser(tenantAdmin, user.id, {
        email: "new@example.com",
      }).email,
      "new@example.com",
    );
    assert.throws(
      () =>
        service.updateUser(tenantAdmin, user.id, {
          email: "not-an-email",
        }),
      /Geçerli bir e-posta/,
    );
  } finally {
    service.close();
  }
});

test("OLKA and HD aliases resolve to their backend tenant scopes", () => {
  assert.equal(getCompanyLoginTenant("OLKA", ["KLD", "MCC"]), "KLD");
  assert.deepEqual(getCompanyTenantScopes("OLKA"), [
    "SKC",
    "SKCP",
    "ASC",
    "BRR",
    "HFV",
    "HTR",
    "KLD",
  ]);
  assert.equal(getCompanyLoginTenant("HD"), "HDV");
  assert.equal(getCompanyLoginTenant("HD", ["MCC", "CL"]), "CL");
  assert.equal(getCompanyLoginTenant("HD", ["MCC"]), "MCC");
  assert.deepEqual(getCompanyTenantScopes("HD"), ["HDV"]);
  assert.deepEqual(
    getCompanyTenantOptions(["MCC", "KLD", "SKC", "EVY"]),
    ["OLKA", "MCC", "HD"],
  );
});

test("OwnerAdmin creates a multi-tenant user and login requires tenant selection", () => {
  const service = createService();
  try {
    const user = service.createUser(owner, {
      email: "admin@example.com",
      displayName: "Tenant Admin",
      password: "strong-pass-123",
      role: ROLES.TENANT_ADMIN,
      tenants: ["KLD", "ABC"],
    });

    assert.deepEqual(user.tenants, ["ABC", "KLD"]);

    const firstStep = service.localLogin({
      email: "admin@example.com",
      password: "strong-pass-123",
    });
    assert.deepEqual(firstStep, {
      kind: "tenant",
      tenants: ["ABC", "KLD"],
    });

    const secondStep = service.localLogin({
      email: "admin@example.com",
      password: "strong-pass-123",
      tenant: "KLD",
    });
    assert.equal(secondStep.kind, "authenticated");
    assert.equal(secondStep.identity.role, ROLES.TENANT_ADMIN);
    assert.equal(secondStep.identity.tenant, "KLD");
    assert.equal(
      service.getLocalSession(secondStep.token).tenant,
      "KLD",
    );
  } finally {
    service.close();
  }
});

test("TenantAdmin creates users only for its own tenant", () => {
  const service = createService();
  const tenantAdmin = {
    id: "admin-1",
    email: "admin@example.com",
    role: ROLES.TENANT_ADMIN,
    tenant: "KLD",
    source: "local",
  };

  try {
    const created = service.createUser(tenantAdmin, {
      email: "admin2@example.com",
      displayName: "Second Admin",
      password: "strong-pass-123",
      role: ROLES.TENANT_ADMIN,
      tenants: ["KLD"],
    });
    assert.equal(created.role, ROLES.TENANT_ADMIN);
    assert.deepEqual(created.tenants, ["KLD"]);

    assert.throws(
      () =>
        service.createUser(tenantAdmin, {
          email: "admin3@example.com",
          displayName: "Other Tenant Admin",
          password: "strong-pass-123",
          role: ROLES.TENANT_ADMIN,
          tenants: ["ABC"],
        }),
      /Kullanıcı yalnız aktif tenant için oluşturulabilir/,
    );
  } finally {
    service.close();
  }
});

test("TenantAdmin lists only its own tenant users", () => {
  const service = createService();
  try {
    service.createUser(owner, {
      email: "admin@example.com",
      displayName: "Shared Admin",
      password: "strong-pass-123",
      role: ROLES.TENANT_ADMIN,
      tenants: ["KLD", "ABC"],
    });

    const users = service.listUsers({
      ...owner,
      role: ROLES.TENANT_ADMIN,
      tenant: "KLD",
      source: "local",
      allowedTenants: undefined,
    });
    assert.equal(users.length, 1);
    assert.equal(users[0].email, "admin@example.com");
  } finally {
    service.close();
  }
});

test("Removing a tenant membership invalidates its active local session", () => {
  const service = createService();
  try {
    const user = service.createUser(owner, {
      email: "admin@example.com",
      displayName: "Shared Admin",
      password: "strong-pass-123",
      role: ROLES.TENANT_ADMIN,
      tenants: ["KLD", "ABC"],
    });
    const login = service.localLogin({
      email: "admin@example.com",
      password: "strong-pass-123",
      tenant: "KLD",
    });

    service.deleteUser(
      {
        ...owner,
        role: ROLES.OWNER_ADMIN,
        tenant: "KLD",
      },
      user.id,
    );

    assert.equal(service.getLocalSession(login.token), null);
    assert.deepEqual(service.getPublicUser(user.id).tenants, ["ABC"]);
  } finally {
    service.close();
  }
});

test("Company token identity is accepted only after backend validation", async () => {
  const service = createService();
  const payload = {
    "__tenant__": "KLD",
    [ROLES_CLAIM]: ROLES.OWNER_ADMIN,
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name":
      "owner@commercelab.com.tr",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature-validated-by-backend",
  ].join(".");

  service.callUserService = async () => ({ status: 200, data: [] });

  try {
    const identity = await service.validateCompanyToken(token);
    assert.equal(identity.role, ROLES.OWNER_ADMIN);
    assert.equal(identity.tenantScope, null);
  } finally {
    service.close();
  }
});

test("OwnerAdmin role claim logs in without tenant-specific role lookup", async () => {
  const service = createService();
  const payload = {
    "__tenant__": "KLD",
    [ROLES_CLAIM]: ["Viewer", "owneradmin"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature-validated-by-backend",
  ].join(".");

  service.callUserService = async () => ({ status: 200, data: [] });

  try {
    const identity = await service.validateCompanyToken(token);
    assert.equal(identity.role, ROLES.OWNER_ADMIN);
    assert.equal(identity.tenant, "KLD");
    assert.equal(identity.tenantScope, null);
  } finally {
    service.close();
  }
});

test("CL TenantAdmin creates users within its allowed tenants", () => {
  const service = createService();
  const tenantAdmin = {
    id: "company-admin-1",
    email: "admin@commercelab.com.tr",
    role: ROLES.TENANT_ADMIN,
    tenant: "CL",
    source: "commercelab",
    allowedTenants: ["KLD", "MCC", "HDV"],
  };

  try {
    const created = service.createUser(tenantAdmin, {
      email: "mcc-admin@example.com",
      displayName: "MCC Admin",
      password: "strong-pass-123",
      role: ROLES.TENANT_ADMIN,
      tenants: ["MCC"],
    });
    assert.deepEqual(created.tenants, ["MCC"]);

    assert.throws(
      () =>
        service.createUser(tenantAdmin, {
          email: "other-admin@example.com",
          displayName: "Other Admin",
          password: "strong-pass-123",
          role: ROLES.TENANT_ADMIN,
          tenants: ["ABC"],
        }),
      /Seçilen tenant CommerceLab oturumunuz için yetkili değil/,
    );
  } finally {
    service.close();
  }
});

test("CL tenant sessions bypass tenant report restrictions", () => {
  const service = createService();
  const allow = service.requireTenantAccess("MCC");
  let proceeded = false;

  allow(
    { auth: { source: "local", tenant: "CL" } },
    {},
    () => {
      proceeded = true;
    },
  );

  assert.equal(proceeded, true);
  service.close();
});

test("CommerceLab MCC sessions access only their matching tenant report", () => {
  const service = createService();
  const allow = service.requireTenantAccess("HDV");
  const denied = { statusCode: null, body: null };

  allow(
    { auth: { source: "commercelab", tenant: "MCC" } },
    {
      status(code) {
        denied.statusCode = code;
        return this;
      },
      json(body) {
        denied.body = body;
      },
    },
    () => {
      throw new Error("Mismatched tenant should not proceed");
    },
  );

  assert.equal(denied.statusCode, 403);
  assert.match(denied.body.error, /HDV tenantı/);
  service.close();
});

test("MCC and HDV sessions access their matching tenant reports", () => {
  const service = createService();
  for (const tenant of ["MCC", "HDV"]) {
    let proceeded = false;
    service.requireTenantAccess(tenant)(
      { auth: { source: "commercelab", tenant } },
      {},
      () => {
        proceeded = true;
      },
    );
    assert.equal(proceeded, true);
  }
  service.close();
});

test("OLKA sessions access every grouped brand tenant", () => {
  const service = createService();
  for (const tenant of getCompanyTenantScopes("OLKA")) {
    let proceeded = false;
    service.requireTenantAccess(tenant)(
      { auth: { source: "commercelab", tenant: "OLKA" } },
      {},
      () => {
        proceeded = true;
      },
    );
    assert.equal(proceeded, true);
  }
  service.close();
});

test("Only OwnerAdmin can switch an active company tenant", () => {
  const service = createService();
  const token = "company-token";
  try {
    service.registerCompanySession(
      token,
      COMPANY_LOGIN_TENANTS,
      "OLKA",
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(
      service.switchCompanyTenant(token, owner, "HD"),
      "HD",
    );
    assert.equal(service.getCompanySession(token).activeTenant, "HD");
    assert.throws(
      () =>
        service.switchCompanyTenant(
          token,
          { ...owner, role: ROLES.TENANT_ADMIN },
          "MCC",
        ),
      /Tenant değiştirme yetkiniz yok/,
    );
  } finally {
    service.close();
  }
});

test("Non-CL tenant cannot create a user in another tenant", () => {
  const service = createService();
  try {
    assert.throws(
      () =>
        service.createUser(
          {
            id: "mcc-owner",
            email: "owner@mcc.example",
            role: ROLES.OWNER_ADMIN,
            tenant: "MCC",
            source: "commercelab",
            allowedTenants: ["MCC", "HDV"],
          },
          {
            email: "hdv-admin@example.com",
            displayName: "HDV Admin",
            password: "strong-pass-123",
            role: ROLES.TENANT_ADMIN,
            tenants: ["HDV"],
          },
        ),
      /yalnız aktif tenant/,
    );
  } finally {
    service.close();
  }
});

test("Local users cannot be assigned to the CL tenant", () => {
  const service = createService();
  try {
    assert.throws(
      () =>
        service.createUser(owner, {
          email: "cl-admin@example.com",
          displayName: "CL Admin",
          password: "strong-pass-123",
          role: ROLES.TENANT_ADMIN,
          tenants: ["CL"],
        }),
      /CL tenantına atanamaz/,
    );
  } finally {
    service.close();
  }
});

test("CommerceLab tenant flow persists and validates tenant options", () => {
  const service = createService();
  try {
    const flow = service.createCompanyTenantFlow(["mcc", "kld"]);
    assert.deepEqual(service.getCompanyTenantFlow(flow.token), ["MCC", "KLD"]);

    service.deleteCompanyTenantFlow(flow.token);
    assert.equal(service.getCompanyTenantFlow(flow.token), null);
  } finally {
    service.close();
  }
});

const ROLES_CLAIM =
  "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
