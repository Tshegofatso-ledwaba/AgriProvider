import { Text, type TextProps } from 'react-native';

import type { ThemeColor } from '@/constants/theme';

export type ThemedTextProps = TextProps & {
  className?: string;
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

const typeClasses: Record<NonNullable<ThemedTextProps['type']>, string> = {
  default: 'text-base leading-6 font-medium',
  title: 'text-5xl leading-[52px] font-semibold',
  small: 'text-sm leading-5 font-medium',
  smallBold: 'text-sm leading-5 font-bold',
  subtitle: 'text-[32px] leading-[44px] font-semibold',
  link: 'text-sm leading-[30px] underline',
  linkPrimary: 'text-sm leading-[30px] text-blue-600 underline',
  code: 'font-mono text-xs',
};

const colorClasses: Record<ThemeColor, string> = {
  text: 'text-ink dark:text-dark-ink',
  background: 'text-surface dark:text-dark-surface',
  backgroundElement: 'text-element dark:text-dark-element',
  backgroundSelected: 'text-selected dark:text-dark-selected',
  textSecondary: 'text-muted dark:text-dark-muted',
  primary: 'text-primary dark:text-dark-primary',
  primarySoft: 'text-primary-soft dark:text-dark-primary-soft',
  border: 'text-border dark:text-dark-border',
  accent: 'text-accent dark:text-dark-accent',
};

export function ThemedText({
  className = '',
  type = 'default',
  themeColor = 'text',
  ...rest
}: ThemedTextProps) {
  return (
    <Text
      className={`${typeClasses[type]} ${colorClasses[themeColor]} ${className}`}
      {...rest}
    />
  );
}
