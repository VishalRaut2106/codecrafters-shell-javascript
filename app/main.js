const readline = require("readline");
const fs = require("fs");
const path = require("path");

const builtins = ["echo", "exit", "type", "pwd", "cd"];

let lastTabLine = "";

function getCommonPrefix(strings) {
  if (strings.length === 0) return "";
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (strings[i].indexOf(prefix) !== 0) {
      prefix = prefix.substring(0, prefix.length - 1);
      if (!prefix) return "";
    }
  }
  return prefix;
}

function completer(line) {
  const parts = line.split(" ");
  if (parts.length > 1) {
    // Filename completion
    const lastPart = parts[parts.length - 1];
    let searchDir = ".";
    let prefix = lastPart;
    let pathPrefix = "";
    const lastSlashIndex = lastPart.lastIndexOf("/");

    if (lastSlashIndex !== -1) {
      pathPrefix = lastPart.substring(0, lastSlashIndex + 1);
      searchDir = pathPrefix;
      prefix = lastPart.substring(lastSlashIndex + 1);
    }

    try {
      if (fs.existsSync(searchDir) && fs.statSync(searchDir).isDirectory()) {
        let hits = fs
          .readdirSync(searchDir)
          .filter((f) => f.startsWith(prefix));
        hits = Array.from(new Set(hits)).sort();

        if (hits.length === 1) {
          lastTabLine = "";
          const fullMatchPath = path.join(searchDir, hits[0]);
          const isDir = fs.statSync(fullMatchPath).isDirectory();
          if (isDir) {
            return [[pathPrefix + hits[0] + "/"], lastPart];
          } else {
            return [[pathPrefix + hits[0] + " "], lastPart];
          }
        }
        if (hits.length > 1) {
          const commonPrefix = getCommonPrefix(hits);
          if (commonPrefix.length > prefix.length) {
            lastTabLine = "";
            return [[pathPrefix + commonPrefix], lastPart];
          }
          if (line === lastTabLine) {
            const displayHits = hits.map((h) => {
              try {
                if (fs.statSync(path.join(searchDir, h)).isDirectory())
                  return h + "/";
              } catch (e) {}
              return h;
            });
            process.stdout.write("\r\n" + displayHits.join("  ") + "\r\n");
            rl.line = "";
            rl.cursor = 0;
            rl.prompt();
            rl.write(line);
            lastTabLine = "";
          } else {
            process.stdout.write("\x07");
            lastTabLine = line;
          }
          return [[], lastPart];
        }
      }
    } catch (e) {}
    process.stdout.write("\x07");
    lastTabLine = "";
    return [[], lastPart];
  }

  let completions = [...builtins];

  const paths = (process.env.PATH || "").split(path.delimiter);
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const files = fs.readdirSync(p);
      for (const file of files) {
        const fullPath = path.join(p, file);
        try {
          fs.accessSync(fullPath, fs.constants.X_OK);
          if (!completions.includes(file)) {
            completions.push(file);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  completions = Array.from(new Set(completions)).sort();
  const hits = completions.filter((c) => c.startsWith(line));

  if (hits.length === 0) {
    process.stdout.write("\x07");
    lastTabLine = "";
    return [[], line];
  }

  if (hits.length === 1) {
    lastTabLine = "";
    return [[hits[0] + " "], line];
  }

  const commonPrefix = getCommonPrefix(hits);
  if (commonPrefix.length > line.length) {
    lastTabLine = "";
    return [[commonPrefix], line];
  }

  if (line === lastTabLine) {
    // Second tab
    process.stdout.write("\r\n" + hits.join("  ") + "\r\n");
    rl.line = "";
    rl.cursor = 0;
    rl.prompt();
    rl.write(line);
    lastTabLine = "";
  } else {
    // First tab
    process.stdout.write("\x07");
    lastTabLine = line;
  }

  return [[], line];
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
    } else if (char === "|" && !inSingleQuote && !inDoubleQuote) {
      if (hasChars) {
        args.push(currentArg);
        currentArg = "";
        hasChars = false;
      }
      args.push("|");
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

  const stages = [];
  let currentStage = [];
  for (const token of parsedArgs) {
    if (token === "|") {
      stages.push(currentStage);
      currentStage = [];
    } else {
      currentStage.push(token);
    }
  }
  stages.push(currentStage);

  if (stages.length === 1) {
    const tokens = stages[0];
    let stdoutFile = null;
    let stdoutAppend = false;
    let stderrFile = null;
    let stderrAppend = false;
    const filteredArgs = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === ">" || token === "1>") {
        stdoutFile = tokens[++i];
        stdoutAppend = false;
      } else if (token === ">>" || token === "1>>") {
        stdoutFile = tokens[++i];
        stdoutAppend = true;
      } else if (token === "2>") {
        stderrFile = tokens[++i];
        stderrAppend = false;
      } else if (token === "2>>") {
        stderrFile = tokens[++i];
        stderrAppend = true;
      } else {
        filteredArgs.push(token);
      }
    }

    const [command, ...args] = filteredArgs;

    if (stdoutFile) {
      const dir = path.dirname(stdoutFile);
      if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
      if (!stdoutAppend || !fs.existsSync(stdoutFile))
        fs.writeFileSync(stdoutFile, "");
    }
    if (stderrFile) {
      const dir = path.dirname(stderrFile);
      if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
      if (!stderrAppend || !fs.existsSync(stderrFile))
        fs.writeFileSync(stderrFile, "");
    }

    const writeOutput = (text) => {
      if (stdoutFile) fs.appendFileSync(stdoutFile, text + "\n");
      else console.log(text);
    };
    const writeError = (text) => {
      if (stderrFile) fs.appendFileSync(stderrFile, text + "\n");
      else console.error(text);
    };

    if (command === "exit") {
      process.exit(0);
    } else if (command === "echo") {
      writeOutput(args.join(" "));
      rl.prompt();
    } else if (command === "type") {
      const target = args[0];
      if (builtins.includes(target))
        writeOutput(`${target} is a shell builtin`);
      else {
        const fullPath = findInPath(target);
        if (fullPath) writeOutput(`${target} is ${fullPath}`);
        else writeOutput(`${target}: not found`);
      }
      rl.prompt();
    } else if (command === "pwd") {
      writeOutput(process.cwd());
      rl.prompt();
    } else if (command === "cd") {
      let dir = args[0];
      if (dir === "~") dir = process.env.HOME;
      try {
        process.chdir(dir);
      } catch (e) {
        writeError(`cd: ${args[0]}: No such file or directory`);
      }
      rl.prompt();
    } else {
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
        for (const fd of fds) fs.closeSync(fd);
      } else {
        writeError(`${command}: command not found`);
      }
      rl.prompt();
    }
  } else {
    // Pipeline support
    const { spawn } = require("child_process");
    let prevChild = null;

    for (let i = 0; i < stages.length; i++) {
      const tokens = stages[i];
      let stdoutFile = null;
      let stdoutAppend = false;
      let stderrFile = null;
      let stderrAppend = false;
      const filtered = [];
      for (let j = 0; j < tokens.length; j++) {
        const t = tokens[j];
        if (t === ">" || t === "1>") {
          stdoutFile = tokens[++j];
          stdoutAppend = false;
        } else if (t === ">>" || t === "1>>") {
          stdoutFile = tokens[++j];
          stdoutAppend = true;
        } else if (t === "2>") {
          stderrFile = tokens[++j];
          stderrAppend = false;
        } else if (t === "2>>") {
          stderrFile = tokens[++j];
          stderrAppend = true;
        } else filtered.push(t);
      }

      const [cmd, ...cargs] = filtered;
      const fPath = findInPath(cmd);
      if (!fPath) {
        process.stderr.write(`${cmd}: command not found\n`);
        continue;
      }

      let stdio = [prevChild ? prevChild.stdout : "inherit", "pipe", "inherit"];
      if (i === stages.length - 1) stdio[1] = "inherit";

      let fds = [];
      if (stdoutFile) {
        const dir = path.dirname(stdoutFile);
        if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
        const fd = fs.openSync(stdoutFile, stdoutAppend ? "a" : "w");
        stdio[1] = fd;
        fds.push(fd);
      }
      if (stderrFile) {
        const dir = path.dirname(stderrFile);
        if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
        const fd = fs.openSync(stderrFile, stderrAppend ? "a" : "w");
        stdio[2] = fd;
        fds.push(fd);
      }

      const child = spawn(fPath, cargs, { stdio, argv0: cmd });
      if (prevChild) prevChild.stdout.unref(); // Avoid hanging on previous stage's stdout

      prevChild = child;

      if (i === stages.length - 1) {
        child.on("exit", () => {
          for (const fd of fds)
            try {
              fs.closeSync(fd);
            } catch (e) {}
          rl.prompt();
        });
      }
    }
  }
});