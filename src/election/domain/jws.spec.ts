import { generateKeyPairSync, sign } from 'node:crypto';
import type { Ed25519Jwk } from './election-config';
import { verifyJws } from './jws';

// Par Ed25519 gerado no teste — nunca a chave do TSE.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const exported = publicKey.export({ format: 'jwk' }) as { x: string };
const JWK: Ed25519Jwk = { kty: 'OKP', crv: 'Ed25519', kid: 'kid-teste', x: exported.x };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function makeJws(payload: unknown, header: Record<string, unknown> = {}): string {
  const head = b64({ alg: 'EdDSA', kid: 'kid-teste', typ: 'JOSE', ...header });
  const body = b64(payload);
  const signature = sign(null, Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

describe('verifyJws (R-1, AC-02)', () => {
  it('aceita assinatura válida e devolve o payload', () => {
    expect(verifyJws(makeJws({ ele: '6258' }), JWK)).toEqual({
      ok: true,
      payload: { ele: '6258' },
    });
  });

  it('rejeita assinatura adulterada', () => {
    const [h, p, s] = makeJws({ ele: '6258' }).split('.');
    const tampered = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('A') ? 'B' : 'A'}A`;
    expect(verifyJws(tampered, JWK).ok).toBe(false);
  });

  it('rejeita payload adulterado', () => {
    const [h, , s] = makeJws({ ele: '6258' }).split('.');
    expect(verifyJws(`${h}.${b64({ ele: '9999' })}.${s}`, JWK)).toEqual({
      ok: false,
      reason: 'assinatura JWS inválida',
    });
  });

  it('rejeita alg diferente de EdDSA', () => {
    expect(verifyJws(makeJws({}, { alg: 'HS256' }), JWK).ok).toBe(false);
  });

  it('rejeita kid diferente do configurado', () => {
    expect(verifyJws(makeJws({}, { kid: 'outro' }), JWK).ok).toBe(false);
  });

  it('rejeita assinatura de outra chave', () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }) as {
      x: string;
    };
    expect(verifyJws(makeJws({ a: 1 }), { ...JWK, x: other.x }).ok).toBe(false);
  });

  it.each(['', 'a.b', 'a.b.c.d', 'a@.b.c', '{}.{}.{}'])('rejeita JWS malformado %p', (jws) => {
    expect(verifyJws(jws, JWK).ok).toBe(false);
  });

  it('rejeita payload que não é objeto', () => {
    expect(verifyJws(makeJws([1, 2]), JWK)).toEqual({
      ok: false,
      reason: 'payload JWS não é um objeto',
    });
  });
});
