// src/business/linkedin-posts.js — LinkedIn post discovery via Apify.
// searchLinkedInPosts(keyword) runs the posts actor, normalizes each post, and pulls any
// inline contact (email/phone) out of the text. Never throws (returns [] on failure).

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { runApifyActor } from './linkedin-profiles.js';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

/** Pull an email and/or phone out of a post body. */
export function extractContactFromPost(text) {
  const t = text || '';
  const email = (t.match(EMAIL_RE) || [])[0] || null;
  const phone = (t.match(PHONE_RE) || [])[0] || null;
  return { email: email ? email.toLowerCase() : null, phone: phone ? phone.trim() : null };
}

export async function searchLinkedInPosts(keyword) {
  if (!config.apifyApiToken) {
    logger.debug('searchLinkedInPosts: APIFY_API_TOKEN not set, skipping');
    return [];
  }
  try {
    const items = await runApifyActor(config.apifyPostsActor, {
      keyword,
      searchQueries: [keyword],
      maxItems: 50,
    });
    const posts = (Array.isArray(items) ? items : []).map((p) => {
      const text = p.text || p.content || p.postText || '';
      return {
        text,
        url: p.url || p.postUrl || null,
        authorName: p.authorName || p.author?.name || null,
        authorHeadline: p.authorHeadline || p.author?.headline || null,
        authorProfile: p.authorProfileUrl || p.author?.url || null,
        postedAt: p.postedAt || p.date || null,
        contact: extractContactFromPost(text),
      };
    });
    logger.info('searchLinkedInPosts complete', { keyword, returned: posts.length });
    return posts;
  } catch (err) {
    logger.warn('searchLinkedInPosts failed', { keyword, error: err.message });
    return [];
  }
}

export default searchLinkedInPosts;
