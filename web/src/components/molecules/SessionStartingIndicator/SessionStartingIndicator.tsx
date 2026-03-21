import { OdinEye } from '@/components/atoms/OdinEye';
import { LoadingIndicator } from '@/modules/shared/components/LoadingIndicator';

export interface SessionStartingIndicatorProps {
  /** Additional CSS class */
  className?: string;
}

const FORGE_MESSAGES = [
  'Igniting the forge fires\u2026',
  'Summoning the Skuld pod\u2026',
  'Shaping the workspace\u2026',
  'Tempering the environment\u2026',
  'Forging your session\u2026',
  'Preparing the anvil\u2026',
  'Stoking the bellows\u2026',
  'Quenching the tools\u2026',
  'Aligning the runes\u2026',
  'Awakening the smith\u2026',
];

export function SessionStartingIndicator({ className }: SessionStartingIndicatorProps) {
  return (
    <LoadingIndicator
      messages={FORGE_MESSAGES}
      icon={<OdinEye size={40} />}
      label={'Forging session\u2026'}
      variant="centered"
      className={className}
    />
  );
}
