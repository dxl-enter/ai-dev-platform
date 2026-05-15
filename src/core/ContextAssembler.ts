// src/core/ContextAssembler.ts

import { AssembledContext, ProjectConfig, StageContext } from '../types';
import { configManager } from '../config';
import { FileManager } from '../utils/fs';
import { llmClient } from '../llm/LLMClient';
import { logger } from '../utils/logger';
import * as path from 'path';

export class ContextAssembler {
  private projectCodebaseCache: Map<string, string> = new Map();

  /**
   * 组装AI调用所需的上下文
   */
  async assemble(opts: {
    projectId: string;
    featureName: string;
    stage: string;
    taskId?: string;
    previousResults?: any[];
  }): Promise<AssembledContext> {
    logger.info(`组装上下文: ${opts.stage}`);

    const projectConfig = configManager.getProject(opts.projectId);
    const featurePath = path.join(
      configManager.getSpecsConfig().base_dir,
      opts.projectId,
      opts.featureName
    );

    // 1. 构建系统提示词
    const systemPrompt = this.buildSystemPrompt(projectConfig, opts.stage);

    // 2. 加载feature上下文（根据stage决定加载哪些文件）
    const featureContext = await this.loadFeatureContext(featurePath, opts.stage, opts.taskId);

    // 3. 加载项目上下文（RAG检索）
    const projectContext = await this.loadProjectContext(opts.projectId, featureContext);

    // 4. 加载任务上下文（P4阶段需要）
    const taskContext = opts.taskId 
      ? await this.loadTaskContext(featurePath, opts.taskId)
      : undefined;

    // 5. 组装完整上下文
    const fullContext = [
      systemPrompt,
      featureContext,
      projectContext,
      taskContext,
    ].filter(Boolean).join('\n\n---\n\n');

    // 6. 检查上下文大小
    const totalTokens = llmClient.estimateTokens(fullContext);
    const maxTokens = configManager.getLLMConfig().defaults.context_window;

    logger.info(`上下文大小: ${totalTokens} / ${maxTokens} tokens`);

    if (totalTokens > maxTokens) {
      logger.warn(`上下文超过窗口大小，进行压缩`);
      const compressed = llmClient.compressContext(fullContext, maxTokens);
      return {
        systemPrompt,
        featureContext,
        projectContext: projectContext.substring(0, 1000) + '...(已截断)',
        taskContext,
        totalTokens: llmClient.estimateTokens(compressed),
      };
    }

    return {
      systemPrompt,
      featureContext,
      projectContext,
      taskContext,
      totalTokens,
    };
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(projectConfig: ProjectConfig, stage: string): string {
    return `你是AI开发平台中的一位专家。
当前项目: ${projectConfig.name}
技术栈: ${projectConfig.tech_stack.frontend} + ${projectConfig.tech_stack.backend}
UI库: ${projectConfig.tech_stack.ui_lib}
当前阶段: ${stage}

请基于提供的上下文完成任务。如果发现信息不足或矛盾，请明确指出。`;
  }

  /**
   * 加载feature上下文
   */
  private async loadFeatureContext(
    featurePath: string,
    stage: string,
    taskId?: string
  ): Promise<string> {
    const stageFileMap: Record<string, string[]> = {
      'P1': [],  // P1只需要原始输入
      'P2': ['requirements.md'],
      'P3': ['requirements.md', 'design.md'],
      'P4': ['requirements.md', 'design.md', 'tasks.md'],
      'P5': ['requirements.md', 'design.md', 'tasks.md'],
      'P6': ['requirements.md', 'design.md', 'tasks.md'],
    };

    const filesToLoad = stageFileMap[stage] || [];
    const contents: string[] = [];

    for (const file of filesToLoad) {
      const filePath = path.join(featurePath, file);
      const content = await FileManager.readFileSafe(filePath);
      if (content) {
        contents.push(`## ${file}\n\n${content}`);
      }
    }

    // 如果有taskId，只加载该task的内容（不是全部tasks）
    if (taskId && stage === 'P4') {
      const tasksContent = await FileManager.readFileSafe(
        path.join(featurePath, 'tasks.md')
      );
      if (tasksContent) {
        const taskSection = this.extractTaskSection(tasksContent, taskId);
        contents.push(`## 当前任务\n\n${taskSection}`);
      }
    }

    return contents.join('\n\n---\n\n');
  }

  /**
   * 加载项目上下文（RAG检索）
   */
  private async loadProjectContext(projectId: string, featureContext: string): Promise<string> {
    // 检查缓存
    if (this.projectCodebaseCache.has(projectId)) {
      return this.projectCodebaseCache.get(projectId)!;
    }

    const projectConfig = configManager.getProject(projectId);
    
    const context = `
## 项目信息
- 名称: ${projectConfig.name}
- 前端: ${projectConfig.tech_stack.frontend} + ${projectConfig.tech_stack.ui_lib}
- 后端: ${projectConfig.tech_stack.backend}
- 状态管理: ${projectConfig.tech_stack.state_mgmt || '默认'}

## 技术规范
- 遵循项目现有代码规范
- 使用项目已有的公共组件和工具函数
- API设计遵循RESTful规范
- 代码需要包含错误处理
`;

    // 缓存
    this.projectCodebaseCache.set(projectId, context);
    return context;
  }

  /**
   * 加载任务上下文
   */
  private async loadTaskContext(featurePath: string, taskId: string): Promise<string> {
    const tasksContent = await FileManager.readFileSafe(
      path.join(featurePath, 'tasks.md')
    );
    
    if (!tasksContent) return '';
    
    const taskSection = this.extractTaskSection(tasksContent, taskId);
    return `## 任务详情\n\n${taskSection}`;
  }

  /**
   * 从tasks.md中提取特定任务的内容
   */
  private extractTaskSection(tasksContent: string, taskId: string): string {
    const lines = tasksContent.split('\n');
    let inTask = false;
    let taskContent: string[] = [];
    
    for (const line of lines) {
      if (line.includes(`T-${taskId}`) || line.includes(taskId)) {
        inTask = true;
      }
      
      if (inTask) {
        // 遇到下一个任务标题就停止
        if (taskContent.length > 0 && line.match(/^###?\s+T-\d+/)) {
          break;
        }
        taskContent.push(line);
      }
    }
    
    return taskContent.length > 0 ? taskContent.join('\n') : `Task ${taskId} 未找到`;
  }

  /**
   * 清除缓存
   */
  clearCache(projectId?: string): void {
    if (projectId) {
      this.projectCodebaseCache.delete(projectId);
    } else {
      this.projectCodebaseCache.clear();
    }
  }
}
