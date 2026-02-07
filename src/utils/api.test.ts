
import { buildExtractUrl, makeKRSRequest } from './api';
import { KrsExtract } from '../types/krs';

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

    it('should return null when the response is not ok (after retries)', async () => {
      jest.useFakeTimers();
      const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: '0000000001' });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not found' }),
      } as Response);

      const responsePromise = makeKRSRequest<KrsExtract>(url);
      await jest.advanceTimersByTimeAsync(30_000);
      await jest.advanceTimersByTimeAsync(60_000);
      const response = await responsePromise;

      expect(response).toBeNull();
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
});
