import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const scryptParams = { N: 16384, r: 8, p: 1, keyLength: 32 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, scryptParams.N, scryptParams.r, scryptParams.p, scryptParams.keyLength);
  return ["scrypt", scryptParams.N, scryptParams.r, scryptParams.p, salt.toString("base64"), derived.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) {
    return false;
  }

  const parts = stored.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, n, r, p, saltText, hashText] = parts;
  const expected = Buffer.from(hashText, "base64");

  try {
    const derived = await derive(password, Buffer.from(saltText, "base64"), Number(n), Number(r), Number(p), expected.length);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
