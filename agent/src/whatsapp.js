'use strict';

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

class WhatsAppLinkedDevice {
  constructor(storagePath) {
    this.authFolder = path.join(storagePath, 'auth_info_baileys');
    this.sock = null;
    this.qrCodeDataUrl = null;
    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.lastError = null;
  }

  async init() {
    if (!fs.existsSync(this.authFolder)) {
      fs.mkdirSync(this.authFolder, { recursive: true });
    }
    await this.connectToWhatsApp();
  }

  async connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
    });

    this.sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.connectionStatus = 'qr_ready';
        try {
          this.qrCodeDataUrl = await qrcode.toDataURL(qr);
        } catch (e) {
          console.error('Failed to generate QR data URL:', e);
        }
        console.log('📱 WhatsApp QR Code generated. Scan from Linked Devices in WhatsApp.');
      }

      if (connection === 'close') {
        this.isConnected = false;
        this.connectionStatus = 'disconnected';
        this.qrCodeDataUrl = null;
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
        if (shouldReconnect) {
          setTimeout(() => this.connectToWhatsApp(), 3000);
        } else {
          this.connectionStatus = 'logged_out';
          console.log('WhatsApp connection logged out. Please clear auth and re-scan QR.');
        }
      } else if (connection === 'open') {
        this.isConnected = true;
        this.connectionStatus = 'connected';
        this.qrCodeDataUrl = null;
        console.log('✅ WhatsApp Linked Device connected successfully!');
      }
    });

    this.sock.ev.on('creds.update', saveCreds);
  }

  async sendMessage(recipientNumber, text) {
    if (!this.isConnected || !this.sock) {
      throw new Error('WhatsApp linked device is not connected. Please scan QR code first.');
    }
    // Format recipient number (e.g. +8801849350702 -> 8801849350702@s.whatsapp.net)
    const cleanNum = recipientNumber.replace(/[^0-9]/g, '');
    const jid = `${cleanNum}@s.whatsapp.net`;

    try {
      const result = await this.sock.sendMessage(jid, { text });
      console.log(`📤 WhatsApp message sent to ${recipientNumber}`);
      return { success: true, result };
    } catch (e) {
      console.error(`❌ Failed to send WhatsApp message to ${recipientNumber}:`, e.message);
      throw e;
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      connectionStatus: this.connectionStatus,
      qrCodeDataUrl: this.qrCodeDataUrl,
    };
  }

  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
      if (fs.existsSync(this.authFolder)) {
        fs.rmSync(this.authFolder, { recursive: true, force: true });
      }
      this.isConnected = false;
      this.connectionStatus = 'disconnected';
      this.qrCodeDataUrl = null;
      await this.init();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = WhatsAppLinkedDevice;