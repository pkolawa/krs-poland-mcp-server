
import {
  buildBulletinUrl,
  buildExtractUrl,
  buildExtractUrlPath,
  buildExtractUrls,
  fetchBulletin,
  fetchKrs,
  fetchKrsExtractFromRegisters,
  makeKRSRequest,
  normalizeKrsNumber,
} from "./api.js";
import { KrsExtract } from "../types/krs.js";

// Using a well-known, stable entity (GUS) for reliable testing.
const TEST_KRS_NUMBER = '0000109411';

const SAMPLE_ODPIS_AKTUALNY: KrsExtract = {
  odpis: {
    rodzaj: 'Aktualny',
    naglowekP: {
      dataCzasOdpisu: '2025-01-28T00:00:00.000Z',
      numerKRS: TEST_KRS_NUMBER,
      rejestr: 'RejP',
      stanPozycji: 2,
      stanZDnia: '28.01.2025',
    },
  },
};

const SAMPLE_ODPIS_PELNY: KrsExtract = {
  odpis: {
    rodzaj: 'Pełny',
    naglowekP: {
      dataCzasOdpisu: '2025-01-28T00:00:00.000Z',
      numerKRS: TEST_KRS_NUMBER,
      rejestr: 'RejP',
      stanPozycji: 2,
      stanZDnia: '28.01.2025',
    },
    dane: {
      dzial1: {
        danePodmiotu: {
          nazwa: [
            {
              nazwa: 'GŁÓWNY URZĄD STATYSTYCZNY',
            },
          ],
        },
      },
    },
  },
};

describe('KRS API Utilities', () => {
  // Test for the URL builder logic
  describe('buildExtractUrl', () => {
    it('should construct a valid URL for OdpisAktualny', () => {
      const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      expect(url).toBe(`https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${TEST_KRS_NUMBER}?rejestr=P&format=json`);
    });

    it('should construct a valid URL for OdpisPelny', () => {
      const url = buildExtractUrl({ type: 'OdpisPelny', rejestr: 'S', krs: TEST_KRS_NUMBER });
      expect(url).toBe(`https://api-krs.ms.gov.pl/api/krs/OdpisPelny/${TEST_KRS_NUMBER}?rejestr=S&format=json`);
    });
  });

  describe('buildExtractUrlPath', () => {
    it('should construct a valid path URL for OdpisAktualny', () => {
      const url = buildExtractUrlPath({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      expect(url).toBe(`https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/P/${TEST_KRS_NUMBER}?format=json`);
    });

    it('should construct a valid path URL for OdpisPelny', () => {
      const url = buildExtractUrlPath({ type: 'OdpisPelny', rejestr: 'S', krs: TEST_KRS_NUMBER });
      expect(url).toBe(`https://api-krs.ms.gov.pl/api/krs/OdpisPelny/S/${TEST_KRS_NUMBER}?format=json`);
    });
  });

  describe('buildExtractUrls', () => {
    it('should return the query-param URL first and the path URL as fallback', () => {
      const urls = buildExtractUrls({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      expect(urls).toEqual([
        `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${TEST_KRS_NUMBER}?rejestr=P&format=json`,
        `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/P/${TEST_KRS_NUMBER}?format=json`,
      ]);
    });
  });

  // Unit tests for the request helper (mocked fetch to avoid network flakiness)
  describe('makeKRSRequest', () => {
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should return parsed JSON for a successful response', async () => {
      const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => SAMPLE_ODPIS_AKTUALNY,
      } as Response);

      const response = await makeKRSRequest<KrsExtract>(url);

      expect(response).toEqual(SAMPLE_ODPIS_AKTUALNY);
      expect(fetchSpy).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          headers: { Accept: 'application/json', 'User-Agent': 'krs-mcp/1.0' },
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('should return parsed JSON for a different extract type', async () => {
      const url = buildExtractUrl({ type: 'OdpisPelny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => SAMPLE_ODPIS_PELNY,
      } as Response);

      const response = await makeKRSRequest<KrsExtract>(url);

      expect(response).toEqual(SAMPLE_ODPIS_PELNY);
    });

    it('should return null immediately for 404 without retrying', async () => {
      const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: '0000000001' });
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not found' }),
      } as Response);

      const response = await makeKRSRequest<KrsExtract>(url);

      expect(response).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should return null when the server keeps failing (after retries)', async () => {
      jest.useFakeTimers();
      const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as Response);

      const responsePromise = makeKRSRequest<KrsExtract>(url);
      await jest.advanceTimersByTimeAsync(30_000);
      await jest.advanceTimersByTimeAsync(60_000);
      const response = await responsePromise;

      expect(response).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should return null when fetch throws (after retries)', async () => {
      jest.useFakeTimers();
      const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

      const responsePromise = makeKRSRequest<KrsExtract>(url);
      await jest.advanceTimersByTimeAsync(30_000);
      await jest.advanceTimersByTimeAsync(60_000);
      const response = await responsePromise;

      expect(response).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should retry with backoff and succeed on the third attempt', async () => {
      jest.useFakeTimers();
      const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => SAMPLE_ODPIS_AKTUALNY,
        } as Response);

      const responsePromise = makeKRSRequest<KrsExtract>(url);
      await jest.advanceTimersByTimeAsync(30_000);
      await jest.advanceTimersByTimeAsync(60_000);
      const response = await responsePromise;

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(response).toEqual(SAMPLE_ODPIS_AKTUALNY);
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('fetchKrs', () => {
    const urls = buildExtractUrls({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });

    function respond(status: number, body: unknown = {}): Response {
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('returns ok with data from the first URL that succeeds', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond(200, SAMPLE_ODPIS_AKTUALNY));

      const result = await fetchKrs<KrsExtract>(urls);

      expect(result).toEqual({ status: 'ok', data: SAMPLE_ODPIS_AKTUALNY });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(urls[0], expect.anything());
    });

    it('falls back to the next URL after a 404', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(respond(404))
        .mockResolvedValueOnce(respond(200, SAMPLE_ODPIS_AKTUALNY));

      const result = await fetchKrs<KrsExtract>(urls);

      expect(result.status).toBe('ok');
      expect(fetchSpy).toHaveBeenNthCalledWith(2, urls[1], expect.anything());
    });

    it('treats 204 No Content (deleted entity) as not_found without retrying', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      } as unknown as Response);

      const result = await fetchKrs<KrsExtract>(urls);

      expect(result).toEqual({ status: 'not_found' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('returns not_found when every URL answers 404', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond(404));

      const result = await fetchKrs<KrsExtract>(urls);

      expect(result).toEqual({ status: 'not_found' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('returns error without retrying for other 4xx responses', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond(400));

      const result = await fetchKrs<KrsExtract>(urls);

      expect(result).toEqual({ status: 'error', error: 'HTTP 400' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('reports error rather than not_found when one URL failed and another answered 404', async () => {
      jest.useFakeTimers();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(global, 'fetch').mockImplementation(async (input) =>
        String(input) === urls[0] ? respond(503) : respond(404),
      );

      const resultPromise = fetchKrs<KrsExtract>(urls);
      await jest.advanceTimersByTimeAsync(30_000);
      await jest.advanceTimersByTimeAsync(60_000);
      const result = await resultPromise;

      expect(result).toEqual({ status: 'error', error: 'HTTP 503' });
    });

    it('retries 429 responses', async () => {
      jest.useFakeTimers();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(respond(429))
        .mockResolvedValueOnce(respond(200, SAMPLE_ODPIS_AKTUALNY));

      const resultPromise = fetchKrs<KrsExtract>(urls[0]);
      await jest.advanceTimersByTimeAsync(30_000);
      const result = await resultPromise;

      expect(result.status).toBe('ok');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Biuletyn', () => {
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    function respond(status: number, body?: unknown): Response {
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }

    it('builds the bulletin URL for a day', () => {
      expect(buildBulletinUrl('2026-11-12')).toBe('https://api-krs.ms.gov.pl/api/krs/Biuletyn/2026-11-12');
    });

    it.each([
      ['116', '0000000116'],
      [' 19193 ', '0000019193'],
      ['0000019193', '0000019193'],
      [19193, '0000019193'],
    ])('normalizes %p to %p', (input, expected) => {
      expect(normalizeKrsNumber(input)).toBe(expected);
    });

    it.each([[''], ['12a'], ['12345678901'], [null], [{}], [1.5], [-3]])('rejects %p', (input) => {
      expect(normalizeKrsNumber(input)).toBeNull();
    });

    it('returns 10-digit numbers without duplicates or malformed items', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(respond(200, ['116', '19193', '116', '19193', '19193', 'x', null]));

      const result = await fetchBulletin('2026-11-12');

      expect(result).toEqual({ status: 'ok', data: ['0000000116', '0000019193'] });
    });

    it('treats an empty day as an empty list', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(respond(200, []));

      expect(await fetchBulletin('2026-11-14')).toEqual({ status: 'ok', data: [] });
    });

    it('reports 404 as an error rather than an empty day', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond(404));

      expect(await fetchBulletin('2026-11-12')).toEqual({ status: 'error', error: 'brak biuletynu (HTTP 404/204)' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('reports a body that is not a list as an error', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(respond(200, { message: 'unexpected' }));

      expect(await fetchBulletin('2026-11-12')).toEqual({
        status: 'error',
        error: 'nieoczekiwany format odpowiedzi biuletynu',
      });
    });

    it('gives up on a failing day after short retries (2 s, 5 s)', async () => {
      jest.useFakeTimers();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond(503));

      const resultPromise = fetchBulletin('2026-11-12');
      await jest.advanceTimersByTimeAsync(2_000);
      await jest.advanceTimersByTimeAsync(5_000);
      const result = await resultPromise;

      expect(result).toEqual({ status: 'error', error: 'HTTP 503' });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('cache', () => {
    const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });
    const ok = (body: unknown = SAMPLE_ODPIS_AKTUALNY) => ({ ok: true, status: 200, json: async () => body }) as Response;
    const notFound = () => ({ ok: false, status: 404, json: async () => ({}) }) as Response;
    const originalTtl = process.env.KRS_CACHE_TTL_SECONDS;

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
      if (originalTtl === undefined) delete process.env.KRS_CACHE_TTL_SECONDS;
      else process.env.KRS_CACHE_TTL_SECONDS = originalTtl;
    });

    it('answers a repeated request from memory', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ok());

      const first = await fetchKrs<KrsExtract>(url);
      const second = await fetchKrs<KrsExtract>(url);

      expect(second).toEqual(first);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('remembers "not found" too, but not errors', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(notFound());
      await fetchKrs(url);
      await fetchKrs(url);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const other = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'S', krs: TEST_KRS_NUMBER });
      fetchSpy.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) } as Response);
      expect(await fetchKrs(other)).toEqual({ status: 'error', error: 'HTTP 400' });
      fetchSpy.mockResolvedValue(ok());
      expect((await fetchKrs(other)).status).toBe('ok');
    });

    it('shares one request between concurrent callers', async () => {
      let resolve: (value: Response) => void = () => undefined;
      const fetchSpy = jest.spyOn(global, 'fetch').mockReturnValue(new Promise<Response>((r) => (resolve = r)));

      const pending = [fetchKrs(url), fetchKrs(url), fetchKrs(url)];
      resolve(ok());
      const results = await Promise.all(pending);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(results.every((result) => result.status === 'ok')).toBe(true);
    });

    it('expires entries after 10 minutes', async () => {
      jest.useFakeTimers();
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ok());

      await fetchKrs(url);
      jest.setSystemTime(Date.now() + 9 * 60_000);
      await fetchKrs(url);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      jest.setSystemTime(Date.now() + 2 * 60_000);
      await fetchKrs(url);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('can be turned off with KRS_CACHE_TTL_SECONDS=0', async () => {
      process.env.KRS_CACHE_TTL_SECONDS = '0';
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ok());

      await fetchKrs(url);
      await fetchKrs(url);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('keeps only the 50 most recently used entries', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ok());
      const urlFor = (n: number) => buildExtractUrl({ type: 'OdpisPelny', rejestr: 'P', krs: String(n).padStart(10, '0') });

      for (let n = 1; n <= 51; n++) await fetchKrs(urlFor(n));
      expect(fetchSpy).toHaveBeenCalledTimes(51);

      await fetchKrs(urlFor(51)); // still cached
      await fetchKrs(urlFor(1)); // evicted as the least recently used
      expect(fetchSpy).toHaveBeenCalledTimes(52);
    });
  });

  describe('fetchKrsExtractFromRegisters', () => {
    afterEach(() => jest.restoreAllMocks());

    it('returns the first register that has the entity, and not_found / error otherwise', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const rejestr = new URL(String(input)).searchParams.get('rejestr');
        const krs = String(input).match(/\d{10}/)?.[0];
        if (krs === '0000000001' && rejestr === 'S') return { ok: true, status: 200, json: async () => SAMPLE_ODPIS_AKTUALNY } as Response;
        if (krs === '0000000003') return { ok: false, status: 400, json: async () => ({}) } as Response;
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      });

      expect(await fetchKrsExtractFromRegisters('OdpisAktualny', '0000000001', ['P', 'S'])).toEqual({
        status: 'ok',
        rejestr: 'S',
        data: SAMPLE_ODPIS_AKTUALNY,
      });
      expect(await fetchKrsExtractFromRegisters('OdpisAktualny', '0000000002', ['P', 'S'])).toEqual({ status: 'not_found' });
      expect(await fetchKrsExtractFromRegisters('OdpisAktualny', '0000000003', ['P', 'S'])).toEqual({ status: 'error' });
    });
  });
});
