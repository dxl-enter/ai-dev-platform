import { InputAdapter } from './InputAdapter';
import { NormalizedInput } from '../types';
import { logger } from '../utils/logger';

export class GithubAdapter implements InputAdapter {
  readonly name = 'github';

  async normalize(rawInput: any): Promise<NormalizedInput> {
    logger.debug('处理GitHub输入...');

    // 支持Issue和PR两种格式
    if (rawInput.issue) {
      return this.normalizeFromIssue(rawInput.issue);
    }

    if (rawInput.pull_request) {
      return this.normalizeFromPR(rawInput.pull_request);
    }

    // 直接传入的Issue对象
    if (rawInput.title && rawInput.body) {
      return this.normalizeFromIssue(rawInput);
    }

    throw new Error('无效的GitHub输入');
  }

  private normalizeFromIssue(issue: any): NormalizedInput {
    return {
      title: issue.title || '未命名',
      description: issue.body || '',
      priority: this.mapPriority(issue.labels),
      attachments: [],
      source: 'github',
      sourceId: `#${issue.number}`,
      author: issue.user?.login || 'unknown',
      metadata: {
        issueNumber: issue.number,
        state: issue.state,
        labels: (issue.labels || []).map((l: any) => l.name),
        assignees: (issue.assignees || []).map((a: any) => a.login),
        milestone: issue.milestone?.title,
        url: issue.html_url,
      },
    };
  }

  private normalizeFromPR(pr: any): NormalizedInput {
    return {
      title: pr.title || '未命名',
      description: pr.body || '',
      priority: 'high', // PR通常优先级高
      attachments: [],
      source: 'github',
      sourceId: `PR #${pr.number}`,
      author: pr.user?.login || 'unknown',
      metadata: {
        prNumber: pr.number,
        state: pr.state,
        baseBranch: pr.base?.ref,
        headBranch: pr.head?.ref,
        url: pr.html_url,
      },
    };
  }

  private mapPriority(labels?: any[]): 'high' | 'medium' | 'low' {
    if (!labels) return 'medium';
    const labelNames = labels.map((l: any) => 
      typeof l === 'string' ? l.toLowerCase() : l.name?.toLowerCase() || ''
    );
    
    if (labelNames.some(l => l.includes('priority: high') || l.includes('p0') || l.includes('critical'))) {
      return 'high';
    }
    if (labelNames.some(l => l.includes('priority: low') || l.includes('p2'))) {
      return 'low';
    }
    return 'medium';
  }

  validate(rawInput: any): boolean {
    return !!(rawInput.title || rawInput.issue || rawInput.pull_request);
  }
}
