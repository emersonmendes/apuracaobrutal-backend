import { categoryForLabel, LABEL_CATEGORY_MAP, MANDATORY_LABELS, resolveLabel } from './label-map';
import type { ModerationLabelSignal } from './signals';

const label = (
  name: string,
  parentName: string | null = null,
  taxonomyLevel: 1 | 2 | 3 = 1,
): ModerationLabelSignal => ({ name, parentName, taxonomyLevel, confidence: 90 });

describe('LABEL_CATEGORY_MAP — spec sponsorship-image-moderation R-4', () => {
  it('cobre os 10 L1 da taxonomia v7 e marca os quatro obrigatórios', () => {
    expect(Object.keys(LABEL_CATEGORY_MAP).sort()).toEqual(
      [
        'Alcohol',
        'Drugs & Tobacco',
        'Explicit',
        'Gambling',
        'Hate Symbols',
        'Non-Explicit Nudity of Intimate parts and Kissing',
        'Rude Gestures',
        'Swimwear or Underwear',
        'Violence',
        'Visually Disturbing',
      ].sort(),
    );
    expect(MANDATORY_LABELS).toEqual([
      'Explicit',
      'Violence',
      'Visually Disturbing',
      'Hate Symbols',
    ]);
  });

  it('resolve L3 → L2 → L1 pela cadeia de pais', () => {
    const all = [
      label('Explicit'),
      label('Explicit Nudity', 'Explicit', 2),
      label('Exposed Male Genitalia', 'Explicit Nudity', 3),
    ];
    expect(resolveLabel(all[2], all)).toEqual({ l1: 'Explicit', l2: 'Explicit Nudity' });
    expect(resolveLabel(all[1], all)).toEqual({ l1: 'Explicit', l2: 'Explicit Nudity' });
    expect(resolveLabel(all[0], all)).toEqual({ l1: 'Explicit', l2: null });
  });

  it('pai ausente da resposta é tratado como L1', () => {
    const only = [label('Weapons', 'Violence', 2)];
    expect(resolveLabel(only[0], only)).toEqual({ l1: 'Violence', l2: 'Weapons' });
    expect(categoryForLabel(only[0], only)).toMatchObject({
      category: 'THREAT_OR_VIOLENCE',
      mandatory: true,
    });
  });

  it('Violence por L2; L1 desconhecido → OTHER_POLICY_VIOLATION não obrigatório', () => {
    const all = [
      label('Violence'),
      label('Graphic Violence', 'Violence', 2),
      label('Weapons', 'Violence', 2),
    ];
    expect(categoryForLabel(all[1], all).category).toBe('GRAPHIC_VIOLENCE');
    expect(categoryForLabel(all[2], all).category).toBe('THREAT_OR_VIOLENCE');
    expect(categoryForLabel(all[0], all).category).toBe('GRAPHIC_VIOLENCE');
    expect(categoryForLabel(label('Novo'), [label('Novo')])).toEqual({
      category: 'OTHER_POLICY_VIOLATION',
      mandatory: false,
      l1: 'Novo',
      l2: null,
    });
  });
});
