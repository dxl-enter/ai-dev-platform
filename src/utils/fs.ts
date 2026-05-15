import * as fs from 'fs-extra';
import * as path from 'path';
import Handlebars from 'handlebars';
import { logger } from './logger';

export class FileManager {
  
  /**
   * 确保目录存在
   */
  static async ensureDir(dirPath: string): Promise<void> {
    await fs.ensureDir(dirPath);
    logger.debug(`目录已确保: ${dirPath}`);
  }

  /**
   * 读取文件，不存在则返回null
   */
  static async readFileSafe(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 写入文件，自动创建目录
   */
  static async writeFile(filePath: string, content: string): Promise<void> {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf-8');
    logger.debug(`文件已写入: ${filePath}`);
  }

  /**
   * 使用模板生成文件
   */
  static async renderTemplate(
    templatePath: string,
    data: Record<string, any>,
    outputPath: string
  ): Promise<void> {
    const templateContent = await fs.readFile(templatePath, 'utf-8');
    const template = Handlebars.compile(templateContent);
    const rendered = template(data);
    await this.writeFile(outputPath, rendered);
    logger.info(`模板已渲染: ${outputPath}`);
  }

  /**
   * 创建feature目录结构
   */
  static async createFeatureStructure(featurePath: string): Promise<void> {
    const dirs = [
      featurePath,
      path.join(featurePath, '.version'),
    ];
    
    for (const dir of dirs) {
      await this.ensureDir(dir);
    }
    
    logger.info(`Feature目录已创建: ${featurePath}`);
  }

  /**
   * 列出spec文件
   */
  static async listSpecFiles(featurePath: string): Promise<string[]> {
    const files = await fs.readdir(featurePath);
    return files.filter(f => f.endsWith('.md'));
  }

  /**
   * 获取feature的spec文件路径
   */
  static getSpecPath(featurePath: string, stage: string): string {
    const fileMap: Record<string, string> = {
      'P1': 'requirements.md',
      'P2': 'design.md',
      'P3': 'tasks.md',
    };
    const fileName = fileMap[stage] || `${stage.toLowerCase()}.md`;
    return path.join(featurePath, fileName);
  }

  /**
   * 计算文件的简单diff
   */
  static async diff(original: string, modified: string): Promise<string> {
    const { diffLines } = require('diff');
    const changes = diffLines(original, modified);
    
    return changes.map((change: any) => {
      const prefix = change.added ? '+' : change.removed ? '-' : ' ';
      return change.value.split('\n')
        .filter((line: string) => line)
        .map((line: string) => `${prefix} ${line}`)
        .join('\n');
    }).join('\n');
  }
}
