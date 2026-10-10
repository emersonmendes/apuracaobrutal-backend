// Verificação JWS dos arquivos do TSE (spec election-results-feed R-1). A chave vem só da
// configuração — nunca do próprio arquivo.
import { createPublicKey, verify } from 'node:crypto';
import type { Ed25519Jwk } from './election-config';

export type JwsOutcome = { ok: true; payload: unknown } | { ok: false; reason: string };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function decodeJson(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/** Verifica um JWS compacto (EdDSA/Ed25519) e devolve o payload JSON decodificado. */
export function verifyJws(compact: string, jwk: Ed25519Jwk): JwsOutcome {
  const parts = compact.trim().split('.');
  if (parts.length !== 3 || parts.some((part) => !BASE64URL.test(part))) {
    return { ok: false, reason: 'JWS malformado' };
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: unknown;
  try {
    header = decodeJson(headerPart);
  } catch {
    return { ok: false, reason: 'cabeçalho JWS inválido' };
  }
  if (typeof header !== 'object' || header === null) {
    return { ok: false, reason: 'cabeçalho JWS inválido' };
  }
  const { alg, kid } = header as Record<string, unknown>;
  if (alg !== 'EdDSA') return { ok: false, reason: `alg "${String(alg)}" não suportado` };
  if (kid !== jwk.kid) return { ok: false, reason: `kid "${String(kid)}" ≠ chave configurada` };

  let valid: boolean;
  try {
    const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: 'jwk' });
    valid = verify(
      null,
      Buffer.from(`${headerPart}.${payloadPart}`, 'ascii'),
      key,
      Buffer.from(signaturePart, 'base64url'),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'assinatura JWS inválida' };

  let payload: unknown;
  try {
    payload = decodeJson(payloadPart);
  } catch {
    return { ok: false, reason: 'payload JWS não é JSON' };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, reason: 'payload JWS não é um objeto' };
  }
  return { ok: true, payload };
}
