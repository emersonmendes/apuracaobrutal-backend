// Categorias de violação da política de publicidade (spec sponsorship-image-moderation R-3).

export const MODERATION_CATEGORIES = [
  'ELECTORAL_PROPAGANDA',
  'POLITICAL_ATTACK',
  'OFFENSIVE_LANGUAGE',
  'DEFAMATION_RISK',
  'HATE_OR_DISCRIMINATION',
  'THREAT_OR_VIOLENCE',
  'ILLEGAL_OR_FRAUDULENT_CONTENT',
  'MISLEADING_ADVERTISING',
  'SEXUAL_CONTENT',
  'GRAPHIC_VIOLENCE',
  'PRIVACY_VIOLATION',
  'INTELLECTUAL_PROPERTY_RISK',
  'MISLEADING_OFFICIAL_IDENTITY',
  'OTHER_POLICY_VIOLATION',
] as const;

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export function isModerationCategory(value: unknown): value is ModerationCategory {
  return typeof value === 'string' && (MODERATION_CATEGORIES as readonly string[]).includes(value);
}
