import type { SocialAdapter } from "../social-adapter.ts";
import type { XClient } from "./x-client.ts";

export class XAdapter implements SocialAdapter {
  private readonly client: XClient;

  constructor(client: XClient) {
    this.client = client;
  }

  fetchRecentPosts(username: string) {
    return this.client.fetchRecentPosts(username);
  }
}
