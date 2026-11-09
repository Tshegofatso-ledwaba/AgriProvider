import { SymbolView } from 'expo-symbols';
import { PropsWithChildren, useState } from 'react';
import { Pressable } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';

export function Collapsible({ children, title }: PropsWithChildren & { title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();

  return (
    <ThemedView>
      <Pressable
        className="flex-row items-center gap-2 active:opacity-70"
        onPress={() => setIsOpen((value) => !value)}>
        <ThemedView
          type="backgroundElement"
          className="h-10 w-10 items-center justify-center rounded-xl">
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={14}
            weight="bold"
            tintColor={theme.text}
            className={isOpen ? 'rotate-[-90deg]' : 'rotate-90'}
          />
        </ThemedView>

        <ThemedText type="small">{title}</ThemedText>
      </Pressable>
      {isOpen && (
        <Animated.View entering={FadeIn.duration(200)}>
          <ThemedView type="backgroundElement" className="ml-10 mt-3 rounded-xl p-4">
            {children}
          </ThemedView>
        </Animated.View>
      )}
    </ThemedView>
  );
}
