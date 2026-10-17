export const ArrayToObject = <T, V>(arr1: T[], arr2: V[]) =>
  Object.fromEntries(arr1.map((_, i) => [arr1[i], arr2[i]]));
