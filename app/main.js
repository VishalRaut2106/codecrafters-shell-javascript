import readline from "readline";
import path from "path";
import { spawn } from "child_process";
import fs from "fs";

const built_in_commands = new Set(["echo", "type", "exit", "pwd", "cd"]);
const process_path = process.env.PATH;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function process_command() {
  return new Promise((resolve) => {
    rl.question("$ ", resolve);
  });
}

async function main() {
  while (true) {
    const answer = await process_command();
    if (answer === "exit") {
      process.exit(0);
    }
    const argv = split_into_argv(answer);
    const command = argv[0];
    const args = argv.slice(1).join(" ");
    switch (command) {
      case "echo":
        console.log(args);
        break;
      case "type":
        if (built_in_commands.has(args)) {
          console.log(`${args} is a shell builtin`);
        } else {
          await check_valid_type(args);
        }
        break;
      case "pwd":
        console.log(process.cwd());
        break;
      case "cd":
        try {
          if (args === "~") process.chdir(process.env.HOME);
          else process.chdir(args);
        } catch (err) {
          console.error(`${args}: No such file or directory`);
        }
        break;
      default:
        await handle_external_function(command, argv.slice(1));
    }
  }
}

function split_into_argv(input) {
  const tokens = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inSingle) {
      if (ch === "'") inSingle = false;
      else current += ch;
    } else if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (
        ch === "\\" &&
        i + 1 < input.length &&
        `"\\$\``.includes(input[i + 1])
      ) {
        current += input[++i]; // only escape special chars in double quotes
      } else {
        current += ch;
      }
    } else if (ch === "\\" && i + 1 < input.length) {
      current += input[++i]; // escape next char literally outside quotes
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === " ") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
    i++;
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

async function check_valid_type(args) {
  const path_directories = process_path.split(path.delimiter);
  let exists = false;
  for (const path_directory of path_directories) {
    const err = await check_file_executable(path.join(path_directory, args));
    if (!err) {
      console.log(`${args} is ${path.join(path_directory, args)}`);
      exists = true;
      break;
    }
  }
  if (!exists) {
    console.log(`${args}: not found`);
  }
}

function check_file_executable(filePath) {
  return new Promise((resolve) => {
    fs.access(filePath, fs.constants.X_OK, resolve);
  });
}

function handle_external_function(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });
    if (
      child.on("error", (err) => {
        console.log(`${command}: command not found`);
      })
    )
      child.on("close", resolve);
  });
}

main();
