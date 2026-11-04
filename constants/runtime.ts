import Constants from "expo-constants";
import * as ReactNative from "react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;
const API_BASE_URL = extra.apiBaseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

/**
 * Get the API base URL, deriving from current hostname if not set.
 * Metro runs on 8081, API server runs on 3000.
 * URL pattern: https://PORT-sandboxid.region.domain
 */
export function getApiBaseUrl(): string {
  if (API_BASE_URL) {
    return API_BASE_URL.replace(/\/$/, "");
  }

  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    const apiHostname = hostname.replace(/^8081-/, "3000-");
    if (apiHostname !== hostname) {
      return `${protocol}//${apiHostname}`;
    }
  }

  return "";
}

// Keep these persisted keys stable for existing installed clients.
export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "manus-runtime-user-info";
