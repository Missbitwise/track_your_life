import type { PublicDesktopUser } from "../shared.js";

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  user: PublicDesktopUser;
}

export interface ApiReminder {
  id: number;
  user_id: number;
  task_id: number | null;
  scheduled_at: string;
  status: "scheduled" | "sent" | "cancelled";
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export class BackendClient {
  private auth: StoredAuth | null = null;
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private apiOrigin: string,
    private readonly readSecrets: () => Promise<string | null>,
    private readonly writeSecrets: (value: string) => Promise<void>,
    private readonly clearStoredSecrets: () => Promise<void>,
  ) {}

  setApiOrigin(value: string): void {
    this.apiOrigin = validateApiOrigin(value);
  }

  getUser(): PublicDesktopUser | null {
    return this.auth?.user ?? null;
  }

  async restore(): Promise<void> {
    const serialized = await this.readSecrets();
    if (!serialized) return;
    try {
      this.auth = JSON.parse(serialized) as StoredAuth;
    } catch {
      await this.clearStoredSecrets();
    }
  }

  async login(email: string, password: string): Promise<PublicDesktopUser> {
    const result = await this.rawRequest<{ accessToken: string; refreshToken: string; user: PublicDesktopUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.auth = { accessToken: result.accessToken, refreshToken: result.refreshToken, user: result.user };
    await this.persistAuth();
    return result.user;
  }

  async logout(): Promise<void> {
    try {
      if (this.auth) await this.authorizedRequest("/api/auth/logout", { method: "POST" });
    } finally {
      this.auth = null;
      await this.clearStoredSecrets();
    }
  }

  async listReminders(): Promise<ApiReminder[]> {
    return this.authorizedRequest<ApiReminder[]>("/api/reminders");
  }

  async markSent(reminderId: number): Promise<void> {
    await this.authorizedRequest(`/api/reminders/${reminderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "sent" }),
    });
  }

  private async authorizedRequest<T>(route: string, init: RequestInit = {}): Promise<T> {
    if (!this.auth) throw new Error("Please sign in to synchronize reminders");
    let response = await this.fetchWithToken(route, init);
    if (response.status === 401) {
      await this.refresh();
      response = await this.fetchWithToken(route, init);
    }
    if (!response.ok) throw new Error(`Backend request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async fetchWithToken(route: string, init: RequestInit): Promise<Response> {
    return fetch(new URL(route, this.apiOrigin), {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
        Authorization: `Bearer ${this.auth!.accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
  }

  private async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      if (!this.auth) throw new Error("Please sign in again");
      try {
        const tokens = await this.rawRequest<TokenResponse>("/api/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: this.auth.refreshToken }),
        });
        this.auth = { ...this.auth, ...tokens };
        await this.persistAuth();
      } catch {
        this.auth = null;
        await this.clearStoredSecrets();
        throw new Error("Your session expired. Please sign in again.");
      }
    })();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async persistAuth(): Promise<void> {
    if (this.auth) await this.writeSecrets(JSON.stringify(this.auth));
  }

  private async rawRequest<T>(route: string, init: RequestInit): Promise<T> {
    const response = await fetch(new URL(route, this.apiOrigin), {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      let message = `Backend request failed (${response.status})`;
      try {
        const body = await response.json() as { error?: string };
        if (body.error) message = body.error;
      } catch { /* Keep the generic response message. */ }
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  }
}

export function validateApiOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid backend URL");
  }
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("Use HTTPS for the backend URL (HTTP is allowed for localhost)");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}
