interface SpecVersion {
  version: number;
  stage: string;
  content: string;
  timestamp: number;
  frozen: boolean;       // 冻结后不允许直接修改
  parentVersion?: number; // 从哪个版本回溯的
}

class SpecVersionControl {
  private versions: Map<string, SpecVersion[]> = new Map();

  async init(featureName: string) {
    this.versions.set(featureName, []);
  }

  // 保存新版本
  async save(featureName: string, stage: string, content: string) {
    const versions = this.versions.get(featureName)!;
    const newVersion: SpecVersion = {
      version: versions.length + 1,
      stage,
      content,
      timestamp: Date.now(),
      frozen: false
    };
    versions.push(newVersion);
    
    // 同时写入文件系统
    const specFile = this.getSpecFile(featureName, stage);
    await fs.writeFile(specFile, content);
    await fs.writeFile(`${specFile}.version`, JSON.stringify(newVersion));
    
    console.log(`📝 [SpecVC] ${featureName}/${stage} v${newVersion.version}`);
  }

  // 冻结版本（通过Human Gate后）
  async freeze(featureName: string, stage: string) {
    const versions = this.versions.get(featureName)!;
    const current = versions.findLast(v => v.stage === stage);
    if (current) {
      current.frozen = true;
      console.log(`🔒 [SpecVC] ${featureName}/${stage} v${current.version} 已冻结`);
    }
  }

  // 记录回溯
  async recordRollback(
    featureName: string,
    fromStage: string,
    toStage: string,
    reason: string
  ) {
    const versions = this.versions.get(featureName)!;
    const rollbackVersion: SpecVersion = {
      version: versions.length + 1,
      stage: toStage,
      content: `ROLLBACK from ${fromStage}: ${reason}`,
      timestamp: Date.now(),
      frozen: false,
      parentVersion: versions.length // 指向上一个版本
    };
    versions.push(rollbackVersion);
    
    console.log(`📜 [SpecVC] 回溯记录: v${rollbackVersion.version}`);
  }

  // 获取版本历史（用于审计）
  async getHistory(featureName: string): Promise<SpecVersion[]> {
    return this.versions.get(featureName) || [];
  }
}
