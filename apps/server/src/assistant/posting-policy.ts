import { postingPolicy, type AssistantContext, type PostingPolicy, type SocialAccount } from '@fast-social/contracts';
import type { ConfigurationRepository } from '../configuration/repository.ts';
import { AccountRequestLimitError } from '../configuration/request-limits.ts';

export interface AccountReader { fetchAccount(username: string, cookieId?: string): Promise<SocialAccount> }
export class PostingPolicyResolver {
  private accounts: ConfigurationRepository;
  private reader?: AccountReader;
  private verified = new Map<string, { until: number; value: Promise<boolean | undefined> }>();
  constructor(accounts: ConfigurationRepository, reader?: AccountReader) { this.accounts = accounts; this.reader = reader; }
  async resolve(identity: AssistantContext['account']): Promise<PostingPolicy> {
    const id = this.accounts.resolve(identity.actorId, identity.username).accountId;
    const account = this.accounts.accounts().find(a => a.id === id);
    let blue = identity.blueVerified;
    if (blue !== true && account?.cookieConfigured && account.status !== 'invalid' && this.reader) {
      const key = `${account.id}:${identity.actorId}:${identity.username.toLowerCase()}`;
      let cached = this.verified.get(key);
      if (!cached || cached.until < Date.now()) {
        const reader = this.reader;
        const value = reader.fetchAccount(identity.username || account.username, account.id).then(profile => {
          // A viewed author's badge or a wrongly configured username must never grant the current account long posts.
          if (identity.actorId && profile.id !== identity.actorId) return undefined;
          if (profile.username.toLowerCase() !== (identity.username || account.username).toLowerCase()) return undefined;
          return profile.blueVerified;
        }).catch(error => {
          if (error instanceof AccountRequestLimitError) { this.verified.delete(key); throw error; }
          return undefined;
        });
        cached = { until: Date.now() + 60_000, value };
        this.verified.set(key, cached);
      }
      blue = (await cached.value) ?? blue;
    }
    return postingPolicy(blue);
  }
}
