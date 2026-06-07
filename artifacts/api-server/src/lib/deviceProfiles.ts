/**
 * DEVICE PROFILE POOL — P2-1: Device Diversity
 *
 * Each Telegram account gets a unique, realistic device fingerprint.
 * This makes every client look like a different real Android/iOS device,
 * dramatically reducing bot-detection probability.
 */

export interface DeviceProfile {
  deviceModel: string;
  systemVersion: string;
  appVersion: string;
  systemLangCode: string;
  langPack: string;
}

const DEVICE_PROFILES: DeviceProfile[] = [
  { deviceModel: "Samsung Galaxy S23 Ultra", systemVersion: "Android 14", appVersion: "10.9.1", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Samsung Galaxy S22", systemVersion: "Android 13", appVersion: "10.8.3", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Samsung Galaxy A54 5G", systemVersion: "Android 13", appVersion: "10.7.4", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Samsung Galaxy M34", systemVersion: "Android 12", appVersion: "10.6.2", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Xiaomi 13 Pro", systemVersion: "Android 13", appVersion: "10.9.1", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Xiaomi Redmi Note 12", systemVersion: "Android 12", appVersion: "10.8.3", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Xiaomi Redmi 10C", systemVersion: "Android 11", appVersion: "10.7.4", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "POCO X5 Pro", systemVersion: "Android 12", appVersion: "10.8.1", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Huawei Nova 11", systemVersion: "Android 12", appVersion: "10.6.2", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Huawei Y9s", systemVersion: "Android 10", appVersion: "10.5.0", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Oppo A78", systemVersion: "Android 13", appVersion: "10.8.3", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Oppo Reno 10", systemVersion: "Android 13", appVersion: "10.9.1", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Vivo Y36", systemVersion: "Android 13", appVersion: "10.7.4", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "OnePlus Nord CE 3", systemVersion: "Android 13", appVersion: "10.8.3", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Realme C55", systemVersion: "Android 13", appVersion: "10.8.1", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Motorola Moto G84", systemVersion: "Android 13", appVersion: "10.9.1", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "Nokia G42 5G", systemVersion: "Android 13", appVersion: "10.7.4", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "iPhone 14 Pro", systemVersion: "17.4.1", appVersion: "10.9.1", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "iPhone 13", systemVersion: "16.7.5", appVersion: "10.8.3", systemLangCode: "ar", langPack: "tdesktop" },
  { deviceModel: "iPhone 12 mini", systemVersion: "16.6.1", appVersion: "10.7.4", systemLangCode: "ar", langPack: "tdesktop" },
];

/**
 * Pick a random device profile from the pool.
 */
export function getRandomDeviceProfile(): DeviceProfile {
  const idx = Math.floor(Math.random() * DEVICE_PROFILES.length);
  return { ...DEVICE_PROFILES[idx] };
}

/**
 * Get a deterministic profile for a given phone number.
 * Uses a simple hash so the same phone always gets the same profile.
 */
export function getDeviceProfileForPhone(phone: string): DeviceProfile {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) {
    hash = (hash * 31 + phone.charCodeAt(i)) >>> 0;
  }
  return { ...DEVICE_PROFILES[hash % DEVICE_PROFILES.length] };
}
