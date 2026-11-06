import { tapTarget, typeScale } from '@caltracker/design-tokens';
import { expect, it } from 'vitest';
import { stepperButtonSizeCompact, stepperValueCompact, doneButtonHeight, exercisePhotoHeight, logPhotoHeight, stepperButtonSize, stepperValue } from './theme';

it('makes the stepper number bigger than the big number style', () => {
  expect(stepperValue.fontSize).toBeGreaterThan(typeScale.bigNumber.size.phone);
  expect(stepperValue.lineHeight).toBeGreaterThan(stepperValue.fontSize);
});

it('keeps every logging pressable at least the minimum tap size', () => {
  expect(stepperButtonSize).toBeGreaterThanOrEqual(tapTarget.min);
  expect(doneButtonHeight).toBeGreaterThanOrEqual(tapTarget.logging);
});

it('uses the exercise photo height for the logging photo', () => {
  expect(logPhotoHeight).toBe(exercisePhotoHeight);
});

it('keeps the compact stepper buttons at the minimum tap size', () => {
  expect(stepperButtonSizeCompact).toBeGreaterThanOrEqual(tapTarget.min);
  expect(stepperValueCompact.fontSize).toBeLessThan(stepperValue.fontSize);
});
