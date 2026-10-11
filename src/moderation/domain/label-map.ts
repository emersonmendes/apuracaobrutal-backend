// Tabela rótulo do provedor → categoria da política (spec sponsorship-image-moderation R-4).
// Constante do domínio versionada com `policy_version`. Puro — sem NestJS, Prisma nem SDK.
import type { ModerationCategory } from './categories';
import type { ModerationLabelSignal } from './signals';

/** Rótulos L1 cuja presença acima do limiar é recusa obrigatória (D-2). */
export const MANDATORY_LABELS: readonly string[] = [
  'Explicit',
  'Violence',
  'Visually Disturbing',
  'Hate Symbols',
];

/** L1 → categoria (D-2/D-3). `Violence` é resolvido pelo L2 em {@link categoryForLabel}. */
export const LABEL_CATEGORY_MAP: Readonly<Record<string, ModerationCategory>> = {
  Explicit: 'SEXUAL_CONTENT',
  Violence: 'GRAPHIC_VIOLENCE',
  'Visually Disturbing': 'GRAPHIC_VIOLENCE',
  'Hate Symbols': 'HATE_OR_DISCRIMINATION',
  'Non-Explicit Nudity of Intimate parts and Kissing': 'SEXUAL_CONTENT',
  'Swimwear or Underwear': 'OTHER_POLICY_VIOLATION',
  'Drugs & Tobacco': 'OTHER_POLICY_VIOLATION',
  Alcohol: 'OTHER_POLICY_VIOLATION',
  Gambling: 'OTHER_POLICY_VIOLATION',
  'Rude Gestures': 'OFFENSIVE_LANGUAGE',
};

/** L2 de `Violence` com categoria própria. */
const VIOLENCE_L2: Readonly<Record<string, ModerationCategory>> = {
  'Graphic Violence': 'GRAPHIC_VIOLENCE',
  Weapons: 'THREAT_OR_VIOLENCE',
};

/** Categoria para L1 fora da tabela (taxonomia nova): recusa conservadora. */
export const UNKNOWN_LABEL_CATEGORY: ModerationCategory = 'OTHER_POLICY_VIOLATION';

export interface ResolvedLabel {
  l1: string;
  l2: string | null;
}

/**
 * Sobe pela cadeia `parentName` até o L1 e identifica o L2 do caminho. Um rótulo cujo pai não
 * aparece na resposta é tratado como L1 (o provedor sempre devolve o L1 junto; se não vier, a
 * recusa conservadora continua valendo via {@link UNKNOWN_LABEL_CATEGORY}).
 */
export function resolveLabel(
  label: ModerationLabelSignal,
  all: readonly ModerationLabelSignal[],
): ResolvedLabel {
  const byName = new Map(all.map((item) => [item.name, item] as const));
  const chain: ModerationLabelSignal[] = [label];
  let current = label;
  while (current.parentName !== null && chain.length < 4) {
    const parent = byName.get(current.parentName);
    if (!parent) {
      chain.push({
        name: current.parentName,
        parentName: null,
        taxonomyLevel: 1,
        confidence: current.confidence,
      });
      break;
    }
    chain.push(parent);
    current = parent;
  }
  const l1 = chain[chain.length - 1].name;
  const l2 = chain.length >= 2 ? chain[chain.length - 2].name : null;
  return { l1, l2 };
}

export interface LabelCategory {
  category: ModerationCategory;
  mandatory: boolean;
  l1: string;
  l2: string | null;
}

/** Categoria e obrigatoriedade de um rótulo (R-4). */
export function categoryForLabel(
  label: ModerationLabelSignal,
  all: readonly ModerationLabelSignal[],
): LabelCategory {
  const { l1, l2 } = resolveLabel(label, all);
  const mandatory = MANDATORY_LABELS.includes(l1);
  if (l1 === 'Violence') {
    const byL2 = l2 !== null ? VIOLENCE_L2[l2] : undefined;
    return { category: byL2 ?? LABEL_CATEGORY_MAP.Violence, mandatory, l1, l2 };
  }
  const category = LABEL_CATEGORY_MAP[l1] ?? UNKNOWN_LABEL_CATEGORY;
  return { category, mandatory, l1, l2 };
}
