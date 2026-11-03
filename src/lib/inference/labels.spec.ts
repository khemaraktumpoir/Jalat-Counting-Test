import { foldClasses } from './labels';

describe('foldClasses', () => {
  it('sends every class to the first one with its label', () => {
    expect(
      foldClasses({ 0: 'parcel', 1: 'parcel', 2: 'parcel', 3: 'parcel', 4: 'parcel', 5: 'parcel' })
    ).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it('folds only the shared labels', () => {
    expect(foldClasses({ 0: 'parcel', 1: 'person', 2: 'parcel' })).toEqual({ 2: 0 });
  });

  it('leaves a model whose labels all differ as it is', () => {
    expect(foldClasses({ 0: 'person', 1: 'bicycle', 2: 'car' })).toEqual({});
  });
});
