import readline from "readline";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

const BUILTIN_COMMANDS = ["echo", "exit", "type", "pwd"];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

let currDir = process.cwd();

rl.prompt();

rl.on("line", (command) => {
  const words = command.trim().split(" ");

  if (!words[0]) {
    rl.prompt();
    return;
  }

  switch (words[0]) {
    case "exit":
      process.exit();
    case "pwd":
      console.log(currDir);
      break;
    case "cd":
      {
        const rawTarget = words[1] || "~";
        const target = rawTarget === "~" ? (process.env.HOME || process.env.USERPROFILE || "~") : rawTarget;
        const nextDir = path.isAbsolute(target) ? target : path.join(currDir, target);

        if (fs.existsSync(nextDir) && fs.statSync(nextDir).isDirectory()) {
          currDir = path.resolve(nextDir);
          process.chdir(currDir);
        } else {
          console.log(`cd: ${words[1]}: No such file or directory`);
        }
      }
      break;
    case "echo":
      console.log(words.slice(1).join(" "));
      break;
    case "type":
      if (BUILTIN_COMMANDS.includes(words[1])) {
        console.log(`${words[1]} is a shell builtin`);
      } else {
        const { result, filePath } = searchInPath(words[1]);
        if (result === true) {
          console.log(`${words[1]} is ${filePath}`);
        } else {
          console.log(`${words[1]}: not found`);
        }
      }
      break;
    default:
      const { result } = searchInPath(words[0]);
      if (result === true) {
        try {
          const output = execSync(`${command}`, { cwd: currDir });
          process.stdout.write(output);
        } catch (error) {
          console.error(error);
        }
      } else {
        console.log(`${command}: command not found`);
      }
      break;
  }

  rl.prompt();
});

const searchInPath = (command) => {
  const directories = process.env.PATH.split(path.delimiter);

  for (const directory of directories) {
    try {
      const files = fs.readdirSync(directory);
      for (const file of files) {
        const filePath = path.join(directory, file);
        if (file === command && checkExecutablePermission(filePath)) {
          return { result: true, filePath: filePath };
        }
      }
    } catch {
      continue;
    }
  }

  return { result: false, filePath: "" };
};

const checkExecutablePermission = (filePath) => {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
