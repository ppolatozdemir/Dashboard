import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

const DUMMY_PASSWORD_SALT = "91f669a9eea36749fe28fcee7632556d";
const DUMMY_PASSWORD_HASH = scryptSync(
  "dashboard-dummy-password",
  DUMMY_PASSWORD_SALT,
  64,
).toString("hex");

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyPasswordOrDummy(password, user) {
  return user
    ? verifyPassword(password, user.password_salt, user.password_hash)
    : verifyPassword(password, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH);
}
