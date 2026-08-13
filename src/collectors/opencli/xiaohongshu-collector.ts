import type { UnifiedMaterial } from '../../types.js';
import { createBrowserMaterial } from './material-factory.js';
import {
  summarizePlatformStatus,
  terminalPlatformStatus,
  type BrowserPlatformResult,
  type OpenCliStatus,
} from './opencli-capability.js';
import { OpenCliRunner, toCommandSummary } from './opencli-runner.js';
import type { XiaohongshuCollectorConfig } from './platform-config.js';
import { selectRotatedQueries } from './query-budget.js';
import {
  parseXiaohongshuComments,
  parseXiaohongshuDetail,
  parseXiaohongshuSearch,
  type XiaohongshuComment,
} from './parsers/xiaohongshu-parser.js';

function noteIdFromUrl(rawUrl: string): string {
  return rawUrl.match(/\/(?:search_result|explore|note)\/([0-9a-f]{24})/i)?.[1] ?? '';
}

function topQuestions(comments: XiaohongshuComment[]): string[] {
  return comments
    .filter((comment) => /[？?]|怎么|如何|哪里|什么|求/.test(comment.text))
    .sort((left, right) => (right.likes ?? 0) - (left.likes ?? 0))
    .slice(0, 3)
    .map((comment) => comment.text);
}

export class XiaohongshuCollector {
  constructor(
    private readonly runner: OpenCliRunner,
    private readonly config: XiaohongshuCollectorConfig,
  ) {}

  async collect(now = new Date(), signal?: AbortSignal): Promise<BrowserPlatformResult> {
    const commands = [];
    const materials: UnifiedMaterial[] = [];
    const failures: OpenCliStatus[] = [];
    let commentNotes = 0;
    let hardStop = false;
    const queries = selectRotatedQueries(this.config.queries, Math.min(4, this.config.max_queries_per_run), now);

    for (const query of queries) {
      if (hardStop) break;
      const search = await this.runner.run([
        'xiaohongshu', 'search', query.query,
        '--limit', String(Math.min(10, this.config.max_results_per_query)),
        '-f', 'json',
      ], { signal });
      commands.push(toCommandSummary(search));
      if (search.status !== 'success') {
        failures.push(search.status);
        if (terminalPlatformStatus(search.status)) hardStop = true;
        continue;
      }

      let candidates;
      try {
        candidates = parseXiaohongshuSearch(search.data)
          .sort((left, right) => (right.likes ?? -1) - (left.likes ?? -1) || left.rank - right.rank)
          .slice(0, Math.min(3, this.config.max_details_per_query));
      } catch {
        failures.push('command_failed');
        continue;
      }

      for (const candidate of candidates) {
        const detailRun = await this.runner.run(['xiaohongshu', 'note', candidate.url, '-f', 'json'], { signal });
        commands.push(toCommandSummary(detailRun));
        if (detailRun.status !== 'success') {
          failures.push(detailRun.status);
          if (terminalPlatformStatus(detailRun.status)) hardStop = true;
          if (hardStop) break;
          continue;
        }

        let detail;
        try {
          detail = parseXiaohongshuDetail(detailRun.data);
        } catch {
          failures.push('command_failed');
          continue;
        }

        let comments: XiaohongshuComment[] = [];
        if (commentNotes < Math.min(3, this.config.max_comment_notes_per_run)) {
          const commentsRun = await this.runner.run([
            'xiaohongshu', 'comments', candidate.url,
            '--limit', String(Math.min(10, this.config.max_comments_per_note)),
            '--with-replies', 'true',
            '-f', 'json',
          ], { signal });
          commands.push(toCommandSummary(commentsRun));
          commentNotes += 1;
          if (commentsRun.status === 'success') {
            try {
              comments = parseXiaohongshuComments(commentsRun.data);
            } catch {
              failures.push('command_failed');
            }
          } else {
            failures.push(commentsRun.status);
            if (terminalPlatformStatus(commentsRun.status)) hardStop = true;
          }
        }

        const questions = topQuestions(comments);
        const excerpt = [detail.content, questions.length ? `评论区高赞问题：${questions.join('；')}` : '']
          .filter(Boolean)
          .join('\n')
          .slice(0, 1_000);
        materials.push(createBrowserMaterial({
          sourcePlatform: 'xiaohongshu',
          collector: 'opencli-xiaohongshu',
          queryId: query.id,
          queryText: query.query,
          searchRank: candidate.rank,
          sourceItemId: noteIdFromUrl(candidate.url),
          authorName: detail.author || candidate.author,
          title: detail.title || candidate.title,
          excerpt,
          sourceUrl: candidate.url,
          publishedAt: candidate.published_at,
          publishedAtQuality: 'inferred',
          collectedAt: now.toISOString(),
          engagement: {
            likes: detail.likes ?? candidate.likes,
            collects: detail.collects,
            comments: detail.comments,
          },
          usageMode: 'trend_signal',
          viralConfidence: 'candidate',
        }));
        if (hardStop) break;
      }
    }

    return {
      platform: 'xiaohongshu',
      status: summarizePlatformStatus(commands.filter((command) => command.status === 'success').length, failures),
      started_at: now.toISOString(),
      finished_at: new Date().toISOString(),
      commands,
      materials,
      missing_fields: ['author_followers', 'views', 'shares', 'reposts', 'quotes', 'bookmarks'],
      error: [...commands].reverse().find((command) => command.error)?.error ?? null,
    };
  }
}
