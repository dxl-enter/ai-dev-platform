import { StageContext, StageResult } from '../types';

export interface StageHandler {
  /** 阶段名称 */
  readonly name: string;
  
  /** 执行阶段 */
  execute(context: StageContext): Promise<StageResult>;
  
  /** 验证前置条件 */
  validate?(context: StageContext): Promise<boolean>;
  
  /** 清理（失败时回滚） */
  cleanup?(context: StageContext): Promise<void>;
}
