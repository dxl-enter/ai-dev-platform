
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
      const report = this.generateReviewReport(reviewResult, securityIssues, changedFiles
