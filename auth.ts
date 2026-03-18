import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (!cachedAuth) {
    cachedAuth = new GoogleAuth({ scopes: SCOPES });
  }
  return cachedAuth;
}

export async function getValidCredentials(): Promise<GoogleAuth> {
  const auth = getAuth();
  // Validate that credentials are available
  await auth.getClient();
  return auth;
}

export async function loadCredentialsQuietly(): Promise<GoogleAuth | null> {
  try {
    return await getValidCredentials();
  } catch (error) {
    console.error("Failed to load ADC credentials:", error);
    return null;
  }
}

export function setupTokenRefresh() {
  // ADC handles token refresh automatically
}
