import { getUserData } from "@monorepo/core";
import { Logger } from "./logger";

const logger = new Logger("runner");

export interface TaskResult {
  taskId: string;
  success: boolean;
  output: string;
}

/**
 * Runs a task that involves calling getUserData.
 */
export async function runTask(taskId: string, userId: string): Promise<TaskResult> {
  logger.info(`Starting task ${taskId} for user ${userId}`);

  try {
    const data = await getUserData(userId);
    logger.info(`getUserData succeeded for ${userId}: ${data.name}`);

    return {
      taskId,
      success: true,
      output: `Processed getUserData for ${data.name} (${data.email})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`getUserData failed: ${message}`);

    return {
      taskId,
      success: false,
      output: `Failed to getUserData: ${message}`,
    };
  }
}
