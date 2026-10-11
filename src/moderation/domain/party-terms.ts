// Siglas e nomes dos partidos e federações registrados no TSE (spec sponsorship-image-moderation
// R-4 D-5). Lista neutra: todos os partidos recebem o mesmo tratamento. Constante do domínio
// versionada com `policy_version`. Puro — sem NestJS, Prisma nem SDK.

export interface PartyTerm {
  /** Sigla ou nome por extenso, como escrito (a comparação normaliza acento e caixa). */
  term: string;
  /**
   * Coincide com palavra comum (`NOVO`, `REDE`, `UP`…): só casa se aparecer em MAIÚSCULAS na
   * linha original lida.
   */
  ambiguous?: boolean;
}

export const PARTY_TERMS: readonly PartyTerm[] = [
  // Siglas
  { term: 'MDB' },
  { term: 'PT' },
  { term: 'PSDB' },
  { term: 'PP' },
  { term: 'PDT' },
  { term: 'PTB' },
  { term: 'PL' },
  { term: 'PSB' },
  { term: 'PSD' },
  { term: 'PSOL' },
  { term: 'PCdoB' },
  { term: 'PC do B' },
  { term: 'PV' },
  { term: 'PRD' },
  { term: 'PMB' },
  { term: 'PRTB' },
  { term: 'PCB' },
  { term: 'PCO' },
  { term: 'PSTU' },
  { term: 'PMN' },
  { term: 'UNIÃO', ambiguous: true },
  { term: 'REPUBLICANOS', ambiguous: true },
  { term: 'PODE', ambiguous: true },
  { term: 'CIDADANIA', ambiguous: true },
  { term: 'AVANTE', ambiguous: true },
  { term: 'SOLIDARIEDADE', ambiguous: true },
  { term: 'NOVO', ambiguous: true },
  { term: 'REDE', ambiguous: true },
  { term: 'DC', ambiguous: true },
  { term: 'AGIR', ambiguous: true },
  { term: 'MOBILIZA', ambiguous: true },
  { term: 'UP', ambiguous: true },
  { term: 'MISSÃO', ambiguous: true },
  // Nomes por extenso (os iniciados por "Partido" já caem no termo fixo `partido`)
  { term: 'Movimento Democrático Brasileiro' },
  { term: 'Social Democracia Brasileira' },
  { term: 'União Brasil' },
  { term: 'Socialismo e Liberdade' },
  { term: 'Rede Sustentabilidade' },
  { term: 'Democracia Cristã' },
  { term: 'Renovação Democrática' },
  { term: 'Unidade Popular' },
  { term: 'Federação Brasil da Esperança' },
  { term: 'Brasil da Esperança' },
  { term: 'Progressistas', ambiguous: true },
  { term: 'Podemos', ambiguous: true },
];
