/**
 * Rune icons — Elder Futhark rune characters rendered as SVG components
 * that conform to the LucideIcon interface.
 *
 * Canonical rune assignments from NIU-549:
 *   Hliðskjálf → ᛞ Dagaz    Bifrost → ᚨ Ansuz     Ravn → ᚱ Raidho
 *   Sleipnir   → ᛖ Ehwaz    Tyr    → ᛃ Jera      Mímir → ᛗ Mannaz
 *   Búri       → ᛜ Ingwaz
 *
 * Runes to AVOID (political associations): ᛋ Sowilō, ᛟ Othala, ᛏ Tiwaz, ᛉ Algiz
 */
import { forwardRef } from 'react';
import type { LucideProps } from 'lucide-react';

/**
 * Creates a React component that renders a Unicode rune character inside
 * an SVG element, matching the LucideIcon type signature.
 */
function createRuneIcon(rune: string, displayName: string) {
  const RuneIcon = forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
    ({ size = 24, className, color = 'currentColor', ...props }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        {...props}
      >
        <text
          x="12"
          y="12"
          dominantBaseline="central"
          textAnchor="middle"
          fill={color}
          fontSize="18"
          fontWeight="bold"
        >
          {rune}
        </text>
      </svg>
    )
  );
  RuneIcon.displayName = displayName;
  return RuneIcon;
}

// -- ODIN component runes (canonical table from NIU-549) --

/** ᛞ Dagaz — Hliðskjálf (clarity, seeing the whole picture) */
export const DagazRune = createRuneIcon('\u16DE', 'DagazRune');

/** ᚨ Ansuz — Bifrost (divine speech, the word, LLM gateway) */
export const AnsuzRune = createRuneIcon('\u16A8', 'AnsuzRune');

/** ᚱ Raidho — Ravn (journey, riding) */
export const RaidhoRune = createRuneIcon('\u16B1', 'RaidhoRune');

/** ᛖ Ehwaz — Sleipnir (horse) */
export const EhwazRune = createRuneIcon('\u16D6', 'EhwazRune');

/** ᛃ Jera — Tyr (harvest, law, cycles) */
export const JeraRune = createRuneIcon('\u16C3', 'JeraRune');

/** ᛗ Mannaz — Mímir (mankind, the self, knowledge) */
export const MannazRune = createRuneIcon('\u16D7', 'MannazRune');

/** ᛜ Ingwaz — Búri (inner growth, gestation) */
export const IngwazRune = createRuneIcon('\u16DC', 'IngwazRune');
