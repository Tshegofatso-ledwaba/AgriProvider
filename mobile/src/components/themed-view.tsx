import { View, type ViewProps } from 'react-native';

import type { ThemeColor } from '@/constants/theme';

export type ThemedViewProps = ViewProps & {
  className?: string;
  type?: ThemeColor;
};

const backgroundClasses: Record<ThemeColor, string> = {
  text: 'bg-ink dark:bg-dark-ink',
  background: 'bg-surface dark:bg-dark-surface',
  backgroundElement: 'bg-element dark:bg-dark-element',
  backgroundSelected: 'bg-selected dark:bg-dark-selected',
  textSecondary: 'bg-muted dark:bg-dark-muted',
  primary: 'bg-primary dark:bg-dark-primary',
  primarySoft: 'bg-primary-soft dark:bg-dark-primary-soft',
  border: 'bg-border dark:bg-dark-border',
  accent: 'bg-accent dark:bg-dark-accent',
};

export function ThemedView({ className = '', type = 'background', ...otherProps }: ThemedViewProps) {
  return <View className={`${backgroundClasses[type]} ${className}`} {...otherProps} />;
}
