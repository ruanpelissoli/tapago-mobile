import React, { type PropsWithChildren } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '../theme';

type ScreenContainerProps = PropsWithChildren<{
  /**
   * Which safe-area edges to inset. Defaults to every edge except `top`,
   * because screens inside a stack already get their top inset from the header.
   */
  edges?: readonly Edge[];
  /** Centre children on both axes. Handy for empty/loading/stub screens. */
  centered?: boolean;
  style?: ViewStyle;
  testID?: string;
}>;

const DEFAULT_EDGES: readonly Edge[] = ['bottom', 'left', 'right'];

/**
 * Screen-level wrapper that applies the theme background and safe-area insets
 * so individual screens never repeat that boilerplate (or forget the notch).
 */
export function ScreenContainer({
  children,
  edges = DEFAULT_EDGES,
  centered = false,
  style,
  testID,
}: ScreenContainerProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={edges} testID={testID}>
      <View style={[styles.content, centered && styles.centered, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.md,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ScreenContainer;
