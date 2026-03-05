import readline from "readline";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.setPrompt("$ ");
rl.prompt();

const builtinCommands = {
  exit: handleExit,
  echo: handleEcho,
  type: handleType,
  pwd: handlePwd,
  cd: handleCd,
};

function handleExit() {
  process.exit(0);
}

function handleEcho(args) {
  if (args.length > 0) {
    console.log(args.join(" "));
  } else {
    console.log("Nothing to echo.");
  }
}


function searchExecutable(command, args, shouldExecute) {
  const directories = process.env.PATH.split(path.delimiter);
  for (const directory of directories) {
    try {
      const fullPath = path.join(directory, command);
      fs.accessSync(fullPath, fs.constants.X_OK);
      if (!shouldExecute) console.log(`${command} is ${fullPath}`);
      else {
        spawnSync(fullPath, args, {
          stdio: "inherit",
          argv0: command,
        });
      }
      return true;
    } catch (error) {}
  }
  return false;
}

function handleType(args) {
  const command = args[0];
  if (builtinCommands[command]) return console.log(`${command} is a shell builtin`);
  else {
    if (!searchExecutable(command, null, false)) console.log(`${command}: not found`);
  }
}

function handlePwd() {
  console.log(process.cwd());
}


function handleCd(args) {
  const directory = args[0];
  try {
    if (directory === "~") process.chdir(process.env.HOME);
    else process.chdir(directory);
  } catch (error) {
    console.log(`cd: ${directory}: No such file or directory`);
  }
}

function parseCommandLine(input) {
  const tokens = [];
  let current = "";
  let inSingleQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "'") {
      inSingleQuotes = !inSingleQuotes;
      continue;
    }

    if (char === " " && !inSingleQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

rl.on("line", (command) => {
  const parts = parseCommandLine(command.trim());
  if (parts.length === 0) {
    rl.prompt();
    return;
  }

  const cmd = parts[0];
  const args = parts.slice(1);

  if (builtinCommands[cmd]) {
    builtinCommands[cmd](args);
  } else {
    if (!searchExecutable(cmd, args, true)) console.log(`${cmd}: not found`);
  }
  rl.prompt();
});
