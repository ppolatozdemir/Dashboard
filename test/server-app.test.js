import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/server/app.js";

async function withServer(run) {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("health remains public", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("LAB Board logo is served from public emblems", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/amblems/LAB.png`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^image\//);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  });
});

test("protected API rejects anonymous requests", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Oturum açmanız gerekiyor",
    });
  });
});
