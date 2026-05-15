import { NormalizedInput } from '../types';

export interface InputAdapter {
  /** 适配器名称 */
  readonly name: string;
  
  /** 标准化输入 */
  normalize(rawInput: any): Promise<NormalizedInput>;
  
  /** 验证输入有效性 */
  validate(rawInput: any): boolean;
}
