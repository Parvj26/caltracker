/**
 * For a text field that holds a name but isn't the coach's own (a meal, program, exercise, section or document name,
 * or a client's name the coach types). Spread it on the input, and give the field no name/id/placeholder containing
 * "name": iPhone Safari ignores autocomplete="off" and decides to offer "AutoFill Contact" from those cues. The data-
 * attributes ask password managers (1Password, LastPass, Dashlane) to stay out too.
 */
export const NOT_A_CONTACT = {
  autoComplete: 'off',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
  'data-form-type': 'other',
} as const;
