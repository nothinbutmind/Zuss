import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendDir = resolve(__dirname, "..");
const repoRoot = resolve(frontendDir, "..");

const children = [];

function launch(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[${label}] exited with signal ${signal}`);
      return;
    }

    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
      process.exitCode = code;
      shutdown();
    }
  });

  children.push(child);
  return child;
}

function shutdown() {
  while (children.length > 0) {
    const child = children.pop();
    child.kill("SIGTERM");
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

launch("userslist", "cargo", ["run"], resolve(repoRoot, "userslist"));
launch("relayer", "npm", ["run", "relayer"], resolve(repoRoot, "starknet"));
launch("frontend", "pnpm", ["exec", "vite"], frontendDir);
