import { boxPixels, similarity } from './embed';

const meta = {
  size: 4,
  mean: [0, 0, 0] as [number, number, number],
  std: [1, 1, 1] as [number, number, number]
};

/** A 8×4 frame: red on the left half, blue on the right. */
function frame() {
  const width = 8;
  const height = 4;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.set(x < 4 ? [255, 0, 0] : [0, 0, 255], (y * width + x) * 3);
  return { data, width, height };
}

describe('the parcel look-alike model input', () => {
  it("takes the box's own pixels, channel by channel (RGB planes)", () => {
    const out = new Float32Array(3 * 16);
    boxPixels(frame(), { x1: 0, y1: 0, x2: 4, y2: 4 }, meta, out, 0);
    expect([...out.slice(0, 16)].every(v => v === 1)).toBe(true); // red
    expect([...out.slice(32, 48)].every(v => v === 0)).toBe(true); // no blue
    boxPixels(frame(), { x1: 4, y1: 0, x2: 8, y2: 4 }, meta, out, 0);
    expect([...out.slice(32, 48)].every(v => v === 1)).toBe(true); // blue
  });

  it('keeps the middle square of a long box and stays inside the photo', () => {
    const out = new Float32Array(3 * 16);
    // The whole frame (8×4): its middle square is half red, half blue.
    boxPixels(frame(), { x1: -5, y1: -5, x2: 50, y2: 50 }, meta, out, 0);
    const red = [...out.slice(0, 16)];
    expect(red.filter(v => v > 0.5).length).toBe(8);
  });

  it('scores the same look 1 and opposite looks below 0', () => {
    expect(similarity([0.6, 0.8], [0.6, 0.8])).toBeCloseTo(1);
    expect(similarity([1, 0], [-1, 0])).toBe(-1);
  });
});
