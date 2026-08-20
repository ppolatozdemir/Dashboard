import assert from "node:assert/strict";
import test from "node:test";
import { AuthService, ROLES } from "../src/lib/auth-service.js";
import { COMPANY_LOGIN_TENANTS } from "../src/auth/constants.js";

const owner = {
  id: "owner-1",
  username: "owner@commercelab.com.tr",
  role: ROLES.OWNER_ADMIN,
  tenant: "CL",
  source: "commercelab",
  allowedTenants: ["KLD", "ABC", "HDV"],
};

function createService() {
  return new AuthService({ dbPath: ":memory:" });
}

test("CommerceLab login tenant options remain fixed and ordered", () => {
  assert.deepEqual(COMPANY_LOGIN_TENANTS, [
    "MCC",
    "SCH",
    "A101",
    "GRC",
    "ASC",
    "KLD",
    "BRR",
    "SKCP",
    "EVY",
    "SKC",
    "MRDIY",
    "DEC",
    "LWR",
    "AK",
    "FA",
    "HFV",
    "CL",
    "HTR",
  ]);
});

test("OwnerAdmin creates a multi-tenant user and login requires tenant selection", () => {
  const service = createService();
  try {
    const user = service.createUser(owner, {
      username: "admin@example.com",
      displayName: "Tenant Admin",
      password: "strong-pass-123",
      role: ROLES.TENANT_ADMIN,
      tenants: ["KLD", "ABC"],
    });

    assert.deepEqual(user.tenants, ["ABC", "KLD"]);

    const firstStep = service.localLogin({
      username: "admin@example.com",
      password: "strong-pass-123",
    });
    assert.deepEqual(firstStep, {
      kind: "tenant",
      tenants: ["ABC", "KLD"],
    });

    const secondStep = service.localLogin({
      username: "admin@example.com",
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

test("TenantAdmin can create only TenantUser in the active tenant", () => {
  const service = createService();
  const tenantAdmin = {
    id: "admin-1",
    username: "admin@example.com",
    role: ROLES.TENANT_ADMIN,
    tenant: "KLD",
    source: "local",
  };

  try {
    const user = service.createUser(tenantAdmin, {
      username: "reader@example.com",
      displayName: "Tenant Reader",
      password: "strong-pass-123",
      role: ROLES.TENANT_USER,
      tenants: ["KLD"],
    });
    assert.deepEqual(user.tenants, ["KLD"]);

    assert.throws(
      () =>
        service.createUser(tenantAdmin, {
          username: "other@example.com",
          displayName: "Other Tenant",
          password: "strong-pass-123",
          role: ROLES.TENANT_USER,
          tenants: ["ABC"],
        }),
      /yalnız aktif tenant/,
    );

    assert.throws(
      () =>
        service.createUser(tenantAdmin, {
          username: "admin2@example.com",
          displayName: "Second Admin",
          password: "strong-pass-123",
          role: ROLES.TENANT_ADMIN,
          tenants: ["KLD"],
        }),
      /yalnız TenantUser/,
    );
  } finally {
    service.close();
  }
});

test("TenantAdmin listing exposes only the active tenant membership", () => {
  const service = createService();
  try {
    service.createUser(owner, {
      username: "reader@example.com",
      displayName: "Shared Reader",
      password: "strong-pass-123",
      role: ROLES.TENANT_USER,
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
    assert.deepEqual(users[0].tenants, ["KLD"]);
  } finally {
    service.close();
  }
});

test("Removing a tenant membership invalidates its active local session", () => {
  const service = createService();
  try {
    const user = service.createUser(owner, {
      username: "reader@example.com",
      displayName: "Shared Reader",
      password: "strong-pass-123",
      role: ROLES.TENANT_USER,
      tenants: ["KLD", "ABC"],
    });
    const login = service.localLogin({
      username: "reader@example.com",
      password: "strong-pass-123",
      tenant: "KLD",
    });

    service.deleteUser(
      {
        ...owner,
        role: ROLES.TENANT_ADMIN,
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

test("CL TenantAdmin creates TenantUser in an allowed tenant", () => {
  const service = createService();
  const tenantAdmin = {
    id: "company-admin-1",
    username: "admin@commercelab.com.tr",
    role: ROLES.TENANT_ADMIN,
    tenant: "CL",
    source: "commercelab",
    allowedTenants: ["KLD", "MCC", "HDV"],
  };

  try {
    const user = service.createUser(tenantAdmin, {
      username: "mcc-reader@example.com",
      displayName: "MCC Reader",
      password: "strong-pass-123",
      role: ROLES.TENANT_USER,
      tenants: ["MCC"],
    });
    assert.deepEqual(user.tenants, ["MCC"]);

    assert.throws(
      () =>
        service.createUser(tenantAdmin, {
          username: "other-reader@example.com",
          displayName: "Other Reader",
          password: "strong-pass-123",
          role: ROLES.TENANT_USER,
          tenants: ["ABC"],
        }),
      /CommerceLab oturumunuz için yetkili değil/,
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

test("Non-CL tenant cannot create a user in another tenant", () => {
  const service = createService();
  try {
    assert.throws(
      () =>
        service.createUser(
          {
            id: "mcc-owner",
            username: "owner@mcc.example",
            role: ROLES.OWNER_ADMIN,
            tenant: "MCC",
            source: "commercelab",
            allowedTenants: ["MCC", "HDV"],
          },
          {
            username: "hdv-reader@example.com",
            displayName: "HDV Reader",
            password: "strong-pass-123",
            role: ROLES.TENANT_USER,
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
          username: "cl-reader@example.com",
          displayName: "CL Reader",
          password: "strong-pass-123",
          role: ROLES.TENANT_USER,
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
