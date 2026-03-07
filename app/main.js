const readline = require("readline");
const fs = require("fs");
const pathModule = require("path");
const { spawnSync } = require("child_process");
const os = require("os");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

let redirectStdout = null;
let redirectStderr = null;

/** CONSTANTS */
const COMMANDS = {
  EXIT: "exit",
  ECHO: "echo",
  TYPE: "type",
  PWD: "pwd",
  CD: "cd",
};

/** UTILITY FUNCTIONS */
function print(text) {
  if (redirectStdout) {
    const fd = fs.openSync(redirectStdout, redirectStdoutMode);
    fs.writeFileSync(fd, text + "\n");
    fs.closeSync(fd);
    return;
  }
  console.log(text);
}

function printError(text) {
  if (redirectStderr) {
    const fd = fs.openSync(redirectStderr, redirectStderrMode);
    fs.writeFileSync(fd, text + "\n");
    fs.closeSync(fd);
    return;
  }
  console.error(text);
}

function prompt() {
  rl.prompt();
}

function findCommand(command) {
  for (const p of process.env.PATH.split(":")) {
    const commandPath = pathModule.join(p, command);
    try {
      fs.accessSync(commandPath, fs.constants.X_OK);
      return commandPath;
    } catch (e) { }
  }
  return null;
}

function replaceTilda(path) {
  if (path === "~") {
    return os.homedir();
  }
  if (path.startsWith("~/")) {
    return pathModule.join(os.homedir(), path.slice(2));
  }
  return path;
}

function parseArguments(line) {
  const tokens = [];
  let current = "";
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === "\\" && i + 1 < line.length) {
      // In single quotes, backslash is literal
      if (inSingleQuotes) {
        current += char;
        continue;
      }

      // In double quotes, only certain characters (",\,$,`) can be escaped
      if (inDoubleQuotes) {
        const nextChar = line[i + 1];
        if (
          nextChar === '"' ||
          nextChar === "\\" ||
          nextChar === "$" ||
          nextChar === "`"
        ) {
          current += nextChar;
          i++;
        } else {
          current += char;
        }
        continue;
      }

      // Outside quotes, backslash escapes the next character
      current += line[i + 1];
      i++;
      continue;
    }

    if (char === '"') {
      if (inSingleQuotes) {
        current += char;
        continue;
      }
      inDoubleQuotes = !inDoubleQuotes;
      inQuotes = inDoubleQuotes || inSingleQuotes;
      continue;
    }

    if (char === "'") {
      if (inDoubleQuotes) {
        current += char;
        continue;
      }
      inSingleQuotes = !inSingleQuotes;
      inQuotes = inDoubleQuotes || inSingleQuotes;
      continue;
    }

    if (char === " " && !inQuotes) {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current !== "") tokens.push(current);

  const parsed = tokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  let command = parsed[0];
  let args = parsed.slice(1);

  redirectStdout = null;
  redirectStderr = null;

  const cleanArgs = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const isRedirectStdoutWriteOperator = arg === ">" || arg === "1>";
    const isRedirectStderrWriteOperator = arg === "2>";
    const isRedirectStdoutAppendOperator = arg === ">>" || arg === "1>>";
    const isRedirectStderrAppendOperator = arg === "2>>";

    if (isRedirectStdoutWriteOperator || isRedirectStdoutAppendOperator) {
      if (i + 1 < args.length) {
        redirectStdout = args[i + 1];
        redirectStdoutMode = isRedirectStdoutAppendOperator ? "a" : "w";
        fs.closeSync(fs.openSync(redirectStdout, redirectStdoutMode));
        i++;
      }
    } else if (isRedirectStderrWriteOperator || isRedirectStderrAppendOperator) {
      if (i + 1 < args.length) {
        redirectStderr = args[i + 1];
        redirectStderrMode = isRedirectStderrAppendOperator ? "a" : "w";
        fs.closeSync(fs.openSync(redirectStderr, redirectStderrMode));
        i++;
      }
    } else {
      cleanArgs.push(arg);
    }
  }
  args = cleanArgs;
  args = cleanArgs;

  return { command, args };
}

/** BUILTIN COMMANDS */
function handleChangeDirectory({ args }) {
  const path = replaceTilda(args[0]);

  try {
    fs.accessSync(path, fs.constants.R_OK);
    process.chdir(path);
  } catch (e) {
    printError(`cd: no such file or directory: ${path}`);
    prompt();
    return;
  }

  prompt();
}

function handlePrintWorkingDirectory({ args }) {
  print(process.cwd());
  prompt();
}

function handleExit() {
  rl.close();
}

function handleEcho({ args }) {
  print(args.join(" "));
  prompt();
}

function handleExternalCommand({ command, args }) {
  const stdio = ["inherit", "inherit", "inherit"];
  let stdoutFd = null;
  let stderrFd = null;

  if (redirectStdout) {
    stdoutFd = fs.openSync(redirectStdout, redirectStdoutMode);
    stdio[1] = stdoutFd;
  }
  if (redirectStderr) {
    stderrFd = fs.openSync(redirectStderr, redirectStderrMode);
    stdio[2] = stderrFd;
  }

  const childProcess = spawnSync(command, args, { stdio });

  if (stdoutFd) fs.closeSync(stdoutFd);
  if (stderrFd) fs.closeSync(stderrFd);

  prompt();
}

function handleUnknownCommand({ command }) {
  printError(`${command}: command not found`);
  prompt();
}

function handleType({ args }) {
  const command = args[0];

  if (!command) {
    prompt();
    return;
  }

  if (Object.values(COMMANDS).includes(command)) {
    print(`${command} is a shell builtin`);
    prompt();
    return;
  }

  const commandPath = findCommand(command);
  if (commandPath) {
    print(`${command} is ${commandPath}`);
    prompt();
    return;
  }

  print(`${command}: not found`);
  prompt();
}

/** MAIN FUNCTION */
function main() {
  prompt();

  rl.on("line", (line) => {
    const input = parseArguments(line);
    const command = input.command;

    if (!command) {
      prompt();
      return;
    }

    switch (command) {
      case COMMANDS.CD:
        handleChangeDirectory(input);
        return;
      case COMMANDS.PWD:
        handlePrintWorkingDirectory(input);
        return;
      case COMMANDS.EXIT:
        handleExit();
        return;
      case COMMANDS.TYPE:
        handleType(input);
        return;
      case COMMANDS.ECHO:
        handleEcho(input);
        return;
      default:
        if (findCommand(command)) {
          handleExternalCommand(input);
          return;
        }
        handleUnknownCommand(input);
        return;
    }
  });
}

main();
