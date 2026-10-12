import { z } from "zod";

const schema = z.object({
  goal: z.string().trim().min(1).max(8000),
  materials: z.string().max(16_000).optional(),
  method: z.string().max(80).optional(),
});
export type TaskDraft = z.infer<typeof schema>;
export function buildTaskMessage(input: TaskDraft) {
  const draft = schema.parse(input);
  return [
    `任务目标：${draft.goal}`,
    draft.materials?.trim() ? `参考材料：\n${draft.materials.trim()}` : "",
    `调查方式：${draft.method || "根据目标自动选择合适的方法"}。请先简要说明采用的方法，再开始执行；结果附可追溯来源，并明确未完成的检查。`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
