/**
 * Attributes for a text field that holds a name but isn't the coach's own (a meal, program, exercise, section, measure,
 * document or workout name, or a client's details the coach types). Spread the result on the input.
 *
 * iPhone Safari ignores autocomplete="off" and offers "AutoFill Contact" whenever a field's label says "Name". A `name`
 * attribute containing "search" turns that off (Safari never fills contacts into search boxes), so every field gets
 * `name="<field>-search"`; TextField also puts that name in the field's id. Keep "name" out of `field` and out of any
 * placeholder: those are cues too. The data- attributes ask password managers (1Password, LastPass, Dashlane) to stay
 * out. A form that reads FormData gets the field's value with `form.get(notAContact('x').name)`.
 */
export function notAContact<F extends string>(field: F) {
  return {
    name: `${field}-search`,
    autoComplete: 'off',
    'data-1p-ignore': '',
    'data-lpignore': 'true',
    'data-form-type': 'other',
  } as const satisfies Record<string, string>;
}
