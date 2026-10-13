import type { SocialAccount, SocialPost } from '@fast-social/contracts';
import { INPUT_BUDGET, inputSize, type BatchInput } from './batch-matcher.ts';

/** Shared by the following list and manual listener portrait refresh. */
export function portraitInput(account: SocialAccount, posts: SocialPost[]): BatchInput {
  const input: BatchInput = { account, memory: {}, context: [], rules: [], includeBio: true,
    posts: [...new Map(posts.filter(post => post.type !== 'repost').map(post => [post.id, post])).values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, 'en', { numeric: true })).slice(-10) };
  // Keep full source text; reduce the sample instead of truncating a post.
  while (inputSize(input) > INPUT_BUDGET && input.posts.length > 1) input.posts.shift();
  return input;
}
