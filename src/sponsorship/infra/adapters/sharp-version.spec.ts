// Guarda contra rebaixamento do sharp (relatório ab.security H-1): versões < 0.35.5 carregam
// CVEs High do libvips, que decodifica imagens enviadas por visitantes anônimos.
import sharp = require('sharp');

describe('sharp — versão mínima segura (spec sponsorships R-7)', () => {
  it('é ≥ 0.35.5', () => {
    const [major, minor, patch] = String(sharp.versions.sharp).split('.').map(Number);
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(35_005);
  });
});
