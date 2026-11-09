/** Theme colors used by native navigation APIs and mirrored in Tailwind utilities. */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#13271F',
    background: '#F4F1ED',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#DDECE3',
    textSecondary: '#5C6D67',
    primary: '#173F35',
    primarySoft: '#D9E8E2',
    border: '#E1E4E1',
    accent: '#F0C98B',
  },
  dark: {
    text: '#F3F6F3',
    background: '#101914',
    backgroundElement: '#1C2A25',
    backgroundSelected: '#213C34',
    textSecondary: '#AAB7B1',
    primary: '#245D48',
    primarySoft: '#1A2E29',
    border: '#2A403A',
    accent: '#F0C98B',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type AppColors = (typeof Colors)[keyof typeof Colors];

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
