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

  const { spawn } = require("child_process");
  const { PassThrough } = require("stream");

  let prevStdout = null;

  async function runStages() {
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
      let stdout = i === stages.length - 1 ? process.stdout : "pipe";
      let stderr = process.stderr;

      let outFd = null;
      if (stdoutFile) {
        const dir = path.dirname(stdoutFile);
        if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
        outFd = fs.openSync(stdoutFile, stdoutAppend ? "a" : "w");
        stdout = outFd;
      }
      let errFd = null;
      if (stderrFile) {
        const dir = path.dirname(stderrFile);
        if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
        errFd = fs.openSync(stderrFile, stderrAppend ? "a" : "w");
        stderr = errFd;
      }

      if (builtins.includes(cmd)) {
        if (cmd === "exit") process.exit(0);

        const out = new PassThrough();
        const write = (msg) => {
          if (
            stdout instanceof fs.WriteStream ||
            typeof stdout === "number" ||
            stdout === process.stdout
          ) {
            if (typeof stdout === "number") fs.writeSync(stdout, msg + "\n");
            else if (stdout === process.stdout)
              process.stdout.write(msg + "\n");
            else stdout.write(msg + "\n");
          } else {
            out.write(msg + "\n");
          }
        };

        if (cmd === "echo") write(cargs.join(" "));
        else if (cmd === "pwd") write(process.cwd());
        else if (cmd === "type") {
          const target = cargs[0];
          if (builtins.includes(target)) write(`${target} is a shell builtin`);
          else {
            const fPath = findInPath(target);
            if (fPath) write(`${target} is ${fPath}`);
            else write(`${target}: not found`);
          }
        } else if (cmd === "cd") {
          let dir = cargs[0];
          if (dir === "~") dir = process.env.HOME;
          try {
            process.chdir(dir);
          } catch (e) {
            const msg = `cd: ${cargs[0]}: No such file or directory`;
            if (typeof stderr === "number") fs.writeSync(stderr, msg + "\n");
            else stderr.write(msg + "\n");
          }
        }

        out.end();
        prevStdout = out;
        if (outFd) fs.closeSync(outFd);
        if (errFd) fs.closeSync(errFd);

        if (i === stages.length - 1) rl.prompt();
      } else {
        const fullPath = findInPath(cmd);
        if (!fullPath) {
          const msg = `${cmd}: command not found\n`;
          process.stderr.write(msg);
          prevStdout = new PassThrough();
          prevStdout.end();
          if (i === stages.length - 1) rl.prompt();
          continue;
        }

        const stdio = [
          prevStdout ? "pipe" : "inherit",
          stdout === process.stdout
            ? "inherit"
            : typeof stdout === "number"
              ? stdout
              : "pipe",
          stderr === process.stderr
            ? "inherit"
            : typeof stderr === "number"
              ? stderr
              : "pipe",
        ];
        const child = spawn(fullPath, cargs, { stdio, argv0: cmd });

        if (prevStdout) prevStdout.pipe(child.stdin);

        if (stdio[1] === "pipe") prevStdout = child.stdout;
        else prevStdout = null;

        if (i === stages.length - 1) {
          child.on("exit", () => {
            if (outFd) fs.closeSync(outFd);
            if (errFd) fs.closeSync(errFd);
            rl.prompt();
          });
        }
      }
    }
  }

  runStages();
});
