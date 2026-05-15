import simpleGit, { SimpleGit } from 'simple-git';
import { logger } from './logger';

export class GitManager {
  private git: SimpleGit;

  constructor(repoPath: string = process.cwd()) {
    this.git = simpleGit(repoPath);
  }

  /**
   * 检查是否在git仓库中
   */
  async isRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 创建feature分支
   */
  async createFeatureBranch(featureName: string): Promise<string> {
    const branchName = `feature/ai-${featureName}`;
    
    // 检查分支是否存在
    const branches = await this.git.branch();
    if (branches.all.includes(branchName)) {
      logger.warn(`分支已存在: ${branchName}`);
      await this.git.checkout(branchName);
      return branchName;
    }

    await this.git.checkoutLocalBranch(branchName);
    logger.info(`已创建分支: ${branchName}`);
    return branchName;
  }

  /**
   * 提交更改
   */
  async commit(message: string, files?: string[]): Promise<void> {
    if (files) {
      await this.git.add(files);
    } else {
      await this.git.add('.');
    }
    
    await this.git.commit(message);
    logger.info(`已提交: ${message}`);
  }

  /**
   * 推送到远程
   */
  async push(branchName: string): Promise<void> {
    await this.git.push('origin', branchName);
    logger.info(`已推送: ${branchName}`);
  }

  /**
   * 创建PR
   */
  async createPR(opts: {
    title: string;
    body: string;
    base?: string;
    head: string;
  }): Promise<string> {
    // 使用GitHub CLI或API创建PR
    const { execSync } = require('child_process');
    const cmd = `gh pr create --title "${opts.title}" --body "${opts.body}" --base ${opts.base || 'main'} --head ${opts.head}`;
    
    try {
      const result = execSync(cmd, { encoding: 'utf-8' });
      logger.info(`PR已创建: ${result.trim()}`);
      return result.trim();
    } catch (error) {
      logger.error('创建PR失败，请确保已安装GitHub CLI (gh)');
      throw error;
    }
  }

  /**
   * 获取当前分支
   */
  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'main';
  }

  /**
   * 获取变更文件列表
   */
  async getChangedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [
      ...status.created,
      ...status.modified,
      ...status.not_added,
    ];
  }
}
