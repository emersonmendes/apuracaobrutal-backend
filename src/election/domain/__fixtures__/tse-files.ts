// Fixtures derivadas de arquivos EA20 reais do TSE, baixados em 10/10/2026 (spec
// election-results-feed AC-03/AC-04). Reduzidas: só os candidatos usados nos testes e os campos
// lidos pela normalização. São dados de teste, não exibidos ao usuário.

/** Origem: https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json */
export const BR_6258_NOT_STARTED = {
  ele: '6258',
  t: '2',
  f: 'o',
  tpabr: 'br',
  cdabr: 'br',
  dg: '10/10/2026',
  hg: '12:55:44',
  idg: '3396337',
  dt: '',
  ht: '',
  dv: 's',
  tf: 'n',
  and: 'n',
  carg: [
    {
      cd: '1',
      nmn: 'Presidente',
      nv: '1',
      agr: [
        {
          n: '280001801177',
          nm: 'PARTIDO LIBERAL',
          tp: 'i',
          par: [
            {
              n: '22',
              sg: 'PL',
              nm: 'PARTIDO LIBERAL',
              cand: [
                {
                  n: '22',
                  sqcand: '280002551544',
                  nm: 'FLAVIO NANTES BOLSONARO',
                  nmu: 'FLAVIO BOLSONARO',
                  seq: '2',
                  e: 'n',
                  st: '',
                  vap: '0',
                  pvap: '0,00',
                  pvapn: '0',
                },
              ],
            },
          ],
        },
        {
          n: '280001800617',
          nm: 'BRASIL PRONTO PRA MAIS',
          tp: 'c',
          par: [
            {
              n: '13',
              sg: 'PT',
              nm: 'PARTIDO DOS TRABALHADORES',
              cand: [
                {
                  n: '13',
                  sqcand: '280002542548',
                  nm: 'LUIZ INÁCIO LULA DA SILVA',
                  nmu: 'LULA',
                  seq: '1',
                  e: 'n',
                  st: '',
                  vap: '0',
                  pvap: '0,00',
                  pvapn: '0',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  s: {
    ts: '393882',
    st: '0',
    pst: '0,00',
    pstn: '0',
    snt: '393882',
  },
  e: {
    te: '126154240',
    est: '0',
  },
  v: {
    tv: '0',
    vv: '0',
    pvv: '0,00',
  },
};

/** Origem: https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp-c0001-e006258-u.json */
export const SP_6258_NOT_STARTED = {
  ele: '6258',
  t: '2',
  f: 'o',
  tpabr: 'uf',
  cdabr: 'sp',
  dg: '09/10/2026',
  hg: '17:32:25',
  idg: '3383734',
  dt: '',
  ht: '',
  dv: 's',
  tf: 'n',
  and: 'n',
  carg: [
    {
      cd: '1',
      nmn: 'Presidente',
      nv: '1',
      agr: [
        {
          n: '280001801177',
          nm: 'PARTIDO LIBERAL',
          tp: 'i',
          par: [
            {
              n: '22',
              sg: 'PL',
              nm: 'PARTIDO LIBERAL',
              cand: [
                {
                  n: '22',
                  sqcand: '280002551544',
                  nm: 'FLAVIO NANTES BOLSONARO',
                  nmu: 'FLAVIO BOLSONARO',
                  seq: '2',
                  e: 'n',
                  st: '',
                  vap: '0',
                  pvap: '0,00',
                  pvapn: '0',
                },
              ],
            },
          ],
        },
        {
          n: '280001800617',
          nm: 'BRASIL PRONTO PRA MAIS',
          tp: 'c',
          par: [
            {
              n: '13',
              sg: 'PT',
              nm: 'PARTIDO DOS TRABALHADORES',
              cand: [
                {
                  n: '13',
                  sqcand: '280002542548',
                  nm: 'LUIZ INÁCIO LULA DA SILVA',
                  nmu: 'LULA',
                  seq: '1',
                  e: 'n',
                  st: '',
                  vap: '0',
                  pvap: '0,00',
                  pvapn: '0',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  s: {
    ts: '33403',
    st: '0',
    pst: '0,00',
    pstn: '0',
    snt: '33403',
  },
  e: {
    te: '10847521',
    est: '0',
  },
  v: {
    tv: '0',
    vv: '0',
    pvv: '0,00',
  },
};

/** Origem: https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json */
export const BR_6257_FINAL = {
  ele: '6257',
  t: '1',
  f: 'o',
  tpabr: 'br',
  cdabr: 'br',
  dg: '05/10/2026',
  hg: '12:51:47',
  idg: '2837531',
  dt: '05/10/2026',
  ht: '12:51:05',
  dv: 's',
  tf: 's',
  and: 'f',
  esae: 'n',
  carg: [
    {
      cd: '1',
      nmn: 'Presidente',
      nv: '1',
      agr: [
        {
          n: '280001801177',
          nm: 'PARTIDO LIBERAL',
          tp: 'i',
          par: [
            {
              n: '22',
              sg: 'PL',
              nm: 'PARTIDO LIBERAL',
              cand: [
                {
                  n: '22',
                  sqcand: '280002551544',
                  nm: 'FLAVIO NANTES BOLSONARO',
                  nmu: 'FLAVIO BOLSONARO',
                  dvt: 'Válido',
                  seq: '1',
                  e: 's',
                  st: '2º turno',
                  vap: '56104503',
                  pvap: '47,03',
                  pvapn: '47,027772356',
                },
              ],
            },
          ],
        },
        {
          n: '280001801222',
          nm: 'PARTIDO SOCIAL DEMOCRÁTICO',
          tp: 'i',
          par: [
            {
              n: '55',
              sg: 'PSD',
              nm: 'PARTIDO SOCIAL DEMOCRÁTICO',
              cand: [
                {
                  n: '55',
                  sqcand: '280002551932',
                  nm: 'RONALDO RAMOS CAIADO',
                  nmu: 'RONALDO CAIADO',
                  dvt: 'Válido',
                  seq: '5',
                  e: 'n',
                  st: 'Não eleito',
                  vap: '2605148',
                  pvap: '2,18',
                  pvapn: '2,183680463',
                },
              ],
            },
          ],
        },
        {
          n: '280001800617',
          nm: 'BRASIL PRONTO PRA MAIS',
          tp: 'c',
          par: [
            {
              n: '13',
              sg: 'PT',
              nm: 'PARTIDO DOS TRABALHADORES',
              cand: [
                {
                  n: '13',
                  sqcand: '280002542548',
                  nm: 'LUIZ INÁCIO LULA DA SILVA',
                  nmu: 'LULA',
                  dvt: 'Válido',
                  seq: '2',
                  e: 's',
                  st: '2º turno',
                  vap: '53879538',
                  pvap: '45,16',
                  pvapn: '45,162767911',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  s: {
    ts: '499248',
    st: '499248',
    pst: '100,00',
    pstn: '100',
    snt: '0',
  },
  e: {
    te: '158745502',
    est: '158745502',
  },
  v: {
    tv: '125275835',
    vv: '119300788',
    pvv: '100,00',
  },
};

/** Origem: https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026/21270/dados/br/br-c0001-e021270-u.json */
export const BR_21270_SIMULATED = {
  ele: '21270',
  t: '1',
  f: 's',
  tpabr: 'br',
  cdabr: 'br',
  dg: '29/09/2026',
  hg: '16:29:12',
  idg: '175720276',
  dt: '29/09/2026',
  ht: '16:28:52',
  dv: 's',
  tf: 's',
  and: 'f',
  esae: 'n',
  carg: [
    {
      cd: '1',
      nmn: 'Presidente',
      nv: '1',
      agr: [
        {
          n: '60134624',
          nm: 'FEDERAÇÃO 9998',
          tp: 'f',
          par: [
            {
              n: '60',
              sg: 'P 9992',
              nm: 'PARTIDO 9992',
              cand: [
                {
                  n: '60',
                  sqcand: '41592502',
                  nm: 'CANDIDATO 9995',
                  nmu: 'CANDIDATO 9995',
                  dvt: 'Anulado',
                  seq: '11',
                  e: 'n',
                  st: 'Não eleito',
                  vap: '9075260',
                  pvap: '7,53',
                  pvapn: '7,527528669',
                },
              ],
            },
          ],
        },
        {
          n: '60134536',
          nm: 'PARTIDO 9998',
          tp: 'i',
          par: [
            {
              n: '57',
              sg: 'P 9998',
              nm: 'PARTIDO 9998',
              cand: [
                {
                  n: '57',
                  sqcand: '41592406',
                  nm: 'CANDIDATO 9999',
                  nmu: 'CANDIDATO 9999',
                  dvt: 'Anulado sub judice',
                  seq: '1',
                  e: 's',
                  st: '2º turno',
                  vap: '10503573',
                  pvap: '8,71',
                  pvapn: '8,712251427',
                },
              ],
            },
          ],
        },
        {
          n: '60134543',
          nm: 'Coligação teste para string longa e caracteres especiais çó% º123XzO,.&!@#$*(+)"TSE"',
          tp: 'c',
          par: [
            {
              n: '89',
              sg: 'P 9972',
              nm: 'PARTIDO 9972',
              cand: [
                {
                  n: '89',
                  sqcand: '41592500',
                  nm: 'Candidato teste para string longa e caracteres especiais 123!@#$"TSE"',
                  nmu: 'Candidato string 1234!@#$"TSE"',
                  dvt: 'Válido',
                  seq: '2',
                  e: 's',
                  st: '2º turno',
                  vap: '9995297',
                  pvap: '8,29',
                  pvapn: '8,290658860',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  s: {
    ts: '528951',
    st: '528951',
    pst: '100,00',
    pstn: '100',
    snt: '0',
  },
  e: {
    te: '163079139',
    est: '163079139',
  },
  v: {
    tv: '138863131',
    vv: '100982116',
    pvv: '83,66',
  },
};
