// src/gates/HumanGate.ts

import { ApprovalRequest, UncertainPart } from '../types';
import { logger } from '../utils/logger';
import * as readline from 'readline';
import * as fs from 'fs-extra';
import * as path from 'path';

export class HumanGate {
  private rl: readline.Interface | null = null;

  /**
   * 请求人工确认
   */
  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    this.printHeader(request);

    // 显示不确定的部分
    if (request.uncertainParts.length > 0) {
      this.printUncertainParts(request.uncertainParts);
    }

    // 显示内容摘要
    this.printContentSummary(request.content);

    // 获取用户输入
    const answer = await this.askUser(request);

    return this.processAnswer(answer, request);
  }

  /**
   * 打印确认头部
   */
  private printHeader(request: ApprovalRequest): void {
    const separator = '━'.repeat(50);
    
    console.log(`\n${separator}`);
    console.log(`🛑 [Human Gate] ${request.stage} 阶段需要确认`);
    console.log(`   Feature: ${request.featureName}`);
    console.log(`   标题: ${request.title}`);
    console.log(`${separator}\n`);
  }

  /**
   * 打印不确定的部分
   */
  private printUncertainParts(parts: UncertainPart[]): void {
    console.log('⚠️  AI不确定的部分:');
    console.log('─'.repeat(40));
    
    parts.forEach((part, index) => {
      console.log(`   ${index + 1}. ${part.location}`);
      console.log(`      问题: ${part.question}`);
      if (part.suggestedAnswer) {
        console.log(`      建议: ${part.suggestedAnswer}`);
      }
      console.log(`      置信度: ${(part.confidence * 100).toFixed(0)}%`);
      console.log('');
    });
  }

  /**
   * 打印内容摘要
   */
  private printContentSummary(content: string): void {
    const maxLength = 1000;
    const summary = content.length > maxLength 
      ? content.substring(0, maxLength) + '\n... (内容已截断)'
      : content;

    console.log('📄 内容预览:');
    console.log('─'.repeat(40));
    console.log(summary);
    console.log('─'.repeat(40));
    console.log('');
  }

  /**
   * 询问用户
   */
  private async askUser(request: ApprovalRequest): Promise<string> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('可选操作:');
    console.log('  [Y] 或 [回车] - 确认通过');
    console.log('  [N] - 拒绝，需要修改');
    console.log('  [S] - 查看完整spec文件');
    console.log('  [E] - 手动编辑spec');
    console.log('  [R] - 重试（让AI重新生成）');
    console.log('');

    return new Promise((resolve) => {
      this.rl!.question('请选择 [Y/n/s/e/r]: ', (answer: string) => {
        this.rl!.close();
        this.rl = null;
        resolve(answer.trim().toLowerCase());
      });
    });
  }

  /**
   * 处理用户回答
   */
  private async processAnswer(
    answer: string,
    request: ApprovalRequest
  ): Promise<boolean> {
    switch (answer) {
      case '':
      case 'y':
      case 'yes':
        logger.info(`✅ Human Gate 通过: ${request.stage}`);
        return true;

      case 'n':
      case 'no':
        logger.info(`❌ Human Gate 拒绝: ${request.stage}`);
        // 可以收集拒绝原因
        await this.collectRejectionReason();
        return false;

      case 's':
      case 'spec':
      case 'specs':
        // 显示完整spec
        await this.showFullSpec(request);
        // 递归再问
        return this.requestApproval(request);

      case 'e':
      case 'edit':
        // 打开编辑器
        await this.openEditor(request);
        // 递归再问
        return this.requestApproval(request);

      case 'r':
      case 'retry':
        logger.info(`🔄 请求重试: ${request.stage}`);
        return false;

      default:
        console.log(`未知操作: ${answer}，默认通过`);
        return true;
    }
  }

  /**
   * 收集拒绝原因
   */
  private async collectRejectionReason(): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question('请简述拒绝原因（可选）: ', (reason: string) => {
        rl.close();
        if (reason.trim()) {
          logger.info(`拒绝原因: ${reason}`);
        }
        resolve(reason);
      });
    });
  }

  /**
   * 显示完整spec
   */
  private async showFullSpec(request: ApprovalRequest): Promise<void> {
    const specPath = path.join(
      process.cwd(),
      'specs',
      request.featureName,
      this.getSpecFile(request.stage)
    );

    try {
      const content = await fs.readFile(specPath, 'utf-8');
      console.log('\n' + '='.repeat(60));
      console.log(`完整Spec: ${specPath}`);
      console.log('='.repeat(60));
      console.log(content);
      console.log('='.repeat(60) + '\n');
    } catch {
      console.log(`无法读取spec文件: ${specPath}`);
    }
  }

  /**
   * 打开编辑器
   */
  private async openEditor(request: ApprovalRequest): Promise<void> {
    const specPath = path.join(
      process.cwd(),
      'specs',
      request.featureName,
      this.getSpecFile(request.stage)
    );

    const editor = process.env.EDITOR || 'vim';
    const { execSync } = require('child_process');
    
    try {
      console.log(`正在打开编辑器: ${editor} ${specPath}`);
      execSync(`${editor} ${specPath}`, { stdio: 'inherit' });
      console.log('编辑器已关闭，spec可能已修改');
    } catch (error) {
      console.log(`无法打开编辑器: ${editor}`);
    }
  }

  /**
   * 获取spec文件名
   */
  private getSpecFile(stage: string): string {
    const fileMap: Record<string, string> = {
      'P1': 'requirements.md',
      'P2': 'design.md',
      'P3': 'tasks.md',
    };
    return fileMap[stage] || `${stage.toLowerCase()}.md`;
  }
}
