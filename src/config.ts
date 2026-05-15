import * as fs from 'fs-extra';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { PlatformConfig, ProjectConfig } from './types';
import { logger } from './utils/logger';

export class ConfigManager {
  private static instance: ConfigManager;
  private config!: PlatformConfig;
  private configPath: string;
  private currentProjectId: string = 'default';

  private constructor() {
    this.configPath = path.join(process.cwd(), 'platform.yaml');
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  async load(configPath?: string): Promise<PlatformConfig> {
    if (configPath) {
      this.configPath = configPath;
    }

    if (!await fs.pathExists(this.configPath)) {
      logger.warn(`配置文件不存在: ${this.configPath}，使用默认配置`);
      this.config = this.getDefaultConfig();
      await this.save();
      return this.config;
    }

    const content = await fs.readFile(this.configPath, 'utf-8');
    this.config = yaml.load(content) as PlatformConfig;
    
    // 验证配置
    this.validate();
    
    logger.info(`配置已加载: ${this.configPath}`);
    return this.config;
  }

  async save(): Promise<void> {
    const content = yaml.dump(this.config, { indent: 2 });
    await fs.writeFile(this.configPath, content, 'utf-8');
    logger.info(`配置已保存: ${this.configPath}`);
  }

  getProject(projectId?: string): ProjectConfig {
    const id = projectId || this.currentProjectId;
    const project = this.config.projects.find(p => p.id === id);
    if (!project) {
      logger.warn(`项目 ${id} 不存在，使用默认项目`);
      return this.config.projects.find(p => p.id === 'default')!;
    }
    return project;
  }

  setCurrentProject(projectId: string): void {
    const project = this.config.projects.find(p => p.id === projectId);
    if (!project) {
      throw new Error(`项目 ${projectId} 不存在`);
    }
    this.currentProjectId = projectId;
    logger.info(`当前项目: ${projectId}`);
  }

  getLLMConfig() {
    return this.config.platform.llm;
  }

  getPipelineConfig() {
    return this.config.platform.pipeline;
  }

  getSpecsConfig() {
    return this.config.platform.specs;
  }

  private validate(): void {
    if (!this.config.platform) {
      throw new Error('配置文件缺少 platform 节点');
    }
    if (!this.config.projects || this.config.projects.length === 0) {
      throw new Error('配置文件缺少 projects 节点');
    }
    if (!this.config.projects.find(p => p.id === 'default')) {
      throw new Error('配置文件必须包含 id 为 "default" 的项目');
    }
  }

  private getDefaultConfig(): PlatformConfig {
    return {
      platform: {
        version: '2.0',
        llm: {
          provider: 'anthropic',
          models: {
            architect: 'claude-sonnet-4-20250514',
            developer: 'claude-code-sonnet',
            reviewer: 'claude-sonnet-4-20250514'
          },
          defaults: {
            max_tokens: 8192,
            temperature: { creative: 0.7, precise: 0.1 },
            context_window: 800000
          }
        },
        pipeline: {
          stages: ['P1_RequirementsGen', 'P2_DesignGen', 'P3_TaskGen', 'P4_Develop', 'P5_Review', 'P6_Test'],
          human_gates: {
            P1: 'always',
            P2: 'always',
            P3: 'conditional',
            P4: 'conditional',
            P5: 'never',
            P6: 'conditional'
          },
          rollback: {
            max_retries: 3,
            max_total_retries: 8
          }
        },
        specs: {
          base_dir: 'specs',
          templates_dir: 'src/templates',
          freeze_on_gate_pass: true
        }
      },
      projects: [{
        id: 'default',
        name: '默认项目',
        repo: '',
        tech_stack: {
          frontend: 'react',
          backend: 'nodejs',
          ui_lib: 'antd',
          state_mgmt: 'zustand'
        }
      }]
    };
  }
}

export const configManager = ConfigManager.getInstance();
