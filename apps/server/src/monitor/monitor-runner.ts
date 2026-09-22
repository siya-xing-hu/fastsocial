import type { Monitor, MonitorTestResult, SocialPost } from "@fast-social/contracts";
import type { SocialAdapter } from "../adapters/social-adapter.ts";
import type { AIMatcher } from "../ai/ai-matcher.ts";
import type { MonitorRepository } from "../repositories/monitor-repository.ts";
import type { TelegramNotifier } from "../telegram/telegram-notifier.ts";

export class MonitorRunner {
  private readonly monitors: MonitorRepository;
  private readonly social: SocialAdapter;
  private readonly matcher: AIMatcher;
  private readonly telegram: TelegramNotifier;

  constructor(dependencies: {
    monitors: MonitorRepository;
    social: SocialAdapter;
    matcher: AIMatcher;
    telegram: TelegramNotifier;
  }) {
    this.monitors = dependencies.monitors;
    this.social = dependencies.social;
    this.matcher = dependencies.matcher;
    this.telegram = dependencies.telegram;
  }

  async run(id: string): Promise<void> {
    const monitor = this.requireMonitor(id);
    let posts: SocialPost[];
    try {
      posts = await this.social.fetchRecentPosts(monitor.username);
    } catch (error) {
      this.monitors.updateRunState(id, {
        lastCheckedAt: new Date().toISOString(),
        lastError: errorMessage(error),
      });
      throw error;
    }

    const ordered = [...posts].sort(comparePosts);
    if (!monitor.lastSeenPostId && !monitor.lastCheckedAt) {
      this.monitors.updateRunState(id, {
        lastSeenPostId: ordered.at(-1)?.id ?? null,
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
      });
      return;
    }

    let lastError: string | null = null;
    const newPosts = monitor.lastSeenPostId
      ? postsAfter(ordered, monitor.lastSeenPostId)
      : ordered;
    for (const post of newPosts) {
      try {
        const evaluation = await this.matcher.evaluate(monitor.prompt, post);
        if (evaluation.matched) {
          await this.telegram.send(evaluation.message || `命中监控：${monitor.name}`, post);
        }
      } catch (error) {
        lastError = errorMessage(error);
      } finally {
        this.monitors.updateRunState(id, { lastSeenPostId: post.id });
      }
    }
    this.monitors.updateRunState(id, {
      lastCheckedAt: new Date().toISOString(),
      lastError,
    });
  }

  async test(id: string): Promise<MonitorTestResult> {
    const monitor = this.requireMonitor(id);
    const posts = await this.social.fetchRecentPosts(monitor.username);
    const post = [...posts].sort(comparePosts).at(-1);
    if (!post) throw new Error("没有找到可测试的帖子");
    return { post, evaluation: await this.matcher.evaluate(monitor.prompt, post) };
  }

  private requireMonitor(id: string): Monitor {
    const monitor = this.monitors.get(id);
    if (!monitor) throw new Error("监控规则不存在");
    return monitor;
  }
}

function postsAfter(posts: SocialPost[], cursor: string): SocialPost[] {
  const index = posts.findIndex((post) => post.id === cursor);
  if (index >= 0) return posts.slice(index + 1);
  try {
    const cursorId = BigInt(cursor);
    return posts.filter((post) => BigInt(post.id) > cursorId);
  } catch {
    return posts;
  }
}

function comparePosts(left: SocialPost, right: SocialPost): number {
  const time = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (Number.isFinite(time) && time !== 0) return time;
  try {
    const difference = BigInt(left.id) - BigInt(right.id);
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  } catch {
    return left.id.localeCompare(right.id);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
