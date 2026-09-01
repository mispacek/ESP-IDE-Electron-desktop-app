'use strict';

(function attachPickerI18n(root) {
  const FALLBACK_LANGUAGE = 'en';
  const MESSAGES = Object.freeze({
    cs: Object.freeze({
      usbTitle: 'Vyberte USB zařízení',
      bluetoothTitle: 'Vyberte Bluetooth zařízení',
      close: 'Zavřít',
      loading: 'Vyhledávání zařízení…',
      nothingFound: 'Nebyla nalezena žádná zařízení. Zkontrolujte, že je zařízení zapnuté a v dosahu.',
      unnamedDevice: '(nepojmenované zařízení)',
    }),
    en: Object.freeze({
      usbTitle: 'Select USB device',
      bluetoothTitle: 'Select Bluetooth device',
      close: 'Close',
      loading: 'Searching for devices…',
      nothingFound: 'No devices found. Check that the device is powered on and within range.',
      unnamedDevice: '(unnamed device)',
    }),
    de: Object.freeze({
      usbTitle: 'USB-Gerät auswählen',
      bluetoothTitle: 'Bluetooth-Gerät auswählen',
      close: 'Schließen',
      loading: 'Geräte werden gesucht…',
      nothingFound: 'Keine Geräte gefunden. Stellen Sie sicher, dass das Gerät eingeschaltet und in Reichweite ist.',
      unnamedDevice: '(unbenanntes Gerät)',
    }),
  });

  function normalizeLanguage(value) {
    const primary = String(value || '').trim().toLowerCase().split(/[-_]/, 1)[0];
    return Object.prototype.hasOwnProperty.call(MESSAGES, primary) ? primary : FALLBACK_LANGUAGE;
  }

  function getMessages(value) {
    const language = normalizeLanguage(value);
    return { language, messages: MESSAGES[language] };
  }

  const api = Object.freeze({ FALLBACK_LANGUAGE, MESSAGES, getMessages, normalizeLanguage });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.window === root) root.ESPIDE_PICKER_I18N = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
