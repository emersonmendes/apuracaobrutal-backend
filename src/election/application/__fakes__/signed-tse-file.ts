// Gera arquivos EA20 assinados com uma chave de TESTE (nunca a do TSE). Dados de teste.
import { generateKeyPairSync, sign } from 'node:crypto';
import type { Ed25519Jwk, Scope } from '../../domain/election-config';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

export const TEST_JWK: Ed25519Jwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  kid: 'kid-teste',
  x: (publicKey.export({ format: 'jwk' }) as { x: string }).x,
};

export interface FileOptions {
  scope?: Scope;
  ele?: string;
  idg?: string;
  /** `dd/mm/aaaa hh:mm:ss` de geração. */
  generated?: string;
  /** `dd/mm/aaaa hh:mm:ss` de totalização, ou vazio. */
  totalized?: string;
  and?: 'n' | 'p' | 'f';
  tf?: 's' | 'n';
  dv?: 's' | 'n';
  f?: 'o' | 's';
  pst?: string;
  redPct?: string;
  bluePct?: string;
}

const pctOf = (raw: string) => Number(raw.replace(',', '.'));

export function tsePayload(options: FileOptions = {}): Record<string, unknown> {
  const {
    scope = 'br',
    ele = '6258',
    idg = '1',
    generated = '25/10/2026 20:00:00',
    totalized = '25/10/2026 19:59:00',
    and = 'p',
    tf = 'n',
    dv = 's',
    f = 'o',
    pst = '40,000000000',
    redPct = '52,500000000',
    bluePct = '47,500000000',
  } = options;
  const [dg, hg] = generated.split(' ');
  const [dt, ht] = totalized ? totalized.split(' ') : ['', ''];
  const cand = (n: string, sqcand: string, nmu: string, pct: string) => ({
    n,
    sqcand,
    nm: nmu,
    nmu,
    e: 'n',
    st: '',
    vap: String(Math.round(pctOf(pct) * 1000)),
    pvap: pct,
    pvapn: pct,
  });
  return {
    ele,
    t: '2',
    f,
    sup: 'n',
    tpabr: scope === 'br' ? 'br' : 'uf',
    cdabr: scope,
    dg,
    hg,
    idg,
    dt,
    ht,
    dv,
    tf,
    and,
    carg: [
      {
        cd: '1',
        agr: [
          {
            par: [
              {
                n: '22',
                sg: 'PL',
                cand: [cand('22', '280002551544', 'FLAVIO BOLSONARO', bluePct)],
              },
            ],
          },
          { par: [{ n: '13', sg: 'PT', cand: [cand('13', '280002542548', 'LULA', redPct)] }] },
        ],
      },
    ],
    s: { ts: '1000', st: '400', pst, pstn: pst, snt: '600' },
    e: { te: scope === 'sp' ? '34000000' : '1000000' },
    v: { vv: '100000' },
  };
}

export function signPayload(payload: unknown): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = b64({ kid: TEST_JWK.kid, typ: 'JOSE', alg: 'EdDSA' });
  const body = b64(payload);
  const signature = sign(null, Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

export function signedFile(options: FileOptions = {}): string {
  return signPayload(tsePayload(options));
}
