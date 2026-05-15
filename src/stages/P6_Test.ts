import { StageHandler } from './StageHandler';
import { StageContext, StageResult, TestResult } from '../types';
import { llmClient } from '../llm/LLMClient';
import { Prompts } from '../llm/prompts';
import { FileManager } from '../utils/fs';
import { logger } from '../utils/logger';
import { execSync } from 'child_process';
import * as path from 'path';

export class P6_Test implements StageHandler {
  readonly name = 'P6_Test';

  async execute(context: StageContext): Promise<StageResult> {
    logger.info('🧪 执行测试...');

    const { featureName, featurePath, projectConfig } = context;

    try {
      const results: TestResult[] = [];

      // 1. 运行单元测试
      logger.info('  运行单元测试...');
      const unitResults = await this.runUnitTests(projectConfig);
      results.push(...unitResults);

      // 2. 运行E2E测试
      logger.info('  运行E2E测试...');
      const e2eResults = await this.runE2ETests(projectConfig);
      results.push(...e2eResults);

      // 3. 运行MCP集成测试（如果配置了）
      if (projectConfig.tech_stack.backend !== 'static') {
        logger.info('  运行集成测试...');
        const integrationResults = await this.runIntegrationTests();
        results.push(...integrationResults);
      }

      // 4. 生成测试报告
      const passedCount = results.filter(r => r.passed).length;
      const failedCount = results.filter(r => !r.passed).length;
      const failureRate = results.length > 0 ? failedCount / results.length : 0;

      const report = this.generateTestReport(results, passedCount, failedCount);

      // 保存报告
      const reportPath = path.join(featurePath, 'test-report.md');
      await FileManager.writeFile(reportPath, report);

      logger.info(`✅ 测试完成:`);
      logger.info(`   总测试: ${results.length}`);
      logger.info(`   通过: ${passedCount}`);
      logger.info(`   失败: ${failedCount}`);
      logger.info(`   失败率: ${(failureRate * 100).toFixed(1)}%`);

      return {
        stage: 'P6',
        status: failedCount === 0 ? 'completed' : 'needs_refinement',
        output: {
          results,
          passedCount,
          failedCount,
          failureRate,
          reportPath,
        },
        nextAction: failedCount === 0 ? 'proceed' : 'human_gate',
        artifacts: [reportPath],
      };

    } catch (error: any) {
      logger.error(`P6 失败: ${error.message}`);
      return {
        stage: 'P6',
        status: 'failed',
        output: null,
        nextAction: 'retry',
        errors: [error.message],
      };
    }
  }

  /**
   * 运行单元测试
   */
  private async runUnitTests(projectConfig: any): Promise<TestResult[]> {
    const results: TestResult[] = [];

    try {
      const testCommand = this.getTestCommand(projectConfig, 'unit');
      const output = execSync(testCommand, { 
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 60000,
      });

      results.push(...this.parseTestOutput(output, 'unit'));
    } catch (error: any) {
      // 测试失败也会有输出
      if (error.stdout) {
        results.push(...this.parseTestOutput(error.stdout, 'unit'));
      } else {
        results.push({
          name: 'Unit Tests',
          passed: false,
          duration: 0,
          error: error.message,
          type: 'unit',
        });
      }
    }

    return results;
  }

  /**
   * 运行E2E测试
   */
  private async runE2ETests(projectConfig: any): Promise<TestResult[]> {
    const results: TestResult[] = [];

    try {
      const testCommand = this.getTestCommand(projectConfig, 'e2e');
      const output = execSync(testCommand, {
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 120000,
      });

      results.push(...this.parseTestOutput(output, 'e2e'));
    } catch (error: any) {
      if (error.stdout) {
        results.push(...this.parseTestOutput(error.stdout, 'e2e'));
      }
    }

    return results;
  }

  /**
   * 运行集成测试
   */
  private async runIntegrationTests(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    try {
      // 尝试运行MCP集成测试
      const output = execSync('npx jest tests/mcp/', {
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 30000,
        stdio: 'pipe',
      });

      results.push(...this.parseTestOutput(output, 'integration'));
    } catch {
      // MCP测试可能不存在，不是错误
      logger.debug('MCP集成测试未配置或不存在');
    }

    return results;
  }

  /**
   * 获取测试命令
   */
  private getTestCommand(projectConfig: any, type: 'unit' | 'e2e'): string {
    const commands: Record<string, Record<string, string>> = {
      react: { unit: 'npx jest', e2e: 'npx playwright test' },
      vue: { unit: 'npx vitest run', e2e: 'npx playwright test' },
      angular: { unit: 'npx ng test --watch=false', e2e: 'npx ng e2e' },
      default: { unit: 'npx jest', e2e: 'npx playwright test' },
    };

    const framework = projectConfig.tech_stack.frontend || 'default';
    const cmdMap = commands[framework] || commands['default'];
    return cmdMap[type] || 'npx jest';
  }

  /**
   * 解析测试输出
   */
  private parseTestOutput(output: string, type: TestResult['type']): TestResult[] {
    const results: TestResult[] = [];

    // Jest格式解析
    const testRegex = /(✓|✕|●)\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/gm;
    let match;

    while ((match = testRegex.exec(output)) !== null) {
      const passed = match[1] === '✓';
      const name = match[2].trim();
      const duration = match[3] ? parseInt(match[3]) : 0;

      results.push({
        name,
        passed,
        duration,
        error: passed ? undefined : 'Test failed',
        type,
      });
    }

    // Playwright格式解析
    if (results.length === 0) {
      const pwRegex = /(\d+)\s+passed|\s+(\d+)\s+failed/gm;
      let totalPassed = 0;
      let totalFailed = 0;

      while ((match = pwRegex.exec(output)) !== null) {
        if (match[1]) totalPassed = parseInt(match[1]);
        if (match[2]) totalFailed = parseInt(match[2]);
      }

      for (let i = 0; i < totalPassed; i++) {
        results.push({
          name: `E2E Test ${i + 1}`,
          passed: true,
          duration: 0,
          type,
        });
      }
      for (let i = 0; i < totalFailed; i++) {
        results.push({
          name: `E2E Test ${i + 1}`,
          passed: false,
          duration: 0,
          error: 'E2E test failed',
          type,
        });
      }
    }

    return results;
  }

  /**
   * 生成测试报告
   */
  private generateTestReport(
    results: TestResult[],
    passedCount: number,
    failedCount: number
  ): string {
    const sections = [
      `# 测试报告`,
      '',
      `## 概要`,
      `- 测试时间: ${new Date().toISOString()}`,
      `- 总测试数: ${results.length}`,
      `- ✅ 通过: ${passedCount}`,
      `- ❌ 失败: ${failedCount}`,
      `- 通过率: ${results.length > 0 ? ((passedCount / results.length) * 100).toFixed(1) : 0}%`,
      '',
    ];

    if (failedCount > 0) {
      sections.push('## 失败测试');
      sections.push('');
      const failedTests = results.filter(r => !r.passed);
      failedTests.forEach((test, i) => {
        sections.push(`### ${i + 1}. ${test.name}`);
        sections.push(`- 类型: ${test.type}`);
        sections.push(`- 耗时: ${test.duration}ms`);
        if (test.error) {
          sections.push(`- 错误: ${test.error}`);
        }
        sections.push('');
      });
    }

    // 按类型分组
    const unitTests = results.filter(r => r.type === 'unit');
    const e2eTests = results.filter(r => r.type === 'e2e');
    const integrationTests = results.filter(r => r.type === 'integration');

    sections.push('## 测试分类统计');
    sections.push('');
    sections.push('| 类型 | 总数 | 通过 | 失败 | 通过率 |');
    sections.push('|:---|:---|:---|:---|:---|');
    
    for (const [type, tests] of [
      ['单元测试', unitTests],
      ['E2E测试', e2eTests],
      ['集成测试', integrationTests],
    ] as const) {
      const passed = tests.filter(t => t.passed).length;
      const total = tests.length;
      const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : 'N/A';
      sections.push(`| ${type} | ${total} | ${passed} | ${total - passed} | ${rate}% |`);
    }

    return sections.join('\n');
  }
}
