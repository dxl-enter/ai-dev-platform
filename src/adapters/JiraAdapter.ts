import { InputAdapter } from './InputAdapter';
import { NormalizedInput } from '../types';
import { logger } from '../utils/logger';
import axios from 'axios';

export class JiraAdapter implements InputAdapter {
  readonly name = 'jira';
  
  private jiraUrl: string;
  private jiraToken: string;

  constructor() {
    this.jiraUrl = process.env.JIRA_URL || '';
    this.jiraToken = process.env.JIRA_TOKEN || '';
  }

  async normalize(rawInput: any): Promise<NormalizedInput> {
    logger.debug('处理JIRA输入...');

    // 支持两种模式：直接传入issue数据，或通过issueKey拉取
    if (rawInput.fields) {
      return this.normalizeFromIssue(rawInput);
    }

    if (rawInput.key || rawInput.issueKey) {
      const issueKey = rawInput.key || rawInput.issueKey;
      const issue = await this.fetchIssue(issueKey);
      return this.normalizeFromIssue(issue);
    }

    throw new Error('无效的JIRA输入');
  }

  /**
   * 从JIRA API拉取issue
   */
  private async fetchIssue(issueKey: string): Promise<any> {
    if (!this.jiraUrl || !this.jiraToken) {
      throw new Error('JIRA配置缺失，请设置 JIRA_URL 和 JIRA_TOKEN 环境变量');
    }

    const response = await axios.get(
      `${this.jiraUrl}/rest/api/2/issue/${issueKey}`,
      {
        headers: {
          'Authorization': `Bearer ${this.jiraToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  /**
   * 标准化JIRA issue
   */
  private normalizeFromIssue(issue: any): NormalizedInput {
    const fields = issue.fields || {};

    return {
      title: fields.summary || issue.key || '未命名',
      description: fields.description || '',
      priority: this.mapPriority(fields.priority?.name),
      attachments: (fields.attachment || []).map((a: any) => a.filename),
      source: 'jira',
      sourceId: issue.key || issue.id,
      author: fields.reporter?.displayName || fields.creator?.displayName || 'unknown',
      metadata: {
        issueType: fields.issuetype?.name,
        status: fields.status?.name,
        assignee: fields.assignee?.displayName,
        labels: fields.labels || [],
        sprint: fields.sprint?.name,
        epic: fields.epic?.name,
        storyPoints: fields.customfield_10004, // 常见自定义字段
      },
    };
  }

  private mapPriority(jiraPriority?: string): 'high' | 'medium' | 'low' {
    if (!jiraPriority) return 'medium';
    const p = jiraPriority.toLowerCase();
    if (p.includes('highest') || p.includes('high') || p.includes('critical')) return 'high';
    if (p.includes('low') || p.includes('minor')) return 'low';
    return 'medium';
  }

  validate(rawInput: any): boolean {
    return !!(rawInput.key || rawInput.issueKey || rawInput.fields);
  }
}
