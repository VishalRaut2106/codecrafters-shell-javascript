import path from "path";
import readline from "readline";
import fs from "fs";
import child_process from "child_process";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

rl.prompt();

rl.on("line", (input) => {
  executeCommand(input);

  rl.prompt();
});

const executeCommand = (input) => {
  const [command, ...args] = input.trim().split(" ");
  if (commands[command]) {
    commands[command](args.filter((arg) => arg.trim()));
  } else {
    const filePath = getExecutable(command);
    if (filePath) {
      child_process.spawnSync(command, args, { stdio: "inherit" });
      return;
    }
    console.log(`${command}: command not found`);
  }
};

const commands = {
  exit: () => process.exit(0),
  echo: (args) => console.log(args.join(" ")),
  type: (args) => {
    for (let i = 0; i < args.length; i++) {
      if (commands[args[i]]) {
        console.log(`${args[i]} is a shell builtin`);
      } else {
        const filePath = getExecutable(args[i]);
        if (filePath) {
          console.log(`${args[i]} is ${filePath}`);
        } else {
          console.log(`${args[i]}: not found`);
        }
      }
    }
  },
  pwd: () => console.log(process.cwd()),
};

const getExecutable = (file) => {
  const paths = process.env.PATH.split(path.delimiter);
  let found = false;
  for (const p of paths) {
    const fullPath = path.join(p, file);
    if (fs.existsSync(fullPath)) {
      try {
        fs.accessSync(
          fullPath,
          fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
        );
        found = true;
        return fullPath;
      } catch (err) {
        continue;
      }
    }
  }
  return null;
};
