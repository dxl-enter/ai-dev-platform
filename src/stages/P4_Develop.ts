// src/stages/P4_Develop.ts

import { StageHandler } from './StageHandler';
import { StageContext, StageResult, Task, TaskResult } from '../types';
import { llmClient } from '../llm/LLMClient';
import { Prompts } from '../llm/prompts';
import { DependencyGraph } from '../core/DependencyGraph';
import { FileManager } from '../utils/fs';
import { GitManager } from '../utils/git';
import { logger } from '../utils/logger';
import * as path from 'path';

export class P4_Develop implements StageHandler {
  readonly name = 'P4_Develop';
  private gitManager: GitManager;

  constructor() {
    this.gitManager = new GitManager();
  }

  async execute(context: StageContext): Promise<StageResult> {
    logger.info('💻 开始开发...');

    const { featureName, featurePath } = context;

    try {
      // 读取任务列表
      const tasksContent = await FileManager.readFileSafe(
        path.join(featurePath, 'tasks.md')
      );
      if (!tasksContent) {
        return {
          stage: 'P4',
          status: 'failed',
          output: null,
          nextAction: 'rollback',
          rollbackTo: 'P3',
          rollbackReason: '任务列表不存在',
          errors: ['tasks.md not found'],
        };
      }

      // 解析任务
      const tasks = this.parseTasksFromMarkdown(tasksContent);

      // 构建依赖图
      const depGraph = new DependencyGraph();
      depGraph.buildFromTasks(tasks);

      // 按拓扑排序执行
      const batches = depGraph.topologicalSort();
      const results: TaskResult[] = [];
      let hasSecurityCode = false;
      let specIssues: any[] = [];

      for (const batch of batches) {
        logger.info(`📦 执行批次 (${batch.length} 个任务并行)`);

        const batchResults = await Promise.all(
          batch.map(taskId => {
            const task = tasks.find(t => t.id === taskId)!;
            return this.executeTaskWithReviewer({
              task,
              featureName,
              featurePath,
              context,
            });
          })
        );

        // 收集结果
        for (const result of batchResults) {
          results.push(result);

          if (result.status === 'spec_issue') {
            specIssues.push(result);
          }

          if (result.status === 'completed') {
            // 提交代码
            await this.commitTask(result);
          }
        }

        // 如果有spec问题，立即回溯
        if (specIssues.length > 0) {
          return {
            stage: 'P4',
            status: 'needs_refinement',
            output: { results, specIssues, hasSecurityCode },
            nextAction: 'rollback',
            rollbackTo: specIssues[0].affectsStage || 'P2',
            rollbackReason: specIssues[0].description,
          };
        }
      }

      // 检查是否有安全敏感代码
      hasSecurityCode = results.some(r => 
        r.generatedFiles?.some(f => 
          f.includes('auth') || f.includes('security') || f.includes('payment')
        )
      );

      const completedCount = results.filter(r => r.status === 'completed').length;
      const failedCount = results.filter(r => r.status === 'failed').length;

      logger.info(`✅ 开发完成: ${completedCount}/${tasks.length} 成功`);
      if (failedCount > 0) {
        logger.warn(`   ${failedCount} 个任务失败`);
      }

      return {
        stage: 'P4',
        status: failedCount > 0 ? 'needs_refinement' : 'completed',
        output: {
          results,
          totalTasks: tasks.length,
          completedCount,
          failedCount,
          hasSecurityCode,
          generatedFiles: results.flatMap(r => r.generatedFiles || []),
        },
        nextAction: 'proceed',
        artifacts: results.flatMap(r => r.generatedFiles || []),
      };

    } catch (error: any) {
      logger.error(`P4 失败: ${error.message}`);
      return {
        stage: 'P4',
        status: 'failed',
        output: null,
        nextAction: 'retry',
        errors: [error.message],
      };
    }
  }

  /**
   * Agent + Reviewer 双人模式
   */
  private async executeTaskWithReviewer(opts: {
    task: Task;
    featureName: string;
    featurePath: string;
    context: StageContext;
  }): Promise<TaskResult> {
    const { task, featurePath, context } = opts;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      logger.info(`  ✍️  [Agent] ${task.id}: ${task.title} (尝试 ${attempts + 1}/${maxAttempts})`);

      // 1. Agent写代码
      const agentPrompt = Prompts.P4_AGENT_USER(
        task,
        context.assembledContext.taskContext || ''
      );

      const code = await llmClient.developer({
        systemPrompt: Prompts.P4_AGENT_SYSTEM,
        userPrompt: agentPrompt,
      });

      // 2. Reviewer审查
      logger.info(`  🔍 [Reviewer] 审查 ${task.id}`);
      const reviewPrompt = Prompts.P4_REVIEWER_USER(
        code,
        task,
        context.assembledContext.featureContext
      );

      const reviewResponse = await llmClient.reviewer({
        systemPrompt: Prompts.P4_REVIEWER_SYSTEM,
        userPrompt: reviewPrompt,
      });

      // 3. 解析审查结果
      const review = this.parseReviewResponse(reviewResponse);

      // 4. 处理审查结果
      if (review.specIssue) {
        logger.warn(`  ⚠️  发现spec问题: ${review.specIssue.description}`);
        return {
          taskId: task.id,
          status: 'spec_issue',
          attempts: attempts + 1,
          specIssue: true,
          affectsStage: review.specIssue.affectsStage,
          description: review.specIssue.description,
        };
      }

      if (review.issues.length === 0) {
        // 通过，保存代码
        const savedFiles = await this.saveGeneratedCode(
          code,
          task,
          opts.featurePath
        );

        logger.info(`  ✅ ${task.id} 审查通过`);
        return {
          taskId: task.id,
          status: 'completed',
          attempts: attempts + 1,
          generatedFiles: savedFiles,
        };
      }

      // 有代码问题，修复后重试
      logger.info(`  🔧 发现 ${review.issues.length} 个问题，自动修复中...`);
      attempts++;
    }

    // 超过最大尝试次数
    logger.error(`  ❌ ${task.id} 失败: 超过最大尝试次数`);
    return {
      taskId: task.id,
      status: 'failed',
      attempts: maxAttempts,
      error: `Failed after ${maxAttempts} attempts`,
    };
  }

  /**
   * 解析AI的审查结果
   */
  private parseReviewResponse(response: string): {
    passed: boolean;
    issues: Array<{ severity: string; message: string; location: string }>;
    specIssue: { affectsStage: string; description: string } | null;
  } {
    const issues: any[] = [];
    let specIssue = null;

    const lines = response.split('\n');
    
    for (const line of lines) {
      // 检查spec问题
      if (line.toLowerCase().includes('spec') && 
          (line.toLowerCase().includes('问题') || line.toLowerCase().includes('issue') ||
           line.toLowerCase().includes('歧义') || line.toLowerCase().includes('矛盾'))) {
        specIssue = {
          affectsStage: this.determineAffectedStage(line),
          description: line.trim(),
        };
      }

      // 检查代码问题
      if (line.match(/^[-*]\s*(?:错误|error|问题|issue|警告|warning)/i)) {
        issues.push({
          severity: line.toLowerCase().includes('error') ? 'error' : 'warning',
          message: line.replace(/^[-*]\s*/, '').trim(),
          location: '',
        });
      }
    }

    return {
      passed: issues.length === 0 && !specIssue,
      issues,
      specIssue,
    };
  }

  /**
   * 判断受影响的stage
   */
  private determineAffectedStage(message: string): string {
    if (message.includes('需求') || message.includes('requirement')) return 'P1';
    if (message.includes('设计') || message.includes('design')) return 'P2';
    if (message.includes('任务') || message.includes('task')) return 'P3';
    return 'P2'; // 默认回溯到设计阶段
  }

  /**
   * 保存生成的代码文件
   */
  private async saveGeneratedCode(
    code: string,
    task: Task,
    featurePath: string
  ): Promise<string[]> {
    const savedFiles: string[] = [];

    // 解析代码块，提取文件路径
    const fileRegex = /```(?:typescript|javascript|tsx|jsx|java|go|python)?\s*(?:\/\/\s*file:\s*(.+))?\n([\s\S]*?)```/g;
    let match;

    while ((match = fileRegex.exec(code)) !== null) {
      let filePath = match[1]?.trim();
      const fileContent = match[2];

      if (filePath) {
        // 使用指定的文件路径
        const fullPath = path.join(process.cwd(), filePath);
        await FileManager.writeFile(fullPath, fileContent);
        savedFiles.push(filePath);
      }
    }

    // 如果没有指定文件路径，根据任务类型推断
    if (savedFiles.length === 0 && task.files && task.files.length > 0) {
      for (const file of task.files) {
        const fullPath = path.join(process.cwd(), file);
        await FileManager.writeFile(fullPath, code);
        savedFiles.push(file);
      }
    }

    return savedFiles;
  }

  /**
   * 提交任务代码
   */
  private async commitTask(result: TaskResult): Promise<void> {
    if (result.generatedFiles && result.generatedFiles.length > 0) {
      try {
        await this.gitManager.commit(
          `feat: ${result.taskId} - AI generated`,
          result.generatedFiles
        );
      } catch (error) {
        logger.warn(`提交失败: ${result.taskId}`);
      }
    }
  }

  /**
   * 从Markdown解析任务列表
   */
  private parseTasksFromMarkdown(content: string): Task[] {
    const tasks: Task[] = [];
    const taskRegex = /###\s+(T-\d+):\s+(.+?)(?=\n###|\n##|\n*$)/gs;
    let match;

    while ((match = taskRegex.exec(content)) !== null) {
      const taskId = match[1];
      const taskContent = match[2];
      const title = taskContent.split('\n')[0].trim();

      tasks.push({
        id: taskId,
        title,
        type: this.extractType(taskContent),
        dependencies: this.extractDeps(taskContent),
        estimatedHours: this.extractHours(taskContent),
        acceptanceCriteria: [],
        files: this.extractFiles(taskContent),
        status: 'pending',
      });
    }

    return tasks;
  }

  private extractType(content: string): Task['type'] {
    if (content.includes('后端') || content.includes('backend') || content.includes('API')) return 'backend';
    if (content.includes('测试') || content.includes('test')) return 'test';
    if (content.includes('配置') || content.includes('config')) return 'config';
    return 'frontend';
  }

  private extractDeps(content: string): string[] {
    const match = content.match(/依赖[：:]\s*(.+)/);
    if (!match || match[1].includes('无')) return [];
    return match[1].split(/[,，]/).map(d => d.trim());
  }

  private extractHours(content: string): number {
    const match = content.match(/(\d+\.?\d*)\s*h/);
    return match ? parseFloat(match[1]) : 1;
  }

  private extractFiles(content: string): string[] {
    const match = content.match(/文件[：:]\s*(.+)/);
    if (!match) return [];
    return match[1].split(/[,，]/).map(f => f.trim());
  }
}
