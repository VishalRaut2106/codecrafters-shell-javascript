import { access, constants } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { stdin as input, stdout as output, env } from "node:process";
import path from "node:path";

async function locateExecutable(name) {
  if (!env.PATH) return null;

  const pathDirectories = env.PATH.split(path.delimiter);
  for (const dir of pathDirectories) {
    let attempt = path.join(dir, name);
    try {
      await access(attempt, constants.X_OK);
      return attempt;
    } catch (error) {
      continue;
    }
  }
  return null;
}

async function evalCommand(command, args) {
  if (builtins[command]) {
    return builtins[command](args);
  }

  const execPath = await locateExecutable(command);
  if (execPath) {
    const child = spawn(execPath, args, { stdio: "inherit", argv0: command });
    return await new Promise((resolve) => child.on("close", resolve));
  }

  console.log(`${command}: command not found`);
}

const builtins = {
  echo: (args) => console.log(args.join(" ")),
  exit: () => "SIG_EXIT",
  type: async (args) => {
    const query = args[0];
    if (builtins[query]) {
      console.log(`${query} is a shell builtin`);
    } else {
      const path = await locateExecutable(query);
      const logMessage = path ? `${query} is ${path}` : `${query}: not found`;
      console.log(logMessage);
    }
  },
};

const rl = createInterface({ input, output });
rl.on("SIGINT", () => {
  rl.clearLine(0);
  rl.prompt();
});

rl.setPrompt("$ ");
rl.prompt();

for await (const line of rl) {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    continue;
  }

  const [cmd, ...args] = line.trim().split(" ");

  const signal = await evalCommand(cmd, args);

  if (signal === "SIG_EXIT") break;

  rl.prompt();
}

rl.close();
