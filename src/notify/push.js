// src/notify/push.js — Firebase Cloud Messaging (v1) push notifications.
// Lazy-inits firebase-admin from config/firebase-service-account.json on first use.
// Skips silently when the service account or device token is missing. Never throws.
// (firebase-admin is declared as a dependency in a later commit; imported dynamically.)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import config from '../core/config.js';
import logger from '../utils/logger.js';

const SERVICE_ACCOUNT_PATH = join(process.cwd(), 'config', 'firebase-service-account.json');

let _app = null;
let _initFailed = false;

async function getApp() {
  if (_app) return _app;
  if (_initFailed) return null;
  if (!existsSync(SERVICE_ACCOUNT_PATH)) {
    _initFailed = true;
    return null;
  }
  try {
    const admin = (await import('firebase-admin')).default;
    const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    _app = admin.apps?.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return _app;
  } catch (err) {
    logger.warn('push: firebase-admin init failed', { error: err.message });
    _initFailed = true;
    return null;
  }
}

/**
 * Send a push to the configured device. Returns { success, id?, skipped?, error? }.
 * Never throws.
 * @param {{title:string, body:string, data?:object}} payload
 */
export async function sendPush({ title, body, data = {} } = {}) {
  try {
    if (!config.fcmDeviceToken) {
      return { success: false, skipped: true, error: 'no FCM device token' };
    }
    const app = await getApp();
    if (!app) return { success: false, skipped: true, error: 'FCM not configured' };

    const admin = (await import('firebase-admin')).default;
    const id = await admin.messaging(app).send({
      token: config.fcmDeviceToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    });
    logger.info('push: sent', { title, id });
    return { success: true, id };
  } catch (err) {
    logger.warn('push: send failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

export default sendPush;
