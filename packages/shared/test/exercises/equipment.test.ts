import { describe, expect, it } from 'vitest';
import { equipmentLabel, workoutEquipment } from '../../src/exercises/equipment';

describe('equipmentLabel', () => {
  it('names every free-exercise-db value readably', () => {
    expect(equipmentLabel('barbell')).toBe('Barbell');
    expect(equipmentLabel('dumbbell')).toBe('Dumbbell');
    expect(equipmentLabel('cable')).toBe('Cable');
    expect(equipmentLabel('machine')).toBe('Machine');
    expect(equipmentLabel('kettlebells')).toBe('Kettlebells');
    expect(equipmentLabel('bands')).toBe('Bands');
    expect(equipmentLabel('medicine ball')).toBe('Medicine Ball');
    expect(equipmentLabel('exercise ball')).toBe('Exercise Ball');
    expect(equipmentLabel('foam roll')).toBe('Foam Roller');
    expect(equipmentLabel('e-z curl bar')).toBe('EZ Curl Bar');
  });
  it('has no label for no equipment, body weight or other', () => {
    expect(equipmentLabel(null)).toBeNull();
    expect(equipmentLabel(undefined)).toBeNull();
    expect(equipmentLabel('')).toBeNull();
    expect(equipmentLabel('   ')).toBeNull();
    expect(equipmentLabel('body only')).toBeNull();
    expect(equipmentLabel('Body Only')).toBeNull();
    expect(equipmentLabel('other')).toBeNull();
    expect(equipmentLabel('none')).toBeNull();
  });
  it('title-cases a coach’s own wording without lowering capitals', () => {
    expect(equipmentLabel('  TRX straps ')).toBe('TRX Straps');
    expect(equipmentLabel('pull-up  bar')).toBe('Pull-up Bar');
    expect(equipmentLabel(' Cable ')).toBe('Cable');
  });
});

describe('workoutEquipment', () => {
  it('lists each piece once, in the order the workout first uses it', () => {
    expect(workoutEquipment(['dumbbell', 'cable', 'Dumbbell', null, 'body only', 'cable', 'medicine ball'])).toEqual([
      'Dumbbell',
      'Cable',
      'Medicine Ball',
    ]);
  });
  it('is empty when nothing needs equipment', () => {
    expect(workoutEquipment([])).toEqual([]);
    expect(workoutEquipment([null, undefined, 'body only', 'other'])).toEqual([]);
  });
});
