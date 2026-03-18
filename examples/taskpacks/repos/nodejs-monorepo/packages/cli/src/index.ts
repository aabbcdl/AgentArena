import { getUserData } from "@monorepo/core";
import { Logger } from "./logger";

const logger = new Logger("cli");

/**
 * CLI entry point - processes user commands.
 * Calls getUserData to retrieve user information.
 */
export async function main(args: string[]): Promise<void> {
  const command = args[0];

  if (command === "user") {
    const userId = args[1] ?? "default";
    logger.info(`Fetching user data for: ${userId}`);
    const data = await getUserData(userId);
    logger.info(`getUserData returned: ${data.name}`);
    console.log(JSON.stringify(data, null, 2));
  } else {
    logger.warn(`Unknown command: ${command}`);
    console.log("Usage: cli user <userId>");
  }
}
