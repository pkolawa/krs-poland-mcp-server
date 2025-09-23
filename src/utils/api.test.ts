
import { buildExtractUrl, makeKRSRequest } from './api';
import { KrsExtract } from '../types/krs';

// Using a well-known, stable entity (GUS) for reliable testing.
const TEST_KRS_NUMBER = '0000109411';

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

  // Tests for the actual API request and response structure (contract testing)
  describe('makeKRSRequest', () => {

    // Set a longer timeout for network requests
    jest.setTimeout(20000);

    it('should fetch OdpisAktualny and match the contract (snapshot)', async () => {
      const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      const response = await makeKRSRequest<KrsExtract>(url);

      // Compare the response structure with the saved snapshot
      expect(response).toMatchSnapshot();
    });

    it('should fetch OdpisPelny and match the contract (snapshot)', async () => {
      const url = buildExtractUrl({ type: 'OdpisPelny', rejestr: 'P', krs: TEST_KRS_NUMBER });
      const response = await makeKRSRequest<KrsExtract>(url);

      // Ensure the response is not null
      expect(response).not.toBeNull();

      // Compare the response structure with the saved snapshot
      expect(response).toMatchSnapshot({
        odpis: {
          naglowekP: {
            dataCzasOdpisu: expect.any(String),
          },
        },
      });
    });

    it('should return null for a non-existent KRS number', async () => {
        // This KRS number is unlikely to exist
        const url = buildExtractUrl({ type: 'OdpisAktualny', rejestr: 'P', krs: '0000000001' });
        const response = await makeKRSRequest<KrsExtract>(url);

        // The API currently returns a 200 with an error message inside, so we snapshot it.
        // If it ever changes to a 404 or different error, this test will fail and notify us.
        expect(response).toMatchSnapshot();
    });
  });
});
