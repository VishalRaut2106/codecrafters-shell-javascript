const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const builtins = ["echo", "type", "exit", "pwd", "cd"];
let lastTabLine = "";
let lastTabMatchesKey = "";
let rl;

function getLongestCommonPrefix(items) {
  if (items.length === 0) return "";
  let prefix = items[0];
  for (let i = 1; i < items.length; i++) {
    let j = 0;
    while (j < prefix.length && j < items[i].length && prefix[j] === items[i][j]) {
      j++;
    }
    prefix = prefix.slice(0, j);
    if (prefix.length === 0) break;
  }
  return prefix;
}

function getCommandCompletions(prefix) {
  const candidates = new Set(builtins);
  const pathDirs = (process.env.PATH || "").split(path.delimiter);

  for (const dir of pathDirs) {
    try {
      for (const file of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        try {
          fs.accessSync(fullPath, fs.constants.X_OK);
          candidates.add(file);
        } catch {
          // Ignore non-executable files.
        }
      }
    } catch {
      // Ignore unreadable PATH entries.
    }
  }

  return [...candidates]
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b));
}

rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: (line) => {
    const matches = getCommandCompletions(line);
    if (matches.length === 0) {
      lastTabLine = "";
      lastTabMatchesKey = "";
      process.stdout.write("\x07");
      return [[], line];
    }
    if (matches.length === 1) {
      lastTabLine = "";
      lastTabMatchesKey = "";
      return [[matches[0] + " "], line];
    }
    const commonPrefix = getLongestCommonPrefix(matches);
    if (commonPrefix.length > line.length) {
      lastTabLine = "";
      lastTabMatchesKey = "";
      return [[commonPrefix], line];
    }

    const matchesKey = matches.join("\0");
    if (lastTabLine === line && lastTabMatchesKey === matchesKey) {
      process.stdout.write(`\n${matches.join("  ")}\n`);
      if (typeof rl._refreshLine === "function") {
        rl._refreshLine();
      }
      lastTabLine = "";
      lastTabMatchesKey = "";
      return [[], line];
    }

    lastTabLine = line;
    lastTabMatchesKey = matchesKey;
    process.stdout.write("\x07");
    return [[], line];
  },
});

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

function parseRedirections(args) {
  const cleanArgs = [];
  let stdoutFile = null;
  let stderrFile = null;
  let stdoutAppend = false;
  let stderrAppend = false;

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    const next = args[i + 1];

    if ((token === ">" || token === "1>") && next) {
      stdoutFile = next;
      stdoutAppend = false;
      i++;
      continue;
    }

    if ((token === ">>" || token === "1>>") && next) {
      stdoutFile = next;
      stdoutAppend = true;
      i++;
      continue;
    }

    if (token === "2>" && next) {
      stderrFile = next;
      stderrAppend = false;
      i++;
      continue;
    }

    if (token === "2>>" && next) {
      stderrFile = next;
      stderrAppend = true;
      i++;
      continue;
    }

    cleanArgs.push(token);
  }

  return { cleanArgs, stdoutFile, stderrFile, stdoutAppend, stderrAppend };
}

function writeStdout(text, redirect) {
  if (redirect.stdoutFile) {
    fs.writeFileSync(redirect.stdoutFile, `${text}\n`, {
      flag: redirect.stdoutAppend ? "a" : "w",
    });
    return;
  }
  process.stdout.write(`${text}\n`);
}

function writeStderr(text, redirect) {
  if (redirect.stderrFile) {
    fs.writeFileSync(redirect.stderrFile, `${text}\n`, {
      flag: redirect.stderrAppend ? "a" : "w",
    });
    return;
  }
  process.stderr.write(`${text}\n`);
}

function prompt() {
  rl.question("$ ", (command) => {
    command = command.trim();
    const [cmd, ...args] = command.split(/\s+/);
    const redirect = parseRedirections(args);
    const commandArgs = redirect.cleanArgs;

    if (cmd === "exit" && (commandArgs.length === 0 || commandArgs[0] === "0")) {
      rl.close();
    } else if (cmd === "echo") {
      writeStdout(commandArgs.join(" "), redirect);
      prompt();
    } else if (cmd === "type") {
      let target = commandArgs[0];

      if (builtins.includes(target)) {
        writeStdout(`${target} is a shell builtin`, redirect);
        prompt();
        return;
      }

      const fullPath = findExecutable(target);
      if (fullPath) {
        writeStdout(`${target} is ${fullPath}`, redirect);
      } else {
        writeStdout(`${target}: not found`, redirect);
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
        let outFd = null;
        let errFd = null;

        try {
          if (redirect.stdoutFile) {
            outFd = fs.openSync(redirect.stdoutFile, redirect.stdoutAppend ? "a" : "w");
          }
          if (redirect.stderrFile) {
            errFd = fs.openSync(redirect.stderrFile, redirect.stderrAppend ? "a" : "w");
          }
        } catch (err) {
          if (outFd !== null) fs.closeSync(outFd);
          if (errFd !== null) fs.closeSync(errFd);
          writeStderr(err.message, {
            stderrFile: null,
            stderrAppend: false,
          });
          prompt();
          return;
        }

        const stdio = ["inherit", outFd !== null ? outFd : "inherit", errFd !== null ? errFd : "inherit"];

        const child = spawn(fullPath, commandArgs, { stdio, argv0: cmd });
        child.on("exit", () => {
          if (outFd !== null) fs.closeSync(outFd);
          if (errFd !== null) fs.closeSync(errFd);
          prompt();
        });
        child.on("error", (err) => {
          if (outFd !== null) fs.closeSync(outFd);
          if (errFd !== null) fs.closeSync(errFd);
          writeStderr(err.message, {
            stderrFile: null,
            stderrAppend: false,
          });
          prompt();
        });
      } else {
        writeStdout(`${cmd}: command not found`, redirect);
        prompt();
      }
    }
  });
}

prompt();