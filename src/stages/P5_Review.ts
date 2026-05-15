// src/stages/P5_Review.ts

import { StageHandler } from './StageHandler';
import { StageContext, StageResult, ReviewResult, ReviewIssue, SecurityIssue } from '../types';
import { llmClient } from '../llm/LLMClient';
import { Prompts } from '../llm/prompts';
import { GitManager } from '../utils/git';
import { FileManager } from '../utils/fs';
import { logger } from '../utils/logger';
import * as path from 'path';

export class P5_Review implements StageHandler {
  readonly name = 'P5_Review';
  private gitManager: GitManager;

  constructor() {
    this.gitManager = new GitManager();
  }

  async execute(context: StageContext): Promise<StageResult> {
    logger.info('🔍 代码审查...');

    const { featureName, featurePath } = context;

    try {
      // 获取变更文件
      const changedFiles = await this.gitManager.getChangedFiles();
      
      if (changedFiles.length === 0) {
        logger.warn('没有变更文件');
        return {
          stage: 'P5',
          status: 'completed',
          output: { changedFiles: [], issues: [], score: 100 },
          nextAction: 'proceed',
        };
      }

      // 读取specs
      const specs = await this.loadSpecs(featurePath);

      // 读取所有变更文件内容
      const fileContents: Record<string, string> = {};
      for (const file of changedFiles) {
        const content = await FileManager.readFileSafe(
          path.join(process.cwd(), file)
        );
        if (content) {
          fileContents[file] = content;
        }
      }

      // 调用AI审查
      const reviewPrompt = Prompts.P5_USER(
        changedFiles.map(f => `${f}\n\`\`\`\n${(fileContents[f] || '').substring(0, 2000)}\n\`\`\``),
        specs
      );

      const reviewResponse = await llmClient.reviewer({
        systemPrompt: Prompts.P5_SYSTEM,
        userPrompt: reviewPrompt,
      });

      // 解析审查结果
      const reviewResult = this.parseReviewResponse(reviewResponse, changedFiles);

      // 安全检查
      const securityIssues = this.performSecurityCheck(fileContents);

      // 生成审查报告
      const report = this.generateReviewReport(reviewResult, securityIssues, changedFiles);

      // 保存审查报告
      const reportPath = path.join(featurePath, 'review-report.md');
      await FileManager.writeFile(reportPath, report);

      logger.info(`✅ 审查完成:`);
      logger.info(`   文件数: ${changedFiles.length}`);
      logger.info(`   问题数: ${reviewResult.issues.length}`);
      logger.info(`   安全问题: ${securityIssues.length}`);
      logger.info(`   评分: ${reviewResult.score}/100`);

      return {
        stage: 'P5',
        status: reviewResult.passed ? 'completed' : 'needs_refinement',
        output: {
          reviewResult,
          securityIssues,
          changedFiles,
          reportPath,
          score: reviewResult.score,
          passed: reviewResult.passed,
        },
        nextAction: reviewResult.passed ? 'proceed' : 'human_gate',
        artifacts: [reportPath],
      };

    } catch (error: any) {
      logger.error(`P5 失败: ${error.message}`);
      return {
        stage: 'P5',
        status: 'failed',
        output: null,
        nextAction: 'retry',
        errors: [error.message],
      };
    }
  }

  /**
   * 加载所有spec文件
   */
  private async loadSpecs(featurePath: string): Promise<string> {
    const specFiles = ['requirements.md', 'design.md', 'tasks.md'];
    const contents: string[] = [];

    for (const file of specFiles) {
      const content = await FileManager.readFileSafe(path.join(featurePath, file));
      if (content) {
        contents.push(`## ${file}\n${content}`);
      }
    }

    return contents.join('\n\n');
  }

  /**
   * 解析AI审查结果
   */
  private parseReviewResponse(
    response: string,
    changedFiles: string[]
  ): ReviewResult {
    const issues: ReviewIssue[] = [];
    let score = 80; // 默认评分

    // 提取评分
    const scoreMatch = response.match(/(?:评分|score)[：:]\s*(\d+)/i);
    if (scoreMatch) {
      score = parseInt(scoreMatch[1]);
    }

    // 提取问题
    const lines = response.split('\n');
    let currentFile = '';
    let currentLine = 0;

    for (const line of lines) {
      // 检测文件名
      for (const file of changedFiles) {
        if (line.includes(file)) {
          currentFile = file;
          break;
        }
      }

      // 检测行号
      const lineMatch = line.match(/(?:行|line|:)(\d+)/i);
      if (lineMatch) {
        currentLine = parseInt(lineMatch[1]);
      }

      // 检测问题
      if (line.match(/^[-*]\s*(?:❌|⚠️|💡|错误|警告|建议)/)) {
        const severity = line.includes('❌') || line.includes('错误') 
          ? 'error' 
          : line.includes('⚠️') || line.includes('警告')
            ? 'warning'
            : 'info';

        issues.push({
          file: currentFile,
          line: currentLine,
          severity,
          message: line.replace(/^[-*]\s*(?:❌|⚠️|💡)\s*/, '').trim(),
          suggestion: undefined,
        });
      }
    }

    return {
      passed: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      securityIssues: [],
      specIssues: [],
      score,
    };
  }

  /**
   * 执行安全检查
   */
  private performSecurityCheck(
    fileContents: Record<string, string>
  ): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    
    const securityPatterns: Array<{
      pattern: RegExp;
      type: string;
      severity: SecurityIssue['severity'];
      description: string;
    }> = [
      {
        pattern: /password\s*=\s*['"][^'"]+['"]/i,
        type: '硬编码密码',
        severity: 'critical',
        description: '代码中包含硬编码的密码',
      },
      {
        pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/i,
        type: '硬编码API密钥',
        severity: 'critical',
        description: '代码中包含硬编码的API密钥',
      },
      {
        pattern: /eval\s*\(/,
        type: 'eval使用',
        severity: 'high',
        description: '使用了eval函数，存在代码注入风险',
      },
      {
        pattern: /innerHTML\s*=/,
        type: 'XSS风险',
        severity: 'high',
        description: '直接设置innerHTML可能导致XSS攻击',
      },
      {
        pattern: /\.execute\s*\(\s*['"`].*\$\{/,
        type: 'SQL注入风险',
        severity: 'critical',
        description: 'SQL语句中使用字符串拼接，存在注入风险',
      },
      {
        pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/i,
        type: '不安全的HTTP',
        severity: 'medium',
        description: '使用了不安全的HTTP连接',
      },
    ];

    for (const [file, content] of Object.entries(fileContents)) {
      for (const pattern of securityPatterns) {
        if (pattern.pattern.test(content)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (pattern.pattern.test(lines[i])) {
              issues.push({
                type: pattern.type,
                severity: pattern.severity,
                description: pattern.description,
                location: `${file}:${i + 1}`,
              });
            }
          }
        }
      }
    }

    return issues;
  }

  /**
   * 生成审查报告
   */
  private generateReviewReport(
    review: ReviewResult,
    securityIssues: SecurityIssue[],
    changedFiles: string[]
  ): string {
    const sections = [
      `# 代码审查报告`,
      '',
      `## 概要`,
      `- 审查时间: ${new Date().toISOString()}`,
      `- 变更文件: ${changedFiles.length} 个`,
      `- 评分: ${review.score}/100`,
      `- 状态: ${review.passed ? '✅ 通过' : '⚠️ 需要改进'}`,
      '',
      `## 变更文件`,
      ...changedFiles.map(f => `- ${f}`),
      '',
    ];

    if (review.issues.length > 0) {
      sections.push('## 代码问题');
      sections.push('');
      
      const errors = review.issues.filter(i => i.severity === 'error');
      const warnings = review.issues.filter(i => i.severity === 'warning');
      const infos = review.issues.filter(i => i.severity === 'info');

      if (errors.length > 0) {
        sections.push('### ❌ 错误');
        errors.forEach(i => {
          sections.push(`- **${i.file}:${i.line}** - ${i.message}`);
        });
        sections.push('');
      }

      if (warnings.length > 0) {
        sections.push('### ⚠️ 警告');
        warnings.forEach(i => {
          sections.push(`- **${i.file}:${i.line}** - ${i.message}`);
        });
        sections.push('');
      }

      if (infos.length > 0) {
        sections.push('### 💡 建议');
        infos.forEach(i => {
          sections.push(`- **${i.file}:${i.line}** - ${i.message}`);
        });
        sections.push('');
      }
    }

    if (securityIssues.length > 0) {
      sections.push('## 🔒 安全问题');
      sections.push('');
      
      const critical = securityIssues.filter(i => i.severity === 'critical');
      const high = securityIssues.filter(i => i.severity === 'high');
      
      if (critical.length > 0) {
        sections.push('### 🚨 严重');
        critical.forEach(i => {
          sections.push(`- **${i.location}** - ${i.description}`);
        });
        sections.push('');
      }
      
      if (high.length > 0) {
        sections.push('### ⚠️ 高危');
        high.forEach(i => {
          sections.push(`- **${i.location}** - ${i.description}`);
        });
        sections.push('');
      }
    }

    return sections.join('\n');
  }
}
