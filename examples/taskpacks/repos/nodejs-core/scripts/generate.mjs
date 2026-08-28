import { renderSummary } from "../src/generator.js";

process.stdout.write(renderSummary({ name: "AgentArena", count: 3 }));
