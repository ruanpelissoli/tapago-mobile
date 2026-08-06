/**
 * TaPago brand theme.
 *
 * Single source of truth for colour, spacing and type scale. Screens and
 * components should import from here rather than hard-coding literals, so a
 * brand tweak is a one-file change.
 */

export const colors = {
  /** Brand green — primary actions, active states, brand marks. */
  primary: '#2ECC71',
  /** Pressed/hover shade of `primary`. */
  primaryDark: '#27AE60',
  /** Tinted `primary` for subtle fills and selected rows. */
  primaryMuted: '#E8F8F0',
  /** Text/icon colour that meets contrast on top of `primary`. */
  onPrimary: '#FFFFFF',

  background: '#FFFFFF',
  /** Page background one step back from `background` (grouped lists, screens). */
  backgroundAlt: '#F5F7FA',
  surface: '#FFFFFF',
  border: '#E2E8F0',

  text: '#1A202C',
  textSecondary: '#4A5568',
  textMuted: '#A0AEC0',
  /** Text/icon colour for use on dark or brand-coloured surfaces. */
  textInverse: '#FFFFFF',

  success: '#2ECC71',
  warning: '#F2C94C',
  danger: '#E74C3C',
  info: '#3498DB',

  /** Scrim behind modals and bottom sheets. */
  overlay: 'rgba(26, 32, 44, 0.5)',
} as const;

/**
 * Font size scale. Values are unscaled points — React Native applies the
 * user's system font-size preference on top, so never disable `allowFontScaling`.
 */
export const fontSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  xxxl: 34,
} as const;

/** Line heights paired 1:1 with `fontSizes` (~1.4 ratio, rounded to even). */
export const lineHeights = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 26,
  xl: 30,
  xxl: 36,
  xxxl: 42,
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** 4pt base spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 16,
  pill: 999,
} as const;

/**
 * Minimum interactive size. 48 satisfies both the iOS 44pt and the Android 48dp
 * guidance, so a single constant covers every touch target in the app.
 */
export const MIN_TOUCH_TARGET = 48;

export const theme = {
  colors,
  fontSizes,
  lineHeights,
  fontWeights,
  spacing,
  radii,
  minTouchTarget: MIN_TOUCH_TARGET,
} as const;

export type Theme = typeof theme;
export type ThemeColor = keyof typeof colors;

export default theme;
