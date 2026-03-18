// src/business/places-finder.js — Google Places (New) Text Search.
// searchPlaces(query, max) returns lightweight business records. The field mask is kept
// deliberately small to minimize per-request billing. Never throws (returns [] on error).

import config from '../core/config.js';
import logger from '../utils/logger.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

// Billing-minimizing field mask — only what the SMB pipeline actually uses.
const FIELD_MASK = [
  'places.displayName',
  'places.websiteUri',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.primaryType',
].join(',');

/**
 * @param {string} query  e.g. "dentists in Austin TX"
 * @param {number} [max]  max results to return
 * @returns {Promise<Array<{name,website,address,phone,type}>>}
 */
export async function searchPlaces(query, max = 20) {
  if (!config.googlePlacesApiKey) {
    logger.debug('searchPlaces: GOOGLE_PLACES_API_KEY not set, skipping');
    return [];
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.googlePlacesApiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, pageSize: Math.min(max, 20) }),
    });
    if (!res.ok) {
      logger.warn('searchPlaces: HTTP error', { status: res.status });
      return [];
    }
    const data = await res.json();
    return (data.places || []).slice(0, max).map((p) => ({
      name: p.displayName?.text || null,
      website: p.websiteUri || null,
      address: p.formattedAddress || null,
      phone: p.nationalPhoneNumber || null,
      type: p.primaryType || null,
    }));
  } catch (err) {
    logger.warn('searchPlaces failed', { error: err.message });
    return [];
  }
}

export default searchPlaces;
