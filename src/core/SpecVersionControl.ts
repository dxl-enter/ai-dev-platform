// src/core/SpecVersionControl.ts

import { v4 as uuidv4 } from 'uuid';
import { SpecVersion } from '../types';
import { FileManager } from '../utils/fs';
import { logger } from '../utils/logger';
import * as path from 'path';

export class SpecVersionControl {
  private versions: Map<string, SpecVersion[]> = new Map();
  private baseDir: string;

  constructor(baseDir: string = 'specs') {
    this.baseDir = baseDir;
  }

  /**
   * 初始化feature的版本控制
   */
  async init(featureName: string): Promise<void> {
    const key = featureName;
    if (!this.versions.has(key)) {
      this.versions.set(key, []);
      logger.debug(`版本控制已初始化: ${featureName}`);
    }
  }

  /**
   * 保存spec的新版本
   */
  async save(
    featureName: string,
    stage: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<SpecVersion> {
    await this.init(featureName);
    
    const versions = this.versions.get(featureName)!;
    const previousVersion = versions
      .filter(v => v.stage === stage)
      .pop();
    
    // 计算diff
    let diff: string | undefined;
    if (previousVersion) {
      diff = await FileManager.diff(previousVersion.content, content);
    }

    const version: SpecVersion = {
      id: uuidv4(),
      featureName,
      stage,
      version: versions.filter(v => v.stage === stage).length + 1,
      content,
      diff,
      timestamp: Date.now(),
      frozen: false,
      parentVersion: previousVersion?.version,
      ...metadata,
    };

    versions.push(version);

    // 写入文件系统
    const specPath = this.getSpecPath(featureName, stage);
    await FileManager.writeFile(specPath, content);
    
    // 写入版本元数据
    const versionDir = path.join(this.baseDir, featureName, '.version');
    const versionFile = path.join(versionDir, `${stage}.json`);
    await FileManager.writeFile(versionFile, JSON.stringify(version, null, 2));

    logger.info(`📝 [SpecVC] ${featureName}/${stage} v${version.version} 已保存`);
    
    return version;
  }

  /**
   * 冻结版本（Human Gate通过后）
   */
  async freeze(featureName: string, stage: string, approvedBy?: string): Promise<void> {
    const versions = this.versions.get(featureName);
    if (!versions) return;

    const current = versions
      .filter(v => v.stage === stage)
      .pop();

    if (current) {
      current.frozen = true;
      if (approvedBy) {
        current.approvedBy = approvedBy;
      }
      
      // 更新文件
      const versionDir = path.join(this.baseDir, featureName, '.version');
      const versionFile = path.join(versionDir, `${stage}.json`);
      await FileManager.writeFile(versionFile, JSON.stringify(current, null, 2));
      
      logger.info(`🔒 [SpecVC] ${featureName}/${stage} v${current.version} 已冻结`);
    }
  }

  /**
   * 记录回溯
   */
  async recordRollback(
    featureName: string,
    fromStage: string,
    toStage: string,
    reason: string
  ): Promise<SpecVersion> {
    const versions = this.versions.get(featureName);
    if (!versions) throw new Error(`Feature ${featureName} 未初始化`);

    const rollbackVersion: SpecVersion = {
      id: uuidv4(),
      featureName,
      stage: toStage,
      version: versions.length + 1,
      content: `## 回溯记录\n\n从 ${fromStage} 回退到 ${toStage}\n\n原因: ${reason}`,
      timestamp: Date.now(),
      frozen: false,
      parentVersion: versions.length,
      rollbackFrom: fromStage,
      rollbackReason: reason,
    };

    versions.push(rollbackVersion);

    logger.info(`⏪ [SpecVC] 回溯记录: ${featureName} v${rollbackVersion.version}`);
    
    return rollbackVersion;
  }

  /**
   * 获取最新版本
   */
  getLatest(featureName: string, stage: string): SpecVersion | null {
    const versions = this.versions.get(featureName);
    if (!versions) return null;

    const stageVersions = versions.filter(v => v.stage === stage);
    return stageVersions.length > 0 ? stageVersions[stageVersions.length - 1] : null;
  }

  /**
   * 获取版本历史
   */
  getHistory(featureName: string, stage?: string): SpecVersion[] {
    const versions = this.versions.get(featureName) || [];
    
    if (stage) {
      return versions.filter(v => v.stage === stage);
    }
    
    return [...versions].sort((a, b) => a.version - b.version);
  }

  /**
   * 获取回溯记录
   */
  getRollbacks(featureName: string): SpecVersion[] {
    const versions = this.versions.get(featureName) || [];
    return versions.filter(v => v.rollbackFrom);
  }

  /**
   * 获取版本统计
   */
  getStats(featureName: string): {
    totalVersions: number;
    frozenVersions: number;
    rollbacks: number;
    stages: Record<string, number>;
  } {
    const versions = this.versions.get(featureName) || [];
    const stages: Record<string, number> = {};
    
    for (const v of versions) {
      stages[v.stage] = (stages[v.stage] || 0) + 1;
    }

    return {
      totalVersions: versions.length,
      frozenVersions: versions.filter(v => v.frozen).length,
      rollbacks: versions.filter(v => v.rollbackFrom).length,
      stages,
    };
  }

  /**
   * 检查版本是否被冻结
   */
  isFrozen(featureName: string, stage: string): boolean {
    const latest = this.getLatest(featureName, stage);
    return latest?.frozen || false;
  }

  /**
   * 获取spec文件路径
   */
  private getSpecPath(featureName: string, stage: string): string {
    const fileMap: Record<string, string> = {
      'P1': 'requirements.md',
      'P2': 'design.md',
      'P3': 'tasks.md',
    };
    const fileName = fileMap[stage] || `${stage.toLowerCase()}.md`;
    return path.join(this.baseDir, featureName, fileName);
  }

  /**
   * 从文件系统加载版本历史
   */
  async loadFromDisk(featureName: string): Promise<void> {
    const versionDir = path.join(this.baseDir, featureName, '.version');
    const files = await FileManager.listSpecFiles(versionDir).catch(() => []);
    
    const versions: SpecVersion[] = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await FileManager.readFileSafe(path.join(versionDir, file));
        if (content) {
          versions.push(JSON.parse(content));
        }
      }
    }

    this.versions.set(featureName, versions);
    logger.debug(`从磁盘加载 ${featureName} 的 ${versions.length} 个版本`);
  }
}
