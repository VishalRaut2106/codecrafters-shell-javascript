const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const builtins = ["echo", "type", "exit"];

function findExecutable(cmd) {
  const pathDirs = process.env.PATH.split(path.delimiter);
  for (let dir of pathDirs) {
    const fullPath = path.join(dir, cmd);
    if (fs.existsSync(fullPath)) {
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return fullPath;
        break;
      } catch {
        continue;
      }
    }
  }

  return null;
}

function prompt() {
  rl.question("$ ", (command) => {
    command = command.trim();
    const [cmd, ...args] = command.split(/\s+/);

    if (cmd == "exit" && args[0] === "0") {
      rl.close();
    } else if (cmd === "echo") {
      console.log(args.join(" "));
      prompt();
    } else if (cmd === "type") {
      let target = args[0];

      if (builtins.includes(target)) {
        console.log(`${target} is a shell builtin`);
        prompt();
        return;
      }

      const fullPath = findExecutable(target);
      if (fullPath) {
        console.log(`${target} is ${fullPath}`);
      } else {
        console.log(`${target}: not found`);
      }

      prompt();
    } else if (command.includes("|")) {
      const [leftCmd, rightCmd] = command.split("|").map((s) => s.trim());
      const [cmd1, ...args1] = leftCmd.split(/\s+/);
      const [cmd2, ...args2] = rightCmd.split(/\s+/);

      const fullPath1 = findExecutable(cmd1);
      const fullPath2 = findExecutable(cmd2);

      if (!fullPath1 || !fullPath2) {
        console.log(`${!fullPath1 ? cmd1 : cmd2}: command not found`);
        prompt();
        return;
      }

      const child1 = spawn(fullPath1, args1, {
        stdio: ["inherit", "pipe", "inherit"],
        argv0: cmd1,
      });
      const child2 = spawn(fullPath2, args2, {
        stdio: ["pipe", "inherit", "inherit"],
        argv0: cmd2,
      });

      child1.stdout.pipe(child2.stdin);
      child2.on("exit", () => {
        prompt();
      });
    } else {
      const fullPath = findExecutable(cmd);
      if (fullPath) {
        const child = spawn(fullPath, args, { stdio: "inherit", argv0: cmd });
        child.on("exit", () => {
          prompt();
        });
      } else {
        console.log(`${cmd}: command not found`);
        prompt();
      }
    }
  });
}

prompt();