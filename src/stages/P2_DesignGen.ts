import { StageHandler } from './StageHandler';
import { StageContext, StageResult } from '../types';
import { llmClient } from '../llm/LLMClient';
import { Prompts } from '../llm/prompts';
import { FileManager } from '../utils/fs';
import { logger } from '../utils/logger';
import * as path from 'path';

export class P2_DesignGen implements StageHandler {
  readonly name = 'P2_DesignGen';

  async execute(context: StageContext): Promise<StageResult> {
    logger.info('🏗️ 生成设计文档...');

    const { featureName, featurePath, projectConfig, assembledContext } = context;

    try {
      // 读取需求文档
      const requirementsPath = path.join(featurePath, 'requirements.md');
      const requirements = await FileManager.readFileSafe(requirementsPath);
      
      if (!requirements) {
        return {
          stage: 'P2',
          status: 'failed',
          output: null,
          nextAction: 'rollback',
          rollbackTo: 'P1',
          rollbackReason: '需求文档不存在，请先生成需求',
          errors: ['requirements.md not found'],
        };
      }

      // 调用AI生成设计
      const userPrompt = Prompts.P2_USER(
        requirements,
        projectConfig.tech_stack,
        assembledContext.projectContext
      );

      const rawDesign = await llmClient.architect({
        systemPrompt: Prompts.P2_SYSTEM,
        userPrompt,
      });

      // 检查设计是否引用了spec中不存在的东西
      const consistencyIssues = this.checkConsistency(rawDesign, requirements);

      // 格式化设计文档
      const formattedDesign = this.formatDesign(
        rawDesign,
        projectConfig,
        consistencyIssues
      );

      // 保存
      const outputPath = path.join(featurePath, 'design.md');
      await FileManager.writeFile(outputPath, formattedDesign);

      logger.info(`✅ 设计文档已生成: ${outputPath}`);
      if (consistencyIssues.length > 0) {
        logger.warn(`   一致性问题: ${consistencyIssues.length} 个`);
      }

      return {
        stage: 'P2',
        status: consistencyIssues.length > 0 ? 'needs_refinement' : 'completed',
        output: {
          path: outputPath,
          content: formattedDesign,
          consistencyIssues,
          hasSecurityCode: this.hasSecurityConcerns(formattedDesign),
        },
        nextAction: consistencyIssues.length > 0 ? 'human_gate' : 'proceed',
        artifacts: [outputPath],
      };

    } catch (error: any) {
      logger.error(`P2 失败: ${error.message}`);
      return {
        stage: 'P2',
        status: 'failed',
        output: null,
        nextAction: 'retry',
        errors: [error.message],
      };
    }
  }

  /**
   * 检查设计文档与需求文档的一致性
   */
  private checkConsistency(design: string, requirements: string): string[] {
    const issues: string[] = [];

    // 提取需求中的所有功能点
    const reqFeatures = requirements.match(/###?\s+\d+\.\s+(.+)/g) || [];
    const reqFeatureNames = reqFeatures.map(f => f.replace(/^###?\s+\d+\.\s+/, ''));

    // 检查每个需求功能点是否在设计中体现
    for (const feature of reqFeatureNames) {
      if (!design.includes(feature.substring(0, 10))) {
        issues.push(`需求功能点 "${feature}" 在设计文档中未找到对应设计`);
      }
    }

    // 检查设计中的组件/API是否都能追溯到需求
    const designComponents = design.match(/###?\s+\d+\.\s+(.+)/g) || [];
    for (const component of designComponents) {
      const componentName = component.replace(/^###?\s+\d+\.\s+/, '');
      const found = reqFeatureNames.some(f => 
        componentName.includes(f.substring(0, 5)) || f.includes(componentName.substring(0, 5))
      );
      if (!found && !componentName.includes('技术') && !componentName.includes('架构')) {
        issues.push(`设计组件 "${componentName}" 可能没有对应的需求功能点`);
      }
    }

    return issues;
  }

  /**
   * 检查是否有安全敏感内容
   */
  private hasSecurityConcerns(design: string): boolean {
    const securityKeywords = [
      '支付', '密码', 'token', '认证', '授权', '加密',
      '文件上传', 'SQL', '注入', 'XSS', 'CSRF',
    ];
    return securityKeywords.some(kw => design.toLowerCase().includes(kw.toLowerCase()));
  }

  /**
   * 格式化设计文档
   */
  private formatDesign(
    rawContent: string,
    projectConfig: any,
    issues: string[]
  ): string {
    const header = [
      `# ${projectConfig.name} - 设计文档`,
      '',
      '## 技术栈',
      `| 层级 | 技术选型 |`,
      `|:---|:---|`,
      `| 前端框架 | ${projectConfig.tech_stack.frontend} |`,
      `| UI组件库 | ${projectConfig.tech_stack.ui_lib} |`,
      `| 状态管理 | ${projectConfig.tech_stack.state_mgmt || '默认'} |`,
      `| 后端框架 | ${projectConfig.tech_stack.backend} |`,
      '',
      '---',
      '',
    ];

    const issuesSection = issues.length > 0
      ? [
          '',
          '## ⚠️ 一致性问题',
          ...issues.map((issue, i) => `${i + 1}. ${issue}`),
          '',
        ]
      : [];

    return [
      ...header,
      rawContent,
      ...issuesSection,
    ].join('\n');
  }
}
