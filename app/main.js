const readline = require("readline");
const fs = require("fs");
const path = require("path");

const builtins = ["echo", "exit", "type", "pwd", "cd"];

function completer(line) {
  const completions = ["echo", "exit"];
  const hits = completions.filter((c) => c.startsWith(line));
  return [hits.length ? hits.map((h) => h + " ") : [], line];
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer: completer,
});

rl.prompt();

function findInPath(command) {
  if (command.includes("/") || command.includes(path.sep)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return command;
    } catch (e) {
      return null;
    }
  }
  const paths = (process.env.PATH || "").split(path.delimiter);
  for (const p of paths) {
    const fullPath = path.join(p, command);
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return fullPath;
    } catch (e) {
      // Continue searching
    }
  }
  return null;
}

function parseInput(line) {
  const args = [];
  let currentArg = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let hasChars = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === "\\" && !inSingleQuote) {
      if (inDoubleQuote) {
        const nextChar = line[i + 1];
        if (nextChar === '"' || nextChar === "\\" || nextChar === "$") {
          currentArg += nextChar;
          i++;
        } else {
          currentArg += char;
        }
        hasChars = true;
      } else {
        // Backslash outside quotes: escape next char
        i++;
        if (i < line.length) {
          currentArg += line[i];
          hasChars = true;
        }
      }
    } else if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      hasChars = true;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      hasChars = true;
    } else if (char === ">" && !inSingleQuote && !inDoubleQuote) {
      if (hasChars) {
        args.push(currentArg);
        currentArg = "";
        hasChars = false;
      }
      if (line[i + 1] === ">") {
        args.push(">>");
        i++;
      } else {
        args.push(">");
      }
    } else if (
      char === "1" &&
      line[i + 1] === ">" &&
      !inSingleQuote &&
      !inDoubleQuote
    ) {
      if (hasChars) {
        args.push(currentArg);
        currentArg = "";
        hasChars = false;
      }
      if (line[i + 2] === ">") {
        args.push("1>>");
        i += 2;
      } else {
        args.push("1>");
        i++;
      }
    } else if (
      char === "2" &&
      line[i + 1] === ">" &&
      !inSingleQuote &&
      !inDoubleQuote
    ) {
      if (hasChars) {
        args.push(currentArg);
        currentArg = "";
        hasChars = false;
      }
      if (line[i + 2] === ">") {
        args.push("2>>");
        i += 2;
      } else {
        args.push("2>");
        i++;
      }
    } else if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (hasChars) {
        args.push(currentArg);
        currentArg = "";
        hasChars = false;
      }
    } else {
      currentArg += char;
      hasChars = true;
    }
  }

  if (hasChars) {
    args.push(currentArg);
  }

  return args;
}

rl.on("line", (line) => {
  const parsedArgs = parseInput(line.trim());
  if (parsedArgs.length === 0) {
    rl.prompt();
    return;
  }

  // Handle redirection
  let stdoutFile = null;
  let stdoutAppend = false;
  let stderrFile = null;
  let stderrAppend = false;
  const filteredArgs = [];
  for (let i = 0; i < parsedArgs.length; i++) {
    const token = parsedArgs[i];
    if (token === ">" || token === "1>") {
      stdoutFile = parsedArgs[++i];
      stdoutAppend = false;
    } else if (token === ">>" || token === "1>>") {
      stdoutFile = parsedArgs[++i];
      stdoutAppend = true;
    } else if (token === "2>") {
      stderrFile = parsedArgs[++i];
      stderrAppend = false;
    } else if (token === "2>>") {
      stderrFile = parsedArgs[++i];
      stderrAppend = true;
    } else {
      filteredArgs.push(token);
    }
  }

  const [command, ...args] = filteredArgs;

  if (stdoutFile) {
    const dir = path.dirname(stdoutFile);
    if (dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!stdoutAppend) {
      fs.writeFileSync(stdoutFile, "");
    } else if (!fs.existsSync(stdoutFile)) {
      fs.writeFileSync(stdoutFile, "");
    }
  }
  if (stderrFile) {
    const dir = path.dirname(stderrFile);
    if (dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!stderrAppend) {
      fs.writeFileSync(stderrFile, "");
    } else if (!fs.existsSync(stderrFile)) {
      fs.writeFileSync(stderrFile, "");
    }
  }

  const writeOutput = (text) => {
    if (stdoutFile) {
      fs.appendFileSync(stdoutFile, text + "\n");
    } else {
      console.log(text);
    }
  };

  const writeError = (text) => {
    if (stderrFile) {
      fs.appendFileSync(stderrFile, text + "\n");
    } else {
      console.error(text);
    }
  };

  if (command === "exit") {
    process.exit(0);
  } else if (command === "echo") {
    writeOutput(args.join(" "));
    rl.prompt();
  } else if (command === "type") {
    const target = args[0];
    if (builtins.includes(target)) {
      writeOutput(`${target} is a shell builtin`);
    } else {
      const fullPath = findInPath(target);
      if (fullPath) {
        writeOutput(`${target} is ${fullPath}`);
      } else {
        writeOutput(`${target}: not found`);
      }
    }
    rl.prompt();
  } else if (command === "pwd") {
    writeOutput(process.cwd());
    rl.prompt();
  } else if (command === "cd") {
    let dir = args[0];
    if (dir === "~") {
      dir = process.env.HOME;
    }
    try {
      if (!dir) throw new Error();
      process.chdir(dir);
    } catch (e) {
      writeError(`cd: ${args[0]}: No such file or directory`);
    }
    rl.prompt();
  } else {
    // Check if it's an external program
    const fullPath = findInPath(command);
    if (fullPath) {
      const { spawnSync } = require("child_process");
      let stdio = ["inherit", "inherit", "inherit"];
      let fds = [];

      if (stdoutFile) {
        const fd = fs.openSync(stdoutFile, stdoutAppend ? "a" : "w");
        stdio[1] = fd;
        fds.push(fd);
      }

      if (stderrFile) {
        const fd = fs.openSync(stderrFile, stderrAppend ? "a" : "w");
        stdio[2] = fd;
        fds.push(fd);
      }

      spawnSync(fullPath, args, { stdio, argv0: command });

      for (const fd of fds) {
        fs.closeSync(fd);
      }
    } else {
      writeError(`${command}: command not found`);
    }
    rl.prompt();
  }
});
