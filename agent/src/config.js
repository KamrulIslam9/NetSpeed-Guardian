'use strict';

require('dotenv').config();

const DEFAULTS = {
  userWhatsApp: '+8801581955035',
  providerWhatsApp: '+8801849350702',
  packageSpeedMBs: 20,
  alertThresholdMBs: 5,
  message:
    'Hello, I am experiencing slow internet speed with my Wi-Fi connection. My subscribed package speed is {package_speed} MB/s, but my current download speed is only {current_speed} MB/s. Please investigate and resolve this issue as soon as possible. Thank you.',
  intervalSeconds: 60,
  cooldownSeconds: 300,
};

const config = {
  port: parseInt(process.env.AGENT_PORT, 10) || 8787,
  host: process.env.AGENT_HOST || '127.0.0.1',
  storagePath: process.env.STORAGE_PATH || require('path').join(__dirname, '..', 'data'),
  // WhatsApp Business Cloud API (Graph API). NEVER put real tokens in source.
  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
  },
  // Firebase service account path used by the agent to mirror config/history.
  firebase: {
    credentialPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    projectId: process.env.FIREBASET_PROJECT_ID || '',
  },
  speedTest: {
    downloadUrl: process.env.SPEEDTEST_DOWNLOAD_URL || 'https://speedtest.selectel.com/10MB.bin',
    uploadUrl: process.env.SPEEDTEST_UPLOAD_URL || 'https://speedtest.selectel.com/upload',
    sampleSizeBytes: parseInt(process.env.SPEEDTEST_SAMPLE_BYTES, 10) || 8 * 1024 * 1024,
    timeoutMs: parseInt(process.env.SPEEDTEST_TIMEOUT_MS, 10) || 30000,
  },
  ...DEFAULTS,
};

module.exports = config;