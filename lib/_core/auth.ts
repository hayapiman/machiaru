import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { SESSION_TOKEN_KEY, USER_INFO_KEY } from "@/constants/runtime";

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: Date;
};

type AuthUserListener = (user: User | null) => void;
const authUserListeners = new Set<AuthUserListener>();
let webSessionToken: string | null = null;

export function subscribeToUserInfo(listener: AuthUserListener): () => void {
  authUserListeners.add(listener);
  return () => authUserListeners.delete(listener);
}

function publishUserInfo(user: User | null): void {
  for (const listener of authUserListeners) listener(user);
}

export async function getSessionToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      // Short-lived email sessions use per-tab storage as a Bearer fallback for embedded Preview cookies.
      if (typeof window === "undefined") return webSessionToken;
      try {
        return window.sessionStorage.getItem(SESSION_TOKEN_KEY) ?? webSessionToken;
      } catch {
        return webSessionToken;
      }
    }

    // Use SecureStore for native
    console.log("[Auth] Getting session token...");
    const token = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
    return token;
  } catch {
    console.error("[Auth] Failed to get session token");
    return null;
  }
}

export async function setSessionToken(token: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      webSessionToken = token;
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
        } catch {
          // Keep the token in memory for this page when browser storage is unavailable.
        }
      }
      return;
    }

    // Use SecureStore for native
    console.log("[Auth] Setting session token...");
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
    console.log("[Auth] Session token stored in SecureStore successfully");
  } catch (error) {
    console.error("[Auth] Failed to set session token");
    throw error;
  }
}

export async function removeSessionToken(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      webSessionToken = null;
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
        } catch {
          // The in-memory fallback above is cleared even when browser storage is unavailable.
        }
      }
      return;
    }

    // Use SecureStore for native
    console.log("[Auth] Removing session token...");
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    console.log("[Auth] Session token removed from SecureStore successfully");
  } catch {
    console.error("[Auth] Failed to remove session token");
  }
}

export async function getUserInfo(): Promise<User | null> {
  try {
    console.log("[Auth] Getting user info...");

    let info: string | null = null;
    if (Platform.OS === "web") {
      // Use localStorage for web
      info = window.localStorage.getItem(USER_INFO_KEY);
    } else {
      // Use SecureStore for native
      info = await SecureStore.getItemAsync(USER_INFO_KEY);
    }

    if (!info) {
      console.log("[Auth] No user info found");
      return null;
    }
    const user = JSON.parse(info);
    console.log("[Auth] User info retrieved");
    return user;
  } catch {
    console.error("[Auth] Failed to get user info");
    return null;
  }
}

export async function setUserInfo(user: User): Promise<void> {
  try {
    console.log("[Auth] Setting user info...");

    if (Platform.OS === "web") {
      // Use localStorage for web
      window.localStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
      console.log("[Auth] User info stored in localStorage successfully");
    } else {
      // Use SecureStore for native
      await SecureStore.setItemAsync(USER_INFO_KEY, JSON.stringify(user));
      console.log("[Auth] User info stored in SecureStore successfully");
    }
  } catch {
    console.error("[Auth] Failed to set user info");
  }
  publishUserInfo(user);
}

export async function clearUserInfo(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      // Use localStorage for web
      window.localStorage.removeItem(USER_INFO_KEY);
    } else {
      // Use SecureStore for native
      await SecureStore.deleteItemAsync(USER_INFO_KEY);
    }
  } catch {
    console.error("[Auth] Failed to clear user info");
  }
  publishUserInfo(null);
}
