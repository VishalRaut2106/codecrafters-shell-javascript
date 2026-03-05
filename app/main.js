const readline = require("readline");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const BUILTIN_COMMANDS = ["echo", "exit", "type", "pwd"];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

let currDir = process.cwd();

rl.prompt();

rl.on("line", (command) => {
  const words = command.split(" ");

  switch (words[0]) {
    case "exit":
      process.exit();
    case "pwd":
      console.log(currDir);
      break;
    case "cd":
      if (fs.existsSync(words[1])) {
        currDir = words[1];
      } else {
        console.log(`cd: ${words[1]}: No such file or directory`);
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
          const output = execSync(`${command}`);
          process.stdout.write(output);
        } catch {
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

  for (directory of directories) {
    try {
      const files = fs.readdirSync(directory);
      for (file of files) {
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
