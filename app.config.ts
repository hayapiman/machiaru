// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "space.manus.machiaru.t131842472731373";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
// Extract timestamp from bundle ID and prefix with "manus" for deep link scheme
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "まちある",
  appSlug: "machiaru",
  // S3 URL of the app logo - set this to the URL returned by generate_image when creating custom logo
  // Leave empty to use the default icon from assets/images/icon.png
  logoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519664029594046/zkOweoknBAKklTcJ.png",
  scheme: schemeFromBundleId,
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

// Expo serializes this browser-safe subset into native and web bundles. The server-only
// MANUS_API_KEY and MANUS_JWT_SECRET must never enter this object.
const publicRuntime = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() ||
    (process.env.EXPO_PUBLIC_API_BASE_URL?.trim()
      ? `${process.env.EXPO_PUBLIC_API_BASE_URL.trim().replace(/\/$/, "")}/api/legal/privacy`
      : ""),
  supportUrl: process.env.EXPO_PUBLIC_SUPPORT_URL?.trim() ||
    (process.env.EXPO_PUBLIC_API_BASE_URL?.trim()
      ? `${process.env.EXPO_PUBLIC_API_BASE_URL.trim().replace(/\/$/, "")}/api/legal/support`
      : ""),
  operatorName: process.env.EXPO_PUBLIC_OPERATOR_NAME?.trim() ?? "",
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() ?? "",
};

const transientHostSuffixes = [
  ".manus.computer",
  ".ngrok.io",
  ".ngrok-free.app",
  ".trycloudflare.com",
  ".loca.lt",
  ".localtunnel.me",
  ".devtunnels.ms",
];

function assertStablePublicHttpsUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a stable public HTTPS URL.`);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipLiteral = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || /^\[[0-9a-f:]+\]$/i.test(hostname);
  const transientHost = transientHostSuffixes.some((suffix) =>
    hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    ipLiteral ||
    !hostname.includes(".") ||
    transientHost
  ) {
    throw new Error(`${label} must use a stable public HTTPS domain, not localhost, an IP address, Preview, or a temporary tunnel.`);
  }
}

if (process.env.EAS_BUILD_PROFILE === "production") {
  assertStablePublicHttpsUrl(publicRuntime.apiBaseUrl, "EXPO_PUBLIC_API_BASE_URL");
  if (!publicRuntime.operatorName.trim()) {
    throw new Error("Set EXPO_PUBLIC_OPERATOR_NAME before creating an App Store build.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicRuntime.supportEmail.trim())) {
    throw new Error("Set a valid public EXPO_PUBLIC_SUPPORT_EMAIL before creating an App Store build.");
  }
  assertStablePublicHttpsUrl(publicRuntime.privacyPolicyUrl, "EXPO_PUBLIC_PRIVACY_POLICY_URL");
  assertStablePublicHttpsUrl(publicRuntime.supportUrl, "EXPO_PUBLIC_SUPPORT_URL");
}

const config: ExpoConfig & { logoUrl: string } = {
  name: env.appName,
  slug: env.appSlug,
  logoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519664029594046/zkOweoknBAKklTcJ.png",
  version: "1.0.0",
  extra: {
    ...publicRuntime,
    eas: { projectId: "cdf625e2-939c-484c-bbcf-8ccf0d35a11e" },
  },
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS", "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "ACTIVITY_RECOGNITION"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-image",
    "expo-secure-store",
    "expo-status-bar",
    "expo-web-browser",
    "expo-asset",
    ["expo-image-picker", { photosPermission: "訪問した場所の記録に写真へのアクセスを許可します。" }],
    [
      "expo-location",
      {
        locationWhenInUsePermission: "歩行ルートを地図に記録し、現在地を表示するため、使用中の位置情報にアクセスします。",
        locationAlwaysAndWhenInUsePermission: "歩行中に画面をロックしている間もルートを記録するため、位置情報を利用します。位置情報の記録は歩行記録中のみ行います。",
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    ["expo-sensors", { motionPermission: "歩数を記録するため、モーションデータへのアクセスを許可します。" }],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
