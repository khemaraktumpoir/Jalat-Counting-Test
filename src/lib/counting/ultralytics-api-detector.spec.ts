import {
  detectionsOfPlatform,
  isUltralyticsModel,
  UltralyticsApiDetector,
  ultralyticsUrlOf
} from './ultralytics-api-detector';

// MODEL_PATH=ultralytics:<url>: the model on Ultralytics Platform, one JPEG a frame.
const ENDPOINT = 'https://parcels-abc.run.app/predict';
const frame = { data: new Uint8Array(4 * 4 * 3).fill(120), width: 4, height: 4 };
const answer = {
  images: [
    {
      shape: [4, 4],
      results: [
        { class: 0, name: 'parcel', confidence: 0.91, box: { x1: 1, y1: 1, x2: 3, y2: 3 } },
        { class: 0, name: 'parcel', confidence: 0.2, box: { x1: 0, y1: 0, x2: 1, y2: 1 } },
        { class: 2, name: 'bag', confidence: 0.8, box: { x1: 2, y1: 0, x2: 4, y2: 2 } }
      ]
    }
  ]
};

describe('MODEL_PATH ultralytics:', () => {
  it('is recognised, with its url', () => {
    expect(isUltralyticsModel(`ultralytics:${ENDPOINT}`)).toBe(true);
    expect(isUltralyticsModel('models/yolo26n.onnx')).toBe(false);
    expect(ultralyticsUrlOf(` ultralytics: ${ENDPOINT} `)).toBe(ENDPOINT);
  });
});

describe('detectionsOfPlatform', () => {
  it('keeps the confident ones of the classes asked for, as pixel boxes', () => {
    expect(detectionsOfPlatform(answer, { conf: 0.4 })).toEqual([
      { box: { x1: 1, y1: 1, x2: 3, y2: 3 }, score: 0.91, classId: 0 },
      { box: { x1: 2, y1: 0, x2: 4, y2: 2 }, score: 0.8, classId: 2 }
    ]);
    expect(detectionsOfPlatform(answer, { conf: 0.4, classes: [0] })).toHaveLength(1);
    expect(detectionsOfPlatform({}, { conf: 0.4 })).toEqual([]);
  });
});

describe('UltralyticsApiDetector', () => {
  const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers }));

  it('posts the frame as a JPEG with the key, and reads the boxes', async () => {
    const fetchImpl = reply(200, answer);
    const detector = new UltralyticsApiDetector({ url: ENDPOINT, apiKey: 'k1', fetchImpl });
    const found = await detector.detect(frame, { conf: 0.5 });
    expect(found.map(d => d.score)).toEqual([0.91, 0.8]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init.headers).toEqual({ Authorization: 'Bearer k1' });
    const file = (init.body as FormData).get('file') as Blob;
    expect(file.type).toBe('image/jpeg');
    expect(new Uint8Array(await file.arrayBuffer()).slice(0, 2)).toEqual(
      new Uint8Array([0xff, 0xd8])
    );
    expect((init.body as FormData).get('conf')).toBe('0.5');
  });

  it('rate limited: nothing until Retry-After, without asking again', async () => {
    const fetchImpl = reply(429, {}, { 'retry-after': '30' });
    const detector = new UltralyticsApiDetector({ url: ENDPOINT, apiKey: 'k1', fetchImpl });
    expect(await detector.detect(frame, { conf: 0.4 })).toEqual([]);
    expect(await detector.detect(frame, { conf: 0.4 })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('says why a request was refused, and needs a url and a key', async () => {
    const detector = new UltralyticsApiDetector({
      url: ENDPOINT,
      apiKey: 'bad',
      fetchImpl: reply(401)
    });
    await expect(detector.detect(frame, { conf: 0.4 })).rejects.toThrow('API key was refused');
    expect(() => new UltralyticsApiDetector({ url: ENDPOINT, apiKey: '' })).toThrow(
      'ULTRALYTICS_API_KEY'
    );
    expect(() => new UltralyticsApiDetector({ url: '', apiKey: 'k' })).toThrow('url is missing');
  });
});
