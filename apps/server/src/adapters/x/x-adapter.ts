import type { SocialAdapter } from "../social-adapter.ts";
import type { XClient } from "./x-client.ts";

export class XAdapter implements SocialAdapter {
  private readonly client: XClient;

  constructor(client: XClient) {
    this.client = client;
  }

  fetchAccount(username: string) { return this.client.fetchAccount(username); }

  fetchTimelinePage(account: import("@fast-social/contracts").SocialAccount, cursor?: string, surface?: "posts" | "replies") {
    return this.client.fetchTimelinePage(account, cursor, surface);
  }

  fetchRecentPosts(username: string, cookieId?: string) {
    return this.client.fetchRecentPosts(username, cookieId);
  }
}
